# ShowUp — Production Readiness Gap Report
**Date:** 2026-07-20 · **Commit:** d9b6bb76 · **Method:** graphify graph navigation + 5 parallel source audits (creation/activation, billing, assistant contact upload, daily updates + campaigns, invitation link)

Every finding below was confirmed in source. `file:line` references are to commit d9b6bb76.

---

## VERDICT

**Not launchable as-is.** Eleven P0s. Three of them are structural rather than local bugs:

1. **Payment does not gate anything.** The core business rule — "event active only after successful paying" — is not implemented in the backend at all.
2. **Enqueue is treated as delivery, everywhere.** Daily summaries, owner notifications, and campaigns all mark success when a message reaches RabbitMQ. If Meta rejects it, nobody — owner, admin, or the system — ever finds out.
3. **The public invitation endpoints are unauthenticated and unthrottled**, so RSVPs can be read, forged, and mass-created by anyone with a phone number or a guessed slug.

---

## P0 — Launch blockers

### 1. Any logged-in user can self-provision a fully paid Pro event
`core-service/app/routers/events.py:55-77` → `crud/event.py:98-103,126-127`. `plan_id` and `payment_status` are plain client fields on both `POST /events` and `PUT /events/{id}` (`schemas.py:95-96,120`). aub's `provision_order` (`orders.py:820-824,915-919`) calls those very same public endpoints with an ordinary user JWT — there is no internal-secret path distinguishing provisioning from a user request.

```
POST /api/events {"name":"x","plan_id":"pro","payment_status":"paid"}   → paid Pro event, ₪0 charged
PUT  /api/events/{id} {"plan_id":"anything"}                             → unknown plan ⇒ included_rounds
                                                                            returns _UNMETERED=9999
                                                                            (shared/domain/rounds.py:32-35)
                                                                            and check_capacity_limit exits
                                                                            early (crud/guest.py:114-121)
                                                                            ⇒ unlimited rounds AND guests
```
*Independently confirmed by two auditors.* This single gap defeats the entire billing system.

**Fix:** move plan/payment mutation behind an internal-secret endpoint; strip both fields from the public schemas.

### 2. `payment_status` is dead metadata — nothing is gated on payment
`models.py:48` defines it. The only readers are `admin.py:40` and `EventContext.tsx:111`, both display-only. No campaign, guest, invite, or send path consults it. **An event is fully usable the moment it exists.** The paid flow appears to work only because the frontend chooses not to call `POST /events` for paid plans — a client-side convention, not a server rule.

**Fix:** an `active`/`paid` predicate enforced server-side at: campaign create + send, guest import, invitation publish.

### 3. Paid-round gate bypassed by sending two items
`core-service/app/routers/campaigns.py:235` — `if len(to_create) == 1:`. The 402 `extra_round_required` check runs only for single-item creates. `POST /campaigns?event_id=X` with `items:[a,b]` creates unlimited rounds for free. The bulk exemption was meant for the wizard, but nothing authenticates the caller as the wizard. *Independently confirmed by two auditors.* There is also **no send-time round check anywhere** in scheduler or worker.

### 4. Public RSVP: read and overwrite any guest by phone number
`core-service/app/routers/public_invite.py:66-86` — `/rsvp/lookup` returns `name`, `status`, `party_size`, `notes` for any phone submitted. No auth, no token, no throttle. `:108-132` then lets the same anonymous caller overwrite that row. Two attacks: targeted tampering (flip a confirmation to declined; owner sees a legitimate decline, guest never knows) and bulk enumeration of the invitee list over the ~10^7 Israeli mobile space.

### 5. Zero rate limiting on any public endpoint
No limiter in core-service (grep `rate_limit|slowapi|limiter` → only an OpenAI exception name at `routers/assistant.py:193`); no `limit_req` zone in `nginx/nginx.conf` or `nginx/conf.d/default.conf` — `/api/public` at `default.conf:213-220` is a bare `proxy_pass`. A bot POSTing `/rsvp` with random phones and `partySize=50` (schema max, `schemas.py:71`) fills a 400-guest plan in seconds and triggers the owner's capacity-warning WhatsApp. The module docstring at `public_invite.py:15-16` already flags this as a known follow-up.

> **4 and 5 compound.** Rate limiting alone still leaves targeted tampering; unguessable slugs alone still leave the lookup oracle. Minimum viable fix is a **per-guest signed token in the invite link** (or OTP before lookup/update) **plus** an nginx `limit_req` zone on `/api/public`.

### 6. No deliverability gate at send time
Gate exists only at create (`campaigns.py:222`) and update-when-template-changes (`:288-291`). Bypassed three ways: (a) `_require_deliverable_template` returns silently when `resolve_template` yields `None` (`:78-81`) — exactly the stage/variant-addressed path; (b) `campaigns.py` never inspects `stage_id`/`variant_id`; (c) a template approved at create and later paused/rejected by Meta is never rechecked. `campaign-worker/worker.py:181` then raises per-guest at `meta_adapter.py:69-72`, counts into `failed_count`, and **still marks the campaign `sent`** (`:206,208`). Aggravated by `resolver.py:175` falling back to the *base* template, which its own docstring says usually has no Meta mapping.

**Result:** a 300-guest round delivers 0 messages and reports status "sent".

### 7. Meta rate limits are never enforced on the send path
`META_MESSAGES_PER_SECOND` / `META_NEW_CONVERSATIONS_PER_24H` exist only as day-level arithmetic in `planner-service/planner/config.py:65-66,112`. `campaign-worker/worker.py:158-196` publishes the whole batch with no pacing; `outpost-service/rabbit_consumer.py:70` `prefetch_count=1` makes throughput an accident of HTTP latency, not a token bucket.

Worse — **the legacy path bypasses the planner entirely.** `scheduler-service/db.py:145-174` claims any pending campaign with `schedule_time <= NOW()` and no release rows, publishing with no `limit`. `Messages.tsx:634-638` "send now" sets `schedule_time = now + 30s`; whether the planner (60s loop) creates releases before the scheduler's 30s cycle claims it is a **race**. Losing the race blasts the full audience at once, past every cap.

### 8. Campaign failures are invisible to the owner
`failed_count` (`worker.py:186,195`) is logged and discarded — never written to `campaigns`. `mark_campaign_completed` (`db.py:137-156`) sets `recipient_count = sent_count`, where "sent" means *enqueued*. Meta errors in `rabbit_consumer.py:251-271,364-373` are log-only: no `messages_log` row, no error column, no notification. **A fully failed campaign is indistinguishable from a fully delivered one in the UI.**

### 9. Daily summary: publish counted as delivery
`scheduler-service/daily_summary.py:272-288` counts `delivered` on successful RabbitMQ publish; outpost then swallows Meta errors and acks (`rabbit_consumer.py:251-271`). Since `daily_summary_v2` is reportedly still *pending* approval on the WABA, every owner summary fails silently forever — and the `daily_summaries` row is marked sent, so the deltas are consumed and never re-reported. Same defect in the owner-notification outbox (`notifications.py:92-96`), which marks `sent` on enqueue and whose `MAX_ATTEMPTS` counts only *publish* failures.

### 10. Contact messages routed by category instead of by phone number
`webhook-hendler/main.py:365-378` sends **every** `type=contacts` message to `contact_import_queue` before `route_inbound_message` (line 383) is reached. A guest sharing a contact card with the campaign/RSVP number is swallowed by contact-import; if that guest happens to own an event, the contact is silently imported into their own guest list. The reply is then sent from the assistant number (`worker.py:118-128`), which has no open 24-hour window with that person, so Meta rejects it with no fallback.

**Fix:** apply `route_inbound_message` first; accept contacts only on `ASSISTANT_WA_PHONE_ID`.

### 11. No opt-out / STOP handling anywhere
Repo-wide search for `opt_out|optout|unsubscrib|do_not_contact|blocked_at` across `*.py`/`*.tsx`/`*.sql` returns **zero hits**. `campaign-worker/audience.py:21` filters only on a non-empty phone. A guest who replies STOP keeps receiving every subsequent round — a WABA quality-rating and regulatory exposure.

---

## P1 — Fix before real volume

| # | Gap | Location |
|---|---|---|
| 12 | Upgrade credit derived from the plan *price list*, never from actual paid orders. Acquire Plus at ₪0 (100%-off coupon or gap #1), upgrade to Pro → ₪99 credit against a plan never funded. | `orders.py:1121-1127` |
| 13 | Downgrade is a dead-end: Plus→Basic gives `credit=min(99,39)=39` → `gross=0` → 400 "requires no payment". Order created, never provisionable, no refund path. | `orders.py:1172-1173` |
| 14 | Coupons have no expiry, no usage limit, no redemption record — a static `COUPONS_JSON` env blob. A leaked 100%-off code is unlimited free plans until redeploy. | `pricing.py:75-139` |
| 15 | Payment verification never checks the amount: `is_paid()` is true on any `confirmation_code` or `total_paid > 0`. A ₪1 sale provisions the full plan. `get_sale_info` is documented unavailable, so the IPN body is the sole authority. | `orders.py:1338-1354`, `payments_icount.py:184-209` |
| 16 | Double-IPN provisioning is not atomic — non-locking `SELECT status` then `provision_order` with no row lock. iCount retries are normal ⇒ two live events for one payment. | `orders.py:1338-1357` |
| 17 | No reconciliation for a lost IPN. `payment_pending` is written once and never revisited (grep matches one line); no cron. Card charged, no event, no automated recovery. | `orders.py:1244` |
| 18 | Round usage is a live `COUNT`, so deleting a campaign refunds a paid round. | `campaigns.py:26-44,301,311` |
| 19 | Guest cap bypassable via guest UPDATE — `update_guest` writes `import_count` with no capacity check and no lock. | `crud/guest.py:228-229` |
| 20 | Bulk import capacity check not under the advisory lock; `_get_plan_count_limit` is fail-open on any aub error (2s timeout) ⇒ an aub blip disables all guest caps globally. | `crud/guest.py:68-93,250-259` |
| 21 | `messages_sent` dedup is check-then-act. Crash between publish and mark re-sends. Fix is already available and unused: `mark_message_sent` has `ON CONFLICT DO NOTHING` — claim with `RETURNING` *before* publishing. | `worker.py:167,191,192`, `db.py:125-134` |
| 22 | Release `limit` is not durable — in-memory `sent_count` from 0, and `nack(requeue=True)` on any exception. A release of 100 dying after 60 sends 100 more on redelivery. | `worker.py:161,287` |
| 23 | Releases fire at 03:00 Israel time — `r.release_date <= (NOW() AT TIME ZONE 'UTC')::date` flips at 00:00 UTC. No quiet-hours gate anywhere. Guests get campaign WhatsApps at 3 AM. | `scheduler-service/db.py:194` |
| 24 | Daily summary has no send-window upper bound (`< (20,0): return 0`), so it runs until local midnight. Late guest replies trigger near-midnight owner messages. | `daily_summary.py:257` |
| 25 | Dashboard and 20:00 summary report different numbers from the same RSVP: `guests.py:205-215` sums head count, `daily_summary.py:90` uses `COUNT(g.id)` with a different null-fallback. Import `import_count=4`, guest confirms via button (leaves `guest_count` NULL) ⇒ dashboard 4, summary 1. `venues.py:578-585` is a third variant. | multiple |
| 26 | Published invites have no active/paid/date gate — only `invitation_published` (`public_invite.py:43`). Unpaid invites stay live indefinitely; RSVPs keep landing weeks after the event. | `public_invite.py:43` |
| 27 | Declined guests permanently consume plan capacity — the check sums `import_count` across all statuses. | `crud/guest.py:124-126` |
| 28 | Slugs are `_slugify(event.name)` with no random suffix unless collision — guessable, and the write surface behind them is unauthenticated (#4). | `events.py:119-137` |
| 29 | Failed owner notifications are parked after 5 attempts with only a `logger.error` — no consumer, metric, or admin surface reads `status='failed'`. | `notifications.py:100-104` |
| 30 | assistant-worker has no inbound dedupe — acks after `handle_message`. Redelivery re-runs the agent loop including mutating tools (`UpdateGuest`, `TriggerCampaign`). `message_id` is carried but never checked. | `assistant-worker/worker.py:277-289` |
| 31 | No document/CSV/image contact upload. Only WhatsApp contact *cards* are handled; a CSV, vCard, or screenshot hits `MSG_TEXT_ONLY`. The advertised "upload contacts over WhatsApp" is card-share only. | `main.py:196-201`, `worker.py:53,248` |
| 32 | Imported contacts are never normalized to E.164 or deduped by phone — raw string into `VARCHAR(20)`; `052-123-4567` stored as-is; >20 chars raises and is swallowed per-contact, so the success count silently under-reports. | `contact-import-worker/worker.py:96-115,213-215` |
| 33 | `ASSISTANT_WA_PHONE_ID` unset degrades to worst case — every owner message falls into the RSVP flow, outpost falls back to the campaign number. No startup assertion in either service. | `main.py:38`, `whatsapp_sender.py:44` |
| 34 | No refund or chargeback handling anywhere (`refund|chargeback|credit_note|void` → zero hits). A chargeback leaves the event fully entitled. | — |

---

## P2 — Follow-ups

- `create_order` doesn't validate the plan — admin-disabled plans still purchasable via direct API; unknown ids give `_plan_amount → 0.0` (`orders.py:214-305`).
- `POST /api/orders` is unauthenticated and accepts an arbitrary `event_id`, surfacing `venue_name` in the PayPage line item — a low-value enumeration oracle.
- Frontend/backend price duplication: `frontend/src/config/plans.ts:18-63` hardcodes ₪39/₪99/₪199 duplicating `plans.json`; `INCLUDED_ROUNDS` in `shared/domain/rounds.py:19-26` is a third copy. They agree today; nothing prevents drift.
- Core phone normalization only strips non-digits (`core-service/app/utils.py:23-30`) — contradicts aub's `_canonical_phone`, so one person makes up to three guest rows.
- No `noindex` on public invites — no robots meta, no `robots.txt`, no `X-Robots-Tag`.
- `campaigns_sent` counted on a UTC day but compared to a local date (`daily_summary.py:96-99`).
- Owners with no phone are silently skipped forever; two owners sharing a phone get duplicate summaries (`daily_summary.py:146,269-276`).
- Events with `event_date IS NULL` are summarized indefinitely (`daily_summary.py:103`).
- Offsetting status changes (one confirm + one decline) leave counts identical ⇒ no summary despite real activity (`daily_summary.py:160-162`).
- Partial-batch loss on crash in contact import; parked import expires at 1h vs the assistant's 6h context (`contact-import-worker/worker.py:72,185-219`).
- `scheduler-service/db.py:48` bootstrap `CREATE TABLE IF NOT EXISTS` declares a naive `TIMESTAMP` and would win on a virgin DB if the scheduler boots before core-service.
- Coupon can be attached after `payment_pending`, changing the breakdown after the iCount sale was priced (`orders.py:601`).

---

## Confirmed working (do not re-litigate)

**Payments:** charged amount is computed server-side end-to-end (`_order_breakdown` → `price_before_vat` → iCount line items); no client amount field exists on any endpoint. `prev_plan` genuinely server-resolved from core. IPN forgery blocked by HMAC over the order id; `/webhook/payment` requires `INTERNAL_API_SECRET` and refuses if unset. Return URL cannot forge success — `Payment.tsx` polls the server for `status === 'paid'`. Order tokens are 32-byte `secrets.token_urlsafe` compared with `hmac.compare_digest`, cannot be replayed across events; legacy tokenless orders fail closed. Provisioning idempotent on `status == 'paid'`. VAT math consistent and env-driven on both sides; `doc_type: "invrec"` requests a tax invoice + receipt; currency pinned to ILS. Coupons correctly blocked on upgrades.

**RSVP core:** the advisory-lock capacity path is correct — `pg_advisory_xact_lock` taken before the read, re-entrant in `create_guest`, delta-only consumption on party-size increase, decrease correctly frees capacity, decline-then-reconfirm updates in place. Walk-ins and returning guests handled. Public GET whitelist is disciplined — no guest list, owners, plan, or payment fields leak. `rsvpEnabled` honored server-side.

**Invitation rendering:** genuinely robust. `resolveTheme`/`resolveLayout` fall back on every field; an unknown `theme.layout` degrades to `editorial` rather than crashing; missing hero image handled per hero variant; partial/empty config renders via the `DEFAULT_INVITATION` spread; stale block ids filtered; RTL explicit; all fonts carry Hebrew fallbacks. **Preview fidelity is real, not duplicated** — the studio renders the same `InvitationView` the public page uses, and an unsaved draft cannot break the live invite.

**Scheduling:** `schedule_time` timezone handling correct end-to-end. `fetch_and_mark_due` / `fetch_and_mark_due_releases` both use `FOR UPDATE SKIP LOCKED`. Planner replan only deletes `pending` releases and excludes campaigns with any non-pending release, so replanning cannot duplicate an in-flight batch. `create_follow_up_campaign` idempotent on `(event_id, name)`. Inactive events filtered at all three stages.

**Assistant:** `assistant_intro` queued inside `provision_order`, idempotent via `dedupe_key`. Outbox drain claims with `FOR UPDATE SKIP LOCKED` in a real transaction. Multi-event picker exists in both workers; finalize re-validates ownership server-side; the worker mints a 5-min JWT and core re-checks membership via `resolve_role`, 404ing non-members — **owner A cannot touch event B**. Contact import idempotent per WhatsApp `message_id`, debounced, flusher claims atomically with an MQ reconnect + retry. Daily-summary param count is exactly 7 and matches the SSOT yaml; `_local_now()` uses `ZoneInfo` so DST is correct; `_claim` via `ON CONFLICT DO NOTHING RETURNING` is atomic across scheduler instances.

---

## Suggested fix order

**Gate 1 — make money real (nothing ships before this):** #1, #2, #3, #15, #16, #12.
**Gate 2 — stop lying about delivery:** #6, #8, #9, #29 — one shared pattern: a `messages_log` row per send with Meta's response, and status set on *delivery*, not enqueue. The owner-notification outbox is the one place with correct transactional claiming; use it as the template.
**Gate 3 — make the public surface safe:** #4, #5, #28, #26 — per-guest signed token + nginx `limit_req`.
**Gate 4 — compliance and volume:** #11 (STOP), #7, #21, #22, #23.
**Gate 5 — the long tail:** everything remaining.
