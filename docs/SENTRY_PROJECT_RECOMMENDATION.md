# Sentry Project Structure — Recommendation for ShowUp
**Based on** the actual `docker-compose.yml` topology, the shared-Postgres data
model, and the message-flow architecture — not assumed.

## The shape of the system (what drives the recommendation)

- **Two languages / SDKs:** one React frontend, ten Python backend containers.
- **One flow crosses many containers:** a single guest send is Core → RabbitMQ →
  campaign-worker → Outpost → Meta, and a payment is Frontend → aub → Core. Because
  a correlation id already ties these together, **issues do not need to live in the
  same Sentry project to be traceable** — the `correlation_id` tag links them. That
  frees us to group by *ownership and triage*, not by call graph.
- **Very uneven event volume:** Outpost (every WhatsApp message) and Core (every
  API request that 500s) are high-volume; planner/otp-worker/contact-import are
  low-volume; the frontend is its own audience (browser errors).
- **Distinct failure domains an operator triages differently:** browser/UX,
  API/business logic, the WhatsApp delivery pipeline, and payments.

## Guiding principle

**Group by who investigates it and how noisy it is; separate only when a domain
has a different owner, a different triage rhythm, or volume that would drown the
others.** Over-splitting (a project per container) multiplies alert rules, DSNs and
dashboards for little gain when `service` + `correlation_id` already isolate issues
within a project.

## Recommended projects (4)

1. **`showup-frontend`** — the React app. Separate because it is a different SDK,
   a different audience (end-user browsers), different noise (extensions, network
   flakiness), and different release/source-map handling.
2. **`showup-backend`** — the request/business core: **core-service** and
   **aub-service**. These share a codebase, a data model, and a triage owner
   (backend engineers), and their errors are business/API errors. Payments raise
   in aub but the *money* domain is small and tightly coupled to Core provisioning,
   so it lives here, filtered by `flow:payment`.
3. **`showup-messaging`** — the WhatsApp delivery pipeline: **outpost-service**,
   **campaign-worker**, **scheduler-service**, **planner-service**,
   **webhook-hendler**, **webhook-worker**, **contact-import-worker**,
   **assistant-worker**, **otp-worker**. These form ONE operational domain (getting
   WhatsApp messages out and replies in), share failure modes (Meta errors, queue
   backlog, template issues), and are triaged together by whoever watches delivery
   health. Isolation *within* the project is by the `service` tag.
4. *(optional, only if volume demands)* **`showup-outpost`** — split Outpost out of
   `showup-messaging` **if** WhatsApp send volume makes it drown the other workers'
   issues. Start merged; promote to its own project when its event share crosses
   ~60–70% of the messaging project. Don't pre-split.

## Per-container decision

| Container | Sentry Project | service_name | Reason |
|---|---|---|---|
| frontend | `showup-frontend` | `frontend` | Different SDK/audience/release + source maps; browser noise must not mix with backend. |
| core-service | `showup-backend` | `core` | Central API + business logic; backend-engineer triage. Highest backend error variety. |
| aub-service | `showup-backend` | `aub` | Auth + payments; small, tightly coupled to Core provisioning. Filter money issues by `flow:payment`. |
| outpost-service | `showup-messaging` | `outpost` | The Meta boundary; shares delivery failure modes with the workers. Split out only if volume dominates. |
| campaign-worker | `showup-messaging` | `campaign-worker` | Produces the sends Outpost delivers; same domain, same triage. |
| schedule-service | `showup-messaging` | `scheduler` | Releases batches + reconciliation; delivery-pipeline timing. |
| planner-service | `showup-messaging` | `planner` | Plans delivery timing; low volume; same owner. |
| webhook-hendler | `showup-messaging` | `webhook-handler` | Inbound Meta webhooks — the reply half of the WhatsApp domain. |
| webhook-worker | `showup-messaging` | `webhook-worker` | Processes inbound RSVP replies + delivery receipts. |
| contact-import-worker | `showup-messaging` | `contact-import-worker` | WhatsApp-driven contact import; same operational surface. |
| assistant-worker | `showup-messaging` | `assistant-worker` | Owner-facing WhatsApp assistant; shares the messaging surface. |
| otp-worker | `showup-messaging` | `otp-worker` | Sends OTP over WhatsApp; leaf, very low volume; no separate project warranted. |
| postgres / rabbitmq / redis / nginx | *(none)* | — | Infra images we don't instrument with Sentry; their health is on the ops dashboard (§ops) — DB/queue/redis reachability + backlog. |

## Organization structure

- One Sentry **organization**: `showup`.
- **Teams:** `frontend`, `backend`, `messaging` — own the matching projects and
  their alert rules.
- **Alerts** keyed off tags this layer already sets: `flow:payment` (→ backend team,
  high priority), `provider:meta` + `delivery_status:failed` (→ messaging), and
  `level:error` spikes per `service`.

## service_name values

`frontend`, `core`, `aub`, `outpost`, `campaign-worker`, `scheduler`, `planner`,
`webhook-handler`, `webhook-worker`, `contact-import-worker`, `assistant-worker`,
`otp-worker` — set automatically by `bootstrap("<name>")` / the frontend init, and
attached as the `service` tag on every event, so a merged project still isolates by
service.

## environment values

`production`, `staging`, `development` — from `SENTRY_ENVIRONMENT` /
`REACT_APP_SENTRY_ENVIRONMENT` (default `production`). Keep dev events out with an
unset dev DSN, or a separate `development` environment if you want them.

## release naming strategy

`showup@<git-sha>` (short SHA), identical across all services in a deploy so
"which release introduced it" lines up cross-service. Set `SENTRY_RELEASE` (backend)
and `REACT_APP_SENTRY_RELEASE` (frontend) from the CI git SHA at build time. Upload
frontend source maps against the same release, and associate commits so Sentry can
suspect-commit the regression.

## Tags to standardize across all services (already emitted by `shared/obs`)

`service`, `environment`, `release`, `correlation_id`, `operation`, `flow`, `worker`,
`user_id`, `role`, `event_id`, `plan`, `venue_id`, `campaign_id`, `campaign_stage`,
`campaign_round`, `campaign_variant`, `guest_id`, `phone_number_id`, `template`,
`meta_error_code`, `delivery_status`, `payment_id`, `payment_provider`,
`payment_status`, `entitlement_id`, `tool`, `assistant_mode`, `provider`,
`external_status_code`.

Standardize dashboards/saved-searches on `flow`, `service`, and `correlation_id` —
those three answer "which domain, which container, and follow this one incident."

## Summary

**4 projects** (`showup-frontend`, `showup-backend`, `showup-messaging`, + an
optional future `showup-outpost`), **12 service_names**, grouped by triage owner and
volume rather than by call graph — because the `correlation_id` tag already makes
cross-container tracing work regardless of project boundaries. Start merged; split
Outpost out only when its volume earns it.
