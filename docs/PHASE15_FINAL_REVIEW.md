# Phase 15 — Final Review & Production-Readiness Assessment

ShowUp V2 transformation, end of phased migration. **Test state: 88 core tests pass
(`./tooling/test/run.sh`), worker integration green (`./tooling/test/run-workers.sh`),
migrations `0001→0012` apply cleanly on an empty DB.**

---

## 1. Architecture Review

**Where it landed.** A shared domain kernel (`shared/domain/{enums,roles,rsvp,templates,lifecycle}`) is now the single source of truth for statuses, RSVP actions, roles, audiences, field types, template + event lifecycles — consumed by core-service and both reworked workers (vendored via repo-root build context). The relational schema is owned by core-service Alembic (12 revisions) instead of scattered runtime DDL. Tenancy (`account`/`membership`) and a default-deny RBAC matrix sit behind a single `require_event_permission` chokepoint.

**Strengths:** clear bounded concepts; deterministic migrations; semantic (not text) RSVP; audience decoupled from template; auditable AI tool layer reusing the same service/RBAC path as humans.

**Residual:** ownership still runs through a legacy `owners`-JSON bridge for a few endpoints (events CRUD, guest-imports, exports) — functional for owners, not yet membership-aware (see §7/A1–A3). The `try/except` UUID column idiom in `models.py` remains dead.

## 2. Security Review

**Closed:** the cross-tenant IDOR class (guests/campaigns by-id) with regression tests; the public `/events/test` + open Swagger bypass; webhook header/PII and sender PII logging. AI tools enforce RBAC + tenant isolation + audit; the assistant never trusts a raw WhatsApp sender (verified identity link required).

**Open gaps (prioritized in the production checklist):**
- JWT has no `aud`/`iss`, single shared `HS256` secret across services; OTP issuance unthrottled; user-enumeration on register/login (aub-service — untouched by this migration).
- Webhook handler dedups idempotency downstream, not at receipt.
- A few endpoints still legacy-owner-scoped (consistency, not an open hole).

## 3. Performance Review

- Indexes added on the hot paths created this migration (event_id/account_id/tag/usage/timeline). **Still missing:** `guests(event_id, status)` composite for stats/audience at scale; the `owners` JSON membership remains un-indexable (mitigated by `account_id` going forward).
- Campaign audience selection is now SQL-filtered (was in-Python), and metered.
- **Not addressed:** outbound WhatsApp rate limiting (Meta tier throttle risk) and per-message AMQP connection in the webhook handler.

## 4. Scalability Review

Queue-based fan-out is sound. Bottlenecks for large events: outbound send pacing (no throttle), export building whole files in memory (10k cap), and the legacy `owners` scan for "events for user". Account/membership model is the foundation to fix the last; rate-limiting and streaming exports remain.

## 5. AI Readiness Review

**Ready:** fixed tool registry (`SearchGuest/AddGuest/UpdateGuest/EventStats/ExportGuests`), each mapped to typed CRUD (no raw SQL/dynamic queries), RBAC + ownership enforced in `dispatch_tool`, every call audited. Assistant session layer authenticates a verified identity, scopes to (user, account, event), and expires.

**Not built (by design for this phase):** the LLM/NLU itself, the second WhatsApp number's inbound handler, and the OTP/deep-link delivery that sets `verified=True`. The infrastructure is in place to drop an agent on top.

## 6. Billing Readiness Review

Usage ledger (`usage_events`) meters **guests, rounds, and messages**; `would_exceed` is the enforcement hook (guests/rounds are customer-facing limits; messages internal-only, per product decision). **Missing for go-live billing:** a `subscription`/plan-limits source wired into `would_exceed` (currently limits are passed in), and message metering is per-campaign in the worker (not yet reconciled with a billing period). Payments intentionally not connected.

## 7. Technical Debt Review

Removed: dead prints, broken `send_batch`, orphaned `get_intended_recipient_count`, status magic strings, template-coupled audience, duplicated worker utilities, runtime-DDL-as-schema. Tracked remaining: legacy `is_owner` endpoints (A1–A3), dead UUID try/except, demo-data fallback in `daily-responses`, no connection pooling in aub-service.

---

## Production-Readiness Assessment

### 🔴 Critical (must fix before production)
1. **aub-service auth hardening** — throttle OTP issuance, add JWT `aud`/`iss` + per-service key strategy, remove user enumeration. (Outside this migration's scope; it's the actual front door.)
2. **Outbound WhatsApp rate limiting** — without Meta-tier pacing, bulk sends risk number throttling/bans.
3. **Wire plan limits into enforcement** — `would_exceed` exists but no subscription/limit source feeds it; guests/rounds limits are currently unenforced end-to-end.
4. **Secrets & infra** — data-store ports are host-exposed in compose; `webhook-hendler` runs `uvicorn --reload`; provision real secrets management and lock these down.

### 🟠 Important (soon after launch)
5. Finish RBAC rollout (A1–A3): events CRUD, guest-imports, exports → `require_event_permission`; backfill `account_id` and retire the `owners`-JSON bridge.
6. Webhook idempotency at receipt (dedup `wa_message_id` before enqueue).
7. `guests(event_id, status)` composite index; stream exports; remove the 10k cap.
8. Worker integration coverage for webhook-worker (only campaign-worker has it today); message-flow E2E.
9. Daily owner summary + event-health insights (scheduler extension) — promised product features still absent.

### 🟢 Optional / later
10. Remove dead UUID try/except + demo-data fallback; add connection pooling to aub-service.
11. PDF export; Google Sheets import (claimed, absent).
12. i18n layer (Hebrew is hardcoded throughout).
13. Build the LLM agent + second-number inbound handler on the ready tool layer.

### Recommended sequence
Phase A (pre-prod, ~1–2 wks): Critical 1–4. Phase B: Important 5–8. Phase C: product depth (9, 11) + AI agent (13). The migration delivered the hard architectural foundation and test/migration tooling that make all of the above incremental and verifiable rather than risky.
