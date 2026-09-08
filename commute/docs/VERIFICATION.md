# Verification — operator logos (1.4.1)

Completed 7 September 2026. De Lijn, STIB/MIVB and T&T departure icons now use official compact logo assets, embedded as data URIs. Source/provenance is in `static/logos/SOURCES.md`; no marketing tagline or external image requests are added.

- All three embedded images decoded successfully in the browser, with nonzero dimensions.
- Generic departure SVG bus icons are absent for the three configured operators; walking and arrival-arrow icons remain.
- **60 engine tests, 34 Python/backend/config checks and the full browser suite passed**, including mobile widths 320–1440, known/estimated time colours, source matching, inline alternatives, standalone and opaque iframe.
- Logos preserve their native aspect ratios/colours and do not change the meaning of time colours.
- No API behavior changed. The direct De Lijn stop connector still requires its own user key and remains unverified against a real authenticated subscription in this workspace.

## Earlier verification history

# Verification — stop forecasts / estimated schedule matching / inline alternatives (1.4.0)

Completed 7 September 2026. This section supersedes prior statements that no STIB matching or De Lijn stop connector was implemented.

- **60 engine tests passed.** New coverage includes paired De Lijn stop departure/arrival, early departures, cancellation/passed/unknown/ambiguous/stale handling, estimated STIB one-to-one ordering and bounded matching, preserved live windows, and unconditional shuttle exclusion from folding.
- **34 Python checks passed:** existing backend/access/HA checks plus five direct De Lijn configuration/schema/matching-input/quota tests. Batch requests use the documented endpoint and only the user's own private key. No key is exposed or forwarded on redirects.
- **Playwright suite passed**, no uncaught errors: thin inline separators, reasons on expansion, shuttle never inside a collapsed group, later departures retained, both directions, walks, time colours, MIVB ≈ matching labels, a paired De Lijn stop fixture, train planning, 320–1440 layout, offline and opaque iframe.
- Browser tests that use the bundled dated timetable now pin the planning clock to the fixture period, so a train time does not silently become historical as development proceeds.
- **No actual De Lijn subscription key was provided.** Authenticated endpoint execution and HA OS deployment remain unverified. The connector is implemented but cannot be called until the user configures their own key. No website cookies, website API credentials or keys found online are reused.
- Stop API fixtures use the official schema and realistic paired times; they are test-only and are not production departures. The live operator website observations from the earlier diagnosis remain dated observations, not an authenticated API test.

Commands: `node test_engine.js`; `python -m unittest -v test_access.py test_api.py test_ha_config.py test_delijn_stop.py`; `node test_ui.js` with Playwright installed.

Current activation steps and limitations: `docs/DELIJN_REALTIME.md`. BMC remains the global automatic-refresh authorization; a De Lijn-only key uses manual combined refresh. No GTFS download was needed for this revision.

## Earlier release verification history

# Verification — private access and live-window release 1.3.0

Completed 6 September 2026. This section supersedes older automatic-refresh, walking-placement and strikethrough observations below.

- **55 engine tests passed**, including authoritative STIB 10m/30m replacement, the final displayed-minute boundary, later-schedule retention, stop/line/direction isolation and stale fallback.
- **29 Python checks passed**: 8 access/security/quota tests, 17 backend/API tests, 4 HA YAML/template/data-selection checks.
- **Current Playwright suite passed**, with no uncaught errors: anonymous manual-only, registered auto cadence/hidden pause/session cap, key removal, private access capabilities, the STIB live window, subtle home timing placement, collapsed explanations, direction rules, train planning, mobile/desktop, standalone and opaque iframe.
- Private-key tests use fictional keys and mocked transport. Verified key absence from public payloads, persistent cache/quota state and configuration repr; key is an unredirected header and is not forwarded on redirects. Rejected registered access makes no anonymous retry.
- Legacy anonymous quota history is retained; registered usage has a separate bucket. Unmarked/automatic HTTP refreshes are blocked from anonymous upstream use.
- Actual no-key preview check: page opened, visible timer advanced beyond two minutes and focus restored; **zero automatic refresh POSTs**, and the operator `lastAttempt` remained unchanged.
- HA package version is **1.3.0**. `mobility_config.py` is included in the runtime bundle; real secrets, HA options, quota/cache and configured secret files are excluded from archives.

**Not established here:** a successful upstream request using a real registered key, or deployment on the user's HA OS server. No actual key was supplied. Registered gateway checks without a key returned its quota-policy response; they do not prove authenticated access. Users must enter the key locally and verify their assigned subscription/base/quota. No GTFS refresh was needed for this revision.

Earlier walking/route/GTFS caveats remain: no guaranteed platform transfer or exhaustive disruption coverage, no real-time occupancy present in inspected feeds, no full assistive-technology/mobile Safari/DST-fold audit.

## Previous release verification history

# Verification — compact departure-first release 1.2.0

Completed 5 September 2026. This section supersedes older UI/return-walking observations below.

| Check | Result |
|---|---|
| Pure engine suite | **53 passed** |
| Backend/API/rail normalization | **17 passed** |
| HA YAML/native templates/data-selection | **4 passed** |
| Current Playwright suite | All groups passed; no uncaught errors |
| Mobile layout | 320, 360, 390, 768, 1440 px; departure result inside first 667 px screen |
| Preferred stops | Home Picard; TNT Suzan; return Picard when served; later departures retained |
| Dominance | Earlier-start/later-final-arrival options stay and receive strikethrough, not cancellation |
| Return walk | Home arrival adds 5/5/8/11 min; bus arrival timestamp preserved separately |
| Punctuality | Zero green, <180s orange, ≥180s red, negative blue, unknown black; originals black, home gray |
| Auto refresh | Open, minute cadence, hidden pause, return refresh, 20-minute cap, resume, quota exhaustion/recheck |
| References / offline | All reference tabs, manual train deadline, standalone and opaque iframe passed |

Commands: `node test_engine.js`; `python -m unittest -v test_api.py test_ha_config.py`; `node test_ui.js` with Playwright installed.

Direction links were checked in the actual rendered operator websites: STIB **14/20 to BN use f**, away v; **88 to De Brouckere/BN uses v**, to UZ-VUB f. `direction=r` is not the opposite selector. De Lijn R41's GTFS direction 0/1 pages display the corresponding opposite endpoints. No website authentication token is stored or used by the dashboard.

Inspected actual bus payloads: STIB had expected passing times but **no matched original/schedule/delay or occupancy fields**; De Lijn had signed timing updates but **no occupancy fields**. The optional per-departure occupancy UI was tested with explicit test-only GTFS-RT fixture data. Typical STIB website crowding was not presented as live bus load. All green/orange/red/blue fixture screenshots are QA artifacts, not production departures.

A real server-backed browser load was also checked after the changes. HTTP APIs and the live refresh controller remained operational. Public feeds may still fail or exhaust their quota; the UI must then show unknown/timetable values, never green “on time” based on missing data.

**Not verified:** installation/container execution on the user's HA OS server, physical walking or platform-transfer times, full mobile Safari/assistive-technology audit, DST fold/gap disambiguation, comprehensive diversion alerts. HA OS package/code prepared, not installed. No new GTFS download was performed for this revision.

## Earlier verification history (superseded where rules changed)

# Verification log — 5 September 2026

## Completed in the workspace

| Check | Result |
|---|---|
| Pure engine regression suite | **46 passed** |
| Python backend / HTTP / rail normalizer tests | **15 passed** |
| HA YAML/native Jinja and app data-selection checks | **4 passed** |
| Playwright browser suite | All groups passed; **no uncaught browser errors** |
| Result-first mobile geometry | Verified at 320, 360, 390, 768 and 1440 px; recommendation above controls and fully inside a 667 px-high first screen |
| General responsive layouts | Checked across 320–1440 px; no horizontal page overflow |
| Standalone HTML | Timetable and manual train planning passed |
| Opaque scripts-only srcdoc iframe | Passed, including in-page navigation without blanking the iframe |
| Running server | Port 3000, bound to 0.0.0.0; health and planning endpoints returned 200 |
| Actual iRail API and UI | **68 real board entries** for Brussels North, 7 Sep 2026 after 08:00; selected a real returned train and produced a connecting plan |

Final commands:

```bash
node test_engine.js
python -m unittest -v test_api.py test_ha_config.py
NODE_PATH=/home/user/.cache/browser-tools/node_modules node test_ui.js
```

The `NODE_PATH` above is this workspace's cache location. On a normal installation, install Playwright in your environment and use `node test_ui.js`. Optional HA configuration checks need `PyYAML` and `Jinja2`; without them that test module skips explicitly.

## Actual train integration smoke test

Fetched through the running server and selected through the real browser UI, without a mocked rail response:

- Station: **BE.NMBS.008812005**, Brussels North.
- Board query: **2026-09-07, 08:00**, returned **68** entries.
- Selected train: **IC 1929 to Tournai, scheduled 08:01**.
- User's station margin: **5 min** → BN arrival deadline **07:56**.
- Calculated connection: **T&T shuttle 07:48 → BN 07:56**, latest home start **07:43** with the user's 5-minute walk.
- Shuttle departure remains labelled **assumed** (user-approved peak grid), not operator-live or an exact published peak departure.

This is a checked dated example, not an assurance that the same train/platform/connection remains available later. Rail data can change; recheck before travel.

## What the automated suites cover

Existing bus/shuttle behavior: direction changes, morning +7-minute return rule (7-minute ride both ways), anchored 8-minute peak grid, end clipping, duplicate overlap removal, user-confirmed lunch with Rogier 3 minutes after BN for every trip, lunch/afternoon BN returns 7 minutes after the TNT start, confirmed last trips TNT 22:00 / BN 22:07, weekday/holiday/year restrictions, calendars and date exceptions, post-midnight GTFS, direct stop order, operator/stop filters, eligibility and pagination.

Walking: exact 5/5/8-minute profiles and pins, all approved Suzan Daniel platforms, unchanged actual bus coordinates, reachable-only filtering, exact cut-offs, leave-home timestamps, no double-counting, no reverse walk, missing-walk safety, live delay applied before walking eligibility.

Live data: STIB approximation versus exact De Lijn matching, freshness, NO_DATA, cancellation/skipped enums, old cancellation in a fresh feed, no current delay applied to a future plan, genuine fallback after a mocked 503.

Train mode: latest feasible start, default/adjustable station margin, no train-delay extension, no past home start today, cancellation handling, manual offline time, real-board selection, cancelled/departed controls and responsive train fields. Cancellations/delays are also tested with explicit **test-only mocked rail data**, never included as production departures.

API / HA: zero-network calculations on cached bus state, UTC timestamps, null unavailable departures, finite windows and coverage, invalid input, missing Node, fixed rail-station validation, train cache/rate limits, no fake rows on upstream error, documentation allowlist, and seven timestamp templates rendering both valid and missing data without stray whitespace.

## Bugs found and corrected during this revision

- Plain hash links in an opaque `srcdoc` viewer could navigate to a blank page. In-page links are now handled locally.
- Adding a second footer button exposed an old broad selector that overwrote its label. The attribution updater now targets only the sources button.
- HA folded YAML/Jinja blocks initially emitted leading whitespace around booleans/timestamps. Whitespace-control tags were added and native outputs verified.
- The optional protobuf-to-JSON path now requests integer enum values, keeping cancellation/skipped handling compatible with the engine.

## Explicitly NOT verified / remaining limits

- **The HA OS app has not been installed on the user's server.** No Docker image was built/run here, and no Home Assistant Core instance performed full integration/schema validation. The archive, YAML syntax and template outputs are prepared; installation and entity discovery must be checked on the actual HA OS device.
- The optional HA startup GTFS download path is prepared but was not used to redownload the ~217 MB feed during this UI revision. The existing imported timetable was retained. No nightly updater was installed.
- De Lijn's actual endpoint supplied JSON; a real upstream protobuf response was not available for an end-to-end binary test.
- No real-world walk, platform transfer, shuttle boarding bay, accessibility route or guaranteed connection was measured. The station margin is the user's estimate.
- No complete operator disruption feed is connected; no ticketing or reservations.
- Full accessibility testing, actual mobile Safari/device testing and DST fold/gap disambiguation remain unverified. Responsive Chromium tests are not a substitute for those audits.

See `AGENTS.md` for the exact user constraints and `OPERATIONS.md` for safe updates and packaging. Do not turn these unverified areas into claims of completed deployment.


## Follow-up: time colours, line 88 and bus webpages

Implemented the user's additional display/data rules on 5 September 2026:

- Per-trip quality badges, Data column and Scheduled/Estimated text under arrivals removed. **Live-based time values are green; all other sources are black.** Detailed provenance and API quality fields remain.
- STIB line 88 added from actual GTFS: Thurn en Taxis **1349 → BN 1083**, reverse **BN 3400 → 1356**. Walk **11 minutes**, only when leaving home. The stop's coordinates come from the operator; no personal pin was invented.
- STIB data now has 1,425 trips / 1,834 legs, same feed version and coverage as before. Only STIB was fetched/imported; De Lijn data was compared before/after and remained unchanged.
- Bus numbers in the departure table, the recommended bus title and a Details link open operator pages. STIB uses the provided default direction view; De Lijn uses the exact GTFS route URL.
- Four additional engine tests and two additional API tests cover 88's stop order, walk, live matching, stop filter and operator URLs. Browser checks cover green/black computed CSS colours, expiry back to black, all non-live shuttle categories, no data badges, 88 filters and links, and responsive four-stop controls.

Live-colour tests use an explicit test-only mocked STIB 88 prediction. It is not bundled as production data. The HA OS installation/container limitations above still apply.

- HA app bumped to 1.1.0. Two additional data-selection tests protect the new STIB stop scope from being masked by a newer persisted old-scope snapshot, while preserving newer compatible De Lijn data.
