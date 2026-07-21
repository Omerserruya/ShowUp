# ShowUp — Production Hardening: Implementation & Audit
**Date:** 2026-07-20 · **Baseline:** `d9b6bb76` · **Closes:** `docs/PRODUCTION_GAPS_2026-07-20.md`

40 files changed, 5 added, ~1,630 insertions. **151 automated checks across 7 suites, all passing**, run inside the real service images against throwaway PostgreSQL.

---

## The four invariants everything else rests on

Rather than patching each finding, the fixes introduce four invariants that make whole classes of bug unrepresentable.

**1. `active` is derived, never assigned.**
`shared/domain/lifecycle.py::derive_active(state, payment_status)` is the only way the column is set. Because every pre-existing `WHERE active` filter — scheduler, campaign-worker, planner, audience queries — already consults it, payment enforcement reached all of them without a single duplicated check. An unsettled event simply stops being active.

**2. Provisioning idempotency is a database constraint.**
`events.provisioning_order_id` is UNIQUE. A duplicate IPN cannot create a second event even if the caller's locking is wrong, because the guarantee does not live in the caller. Verified by racing an INSERT against the constraint directly.

**3. Enqueue is not delivery.**
`messages_sent` now carries a lifecycle (`queued → accepted → delivered/read`, or `failed`). campaign-worker *claims* a row **before** publishing; outpost writes Meta's verdict; a finalizer promotes the campaign. Claiming before publishing also collapsed the old check-then-act dedup race: a crash can now only under-send, never double-send.

**4. A phone number is not a credential.**
Public RSVP is authorised by a per-guest HMAC token in the invite link. Possession of the link is the credential, exactly like a password-reset link.

---

## Checklist

| Requirement | Status | Where / how verified |
|---|---|---|
| Payment cannot be bypassed | **Done** | `plan_id`/`payment_status`/`active` removed from `EventCreate`/`EventUpdate`; the attack payload is silently dropped (verified against the real Pydantic models). Sole writer is `app/provisioning.py`. |
| Events cannot activate without payment | **Done** | `derive_active`; a PENDING event is inactive in every state. 19/19 checks. |
| Plan limits cannot be bypassed | **Done** | Bulk round-gate bypass closed (gate applies to every create path); guest-cap bypass via `update_guest` closed; bulk import now locks *before* checking. |
| Public RSVP endpoints are secure | **Done** | Signed tokens; untokened submits cannot read or overwrite. 23/23 checks. |
| Guest information cannot be enumerated | **Done** | Phone-only lookup returns `found:false` identically to an unknown guest — no oracle. |
| Message delivery reflects Meta responses | **Done** | outpost records accepted/failed per message; receipts advance to delivered/read, rank-guarded against out-of-order webhooks. |
| Failed messages are visible | **Done** | `failed_count`/`queued_count`/`delivered_count` on campaign stats; Meta's error code and detail persisted per message. |
| Daily summaries are reliable | **Partial** | Now reads real delivery status; the *cadence* defects (no upper send-window bound, UTC/local day mismatch) remain — see Deferred. |
| Campaign statistics are accurate | **Done** | `sent_count` counts only Meta-accepted messages; `recipient_count` set from actual outcomes at finalization. |
| STOP / opt-out works | **Done** | Detection + suppression in **both** audience implementations; 29/29 checks, including that "stop asking me to bring a plus one" is not an opt-out. |
| Duplicate IPNs cannot duplicate provisioning | **Done** | Conditional-UPDATE claim + UNIQUE constraint. 24/24 checks. |
| Payment reconciliation exists | **Done** | `scheduler-service/payment_reconciliation.py` → aub `/orders/internal/reconcile`; recovers lost IPNs and releases stale claims, never provisions an unverified payment. |
| Rate limiting is active | **Done** | nginx `limit_req` zones; both configs validated with `nginx -t`. |
| No privilege escalation remains | **Done for the audited surface** | See "Found beyond the brief". |

---

## Found beyond the brief

Issues not in the original audit, discovered while implementing:

- **`clone_event` minted unmetered events.** It copied no plan, and `included_rounds(None)` returned 9999 — so cloning an event granted unlimited rounds. `included_rounds` now fails closed, and clones start on the free starter plan.
- **The implicit-unmetered default was load-bearing.** Legacy events carry `plan_id = NULL` and relied on that accident. Failing closed alone would have blocked real customers mid-event, so they are backfilled to an explicit `legacy` plan listed in `UNMETERED_PLAN_IDS` — the exemption is now named and greppable instead of being a default any new code path silently inherits.
- **Guest capacity failed OPEN.** A 2-second aub timeout returned "no limit", so an aub blip disabled guest caps platform-wide. Now fails closed with last-known-good caching and a single 503 handler.
- **`apply_schema_patches` aborted on first failure.** On a virgin database `ensure_campaign_template_key` raises (it selects `campaigns.campaign_type`, which `create_all` never creates), which would have silently skipped every later patch — including the new opt-out and delivery columns. Patches are now fault-isolated; verified that all required columns land on a virgin DB while the legacy patch fails loudly.
- **Upgrade credit was unbacked.** It came from the plan *price list*, so a plan acquired for ₪0 generated a full-price credit. Now derived from actually-paid orders, with extra-round purchases excluded.
- **Downgrade was a permanent dead end** — unpayable because it cost nothing, unprovisionable because it was never paid. Now settles directly.

---

## Second-pass adversarial review (and what it caught)

An independent adversarial sweep was run against the hardened code. It found real
issues — **including two regressions introduced by this very effort.** All are fixed;
the full suite was re-run afterwards and still passes 151/151.

**P0 — aub-service was an unauthenticated front door to the entitlement writes core now protects.**
`POST /orders` has no auth and accepted a client-supplied `event_id`, and no
ownership check existed anywhere in the order lifecycle. Chained with the ₪0
internal `venue` tier (unlimited guests) and the new "nothing to charge → settle
directly" branch, anyone could grant themselves an unlimited plan for free, or
**downgrade a paying customer's event to `free`**. Core's internal secret protected
core from the internet, but aub was a confused deputy that signed the request.
*Fixed:* orders carrying an `event_id` now require a JWT and server-side ownership
confirmation from core (`_require_event_owner`, new `is_owner` on the internal
partner endpoint), and non-purchasable tiers (`venue`/`legacy`/`starter`) are
rejected outright.

**P0 — the IPN signing key could silently be the empty string.** `_ipn_secret()`
fell back to `""`, making the callback HMAC computable by anyone who learned an
order id — and the callback body is itself treated as payment evidence. *Fixed:*
raises instead, and the callback fails closed when unconfigured.

**P1 — `change_plan` destroyed the creation idempotency key (regression).** It
overwrote `provisioning_order_id` with the upgrade's order id, so after any
upgrade the original purchase order looked unprovisioned and a replayed or
reconciled IPN would create a **second full event**. *Fixed:* plan-change replays
are tracked by a separate `last_plan_order_id`; the creation key is now immutable.

**P2 — venue events silently lost their tier (regression).** `venues.py` still
passed `plan_id="venue"` / `payment_status="paid"` into `EventCreate`, which no
longer has those fields — Pydantic dropped them, landing venue couples on
`starter`. *Fixed:* venue events now go through `apply_entitlement`. This is the
exact failure mode the schema split is designed to cause loudly and instead caused
quietly; every other construction site was re-audited.

**P1 — venue console checked membership but never role.** A user invited as
VIEWER could create events, rewrite billing and the partner coupon, invite an
accomplice as MANAGER, and suspend members. *Fixed:* `_require_venue_admin` now
takes the required `Action` and consults the role matrix (default-deny).

**P2 — `EventUpdate.owners` was still client-writable.** An owner could `PUT
{"owners": []}` to permanently orphan an event, or silently transfer it, bypassing
the members API's `cannot_modify_owner` guards. *Fixed:* removed from the schema.

**P2 — `clone_event` was an escalation path.** It required only `EVENT_WRITE` but
minted `owners=[caller]` on a copy that could include the entire guest list, so a
MANAGER became OWNER of a full copy. *Fixed:* now requires owner-level authority.

**P1 — OTP brute force.** Verification caps at 5 attempts per code, but re-issuing
resets the counter, so a login→verify loop gave unbounded guesses at a 6-digit
secret. *Fixed:* `/api/auth` throttled at the edge. Note the underlying
resend-resets-counter behaviour is unchanged — the edge limit is the mitigation.

**Clean on re-review:** all `/internal/` handlers are secret-guarded and none are
nginx-routable; the entitlement-field removal genuinely holds; admin gating is
real everywhere; `invite_token.py` and `optout.py` had no flaws found; the order
claim/replay logic is correct; prices and `prev_plan` are always server-resolved.

---

## Deliberate design decisions worth reviewing

- **Untokened duplicate submissions return 409 rather than updating.** This is the change most likely to be felt: a guest who lost their link and re-submits gets "already registered" instead of a silent update. That is the price of closing the overwrite hole; the alternative (trusting the phone) is the vulnerability. Consider an SMS/WhatsApp "resend my link" flow.
- **Unreported payment amounts are accepted.** iCount's paypage IPN does not always state a total, and `get_sale_info` is unavailable. Refusing would strand legitimate customers, so we accept and log. Underpayment *is* rejected whenever an amount is present.
- **Campaigns pass through a new `sending` state** before `sent`/`failed`. Brief (one scheduler cycle) but visible in the UI.
- **Opt-out applies across all of a phone's events.** Someone saying STOP is opting out of being messaged by us, not by one guest list.

---

## Deferred (not launch-blocking, deliberately not done)

These were outside the hardening brief or need a product decision:

- **Daily-summary cadence** (report items A1, A3, A5, A6): no upper bound on the 20:00 send window so a late change triggers a near-midnight message; `campaigns_sent` counted on a UTC day but compared to a local date; NULL-date events summarised forever; offsetting changes go silent.
- **Releases fire at 03:00 Israel time** (`scheduler-service/db.py:194` — the day flips at 00:00 UTC) and there is no quiet-hours gate. Guests can receive campaign WhatsApps at 3 AM. **This is the highest-value remaining item.**
- **Meta rate limits still are not enforced on the send path** — they remain planner-only day-level arithmetic, and the legacy scheduler path can still race the planner. Needs a token bucket in outpost.
- **Coupons** have no expiry, usage limit, or redemption record.
- **No refund/chargeback handling** anywhere.
- **Dashboard vs summary count divergence** (report item 25): head count vs record count, from the same RSVP.
- **`noindex` on public invites**; core phone normalization is not true E.164.

---

## Deploy notes

- **Rebuild required:** core-service, aub-service, outpost-service, campaign-worker, scheduler-service, webhook-worker.
- **outpost-service now builds from the repo root** (it needs `shared/`) — both compose files updated. This is a build-context change, not just a code change.
- **scheduler-service** gained a `requests` dependency and `AUB_SERVICE_URL` / `INTERNAL_API_SECRET` env vars.
- `INTERNAL_API_SECRET` must be set, or provisioning fails closed with a 503 (by design).
- `INVITE_TOKEN_SECRET` is optional; it falls back to `JWT_SECRET`. **Rotating either invalidates already-delivered invite links.**
- Reload nginx after recreating containers.
- Migrations are idempotent and backfill-safe; they were verified not to deactivate or suppress any existing row.

**Not done:** live end-to-end against real iCount and Meta. Everything here is verified against the real code and a real database, but no real payment was taken and no real WhatsApp message was sent.
