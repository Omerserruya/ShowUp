# Global Delivery Planner

The planner is the **single source of truth for message-delivery timing** across
the whole platform. It plans delivery for *all* events at once so channel-provider
limits (Meta/WhatsApp today) are never exceeded, while keeping every campaign as
close to its requested day as possible.

```
planner-service  ──►  owns scheduling decisions   (this service)
campaign_releases ─►  the plan, one row per (campaign, day) batch
scheduler-service ─►  releases due batches onto the queue (transport)
campaign-worker   ─►  executes a batch: sends `limit` not-yet-messaged recipients
```

Workers never schedule. Queues only transport. The planner decides *when* and
*how much*.

## How it plans

Every planning cycle (`PLANNER_INTERVAL_SECONDS`) the service recomputes the
**entire** plan from the current campaign set - so adding/changing a campaign
naturally rebalances all affected days (continuous rebalancing), no special case.

1. **Load** all schedulable campaigns (pending, active event, auto-sending plan,
   supported channel, positive recipient count, target within horizon).
2. **Window** each campaign from its *type* → scheduling flexibility:

   | Type | Flexibility |
   |------|-------------|
   | Save the Date | ±7 days |
   | Invitation | −5 .. +2 days |
   | Reminder | −1 .. 0 days |
   | Last Reminder | 0 only |
   | Thank You | 0 .. +2 days |
   | (generic) | −`MAX_EARLY_SEND_DAYS` .. +`MAX_LATE_SEND_DAYS` |

   Windows never start in the past. Override any row with `PLANNER_FLEXIBILITY_JSON`.
3. **Plan** with the selected `PlannerStrategy`, respecting per-day capacity =
   provider daily limit − safety margin. Priority order: keep on target day →
   minimize movement → move lower-priority first → earlier before later → never
   violate windows. Volume that cannot fit anywhere in-window is left `unplaced`
   (reported), never forced over capacity.
4. **Persist** the plan as `campaign_releases` + a `planner_runs` snapshot.

The engine **validates** every strategy's output (no day over capacity, nothing
outside its window, volume conserved) and refuses to persist an unsafe plan.

## Strategies (pluggable)

The algorithm lives entirely behind `planner.strategy.PlannerStrategy`. Ship a new
one (load balancing, predictive, adaptive shifting) by subclassing it,
`@register_strategy`, and selecting it via `PLANNER_STRATEGY` - nothing else
changes. Strategy #1 is `deterministic` (simple greedy).

```
list strategies:  planner.available_strategies()
```

## Configuration (all from env, never hardcoded)

| Var | Meaning | Default |
|-----|---------|---------|
| `META_MESSAGES_PER_SECOND` | provider throughput cap | 80 |
| `META_NEW_CONVERSATIONS_PER_24H` | provider daily conversation cap (binding) | 1000 |
| `META_TIER` / `META_QUALITY_RATING` | informational, surfaced in monitoring | - |
| `PLANNER_SAFETY_MARGIN_PERCENT` | reserved spare capacity | 15 |
| `MAX_EARLY_SEND_DAYS` / `MAX_LATE_SEND_DAYS` | generic window | 5 / 2 |
| `PLANNER_INTERVAL_SECONDS` | full replan cadence | 20 (compose still passes 60) |
| `PLANNER_FAST_POLL_SECONDS` | probe for due "send now" campaigns with no batch yet; replans immediately | 5 |
| `PLANNER_CARRY_FORWARD_DAYS` | carry-forward past the preferred window when the event date is unknown | 0 |
| `PLANNER_RUN_SNAPSHOT_SECONDS` / `PLANNER_RUNS_RETENTION_DAYS` | planner_runs throttle / retention | 60 / 7 |
| `WA_API_B`, `CAMPAIGN_WA_PHONE_ID` (or `WA_PHONE_ID`), `META_GRAPH_VERSION`, `META_TIER_REFRESH_SECONDS` | hourly read of Meta `messaging_limit_tier` + `quality_rating`; cap = min(env, tier) | -, -, v22.0, 3600 |
| `SEND_WINDOW` / `SEND_WINDOW_TZ` | same spec as scheduler-service; release_at is placed inside it | sun-thu 09-21, fri 09-14, sat 20-21 |
| `PLANNER_STRATEGY` | active strategy | deterministic |
| `PLANNER_HORIZON_DAYS` | how far ahead to plan | 60 |
| `PLANNER_FLEXIBILITY_JSON` | per-type window override | - |

Usable capacity/day = `raw_daily_capacity × (1 − margin)`, where the WhatsApp
conversation cap is `min(META_NEW_CONVERSATIONS_PER_24H, Meta tier)`. The margin
is reserved for retries, manual sends and last-minute load. The effective numbers
are stored in `planner_state` (id=1) - the scheduler's rolling-24h release guard
reads the same capacity.

### Capacity safety (2026-10)

* **Prefill**: each replan packs on top of what is already used today =
  max(releases queued/sent today, distinct campaign recipients in the last 24h +
  in-flight batches). Replans no longer start each day at 0.
* **Live volume**: campaigns are sized from the live remaining audience (same
  semantics as campaign-worker/audience.py, minus messages_sent claims), not
  `recipient_count`. Started campaigns are re-planned for their remainder.
* **Carry-forward + deadline**: overflow moves to the next open day up to the
  event-based deadline (pre-event stages: event−1; final reminder: event-day
  morning; never after the event except thank-you). What still does not fit is
  reported: `campaigns.status_reason='capacity_unplaced'` + an `ops_errors` row
  (once per transition). Past the deadline the campaign is failed
  (`deadline_passed`) or handed to the finalizer if it already sent some.
* **Final batch**: the last batch of a fully-placed campaign has
  `campaign_releases.is_final=true`; the worker sends ALL remaining guests on it.
* **Send window**: release_at is moved inside the open window; days where the
  window never opens (or today after its last close) are skipped.
* **Scheduler guard**: WhatsApp campaigns never use the scheduler's legacy
  unlimited path; each due batch is checked against the rolling 24h count and
  deferred (`SCHEDULER_CAPACITY_DEFER_MINUTES`, default 30) when over.

## Monitoring

Internal (this service): `GET /planner/config`, `/planner/status`,
`/planner/heatmap`, `/planner/delayed`.

Admin console (RBAC-gated, via core-service): `GET /api/admin/planner` →
System Admin › Monitoring shows throughput, moved/delayed, ETA, queue depth and a
per-day capacity heatmap.

## Channels

Channel-agnostic: provider limits live per channel in `ChannelLimits`. WhatsApp
is wired today; adding SMS/email/Instagram/Messenger is a new `ChannelLimits`
entry - the planning algorithm is untouched.

## Tests

Pure-stdlib core, no DB/broker needed:

```
python3 tests/stress_test.py              # invariants + concurrent-event stress
python3 tests/test_capacity_spreading.py  # prefill, carry-forward, event caps, tie-break, window
python3 tests/test_release_instant.py     # local release time (needs psycopg2)
```

DB integration (throwaway Postgres, see the file header):
`INTEGRATION_OK=1 PYTHONPATH=<repo> python planner-service/tests/integration_pg.py`
