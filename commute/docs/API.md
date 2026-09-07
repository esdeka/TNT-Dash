# HTTP API contract (schema version 1)

Base URL on your own LAN: `http://DASHBOARD_HOST:3000`. Do not use a temporary Arena preview for persistent HA entities. No built-in authentication; keep the service private.

All entity timestamps are ISO 8601 **UTC** strings, e.g. `2026-09-07T06:01:00.000Z`. Home Assistant displays them in its configured timezone. UI times are Brussels local time. Missing options are `null`, never 00:00 / epoch zero / an invented departure.

## Endpoints

| Method / path | Purpose | Upstream requests |
|---|---|---|
| `GET /api/health` | Process health, timezone and Node availability | None |
| `GET /api/live` | Current bus cache, errors, freshness metadata and quota | None |
| `POST /api/live/refresh` | STIB + De Lijn refresh, requiring manual/automatic purpose header and respecting key policy | Up to 2 |
| `GET /api/next` | Read-only next/recommended commute options | **None** |
| `GET /api/plan-train` | Read-only backward plan to a supplied train time | **None** |
| `GET /api/trains` | Brussels North iRail departure board | Up to 1, separately cached/rate-limited |

The JSON planning endpoints invoke `api_cli.js` under Node.js 20+, which uses the **same engine** as the browser. Missing Node produces HTTP 503 for these endpoints, not a fabricated result. At most two planning subprocesses run concurrently, each with an 8-second timeout.

## GET /api/next

Example for HA, recalculated at the time of each request:

```text
/api/next?direction=toBN&walking=1&shuttle=1&horizon=240&limit=1
```

Reproducible timetable example:

```text
/api/next?date=2026-09-07&time=08:00&direction=toBN&walking=1
```

| Query | Default | Allowed / meaning |
|---|---|---|
| `date`, `time` | now | Both or neither; YYYY-MM-DD and HH:MM in Brussels time. Supplying them uses planned, not live, bus times. |
| `direction` | `toBN` | `toBN` or `toTNT` |
| `walking` | `1` | `0` or `1`; walk before boarding towards BN, or after alighting on the return |
| `shuttle` | `1` | `0` or `1`; eligible staff only |
| `horizon` | `240` | 30–2880 minutes. Finite service calendars still apply. |
| `operator` | `all` | all, shuttle, stib, delijn |
| `stop` | `all` | all, shuttle, picard, suzan, thurn |
| `limit` | `5` | 1–20 packed options; does not change ranking / the per-operator fields |

### Response fields

- `schema_version`, `generated_at`, `reference`, `timezone`, `direction`, `walking_included`, `window_minutes`, `count`.
- `recommendation`: **earliest final arrival** (BN outbound, home on return) after preferred-stop selection and within active filters, or null.
- `next_by_operator`: chronological next reachable departure for each operator. The active operator and stop filters apply; a filtered-out operator has no option.
- `best_by_operator`: earliest-arriving reachable option for each operator. This can differ from its first departure.
- `options`: limited list in recommendation order.
- `providers`: per-provider freshness, fetch/feed timestamps and error.
- `timetable_coverage`: actual bundled start/end/version/download metadata.
- `upstream_requests_made`: always **0** for this endpoint. This is about this request, not about whether the shared cache contains live data from an earlier explicit refresh.

Use `stop=thurn` to query Thurn en Taxis / STIB 88 specifically. Its home-to-stop walk is 11 minutes. Normal STIB per-operator entities include 88 where it is the next/best reachable choice. Its walk is 11 minutes at either home end.

Each packed option contains:

```json
{
  "operator": "stib",
  "line": "14",
  "headsign": "GARE DU NORD",
  "origin": {"id": "1019", "name": "PICARD", "group": "picard"},
  "destination": {"id": "1083", "name": "GARE DU NORD", "group": "bn"},
  "departure": "2026-09-07T06:06:00.000Z",
  "arrival": "2026-09-07T06:12:00.000Z",
  "leave_home_at": "2026-09-07T06:01:00.000Z",
  "walk_minutes": 5,
  "ride_minutes": 6,
  "total_minutes": 12,
  "quality": "scheduled",
  "live": false,
  "arrival_estimated": false,
  "staff_only": false
}
```

This is a documented example from the included September 2026 timetable, not a universal next departure. Actual output also has `id`, `minutes_until_leave_home`, `note` and **`route_page_url`** (null for the shuttle). STIB links use a verified destination-based `v`/`f` mapping; 14/20 towards BN use f, while 88 towards BN/De Brouckere uses v. De Lijn links use the route URL in GTFS. Fractional minute values can occur because bus GTFS contains seconds. `leave_home_at` is null at a TNT stop start and in the reverse direction. Return trips instead provide `home_arrival`.

`quality`: `live`, `scheduled`, `derived`, `assumed` or `confirmed`. `assumed` denotes the user-requested shuttle peak grid; `confirmed` denotes the user's TNT lunch direction. Neither is live tracking. The browser uses punctuality colours: zero verified delay green, positive <180s orange, ≥180s red, negative blue, unknown black. Home times are gray. API quality fields are intentionally retained. Cancellation/passed/not-boardable rows cannot win. `collapse_eligible` excludes the shuttle even if `dominated` is true.


### Added comparison fields (app 1.2.0)

- `arrival` remains the **bus-stop arrival**, preserving the original field meaning.
- `home_arrival`: return trip bus arrival + walk home, otherwise null.
- `journey_arrival`: final arrival used for ordinary ranking (BN or home).
- `walk_before_minutes`, `walk_after_minutes`, and aggregate `walk_minutes`.
- `scheduled_departure`, `scheduled_arrival`: operator-paired times for the De Lijn stop API, or inferred STIB originals marked by `delay_estimated`; null when no plausible match exists.
- `departure_delay_seconds`, `arrival_delay_seconds`: signed matched-live deltas, or null/unknown; zero is not used for missing data.
- `dominated`, `dominated_by`: strict earlier-start/later-arrival inefficiency. These rows remain in `options` (the browser groups them in a collapsed section with explanations); cancellation/not-boardable rows cannot win. The referenced ID is an option's `id`.
- `occupancy`: matching departure occupancy object or null. No line-average guess.

Both UI and API use `engine.comparison()`. Picard is preferred from home and on return; Suzan Daniel from a no-walk TNT start. Later departures stay. Earliest exact final arrival comes first, then the user's direction-specific operator order, then later start. Explicit stop filters override the default stop preference.

## GET /api/plan-train

```text
/api/plan-train?date=2026-09-07&time=08:30&margin=5&walking=1&horizon=120
```

`date` and `time` are required and mean the **scheduled departure of the desired train from BN**, not a home departure. `margin`: 0–60 minutes, default **5**. Walking, shuttle, operator, stop and limit options work as above; direction is forced to TNT → BN. The search lookback is bounded to 30–240 minutes even if a larger horizon is supplied.

- `recommendation` and `best_by_operator` use **latest start meeting the train deadline**.
- `next_by_operator` remains chronological within the search window; use recommendation/best for a latest-start plan.
- Extra top-level `train_plan`: scheduled departure, BN arrival deadline, margin and objective.
- Packed train options add `train_departure`, `arrive_by`, `station_margin_minutes`, `station_wait_minutes`.
- `total_minutes` for a train option covers its calculated latest start **to BN**. Add `station_wait_minutes` for elapsed time until the train departs.
- For a relevant train today, fresh cached live bus data can be applied. It still makes no network request. Future-date bus plans stay scheduled.
- This endpoint does not verify a real train service at the supplied time and does not query iRail. Use `/api/trains` separately if verification / selection is wanted.

## GET /api/trains

```text
/api/trains?date=2026-09-07&time=08:00
```

Returns the iRail board for **BE.NMBS.008812005**, Brussels North. The station is fixed server-side. `date` / `time` specify the board start, not a home departure. Dates are structurally validated; iRail may reject distant dates.

Response: `ok`, `source`, `sourceUrl`, `station`, `date`, `time`, `fetchedAt`, `feedTime`, `cached`, `departures`.

Each departure has id, service, vehicleId, destination, scheduledDeparture, expectedDeparture, delaySeconds, platform, platformChanged, cancelled, left, source and fetchedAt. Times in this internal/UI rail response are epoch seconds, unlike the packed HA entity timestamps.

No cancellation/left train may be selected in the UI. A delay is displayed but never extends the planner's scheduled-departure deadline. Cached boards retain their original fetch timestamp. On failure, `ok:false`, a human-readable error, and an empty departure list are returned; no sample services are substituted.

## Error behavior

- 400: invalid date/time, enum, range or integer input.
- 429: local train request throttle.
- 502: train upstream unavailable / invalid response.
- 503: Node missing or planning subprocess capacity exhausted.
- 500: planner process/data failure.
- 404: unrecognized route.

Bus upstream failures are represented inside the `/api/live` payload, and timetable fallback remains usable. An absence of departures within a window or outside GTFS coverage is not proof that the operator runs no service.


## Access / refresh purpose (1.3.0)

`access` in health, cached live state and planning responses contains only `mode`, `keyConfigured`, `autoRefreshAllowed`, `dailyLimit`, `minuteLimit`. No key or secret path is exposed. See [private access setup](API_ACCESS.md).

For `POST /api/live/refresh`, send `X-Commute-Refresh: manual` for a deliberate user action, or `automatic` for timers/automation. Missing/unknown headers are automatic. Without a configured key, automatic requests return cache/notice only and do not contact providers. With a key, both manual and automatic requests use the registered gateway. GET cache/planning endpoints always remain zero-upstream reads.

Anonymous and registered quota buckets are separate; legacy anonymous history is retained. Registered default is 10,000/day, not the old anonymous 80/day limit. No auth failure triggers anonymous fallback.


## App 1.4 fields and sources

- `collapse_eligible`: UI folding policy, separate from mathematical `dominated`. Always false for shuttle. Other alternatives are folded inline rather than moved to the bottom.
- `delay_estimated`, `arrival_delay_estimated`, `schedule_match_method`: distinguish STIB inferred schedule matching and projected arrivals from De Lijn operator-paired values. STIB live rows still have no confirmed provider trip identity.
- `live_source: "delijn-stop-api"`, `vehicle_id`: present for matched direct De Lijn stop predictions.
- `access.delijnStopKeyConfigured`, `access.delijnSource`, `access.delijnDailyLimit`: safe capability metadata, never credentials.
- `quota.bmcCallsPerRefresh`, `quota.delijnStop`: direct De Lijn uses one batch call in its own bucket, plus one BMC STIB call. Without the direct key, the existing two-call BMC refresh remains.

The global auto permission remains BMC-key-based. With only a De Lijn key configured, the combined refresh is manual so anonymous STIB requests are never silently automated.
