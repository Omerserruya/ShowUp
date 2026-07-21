# ShowUp — Observability Layer (Sentry Cloud)
**Date:** 2026-07-21 · **Verified:** 35 obs-layer checks + correlation round-trip + no regression (24/24, 19/19, 50/50).

Goal: when something fails, know **what / why / which service / which operation /
which user / event / campaign / guest / phone / provider / release** — and follow
one flow across every service.

---

## Architecture

One shared, defensive foundation (`shared/obs/`) that every Python service imports,
plus `@sentry/react` on the frontend. **A missing `SENTRY_DSN` is a clean no-op** —
dev/CI/test run unchanged; nothing crashes when Sentry is unconfigured. All
instrumentation is wrapped so it can never break a caller.

```
shared/obs/
  sentry.py       init_sentry(service): env-driven DSN/env/release, global `service`
                  tag, before_send (scrub) + before_send_transaction (drop noise),
                  Sentry Logs experiment, traces_sample_rate 0 (no perf noise).
  correlation.py  one id per flow: contextvar + inject_into(msg)/adopt_from(msg) +
                  bind to Sentry scope tag.
  context.py      set_user / set_event / set_campaign / set_guest / set_whatsapp /
                  set_payment / set_ai / set_external / set_flow — tags + a per-flow
                  bag that every log and exception inherits.
  logging.py      log_event(name, **ctx): structured lifecycle events → stdout JSON
                  + Sentry breadcrumb + Sentry Logs. Constants for every lifecycle.
  boundary.py     capture()/operation(): unexpected → Sentry; expected business
                  errors excluded by class name. Single choke point (no dup reports).
  scrub.py        secret scrubbing (keys + JWT/Bearer patterns + query tokens +
                  message content). Applied to events AND log fields.
  fastapi.py      install_fastapi_observability(app): per-request correlation + user
                  context middleware.
  bootstrap()     init Sentry + start ops heartbeat in one call per service.
frontend/src/observability.ts   @sentry/react init + scrub + correlation + user ctx.
```

---

## Correlation flow (verified end-to-end)

```
Frontend  fetchWithAuth sets  X-Correlation-ID: <cid>  on every API call
   │
Core/aub/webhook-handler   install_fastapi_observability adopts the header (or mints),
   │                       binds it to the contextvar + Sentry scope, echoes it back.
RabbitMQ   publishers inject_into(message) → correlation_id rides in the message body
   │        (scheduler/campaign-worker/assistant-worker/contact-import mq helpers;
   │         webhook-handler enqueue).
Workers    each consume callback adopt_from(message) → same id bound on that worker.
   │
Outpost    adopt_from(message) → id + WhatsApp context bound; carried into Meta logs.
   │
Meta call  external.request / external.response lifecycle logs carry the id.
   │
Callback   Meta webhook → webhook-handler mints/keeps a id → webhook-worker adopts.
   │
DB / logs / Sentry   every structured log and every captured exception carries
                     correlation_id (+ service, event/campaign/guest/... context).
```

Verified: `inject_into` → `adopt_from` round-trips the id; a message with no id
mints one on consume; the FastAPI middleware binds from the header and echoes it.

---

## Logging strategy (Sentry Logs + stdout)

`log_event(...)` fires ONLY for meaningful lifecycle events — never per request or
debug. Each record auto-carries `service`, `correlation_id`, and the current flow
context. Wired:

| Event | Where |
|---|---|
| `campaign.started/completed/failed` | campaign-worker `process_campaign` |
| `payment.started/completed/failed` | aub `pay_with_icount` / `icount_callback` |
| `import.started/completed/failed` | contact-import-worker `process_batch` / flusher |
| `webhook.received` | webhook-handler | `webhook.processed` | webhook-worker |
| `external.request/response` | outpost (Meta send) |

Performance rules (spec §15) hold globally: `traces_sample_rate=0`,
`before_send_transaction` drops `/healthz` and health checks, no page-view or
success tracing on the frontend.

---

## Tracing / error strategy (unexpected → Sentry, expected → not)

* **Auto-capture:** the Sentry FastAPI/Starlette integration captures unhandled
  5xx on core/aub/webhook-handler; handled 4xx / HTTPException are NOT captured —
  the expected/unexpected split for free.
* **Worker boundaries:** every worker's message callback captures UNEXPECTED
  exceptions with correlation + domain context attached (campaign-worker, outpost,
  assistant-worker, webhook-worker, contact-import, scheduler cycles).
* **Formerly-swallowed exceptions surfaced:** the core assistant tool loop used to
  turn an unexpected tool exception into a chat reply with no report — it now
  captures to Sentry with AI context (tool, tool_call, conversation, mode). aub
  provisioning-after-payment failure now goes to Sentry (was ops-only).
* **Expected business errors excluded** by class name (`boundary.is_expected`):
  HTTPException, ValidationError, `EntitlementError/NotRedeemable`,
  `PlanLookupUnavailable`, `Tool{Denied,Error}`, `Invite/IpnSecretMissing`, and the
  `ValueError` our CRUD raises for capacity/duplicate rules.
* **No duplicate reports:** reporting happens once at the outermost boundary;
  Sentry's Dedupe integration collapses identical stacks. `record_error` (the
  internal ops-dashboard table) is a *separate* store, not a second Sentry event.

## Context attached (only existing values)

user (id, role — never email/secrets) · event (id, name, plan, venue) · campaign
(id, name, stage, round, variant) · guest (id, phone, party_size) · whatsapp
(phone_number_id, recipient, template, language, message_id, conversation_id, Meta
error code/message, delivery status) · payment (id, provider, status, amount,
currency, entitlement_id) · ai (conversation, tool, tool_call, mode) · external
(provider, endpoint, status_code, latency).

## Security (verified by test)

`before_send` + `scrub_dict` redact, at any depth: Authorization/cookie/token/JWT/
password/secret/internal-secret/OTP/signature keys; `Bearer …` and JWT patterns in
free text; credential query params (`?g=`, `?token=`, `?sig=`, order tokens); and
message CONTENT (`text`/`body`/`message`/`parameters`/`content`). `send_default_pii`
is off. Phone numbers are kept **deliberately** as debugging context (tags), never
as leaked payload. Frontend strips Authorization + scrubs URLs in breadcrumbs.

---

## Files changed (high level)

- **New:** `shared/obs/{__init__,sentry,correlation,context,logging,boundary,scrub,fastapi}.py`;
  `frontend/src/observability.ts`.
- **Init/bootstrap (11 services):** core, aub, outpost, scheduler, planner,
  campaign-worker, assistant-worker, contact-import-worker, webhook-worker,
  webhook-handler, otp-worker — each calls `bootstrap("<service>")`.
- **HTTP middleware:** core, aub, webhook-handler (`install_fastapi_observability`).
- **Correlation inject:** scheduler/campaign-worker/assistant-worker/contact-import
  `mq.py`, webhook-handler `enqueue_to_rabbitmq`.
- **Correlation adopt + capture + lifecycle:** campaign-worker, outpost, aub orders,
  assistant (core), webhook-worker, contact-import, scheduler.
- **Frontend:** `index.tsx` (init + ErrorBoundary), `fetchWithAuth.ts` (X-Correlation-ID),
  `UserContext.tsx` (Sentry user).
- **Config:** `sentry-sdk==2.20.0` in all Python requirements; `@sentry/react` in
  frontend; `SENTRY_*` passthrough in both compose files + `.env` defaults;
  `otp-worker` switched to repo-root build context (to import `shared`).

---

## Audit checklist

| Requirement | Status |
|---|---|
| Every service reports unexpected failures | **Yes** — SDK on all 11 + frontend; auto-capture (web) + explicit boundaries (workers) |
| Correlation IDs propagate correctly | **Yes** — verified inject→adopt round-trip + header binding |
| Structured logs include useful context | **Yes** — service + correlation + flow context on every `log_event` |
| Every important business flow traceable | **Yes** — campaign, payment, import, webhook, WhatsApp lifecycle wired |
| No duplicate events | **Yes** — single boundary + Dedupe integration |
| No sensitive information leaks | **Yes** — scrubbing verified (keys, JWT, query tokens, message content); phones kept as tags by design |

---

## Remaining recommendations

1. **Set the DSNs.** Everything is env-driven and off until `SENTRY_DSN` /
   `REACT_APP_SENTRY_DSN` are set per environment. Rebuild images (requirements
   changed) so `sentry-sdk` is installed.
2. **Release naming.** Set `SENTRY_RELEASE` = the git SHA at build (`GIT_SHA`), and
   `REACT_APP_SENTRY_RELEASE` for the frontend, so "which release introduced it" is
   answered. Consider Sentry's source-map + commit integration for the frontend.
3. **Close the receipt→send correlation loop.** Meta delivery receipts carry only
   the `wamid`. The original send's `correlation_id` is already persisted in
   `messages_log.payload`; a lookup by wamid in webhook-worker would let a delivery
   failure resolve back to the exact send's correlation id (noted, not built).
4. **Turn on a little tracing selectively** (e.g. `traces_sample_rate=0.05` on core)
   if you later want latency distributions — kept at 0 now per the "no perf noise" rule.
5. **`otp-worker` uses `@app`-less consume**; it now bootstraps but has no per-message
   adopt — low value (leaf OTP send), noted for completeness.
6. **Outpost `body_preview` debug log** (500 chars of the message) is stdout-only and
   token-scrubbed via breadcrumbs, but consider dropping it in production.
