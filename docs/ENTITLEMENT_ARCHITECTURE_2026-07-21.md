# ShowUp — Entitlement System: Architecture & Review
**Date:** 2026-07-21 · **Verified:** 38 entitlement checks + 151 prior checks, all passing.

## The idea

An **Entitlement** is the single answer to *"why is this user allowed to create
this event?"*. Payment is no longer wired to event creation — it is one of
several **issuers** of entitlements. Every event, free or paid, consumes exactly
one entitlement, and the two are linked forever.

```
            issue                         redeem
  PAYMENT ─┐                            ┌─> Event  (consumes 1 entitlement)
  VENUE  ──┤                            │
  BETA  ───┼──> Entitlement (available) ┤   one atomic conditional UPDATE
  ADMIN ───┤       code, plan, limits   │   available -> redeemed
  PROMO ───┤                            └─> exactly one event, linked both ways
  PARTNER ─┤
  SYSTEM ──┘  (auto free/starter for self-service + clone)
```

Adding a future business model — affiliate, reseller, loyalty — is a new
`EntitlementSource` value plus an issuer that calls `issue()`. **Event creation
and enforcement do not change.** That is the whole point of the refactor.

## The two shapes

- **`issue()`** mints an `available` entitlement and returns its code, for
  distribution as a link (`/redeem/<code>`). Used by the venue pool, the beta
  program, admin grants, promotions.
- **`issue_and_redeem()`** mints and immediately consumes one, in a single
  transaction, for the paths where the issuer already holds the event details
  and hands out no link: **payment, self-service free creation, clone, admin
  direct-create, venue direct-create.**

Both consumption routes funnel through the SAME atomic `redeem()`, so "one code,
one event" is guaranteed by a conditional UPDATE, not caller discipline.

## Security properties (all verified)

| Requirement | How |
|---|---|
| Cryptographically secure, unguessable | `secrets.token_urlsafe(32)` — 256 bits |
| One-time use | `UPDATE ... WHERE status='available' RETURNING`; the loser gets zero rows |
| Atomic redemption | claim + event creation in one transaction; failure rolls the claim back |
| Concurrency-safe | 8 threads redeeming one code → **exactly one** winner, one event (tested) |
| Full audit trail | `redeemed_at / redeemed_by_user_id / redeemed_event_id / created_by / source / metadata`; admin actions in `audit_log` |
| No client-controlled entitlement data | plan and limits come from the entitlement row; the redeemer supplies only event details |
| No payment bypass | a payment entitlement can only be minted by the verified-payment path; the admin console cannot issue `source=payment` |

## Backwards compatibility

- **Existing paid events:** untouched. A backfill migration mints a synthetic
  `redeemed` entitlement for every pre-existing event (paid → `payment`,
  otherwise → `system`) and links it both ways, so the invariant "every event
  has exactly one entitlement" holds for history too. Idempotent.
- **Payment UX:** identical. `internal_provisioning` still takes the order +
  event data from aub and returns an event id; internally it now issues+redeems
  a `payment` entitlement. The `provisioning_order_id` UNIQUE index still
  guarantees idempotency against duplicate IPNs (verified: replay returns the
  same event, one entitlement, no orphan).
- **Free-event UX:** identical. `POST /events` auto-issues a `system` starter
  entitlement and redeems it in one call — the user sees no redemption step.

## Custom bundles

An entitlement may carry `max_guests` / `campaign_rounds` overrides (a promo
granting Pro rounds but a 100-guest cap). These snapshot onto the event at
redemption (`events.max_guests_override` / `included_rounds_override`), and
enforcement reads **override-or-plan-default** via
`effective_max_guests` / `effective_included_rounds`. A NULL override means "use
the plan", so payment and self-service events behave exactly as before.

## No duplicate concepts (the explicit review)

The refactor **removed** the two functions that would have become parallel
event-construction paths:

- `provisioning.provision_event` (payment event creation) — deleted; payment now
  redeems an entitlement.
- `crud.create_event` (self-service event creation) — deleted; self-service now
  redeems an entitlement.

There is now **exactly one** place an event is constructed:
`entitlement_service._build_event`, reached only through `redeem()`. `provisioning.py`
keeps only the entitlement-FIELD writers (`apply_entitlement` / `derive_active` /
`find_provisioned_event`) and `change_plan` — which modifies an existing event
(an upgrade) and is deliberately **not** an entitlement redemption, because the
model governs event *creation*, not mutation.

Every event-creation path was audited and routed through the system:

| Path | Source | Route |
|---|---|---|
| Payment | `payment` | `internal_provisioning` → `issue_and_redeem` |
| Self-service free | `system` | `POST /events` → `issue_and_redeem` |
| Clone | `system` | `event_ops.clone_event` → `issue_and_redeem` (+ copies) |
| Admin direct | `admin` | `admin.admin_create_event` → `issue_and_redeem` |
| Venue direct | `venue` | `venues.create_venue_event` → `issue_and_redeem` |
| Redemption link | any | `POST /redeem/{code}` → `redeem` |

## Surfaces

- **Public:** `GET /public/redeem/{code}` — preview (grant only, no PII, rate-limited).
- **Authed:** `POST /redeem/{code}` — consume + create event (rate-limited).
- **Admin:** `POST/GET /admin/entitlements`, `/{id}/expire`, `/{id}/cancel` — mint
  beta/promo/partner/admin batches, list with redeemer + event, revoke.
- **Venue:** `POST/GET /venues/{id}/entitlements` — pool generation + list, with
  copy-link / WhatsApp / email share in the dashboard.
- **Frontend:** `/redeem/:code` page, venue pool panel, admin entitlements page.
  Paid and free creation flows unchanged.

## Extensibility check

A new issuer needs: (1) a value in `EntitlementSource`, (2) a call to `issue()`
or `issue_and_redeem()`. No change to `redeem()`, `_build_event`, enforcement,
the event schema, or the redemption UX. Custom limits ride on the existing
override columns. The model supports the listed future cases (marketing,
giveaways, influencers, partners, affiliates) with no structural change.

## Deploy notes

- **Rebuild:** core-service (new tables/columns/routers), frontend (new pages).
  aub-service is unchanged for entitlements (it still calls the same internal
  endpoint). No new env vars beyond the existing `PUBLIC_BASE_URL` (used to build
  redemption links) and `INTERNAL_API_SECRET`.
- **Migration** adds the `entitlements` table, three `events` columns, the FK
  cycle (handled via `use_alter`), and the backfill. Idempotent; verified on a
  virgin DB and against existing data. Deleting an event is blocked while it
  holds an entitlement (`ON DELETE RESTRICT`) — intentional, so the audit link
  cannot be silently broken.

**Not done:** live end-to-end against real iCount/Meta. Everything here is
verified against the real code and a real database.
