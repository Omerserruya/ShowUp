# Phase 14 - Technical Debt Elimination

## 1. Cleanup performed (this phase)

| Item | Action | Files |
|---|---|---|
| 10 debug `print()` statements left in request paths | Removed | `routers/events.py`, `crud/event.py`, `crud/campaign.py` |
| `WhatsAppSender.send_batch()` calling a non-existent `self.send_message` (dead + broken) | Removed | `outpost-service/whatsapp_sender.py` |
| `get_intended_recipient_count()` orphaned after Phase 6 (`count_audience` replaced it) | Removed | `crud/campaign.py` |
| Campaign endpoints still on legacy `is_owner` | Rewired to `require_event_permission` (Phase 10) | `routers/campaigns.py` |

Earlier phases already eliminated major debt: hardcoded magic-string statuses (→ `shared/domain/enums`), audience coupled to template (→ first-class `audience`), duplicated phone/date/enum logic in workers (→ vendored `shared` kernel), runtime `CREATE TABLE` as the schema source (→ Alembic).

### Known remaining debt (tracked, not yet removed - low risk)
- The `try/except` around every `mapped_column(PG_UUID...)` in `models.py` is dead (the except branch can't execute). Left in place because rewriting every PK is high-churn/low-value; safe to remove in a dedicated pass.
- `daily-responses` endpoint contains demo-data fallback logic in production code.
- Per-request DB connections in `aub-service` (no pooling); per-message AMQP connection in `webhook-hendler`.

## 2. Worker Integration Test Harness (NEW)

`tooling/test/run-workers.sh` - spins up a throwaway Postgres, applies the **full schema via core-service Alembic**, then runs each worker's integration check **inside that worker's own image** against the live DB. Closes the gap where worker DB logic was only build/import-checked.

- `campaign-worker/tests/integration_check.py` exercises: audience selection (everyone/confirmed/no_response/declined), follow-up creation + **idempotency**, and message metering - all against real Postgres. Result: `WORKER INTEGRATION OK`.
- Run: `./tooling/test/run-workers.sh`. (Core API/DB layer is covered by `./tooling/test/run.sh`.)

## 3. Service Inventory

| Service | Lang/Runtime | Datastores | Queues | Responsibility |
|---|---|---|---|---|
| **core-service** | FastAPI + SQLAlchemy (PG) | Postgres | - | Events, guests, campaigns, custom fields, tags, templates, timeline, usage, AI tools, lifecycle. Owns the relational schema (Alembic). |
| **aub-service** | FastAPI + psycopg2 + Mongo | Postgres (users/orders), Mongo (plans) | OTP | Auth (phone+OTP→JWT), plans, orders. |
| **webhook-hendler** | FastAPI | - | RabbitMQ (pub) | Inbound Meta webhook: verify HMAC, categorize, enqueue. |
| **webhook-worker** | aio-pika + async SQLAlchemy | Postgres | RabbitMQ (sub) | RSVP conversation state machine; **semantic RSVP** via `shared.domain.rsvp`. |
| **campaign-worker** | psycopg2 | Postgres | RabbitMQ (sub→outpost) | Campaign fan-out by **audience**, follow-up, message metering. |
| **outpost-service** | aio-pika + httpx | Postgres | RabbitMQ (sub) | Outbound WhatsApp Cloud API sender (retry/backoff). |
| **scheduler-service** | psycopg2 + FastAPI | Postgres | RabbitMQ (pub) | Polls due campaigns → enqueues. |
| **contact-import-worker** | psycopg2 | Postgres | RabbitMQ (sub) | WhatsApp contact-share → draft import contacts. |
| **otp-worker** | requests | - | RabbitMQ (sub) | OTP delivery (Telegram/WA). |
| **frontend** | React/TS (MUI, RTL) | - | - | Owner/producer web UI. |

Shared kernel: `shared/` (auth + `shared/domain/{enums,roles,rsvp,templates,lifecycle}`) - vendored into core-service, webhook-worker, campaign-worker.

## 4. Endpoint Inventory (core-service, 61 routes incl. docs)

Generated from the live FastAPI app. Auth column legend: **RBAC** = `require_event_permission`; **owner** = legacy `is_owner`; **admin** = `get_admin_user_id`; **auth** = authenticated only; **public** = no auth.

### Events
| Method | Path | Auth |
|---|---|---|
| GET/POST | `/events` | auth (list filters by ownership) / auth (create binds account) |
| GET/PUT/DELETE | `/events/{id}` | **owner** (legacy) |
| POST | `/events/{id}/transition` | **RBAC** (EVENT_WRITE; cancel=EVENT_DELETE) |
| POST | `/events/{id}/clone` | **RBAC** (EVENT_WRITE) |

### Guests
| Method | Path | Auth |
|---|---|---|
| GET/POST/DELETE | `/guests` | **RBAC** (READ/WRITE/DELETE) |
| GET/PUT/DELETE | `/guests/{id}` | **RBAC** |
| POST | `/guests/bulk` | **RBAC** (WRITE) |
| GET | `/guests/stats` | **RBAC** (READ) |
| GET | `/guests/daily-responses` | **owner** (legacy - gap) |
| GET | `/guests/export` | **owner** (legacy - gap) |
| GET | `/guests/import-template` | auth |
| GET/PUT | `/guests/{id}/custom` | **RBAC** |
| POST/DELETE | `/guests/{id}/tags/{tag_id}` | **RBAC** (WRITE) |
| GET | `/guests/{id}/timeline` | **RBAC** (READ) |

### Campaigns / Fields / Tags / Templates / Import
| Method | Path | Auth |
|---|---|---|
| GET/POST/DELETE | `/campaigns`, `/campaigns/{id}`, `/campaigns/{id}/stats` | **RBAC** |
| GET/POST/DELETE | `/events/{id}/fields[/{field_id}]` | **RBAC** (READ/WRITE) |
| GET/POST | `/events/{id}/tags` | **RBAC** (READ/WRITE) |
| GET/POST | `/events/{id}/templates`, `/usable`, `/{tid}/clone` | **RBAC** |
| POST | `/templates/{id}/validate`, `/transition` | **RBAC** (EVENT_WRITE) |
| POST | `/events/{id}/import/suggest-mapping` | **RBAC** (READ) |
| POST | `/events/{id}/import/apply` | **RBAC** (WRITE) |

### Guest Imports / Uploads / Admin / Infra
| Method | Path | Auth |
|---|---|---|
| GET/PUT/POST | `/guest-imports/*` | **owner** (legacy - gap) |
| POST | `/uploads/generate-upload-url` | auth (no event scoping - low) |
| GET/PUT/DELETE | `/admin/events/*` | **admin** |
| GET | `/healthz` | public |
| GET | `/docs`, `/openapi.json`, `/redoc` | auth (now gated; was public pre-Phase 1) |

## 5. Authorization Audit

**Strengths**
- All guest/campaign by-id endpoints enforce tenant ownership (the Phase 1 IDOR class is closed and regression-tested).
- AI tools (`dispatch_tool`) and the assistant session layer re-check RBAC + event ownership and audit every call.
- Admin endpoints require the `admin` role; no mutating endpoint is unauthenticated; docs are no longer public.

**Gaps (consistency, not open holes - all still authenticated & owner-scoped)**
| # | Area | Issue | Recommendation | Priority |
|---|---|---|---|---|
| A1 | `events.py` GET/PUT/DELETE `/events/{id}` | Use legacy `is_owner`, not RBAC → account **members** (manager/editor/viewer) can't access events they should | Switch to `require_event_permission` (EVENT_READ/WRITE/DELETE) | High |
| A2 | `guest_imports.py` (all 5) | Legacy `is_owner` only | Switch to `require_event_permission` (GUEST_READ/WRITE) | Med |
| A3 | `guests.py` `daily-responses`, `export` | Legacy `is_owner` only | Switch to RBAC (GUEST_READ) | Med |
| A4 | `uploads.py` generate-upload-url | Authenticated but not event-scoped | Scope to an event + EVENT_WRITE if uploads are event assets | Low |
| A5 | `list_events` / `is_owner` | Ownership still via un-indexed `owners` JSON array (legacy bridge) | Backfill `account_id` + membership; drop the JSON bridge | Med (perf+model) |

These are the natural next refactor; the RBAC primitive (`require_event_permission`) and the legacy bridge already exist, so closing A1–A3 is mechanical and low-risk.
