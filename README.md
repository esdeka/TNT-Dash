# TNT ↔ Brussels North — personal commute dashboard

Compares direct staff-shuttle, STIB/MIVB and De Lijn connections between the Tour & Taxis neighbourhood and **Brussel-Noord / Bruxelles-Nord**. The next bus departure is first on the page; subtle gray home times sit below their bus events. Controls are collapsed and later departures remain below it. No product branding or promotional introduction.

## Run it

**Just open it:** open `site/index.html` in a browser (`file://` works), or put the `site/` folder on any static host. The page contains the timetable snapshot, walks, shuttle rules and the original PDF, and calls the STIB, De Lijn and iRail APIs itself when online (their gateways send CORS headers; iRail also accepts `file://`). Offline, timetable and manual train-time planning keep working.

**API keys (optional):** without a key, live data uses the anonymous Belgian Mobility gateway on manual **Refresh** only. To use your own key, either enter it in **Reference → API keys** (stored in this browser's localStorage), or copy `site/Dashboard-secrets.example.js` to `site/Dashboard-secrets.js` and fill it in. That file is git-ignored; never commit it, and only host a `site/` containing it where you alone can reach it. Browser storage wins over the file. With a key, auto refresh runs every minute while visible (up to 20 minutes per session); quotas and the 60-second shared cache persist in `localStorage`. The De Lijn GTFS-RT feed is JSON-only in the browser.

**Optional server (`server/`):** serves the same `site/` with keys kept server-side, a shared cache/quota for all devices, and a small JSON API (see [API](docs/API.md)) for future integrations.

```bash
pip install -r server/requirements.txt
python server/server.py --port 3000     # or: npm run serve
```

Open `http://localhost:3000` (or the machine's LAN address). Configure keys with `BMC_API_KEY` / `BMC_API_KEY_FILE` and optionally `DELIJN_API_KEY` / `DELIJN_API_KEY_FILE`. Runtime quota/cache state lives in git-ignored `server/state/`. The server never serves `Dashboard-secrets.js`. It has no authentication: keep it on a trusted LAN.

**One key is enough:** a single Belgian Mobility Marketplace key covers STIB and De Lijn real-time (De Lijn via the BMC GTFS-RT feed). A separate De Lijn stop-API key (its own delijn.be subscription) adds paired per-stop forecasts; if it is rejected, the dashboard warns and falls back to the BMC feed.

## Repository layout

| Path | Contents |
|---|---|
| `site/` | The dashboard: `index.html`, `css/`, `js/` (engine, app, live access, reference), `js/data/` (generated), `assets/` (font, logos, shuttle PDF) |
| `data/` | Canonical data: `timetable.json` (GTFS corridor subset), `walking.json` (walk estimates) |
| `server/` | Optional Python server and live proxies (`server.py`, `rail.py`, `delijn_live.py`, `mobility_config.py`) |
| `tools/` | `refresh_schedules.py` (GTFS import), `build_data.py` (data → `site/js/data/`) |
| `tests/` | Engine, browser (Playwright) and server tests |
| `docs/` | Architecture, operations, API, train planning, verification log |

## Quick-glance use

- **To BN** has a blue theme; **To TNT/home** has a green theme.
- Bus departure leads; **leave-home time is subtly beneath it**, and walking-home arrival is beneath bus arrival, in gray with a walking icon. Bus cells show relative + absolute times, and a delay/original schedule when reliably known.
- Home starts prefer Picard over Suzan Daniel. TNT starts mean **no walking** and prefer Suzan Daniel. Return trips prefer Picard and **include the walk home**.
- Later buses are retained; duplicate stop alternatives are suppressed. Options another listed trip beats—later start and an arrival **more than 2 minutes** earlier—can sit behind thin expandable separators with a comparison explaining why; the **Collapse less-efficient options** toggle in Change is **off by default**, and **the shuttle is never collapsed** regardless. A toggleable **Timeline** view plots departures on a shared vertical time scale—ruler ticks plus gridlines—with per-stop columns towards BN (T&T shuttle, Picard from home, Suzan Daniel, Thurn en Taxis) and per-operator columns towards TNT (TNT, MIVB, De Lijn). All columns follow one compact chronological order—a later departure never appears above an earlier one, simultaneous departures sit at one identical height, and cards in different columns may overlap slightly so uncongested cards stay on their proportional clock position. Cards stay single-line (time, minutes-away, line badge, delay chip when ≥2 minutes), a trip serving both Picard and Suzan Daniel towards BN shows in both columns with a connector line, and towards TNT duplicate stop variants collapse to one card (Picard where served, otherwise Suzan Daniel); the destination remains in each card's accessibility label. The scheduled+delay chip appears **from 2 minutes**; a smaller offset only colours the time.
- Arrival remains the primary sort: BN arrival outbound, home arrival on return. Ties use your operator order: outbound Shuttle → De Lijn → MIVB 14/20 → 88; return Shuttle → MIVB 14/20 → 88 → De Lijn.
- The **Home / TNT stop** start toggle sits next to the direction buttons at the top. Click **Change** for date/time and filters. The staff shuttle is always included. **Catch a train** works backward from the scheduled train departure with your default **5-minute station margin**.
- Detailed rules, source dates, stop coordinates and the original shuttle PDF are in **Reference**. Ride-time and area-overview panels are removed from the main view.

### Colours and live data

Blue = early; green = on time up to 2 min late; orange = over 2 and under 5 min late; red = 5 min late or more. Delays show in whole minutes (a seconds remainder under 45 rounds down, otherwise up); the colour always follows the displayed minute. Original times remain black; home times gray. **Black is timetable/unknown, not proof of no delay.** STIB now maps live passing times to unique scheduled times in order. Its matched original and minute-rounded delay are **estimated with a dashed underline**, since no provider trip ID exists. De Lijn stop data uses operator-paired original/live times when its separate key is configured.

**Without an API key**, the anonymous feed is manual-only: press **Refresh**. Opening/returning may read the shared cache but makes no upstream call. **With a private server key**, live checks run on opening/returning and every minute visible, up to **20 minutes**. Hidden pages pause; **Resume/Refresh** starts another session. The shared cache and access-mode allowance apply: anonymous 80/day; registered defaults to 10,000/day within your assigned quota. This does not automatically update GTFS routes.

Bus-number links now select the correct STIB direction (`v`/`f`, mapped by destination) and the GTFS directional De Lijn page. Occupancy is only shown when explicitly supplied for the matching departure; none was in the inspected live feeds. Operator-page typical crowding is not passed off as actual bus load.

## Optional API-key secret

Browser: Reference → API keys or `site/Dashboard-secrets.js` (see above). Server: `BMC_API_KEY` or `BMC_API_KEY_FILE`, set privately. Never put keys in chat, URLs or committed files. See [API access setup](docs/API_ACCESS.md) for quotas, gateway overrides and the manual/automatic HTTP contract. A configured key enables the registered gateway; failures do not silently revert to anonymous.

**De Lijn stop forecasts:** your own De Lijn Open Data key, via the API keys tab, the secrets file, or server `DELIJN_API_KEY` / `DELIJN_API_KEY_FILE`. See [De Lijn setup](docs/DELIJN_REALTIME.md).

**STIB live window:** if a fresh response says next buses in 10 and 30 minutes, all schedules for that stop/line/direction through the last displayed 30-minute prediction are suppressed. Later GTFS departures remain. This does not assert exact trip identity. Matched scheduled times/delays are inferred, bounded and visibly approximate. Expired data still falls back to timetables.

## Your walks

| Reference stop | Walk | Latitude | Longitude |
|---|---:|---|---|
| Brussel Picard | 5 min | 50.86404643162095 | 4.343968608510816 |
| TNT shuttle | 5 min | 50.86394437949276 | 4.346459999157837 |
| Suzan Daniel, Picard street | 8 min | 50.863076897694725 | 4.346976807605478 |
| Thurn en Taxis · STIB 88 | 11 min | Operator stop coordinates | No personal reference pin supplied |

You approved **8 minutes for all nearby Suzan Daniel platforms**, including De Lijn. Each bus retains its own GTFS boarding coordinates; the reference pin is not substituted for every platform. The TNT pin supplies the shuttle pickup point. The exact BN shuttle bay remains unspecified.

**Line 88** is included in both directions: Thurn en Taxis **1349 → BN 1083**, and **BN 3400 → Thurn en Taxis 1356**. It is a separate stop from the 5-minute-walk TNT shuttle. The same 11-minute estimate applies before boarding outbound and after alighting on return; actual bus ride time comes from GTFS.

A bus is reachable only when departure ≥ selected home start + walk. **Leave home by = bus departure − walk.** Outbound total = walk + remaining wait + ride = BN arrival − selected start. Return total includes the walk after the bus and ends at home. Walking is not added twice. No additional bus-boarding buffer is included; allow a safety margin yourself.

## Where live data comes from

Official operator data comes via the **Belgian Mobility** public API:

- STIB: `datasets/stibmivb/rt/WaitingTimes` — boarding-stop predictions; the other-end arrival uses a nearby scheduled ride estimate.
- De Lijn: its supported **stop real-time API** with a separate key; otherwise BMC `gtfs/feed/delijn/rt/trip-update` remains the limited fallback.

Base: `https://api-management-discovery-production.azure-api.net/api/`

The page calls these endpoints directly, or through the optional server, which then holds the keys. Either way the code selects anonymous/manual or registered/key-based access automatically. Only registered mode starts automatic visible-page refresh sessions. Bus cache: ≥60 seconds; predictions expire after 120 seconds. Live app limits: anonymous 80/day, registered default 10,000/day; both use a 60-second cache and 4/minute guard. Two provider calls per refresh. Hidden pages and completed sessions do not poll. A selected near-term train from today can be refreshed alongside the active session.

Trains use **iRail's Brussels North liveboard**, separately from the bus APIs. Board loads are cached; a selected near-term train today can be rechecked during the active visible session. Train planning uses the **scheduled departure**, not a currently reported delay. Manual time entry does not verify that a train exists.

Full provenance, match rules and limitations: [Architecture](docs/ARCHITECTURE.md) and [train planning](docs/TRAIN_PLANNING.md).

## How offline data is updated

**Manually**, never automatically:

```bash
python tools/refresh_schedules.py            # downloads GTFS, writes data/timetable.json and site/js/data/
python tools/refresh_schedules.py --cached   # reuse downloaded archives; NOT a fresh download
python tools/refresh_schedules.py --operators stib   # STIB only, preserves De Lijn
python tools/build_data.py                   # after editing data/walking.json by hand
```

The importer makes one public API request per operator and downloads the full GTFS ZIPs into git-ignored `.cache/` (De Lijn is about **217 MB**). It streams the large stop-times table and keeps a ~4 MB corridor subset, with calendars, exceptions, stop IDs and attribution. `data/walking.json` and shuttle assumptions are not overwritten. Restart the server (if used) after changing GTFS, because live-route filtering is loaded at startup. Details: [Operations](docs/OPERATIONS.md).

## Documentation / other agents

**Read [AGENTS.md](AGENTS.md) first** before changing code.

- [Architecture & data flows](docs/ARCHITECTURE.md)
- [Operations, updates & packaging](docs/OPERATIONS.md)
- [HTTP API contract](docs/API.md)
- [Train-planning semantics](docs/TRAIN_PLANNING.md)
- [Verification & remaining limits](docs/VERIFICATION.md)

The browser and the tests use **one shared calculation engine**, `site/js/engine.js`. Do not duplicate its logic in Python.

## Tests

Requires Node.js 20+ and Python 3.10+.

```bash
npm install && npx playwright install chromium
pip install -r tests/requirements.txt
npm test            # all suites; or npm run test:engine | test:py | test:ui
```

The UI suite starts its own server on a spare port with a throwaway state directory, and tests `file://` copies of `site/` without your real secrets file. Some timetable regression examples are tied to the bundled September 2026 snapshot; review fixtures when replacing GTFS.

## Attribution

Source: **STIB-MIVB – Open Data – 5 September 2026**. Source: **De Lijn – Open Data – 4 September 2026**. Direct-trip subset adapted for this personal commute dashboard. Operator data: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); [Belgian Mobility terms](https://data.belgianmobility.io/en/terms.html). Current per-provider dates/versions are embedded in `data/timetable.json` and the UI.

Train information: **iRail / SNCB-NMBS**, [API documentation](https://docs.irail.be/). No assertion that the bus-data licence also covers the train API.

Shuttle: original user-supplied 2026 Tour & Taxis PDF, unchanged, plus explicitly agreed user assumptions recorded in `AGENTS.md`. Walking times and pins are user-supplied. Font: Manrope, SIL Open Font License; `site/assets/fonts/FONT-LICENSE.txt` is included.
