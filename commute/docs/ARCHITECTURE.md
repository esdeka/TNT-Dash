# Architecture and provenance

## Components / data flow

```text
Official BMC GTFS ZIPs ── refresh_schedules.py ── data/timetable.json
User walking pins ──────────────────────────── data/walking.json
Original shuttle PDF + explicit user rules ─── static/engine.js
                                      │
                   build.py embeds everything into Dashboard.html
                                      │
                 browser app.js ── shared engine.js ── recommendations
                                      ▲
  STIB WaitingTimes ─┐                │
  De Lijn GTFS-RT ───┴─ server.py cache/normalize ── /api/live[ /refresh ]

Home Assistant ── /api/next ── server.py ── api_cli.js ── SAME engine.js
                     cached live state + GTFS; zero upstream requests

Train selection ── /api/trains ── rail.py ── iRail Brussels North liveboard
             chosen scheduled departure + margin ── engine.planForTrain
Manual train time ──────────────────────────────────┘
```

There is no frontend framework, external CDN dependency, geolocation tracking or analytics. All browser-facing API URLs are relative. `window.COMMUTE_SERVER` is false in the built file; `server.py` changes it to true only when serving HTML. The offline copy therefore does not misrepresent itself as a live service.

## Official static bus data

Public API base:

`https://api-management-discovery-production.azure-api.net/api/`

| Operator | Endpoint |
|---|---|
| STIB-MIVB | `gtfs/feed/stibmivb/static` |
| De Lijn | `gtfs/feed/delijn/static` |

`refresh_schedules.py` downloads both ZIPs and streams the very large `stop_times.txt`, rather than unpacking the full network into the project. It selects direct bus legs (GTFS route type 3) serving a neighbourhood stop and BN in the correct order, with normal pickup/drop-off and ride ≤1 hour. It preserves service calendars and date exceptions. One physical vehicle may yield both a Picard and Suzan Daniel boarding option.

Included snapshot, downloaded 4 September 2026:

- STIB feed `2_20_20260831_010702`, coverage **31 Aug–27 Sep 2026**; 1,425 relevant trips / 1,834 legs after adding line 88; STIB archive re-fetched 5 Sep 2026.
- De Lijn feed `20260903_20261112_003000`, coverage **3 Sep–12 Nov 2026**; 7,676 relevant trips / 13,957 legs.

Inspect `data/timetable.json` after a refresh; these dates are historical documentation of the bundled fixture, not a promise of future validity. Outside coverage, no service is extrapolated.

### Stop / route identity

- STIB 14 serves Picard and Suzan Daniel; 20 serves Suzan Daniel, not Picard; **88 serves Thurn en Taxis** in this snapshot.
- STIB Picard IDs: 1019 / 1056; relevant Suzan Daniel IDs: 1670 / 1671; BN: 1082 / 1083, plus 3400 for boarding line 88. Thurn en Taxis: 1349 towards BN, 1356 on the return. Other nearby Suzan Daniel platforms may serve unrelated routes.
- De Lijn IDs are prefixed `gs:delijn:`. Relevant Suzan Daniel: 310787 / 310788 / 359938; Picard: 310789 / 310790; BN arrival 303916, boarding 303917.
- De Lijn direct routes found include 714, R14, R15, R30, R31, R40, R41, R45, R50, R60, X60. Do not infer service on a date from a route number alone.
- Walking reference pins and actual GTFS boarding coordinates are different concepts. The user approved 8 minutes for the whole relevant Suzan Daniel stop area, and 11 minutes for Thurn en Taxis. The latter has operator coordinates only, not an invented user reference pin.

## Live bus APIs

| Operator | Endpoint | What it provides |
|---|---|---|
| STIB | `datasets/stibmivb/rt/WaitingTimes` | Predicted arrivals at stops, line and destination, without usable trip IDs |
| De Lijn | `gtfs/feed/delijn/rt/trip-update` | GTFS-Realtime trip/date/stop updates and cancellation/skipped flags |

The backend fetches both concurrently and filters to this corridor. De Lijn currently returns JSON even though it is a GTFS-RT endpoint; optional `gtfs-realtime-bindings` handles protobuf if the format changes.

### Matching and honest fallback

- STIB predictions match stop + line + headsign to a nearby valid scheduled template within one hour. The other end is an **estimated** scheduled ride away. No exact matched-trip delay is invented. End-of-service sentinel rows are discarded.
- De Lijn matches exact trip ID, service date, stop ID and sequence. Explicit `NO_DATA` is never converted into a positive live prediction.
- Trip cancellation enum 3 is different from skipped-stop enum 1. A fresh feed can still contain a cancellation last changed long ago; preserve it. Reject **positive timing** older than 300 seconds only after processing cancellation/skipped flags.
- Fresh provider/fetch data lasts 120 seconds. De Lijn's feed-generation timestamp is also checked. STIB does not expose one at this endpoint, so its freshness is measured from fetch time.
- Stale / failed data falls back to labelled timetable values. No fabricated delays, cancellations or countdowns are emitted as live.

### Network policy

With a configured BMC key, opening/returning starts a visible-page session: checks every 60 seconds, up to 20 minutes. Without a key, operator refresh is manual-only. A read-only cache/capability GET is permitted on opening/returning. Hidden pages pause; manual refresh resumes a session. The shared cache and 80-call rolling-day cap remain. Local display rerenders every 15 seconds and does not by itself fetch data.

Shared bus cache: at least 60 seconds. Per-mode app limit: **anonymous 80/day; registered default 10,000/day; 4/minute for either**. Mode buckets preserve legacy usage. One two-provider refresh consumes two requests. Quota and live cache persist in the state directory; failed attempts also consume quota. The BMC anonymous terms describe 100 requests/day and 10/minute; the lower application limits reserve headroom for GTFS downloads. Other applications on the same public IP may also consume the provider allowance.

`GET /api/next` and `GET /api/plan-train` do not refresh those APIs. They read the shared cache and recalculate against the current clock. This makes normal HA sensor polling inexpensive and quota-safe, but does not provide continuously fresh live predictions by itself.

## Train board

`rail.py` queries `https://api.irail.be/liveboard/` using fixed, verified station ID **BE.NMBS.008812005** (Brussel-Noord/Bruxelles-Nord). It never accepts an arbitrary upstream URL or station ID from a client.

- ISO UI date is converted to iRail `ddmmyy`; time to `hhmm`.
- Scheduled time, delay, platform, platform-change, cancellation and departed flags are retained.
- Distinct date/time requests have a minimum 60-second cache; longer upstream `max-age` is respected. A separate local limiter caps 20 requests/minute and separates upstream calls by at least 1 second.
- A selected near-term train today can be refreshed with the visible session; no hidden/future-date polling. Caches are private and in memory; restarting only loses train-board caches, not the bus quota.
- Distant dates / upstream errors fail clearly and offer manual train-time entry. No example trains are substituted.
- iRail is a separate open-data service. Do not describe this as a direct official SNCB API integration.

## Comparison and time semantics

`comparison()` is the common UI/API entry point. It queries an extra hour of preceding calls so a passed preferred stop is not silently replaced by a non-preferred stop, applies active filters, selects preferred stop variants, then applies walking and the real cutoff. Later vehicles remain. STIB uses line/date stop preference because live records have no trip ID; De Lijn uses exact trip/date and can fall back when a preferred call is skipped.

Home → BN: Picard over Suzan, walk before boarding. TNT → BN: Suzan over Picard, no walk. BN → home: Picard where served, walk after alighting. The original 5/5/8/11-minute user estimates are reused on return. Individual GTFS boarding/alighting coordinates are retained.

`arrival` remains the bus-stop timestamp. `homeArrival` and `journeyArrival` account for the return walk. Outbound walk must not be added to absolute bus arrival a second time. Standard rank is final arrival, then operator preference, then later feasible start. Outbound operator order: Shuttle, De Lijn, MIVB 14/20, 88; return: Shuttle, MIVB 14/20, 88, De Lijn.

Strict dominance means another option starts later AND ends earlier; it is annotated and collapsed with a comparison reason in the UI, not removed or called cancelled. Equal arrivals use the preference order. `markDominated()` is O(n log n), retaining later departures.

All internal times are epoch seconds and UI formatting uses Europe/Brussels. Relative minutes are the difference between the displayed clock-minute values (an approximation); future train plans show absolute times rather than a misleading countdown from the search bound. Previous service days handle GTFS >24:00.

Train mode still works backward from scheduled train departure minus the 5-minute default margin and chooses latest start. `queryReference` is only a lookback bound. Today's relevant cached bus updates may apply, future-date updates do not. A train delay never extends the deadline.

## Files and serving

`build.py` embeds JSON, all three CSS layers, the font, scripts and original PDF in one HTML file, using an atomic replace. The server route marks it as live-capable. The shared `engine.js` is also required by the Node CLI bridge; no calculation logic is duplicated in Python.

`server.py` uses stdlib HTTP and a maximum of two concurrent Node planning subprocesses, with a timeout. Missing Node yields a clear 503 for the JSON planner while the browser UI still works. A timetable replacement requires server restart because the live filtering dataset is loaded at startup.

Source documentation is exposed on a small explicit `/docs/...` allowlist. There is no arbitrary file-server route. The server is designed for a trusted LAN / authenticated preview, not as a publicly exposed production service.

## External references

- Belgian Mobility catalog: https://data.belgianmobility.io/en/data.html
- Public-feed terms: https://data.belgianmobility.io/en/terms.html
- iRail API, caching and request limits: https://docs.irail.be/
- HA REST integration: https://www.home-assistant.io/integrations/rest/
- HA OS local app development: https://developers.home-assistant.io/docs/apps/tutorial/


## Temporary route changes: R15 example

Checked on 5 September 2026 against the saved **4 September** De Lijn GTFS, version `20260903_20261112_003000`. The user reports R15 temporarily serving Suzan Daniel because of works. The dashboard does not maintain a permanent R15–Suzan Daniel route rule: that connection is discovered from dated trip stop sequences.

The imported R15 corridor legs use **Suzan Daniel (MIVB) 359938 → BN alighting stop 303916**, and **BN boarding stop 303917 → Suzan Daniel 310787** in the reverse direction. Their relevant service calendars/date exceptions run on specific dates through **17 September 2026**; the saved dataset has no R15–Suzan Daniel corridor departures on **18 September** or later within its coverage. This is a statement about this snapshot, **not an independently verified works end date**. The reason for a route change is not encoded by a stop sequence alone.

Planned diversions are reflected when the operator publishes them in GTFS and that feed is imported. Matching fresh De Lijn trip updates can change timing, cancel a trip or mark a boarding/alighting stop skipped. They do **not** currently discover brand-new trip IDs or construct new legs through stops absent from the saved trip pattern. ADDED/UNSCHEDULED/DUPLICATED trips are not used to invent connections. STIB waiting times likewise do not provide full replacement routes.

No comprehensive De Lijn/STIB service-alert feed is currently connected, and a Live refresh does not refresh GTFS. Therefore last-minute rerouting, temporary stops not yet imported, changed diversion end dates and explanatory works notices can be missed. Suitable next work: opt-in scheduled GTFS updates plus dated route/stop-specific alert warnings. Alerts can explain and warn; free-text diversion notices should not be converted into fabricated departure times. If a temporary stop moves beyond the approved walking area, its walking time needs confirmation too.


## Punctuality colours, links and occupancy

The compact main view leads with bus departure, with subtle gray leave-home/home-arrival lines below the corresponding bus event. Blue direction theme towards BN; green towards home/TNT. Walking/home times are gray. Bus departure and stop arrival have distinct icons, relative + absolute times, and nonzero delay/original times when known.

`timingStatus()` returns green for exactly zero verified live delay, orange for positive <180s, red for ≥180s, blue for early, black for unknown/timetable. Original times are black. Do not treat missing delay as zero. STIB's waiting feed has no paired original/trip IDs; the user now explicitly requests estimated matching. The bounded order-preserving match provides approximate originals/delays marked ≈, not provider-reported identities. Downstream projected arrivals carry ≈.

STIB web links were checked in rendered operator pages on 2026-09-05. Codes are **v/f**, not v/r: 14/20 to BN use f and away use v; 88 to De Brouckere/BN uses v and to UZ-VUB uses f. This is a per-line destination map, not a global direction guess. De Lijn R41 direction 0/1 URLs were also checked against the displayed endpoints; the published GTFS URL is retained.

Both inspected live bus payloads contained no occupancy fields. De Lijn normalization now preserves optional GTFS-RT `departureOccupancyStatus` / snake-case equivalent at a stop. The engine only attaches it with a matching trip, service date and origin sequence in fresh data. Explicit no-data occupancy is omitted. Not-accepting/not-boardable statuses cannot win. STIB website average crowding profiles are not imported as current vehicle load. No private website API/token is used by the dashboard.

The source/referral material now lives in `static/reference.js`; the compact UI/controller in `static/app.js`, with final layout in `static/glance.css`. `build.py` embeds both modules and all CSS, preserving standalone/opaque iframe operation.

The scoped STIB import for line 88 remains: `refresh_schedules.py --operators stib`, preserving De Lijn. No additional GTFS download was needed for this layout/ranking revision.


## Private transport configuration and STIB coverage

`mobility_config.py` is used by the server and GTFS importer. Empty key means the anonymous Discovery base; a configured private key/file means the registered HTTPS base, with a key in an unredirected `Ocp-Apim-Subscription-Key` header. Only sanitized capabilities reach the browser. Auth failures do not fall back to anonymous. See `API_ACCESS.md`.

The client first reads cached state/capabilities. It starts with auto refresh disabled until the server allows it. No key means no automatic POST, even on reopening, mode changes or focus. The server treats unmarked requests as automatic and blocks anonymous automatic refresh, protecting against older tabs. Manual requests are explicitly tagged.

STIB uses an authoritative next-passing window per boarding stop, line and destination. Valid fresh predictions replace every GTFS call through the final predicted display minute; later schedules remain. Identical prediction records are deduplicated. This is not a one-to-one match to scheduled trip IDs. Existing walking filters run afterward, so losing an unwalkable 10-minute prediction never resurrects a scheduled 15-minute bus inside a live 10/30-minute window.


## Observed De Lijn coverage — 7 September 2026

A manual diagnostic refresh at **07:50 Brussels time** succeeded for both providers. De Lijn's feed and relevant trip timestamps were fresh. Replaying that received snapshot at its retrieval time produced **zero usable live boarding predictions towards BN**, across all queried neighbourhood boarding options—not only after preferred-stop filtering. **15 preferred return options from BN had live departure updates**, all with a reported zero departure delta in that snapshot. This is a dated observation, not a permanent guarantee of feed coverage.

Example: the upcoming R41 at Picard matched its GTFS trip and sequence, but its origin update was `{stop: "gs:delijn:310790", seq: 23, relationship: 2}` with no timing event. Relationship 2 is **NO_DATA**, not on time. The same issue affected other upcoming Picard and Suzan Daniel calls. Among the preferred outbound rows, 41 had origin NO_DATA, 10 lacked a matching live trip, 2 had old trip timestamps, and 2 were explicit cancellations. No usable outbound prediction was being lost merely because of colour rendering.

Black timetable/unknown times are therefore appropriate for those rows. Do not force green or propagate a first-stop delay across an explicit NO_DATA call. The original cache inspected before the diagnostic refresh was also about five minutes old, exceeding the two-minute freshness threshold. Manual refresh can solve cache age but cannot supply a forecast omitted by the operator. More request quota does not itself repair stop-level data coverage.

No timing or colour algorithm was changed in response to this diagnosis. A future investigation may compare a properly authorized stop-specific De Lijn real-time source with this BMC GTFS-RT feed. Do not promise that alternative coverage before checking it.


## Operator stop-feed confirmation — 7 September 2026

The user's official-app screenshot correctly showed delayed/early buses at Picard **310790 towards BN**. Further investigation confirmed that this is a **data-source/adapter gap**, not absence of De Lijn live information. Do not generalize the BMC `NO_DATA` result to De Lijn's own app.

The public operator stop page, rendered normally in a browser, requests its stop-oriented network-trip data. That response supplies separate `plannedPassage` and `realtimePassage` timestamps, `realtimeStatuses: ["REALTIME"]`, line/direction, journey IDs and vehicle IDs. It matched the user's vehicles 2659, 2580, 2679, 2618 and 2559. The BMC feed contained some running deviations at preceding stops for those same vehicles, but no timing event at Picard itself. It is still incorrect to present first-stop/preceding-stop data as an authoritative Picard prediction through explicit NO_DATA.

Latest browser stop check: **07/09/2026, 08:28:14 Brussels time**. First five future/arriving entries:

| Line | Vehicle | Scheduled | Expected | Delta (seconds) | Status |
|---|---|---|---|---:|---|
| R31 | 2676 | 08:24:00 | 08:33:11 | +551 | REALTIME |
| X60 | 2573 | 08:18:00 | 08:34:00 | +960 | REALTIME |
| R40 | 618085 | 08:29:00 | 08:34:42 | +342 | REALTIME |
| R41 | 550154 | 08:39:00 | 08:38:12 | -48 | REALTIME |
| X60 | 604026 | 08:34:00 | 08:38:21 | +261 | REALTIME |

The operator website's internal stop endpoint returned data through ordinary public browsing, but a direct unauthenticated backend request received HTTP 403. Do not copy/reuse website cookies or keys found online to turn this into an undocumented automated backend. De Lijn's own developer portal explicitly offers a free subscription product including **real-time information for stops**: https://data.delijn.be/products . The next implementation step is a supported stop-level connector using the user's own appropriate API access, matching service date / line / journey / stop and planned time. The existing BMC API-key configuration is not already this connector.

No production timing/colour algorithm or upstream selection was changed during this check. The current app can therefore still miss these outbound forecasts. The previous 07:50 diagnosis is accurate for its BMC snapshot, but was too broad if read as saying De Lijn itself has no stop predictions.


## Current implementation update — 1.4.0

The operator stop connector described in the diagnosis is now implemented in `delijn_live.py`, using the supported documented API and the user's own separate key. It is not active without that key. See `DELIJN_REALTIME.md` for the exact schema, identity match, limits and unverified authenticated deployment. The website browser endpoint and third-party/shared keys are not used.

STIB scheduled matching is now an explicit user request, superseding the former no-numeric-delay display. `matchSTIBSchedules` performs a bounded (±30 minutes) one-to-one, order-preserving minimum-cost match to unique GTFS departures. Equal-cost choices retain earlier schedules. Actual live times stay unchanged; originals and minute-rounded deltas are labelled estimated (`≈`, `delayEstimated`). No provider trip ID is claimed. A no-match case stays unknown. The live window remains authoritative, and any assigned schedule slot is removed to avoid a duplicate representation of an early live bus.

`collapseEligible` is separate from dominance; shuttle is always ineligible for collapsing. Other dominated runs are inserted as thin `<details>` rules at their chronological position, with reasons inside, not pooled at the bottom.
