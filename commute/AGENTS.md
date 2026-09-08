# Agent handoff: personal TNT ↔ Brussels North commute dashboard

Start here. This file records the user's actual decisions and the invariants that must survive further work. It is not a product: do not reintroduce branding, slogans, a landing-page hero, or a large introduction above the result.

## Current task / verification state

Updated **2026-09-07, app 1.4.0**. Latest user rules override older no-STIB-matching and bottom-collapse instructions:

- **De Lijn supported stop real-time connector implemented** in `delijn_live.py`. It uses the documented multi-stop API and the user's separate De Lijn key. No real key was supplied here; actual authenticated deployment remains unverified/inactive until configured. BMC GTFS-RT remains fallback without it. Never use a website/shared/borrowed key.
- **Shuttle is never collapsed**, even when mathematically dominated. Keep `dominated` separate from `collapseEligible`.
- Other dominated runs become **very thin inline expandable separators in sorted position**, not one group at the bottom. Reasons remain inside the expanded records; later departures remain.
- **STIB scheduled/live matching is now explicitly requested by the user.** Match unique scheduled times one-to-one in order, within ±30 minutes, minimize total absolute time difference, and prefer earlier schedules on equal cost. This is an estimate, NOT a publisher trip ID. Show ≈ with original time/delay; keep `tripId:null`, `estimatedTripId`, `delayEstimated:true` and `scheduleMatchMethod`. Display STIB estimated deltas rounded symmetrically to whole minutes; actual live timestamps stay unchanged. A missing plausible match remains unknown.
- Retain the authoritative STIB live window through the last prediction minute. Also remove assigned schedule slots beyond the window when an early live bus was matched to them, avoiding duplicate representations.

Verified locally: **60 engine tests, 34 Python checks and the browser suite passed**. Exact limits are in `docs/VERIFICATION.md`; setup in `docs/DELIJN_REALTIME.md`. The global auto-refresh policy still requires the BMC key to avoid automatic anonymous STIB calls; a separate De Lijn key alone enables its stop values on manual refresh.

## Current user decisions (latest wins)

- Personal dashboard, no marketing. Main page is a quick phone glance: bus departure is prominent and the gray home time sits subtly beneath the corresponding bus event; **no ride-time column, operator comparison panels or area map**. Detailed explanations belong in Reference. Controls are collapsed by default.
- Destination direction theme: **blue towards BN, green towards TNT/home**. Header buttons make this obvious.
- Home is on Parkdreef on the T&T site. BN is Brussels North / Brussel-Noord, NOT the Tour-et-Taxis railway station.
- Home → BN: add the walk before boarding. **From TNT** means already at a neighbourhood stop, with **no walking**. User confirmed this in clarification.
- **BN → home now includes the walking time after alighting.** Reuse the user estimates: Picard 5 min, shuttle 5 min, Suzan Daniel 8 min, Thurn en Taxis 11 min. The earlier “no reverse walk” rule is superseded.
- Original three reference pins are user-provided. Thurn has an 11-minute user estimate but no personal pin; actual coordinates come from STIB. Do not overwrite individual operator stop coordinates. The user approved 8 minutes for all nearby Suzan Daniel platforms.
- Stop preference: **Home: Picard over Suzan Daniel. TNT start: Suzan Daniel over Picard. Return: Picard where served.** Keep line 20 at Suzan and 88 at Thurn. De Lijn exact trip groups can fall back when the preferred stop is skipped/not boardable. STIB has no live trip IDs, so its line-level stop policy must not invent vehicle pairing.
- User confirmed **retain later departures of the same line**. Only duplicate stop alternatives are suppressed, not all future buses of that line.
- Keep strictly dominated alternatives (except the shuttle stays unfolded): earlier journey start AND later final arrival than another option. Place in thin inline closed-by-default separators with a reason; never collapse shuttle; **not cancellation**, not deletion. Equal arrivals are not strict dominance. Only usable options can dominate others.
- Ordinary ranking: exact **final arrival** first (BN outbound, home on return); operator preference breaks ties; then later feasible start. Outbound order: Shuttle → De Lijn → MIVB 14/20 → 88. Return order: Shuttle → MIVB 14/20 → 88 → De Lijn.
- Home leave/arrival times: **gray**, with walking icon, below the bus departure/arrival rather than above/in the row heading. Bus departure: bus icon; bus arrival: arriving-arrow icon. Show relative minutes and absolute time. Relative minutes reflect the displayed clock-minute difference; absolute times are Brussels time. Future train plans omit relative counts instead of using the search-window start.
- **Punctuality colours:** green only for a verified live delta of zero; orange for positive delay <180 s; red for ≥180 s; blue for negative/early. Show delay and original time when nonzero, with original time black. **Black means scheduled/unknown, not verified on time.** STIB expected times have no provider trip ID; the user now requests a clearly estimated one-to-one scheduled-time match. Numeric matched delays must carry ≈ and must never be described as provider-reported.
- With an API key configured, the user selected auto refresh **once per minute while visible, up to 20 minutes per opening/return**. Without a key, only explicit manual refresh may call upstream. Pause hidden pages; refresh on load/refocus/return if due. Manual refresh starts a new session. Keep the shared cache and daily quota. Refocus can recheck an exhausted quota so an old client does not remain stuck after it resets.
- Occupancy only if explicitly supplied for the particular departure. Both live feeds inspected on 5 Sep supplied none. The STIB website's typical average crowding is NOT current bus load. Do not present it as live occupancy. Optional GTFS-RT origin departure occupancy is supported with exact trip/date/sequence matching.
- **Links:** verified STIB codes are `v` and `f`, not `v/r`. 14/20 towards BN use `f`, away use `v`; 88 towards De Brouckere/BN uses `v`, towards UZ-VUB uses `f`. The map is destination-based in the engine. De Lijn uses the GTFS directional URL; R41 direction 0/1 was checked on the operator site.
- User has HA OS. Default train station-transfer margin **5 minutes**, adjustable. Train mode still chooses the latest start meeting the **scheduled** train departure minus margin, never a delayed train time. No extra bus-boarding margin is added.

## Shuttle interpretation — do not silently change it

Original document: `static/shuttle.pdf`, user-uploaded 2026 timetable. Keep it unchanged.

- Employees-only; the user's ride-time assumption is **8 minutes**. No shuttle live tracking exists here.
- Morning fixed times are BN → TNT. TNT returns are BN departures **+8 minutes**, e.g. 05:38 and 05:48. Quality: `derived` (Details/API; times appear black).
- User-assumed peak grid: morning BN **07:00, 07:08, …, 09:24**, anchored once and clipped to the 07:00–09:30 window. Do not restart the grid each hour: after 07:56 comes **08:04**, not 08:00.
- Morning TNT grid = that BN grid +8 min: **07:08–09:32**. Next derived fixed TNT trip is 09:43.
- Afternoon TNT grid: **16:00, 16:08, …, 18:24**, clipped to 16:00–18:30. Next fixed trip is 18:40.
- De-duplicate fixed/grid overlaps, keeping stronger provenance at BN 07:00 / TNT 07:08.
- Lunch starts at **TNT**, as confirmed by the user: 12:05, 12:20, …, 13:50 every 15 min. BN arrival +8 min. Quality `confirmed` describes the user's direction confirmation, not live operation.
- Rogier estimates: **12:16 for TNT 12:05; 12:32 for TNT 12:20**. Keep both exactly. Later Rogier arrivals are unspecified; do not extrapolate the inconsistent offsets. Rogier is continuation information, not a comparison destination. BN lunch arrivals are not return departures to TNT.
- Still exclude unspecified afternoon **BN → TNT** trips and the disputed **22:00** row. Retain TNT **21:40**. Do not extend the morning return rule to the afternoon without permission.
- No weekend shuttle; public-holiday operation unconfirmed and excluded; PDF applies only in 2026.

## Dual transport: server mode and serverless direct mode — keep them mirrored

The dashboard runs two ways, and behaviour must stay identical in both. **Server mode**: `server.py` serves the built page with `window.COMMUTE_SERVER = true` and holds `/api/health`, `/api/live`, `POST /api/live/refresh`, `/api/next`, `/api/plan-train`, `/api/trains`. Keys stay private on the server. **Serverless direct mode** (`static/live-direct.js`, loaded when `COMMUTE_SERVER` is false): the built page itself calls the same upstreams — STIB waiting times and De Lijn GTFS-RT via the BMC discovery/registered gateways, the De Lijn stop API with its own key, and the iRail liveboard. CORS was verified on 2026-09-07 for all four gateways (iRail mirrors the request origin, which also legitimises `file://`).

Hard rules for direct mode:

- `live-direct.js` ports `server.py`/`delijn_live.py`/`rail.py` **behaviour exactly**: same normalisers, quota buckets (anonymous 80/day, registered 10000/day, 4/minute, separate De Lijn stop bucket), 60-second shared cache (`TTL`), `STALE_AFTER` 120s, fail-closed anonymous auto-refresh, error kinds/messages, `refreshesLeft` math and the stop↔trip join keys (`3_<stopcode>` batch path, `journeyId = date_lineCode_journey`, GTFS `tripId`). Change the Python and the JS together, like the engine.
- Quotas/cache persist in `localStorage` (`commute.direct.*` keys), tolerating sandboxed iframes and private mode where storage throws.
- No GTFS-RT protobuf parsing in the browser: JSON only. If the gateway ever returns protobuf in direct mode, De Lijn falls back to the timetable honestly. The Python protobuf fallback is server-only.
- Keys resolve at runtime, strongest first: **browser localStorage** (entered via Reference → API keys, stored under `commute.keys.v1`) → **sibling `Dashboard-secrets.js`** (`window.COMMUTE_SECRETS`, loaded by a plain script tag so it works on `file://`; `build.py` writes it from the env key files and `.gitignore` keeps it out of git; rotate by editing it, no rebuild) → **build-embedded** (`COMMUTE_KEYS`, only with `--embed-keys`). `live-direct.js` re-resolves keys on every operation; `keyStatus()` reports masked values and which source supplied each key.
- `Dashboard-secrets.js` must NEVER be committed (it is git-ignored), and the committed Dashboard.html is built with `--no-embed-keys`; artifacts with keys may only be hosted where the user alone can reach them.
- The HA entities API (`/api/next`, `/api/plan-train`) stays server-only; it spawns `api_cli.js` and never spends upstream quota.

## One calculation engine

`static/engine.js` is shared by browser and Node API. User-facing queries must use **`comparison()`**, not raw `allRows()`: comparison applies filters, preferred stops, walking, dominance and direction-specific tie-breaks. `allRows()` is the underlying timetable/live query used by diagnostics/tests.

- `comparison` looks back an extra hour before choosing the preferred stop, then enforces the real start/walk cutoff. This prevents a passed Picard call incorrectly turning into an alternative Suzan boarding option.
- `preferredStops` groups De Lijn by exact trip/date, while STIB uses line/date because its live predictions have no trip ID. Explicit stop filters override default preferences.
- `applyWalking` preserves `arrival` / `arrivalLatest` as **bus-stop timestamps**. Adds `walkBeforeSeconds`, `walkAfterSeconds`, `leaveHomeBy`, `homeArrival`, `journeyArrival`, `journeyArrivalLatest` and `journeyStart`.
- `walkMinutes` is the walk at the home end (before outbound, after return). `totalJourneySeconds` ends at the final destination. Do not add a pre-boarding walk twice.
- `filterRows` sorts on final arrival and the directional operator priority; `markDominated` keeps and annotates strict dominated choices.
- `planForTrain` uses `comparison`, then the station deadline and latest start. Train-row `totalJourneySeconds` ends at BN; `stationWaitSeconds` is separate. `queryReference` is a search bound, not a real home departure.
- `timingStatus` is the single source of punctuality thresholds and known/unknown delay. Never use missing delay as zero.
- All engine times are epoch seconds. Display uses Europe/Brussels, regardless of device timezone. Previous service dates handle GTFS values above 24:00.

## Temporary routing investigation

R15's Suzan Daniel stop is user-reported as temporary because of works. Checked the saved 4 Sep 2026 GTFS: this direct connection is date-specific, present on relevant dates through **17 Sep**, absent from **18 Sep** onward in this snapshot. This is **not a verified works end date**. Do not hardcode R15 as permanently serving Suzan Daniel. See `docs/ARCHITECTURE.md`, “Temporary route changes: R15 example”. There is still no comprehensive diversion-alert integration; Live refresh alone does not import new routes or stop sequences.

## Live-data invariants

- Official STIB/De Lijn data is obtained through **Belgian Mobility**, server-side. No browser API key and no synthetic live data.
- STIB has no matching provider trip ID. The user now explicitly allows estimated one-to-one, order-preserving timetable matching at each stop/line/direction. Preserve actual live times, mark estimated originals/delays with ≈, expose estimate metadata and keep `tripId:null`. Do not claim exact identification or compute an unbounded match.
- De Lijn uses exact trip/date/stop/sequence matching. Trip CANCELED = 3; stop SKIPPED = 1; stop NO_DATA = 2. Do not mix these enums.
- Feed/fetch freshness: **120 s**. De Lijn feed timestamp is checked. Positive per-trip timing expires after **300 s**.
- Critical: handle De Lijn cancellations/skipped stops **before** rejecting old per-trip timing. A cancellation still present in a fresh feed remains valid even if last modified an hour ago. This regression is tested.
- Backend cache ≥60 s. Anonymous: manual-only, 80 calls / rolling 24h. Registered key: default 10,000/day, configurable within assigned quota. Both modes cap at 4/minute. Quota version 2 preserves separate mode buckets and migrates legacy anonymous calls. Two calls per refresh. Preserve runtime quota state. Never reset it for testing or packaging.
- `/api/next` and `/api/plan-train` are read-only calculations on cached live state plus timetables. Polling them must make **zero upstream requests**.
- iRail has a separate cache/rate limiter. A selected near-term train from today can be rechecked with the visible-page live session; no background/future-date polling. Cancelled/departed trains cannot be selected.

## Where things live

| File | Responsibility |
|---|---|
| `static/engine.js` | Calendars, direct routes, live matching, walks, train deadline planning |
| `static/app.js` | Compact UI state, timing display, visible-page refresh controller, train selection |
| `static/template.html` | Compact DOM; departure-first result, collapsed controls and list |
| `static/style.css`, `readability.css`, `personal.css`, `glance.css` | Base/reference styles and final blue/green compact layout |
| `static/reference.js` | Reference-only content; extracted from app.js, no main-page bloat |
| `mobility_config.py` | Server-only key/secret-file selection, gateway, safe capabilities, unredirected auth header |
| `server.py` | HTTP server, BMC/direct-De-Lijn source selection, cache/quota and planning endpoints |
| `delijn_live.py` | Private De Lijn stop API batch, official-schema normalization, exact journey/stop matching inputs |
| `rail.py` | Fixed Brussels North iRail proxy; validation, normalization, cache/rate limits |
| `api_cli.js` | JSON-in/out Node bridge into the same engine; no networking |
| `refresh_schedules.py` | Streams selected official GTFS ZIPs into the corridor subset; `--operators stib` preserves De Lijn |
| `build.py` | Atomic, self-contained HTML build with data/font/PDF/JS/CSS embedded |
| `data/timetable.json` | Attributed GTFS snapshot and service calendars |
| `data/walking.json` | User walk estimates at either home end and reference pins |
| `ha_app/`, `home_assistant/` | HA OS app packaging and REST/template sensor configuration |
| `test_engine.js`, `test_ui.js`, `test_api.py`, `test_access.py`, `test_ha_config.py` | Engine, browser, backend and optional HA-template regressions |

`window.CommuteDashboard.getSnapshot()` is available for tests. A legacy `window.Northbound` alias and migration from the old localStorage key are kept only for compatibility; never display that name in the UI. Server marker is now `window.COMMUTE_SERVER`.

## Run, change, verify, deliver

```bash
python build.py
node test_engine.js
python -m unittest -v test_access.py test_api.py test_ha_config.py test_delijn_stop.py
python server.py --port 3000
# In a second terminal, after installing Playwright / Chromium:
node test_ui.js
```

In Arena, use `start_process` for the server, bound to **0.0.0.0**, and a plain name such as **Commute dashboard**. Browser requests must be relative URLs. Do not hand a user a localhost URL; use the live preview. Background processes and installed caches may not survive a new sandbox; inspect and restart rather than assuming the server is running.

The downloaded HTML is offline: bus timetables, walks, shuttle and **manual train-time planning** work; live APIs / train boards do not. Never present the offline viewer as a running live server.

See `docs/OPERATIONS.md` for refresh/build/restart and packaging. Do not redownload ~217 MB of De Lijn GTFS just to restyle the UI or add an STIB stop. Use `--operators stib` for a targeted import; `--cached` reuses that selected archive. The 88 addition refreshed STIB only and verified the De Lijn operator object was unchanged. Never package `quota.json`, `live-state.json`, credentials, node_modules, browser files or huge cached GTFS ZIPs.

## Known limitations / things not yet established

- No actual connection to the user's Home Assistant instance has been made. A generated HA OS package / YAML is not the same as an installed, validated HA app.
- Only direct stop-to-stop bus/shuttle legs. No pedestrian route geometry, accessibility/platform route, tickets, guaranteed transfers or full disruption coverage.
- iRail is a separate open-data service, not a direct official SNCB API contract. Distant dates may fail. A train board is not a search for every intermediate destination.
- Ordinary planning includes the walk at the home end but does not include a station-platform allowance. Train mode does, using the user's 5-minute estimate.
- GTFS coverage is finite. The included snapshot starts in September 2026; inspect current metadata before assuming it covers a requested date.
- DST fold/gap disambiguation and a complete assistive-technology accessibility audit remain untested.
- API is intended for a trusted LAN and has no built-in authentication. Do not expose it publicly without an authenticated reverse proxy or VPN.

## HA data-scope upgrade

App 1.1.0 adds Thurn en Taxis. STIB `stopScopeVersion` is now 2 (legacy missing version = 1). `ha_app/run.py` selects persisted data per operator only when its scope is compatible and it is newer. Never let a newer cached old-scope STIB extraction hide 88. De Lijn is evaluated independently so its newer compatible data is retained. The selector is import-safe and unit-tested; full HA OS deployment is still unverified.

## Private access invariant

Never request or embed the real subscription key in chat, HTML, public JSON, data files, URL parameters or logs. Use `BMC_API_KEY` / `BMC_API_KEY_FILE` or HA app masked `bmc_api_key`. All public responses use `CONFIG.public()`, not a dataclass dump. Header `X-Commute-Refresh: manual` is required for anonymous upstream refresh; missing header fails closed as automatic. Auth errors must not fall back to anonymous. Static imports use the same server-only access config; no key is sent to iRail.


## De Lijn no-data diagnosis (2026-09-07)

User reported De Lijn appearing scheduled. A fresh 07:50 Brussels manual check found zero live boarding predictions towards BN, because the matched Picard/Suzan calls explicitly used NO_DATA; reverse BN boarding had 15 live zero-delta options. R41 Picard was matched correctly (stop 310790, seq 23) but NO_DATA. The prior cache was also five minutes old. **Do not “fix” this by colouring missing data green or propagating delay through NO_DATA.** Full dated findings are in `docs/ARCHITECTURE.md`. No code behaviour was changed for this diagnosis.


## IMPORTANT correction: De Lijn has live Picard forecasts

On 2026-09-07 the user provided a De Lijn app screenshot proving live +6/+8/etc and early running at Picard 310790. Normal browser inspection confirmed operator stop-response `plannedPassage`, `realtimePassage` and REALTIME flags, including the same vehicle IDs. The BMC feed's NO_DATA is not proof that De Lijn lacks predictions. Our current adapter is insufficient for that stop forecast use case. Details and dated samples are in the last section of `docs/ARCHITECTURE.md`. A direct backend attempt against the website's internal endpoint returned 403; do not reuse any website/third-party key or cookies. Use the supported De Lijn stop-level API with the user's own access if implementing the connector. It has NOT been connected yet.

## De Lijn connector specifics

Uses `/DLKernOpenData/api/v1/haltes/lijst/{entity_stop_pairs}/real-time?maxAantalDoorkomsten=50`. All configured corridor stops are entity 3. Parse `halteDoorkomstenLijst → halteDoorkomsten → doorkomsten`; planned `dienstregelingTijdstip`, actual `doorkomstTijdstip`, explicit REALTIME status, journey identity from `doorkomstId`, vehicle `vrtnum`. GESCHRAPT/CANCELLED are cancellations; VERSTREKEN is passed; GEENREALTIME must not be green/on-time. Date-only timestamps are not valid departures.

`applyDeLijnStop` matches date + line/journey + stop; exact planned time disambiguates repeated calls. Use actual destination data when present, otherwise project the GTFS ride and mark the arrival/delta estimated. A configured direct-key failure does not silently make an extra BMC call. Quota schema 3 preserves anonymous/registered history and adds `delijn_stop` (one batch call). With direct De Lijn active, BMC cost is one STIB request instead of two.

HA app settings: masked `delijn_api_key`, optional `delijn_daily_limit`; environment `DELIJN_API_KEY` or `DELIJN_API_KEY_FILE`. Keep secrets private and excluded from packages. No authenticated stop call was executed with a real key in this workspace.


## Operator logos (1.4.1)

Generic departure-bus glyphs are replaced by the actual De Lijn, STIB/MIVB and T&T compact marks. `static/logos/` contains three PNGs and provenance notes. `build.py` embeds them as data URIs in `operator-logos`; do not add CDN dependencies. Keep image proportions/native colours, the walking sign and arrival arrow. Punctuality remains encoded by numeric time colour, not logo colour. No marketing tagline is included.

Key clarification: BMC distributes De Lijn GTFS-RT, but the implemented direct stop connector is a separate De Lijn Open Data API/subscription. A De Lijn-issued key is needed for that connector, not automatically a BMC key. Do not assert that every possible private BMC product has been investigated. Manual anonymous STIB/BMC + a De Lijn key works without a BMC key.
