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
| `PLANNER_INTERVAL_SECONDS` | replan cadence | 60 |
| `PLANNER_STRATEGY` | active strategy | deterministic |
| `PLANNER_HORIZON_DAYS` | how far ahead to plan | 60 |
| `PLANNER_FLEXIBILITY_JSON` | per-type window override | - |

Usable capacity/day = `raw_daily_capacity × (1 − margin)`. The margin is reserved
for retries, manual sends and last-minute load.

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
python3 tests/stress_test.py     # invariants + concurrent-event stress
```
