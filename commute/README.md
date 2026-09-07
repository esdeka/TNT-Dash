# TNT ↔ Brussels North — personal commute dashboard

Compares direct staff-shuttle, STIB/MIVB and De Lijn connections between the Tour & Taxis neighbourhood and **Brussel-Noord / Bruxelles-Nord**. The next bus departure is first on the page; subtle gray home times sit below their bus events. Controls are collapsed and later departures remain below it. No product branding or promotional introduction.

## Run it

Requirements: **Python 3.10+**. **Node.js 20+** is required for the Home Assistant / JSON planning API and engine tests; the browser-only dashboard does not need Node at runtime.

```bash
python build.py
python server.py --port 3000
```

On the same computer, open `http://localhost:3000`. For another device use that computer's LAN address. In Arena, use the **Commute dashboard** live preview. The server binds to `0.0.0.0` and accepts the proxied preview host.

Optional protobuf fallback for De Lijn:

```bash
pip install -r requirements.txt
```

The portal currently supplies JSON. If it switches to protobuf and this optional parser is absent, De Lijn live data falls back honestly to the timetable.

**`Dashboard.html` is a self-contained offline snapshot.** It includes the GTFS subset, walks, shuttle rules, original PDF, font and code. It works without an internet connection, including manual train-time planning. It does not fetch live buses or train boards when opened as a standalone file.

## Quick-glance use

- **To BN** has a blue theme; **To TNT/home** has a green theme.
- Bus departure leads; **leave-home time is subtly beneath it**, and walking-home arrival is beneath bus arrival, in gray with a walking icon. Bus cells show relative + absolute times, and a delay/original schedule when reliably known.
- Home starts prefer Picard over Suzan Daniel. TNT starts mean **no walking** and prefer Suzan Daniel. Return trips prefer Picard and **include the walk home**.
- Later buses are retained; duplicate stop alternatives are suppressed. Less-efficient options sit behind **thin expandable separators in sorted position**, with a comparison explaining why: another lets you start later and arrive earlier. They are not cancelled or deleted. **The shuttle is never collapsed.**
- Arrival remains the primary sort: BN arrival outbound, home arrival on return. Ties use your operator order: outbound Shuttle → De Lijn → MIVB 14/20 → 88; return Shuttle → MIVB 14/20 → 88 → De Lijn.
- Click **Change** for date/time, Home/TNT start, filters and shuttle eligibility. **Catch a train** works backward from the scheduled train departure with your default **5-minute station margin**.
- Detailed rules, source dates, stop coordinates and the original shuttle PDF are in **Reference**. Ride-time and area-overview panels are removed from the main view.

### Colours and live data

Green = a verified on-time prediction; orange = delay under 3 min; red = delay at least 3 min; blue = early. Original times remain black; home times gray. **Black is timetable/unknown, not proof of no delay.** STIB now maps live passing times to unique scheduled times in order. Its matched original and minute-rounded delay are **estimated and marked ≈**, since no provider trip ID exists. De Lijn stop data uses operator-paired original/live times when its separate key is configured.

**Without an API key**, the anonymous feed is manual-only: press **Refresh**. Opening/returning may read the shared cache but makes no upstream call. **With a private server key**, live checks run on opening/returning and every minute visible, up to **20 minutes**. Hidden pages pause; **Resume/Refresh** starts another session. The shared cache and access-mode allowance apply: anonymous 80/day; registered defaults to 10,000/day within your assigned quota. This does not automatically update GTFS routes.

Bus-number links now select the correct STIB direction (`v`/`f`, mapped by destination) and the GTFS directional De Lijn page. Occupancy is only shown when explicitly supplied for the matching departure; none was in the inspected live feeds. Operator-page typical crowding is not passed off as actual bus load.

## Optional API-key secret

In **HA OS app → Configuration**, enter the key in masked `bmc_api_key` and restart. Leave it blank for anonymous/manual access. For a normal server, configure `BMC_API_KEY` or `BMC_API_KEY_FILE` privately. Do not paste the key into chat or the HTML. See [API access setup](docs/API_ACCESS.md) for quotas, gateway overrides and the manual/automatic HTTP contract.

A configured key enables the registered gateway; failures do not silently revert to anonymous. Actual registered access must be checked with your own subscription—we did not receive or test a real key here.

**De Lijn stop forecasts:** configure your own De Lijn Open Data key in HA app `delijn_api_key` or server `DELIJN_API_KEY` / `DELIJN_API_KEY_FILE`. The supported multi-stop connector is implemented; without that key, the limited BMC fallback remains. See [De Lijn setup](docs/DELIJN_REALTIME.md). No real De Lijn key was available to validate authenticated upstream calls here.

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

Python fetches official operator data via the **Belgian Mobility** public API:

- STIB: `datasets/stibmivb/rt/WaitingTimes` — boarding-stop predictions; the other-end arrival uses a nearby scheduled ride estimate.
- De Lijn: its supported **stop real-time API** with a separate key; otherwise BMC `gtfs/feed/delijn/rt/trip-update` remains the limited fallback.

Base: `https://api-management-discovery-production.azure-api.net/api/`

The browser calls this server, not those operator endpoints directly. The server selects anonymous/manual or registered/key-based access automatically. Only registered mode starts automatic visible-page refresh sessions. Bus cache: ≥60 seconds; predictions expire after 120 seconds. Live app limits: anonymous 80/day, registered default 10,000/day; both use a 60-second cache and 4/minute guard. Two provider calls per refresh. Hidden pages and completed sessions do not poll. A selected near-term train from today can be refreshed alongside the active session.

Trains use **iRail's Brussels North liveboard**, separately from the bus APIs. Board loads are cached; a selected near-term train today can be rechecked during the active visible session. Train planning uses the **scheduled departure**, not a currently reported delay. Manual time entry does not verify that a train exists.

Full provenance, match rules and limitations: [Architecture](docs/ARCHITECTURE.md) and [train planning](docs/TRAIN_PLANNING.md).

## How offline data is updated

**Manually**, not automatically in the HTML:

```bash
python refresh_schedules.py
python build.py
# Restart the running server, then reload the browser.
python server.py --port 3000
```

The importer makes two public API requests and downloads both full GTFS ZIPs. De Lijn was about **217 MB**. It streams the large stop-times table and retains a ~4 MB corridor subset, with calendars, exceptions, stop IDs and attribution. `data/walking.json` and shuttle assumptions are not overwritten.

```bash
python refresh_schedules.py --cached  # reuse archives; NOT a fresh download
python build.py
```

For a targeted update, `python refresh_schedules.py --operators stib` downloads only STIB and preserves De Lijn. Add `--cached` to reuse the selected archive. The line 88 addition used one ~14.5 MB STIB download, not another full De Lijn download.

A server restart is required after changing GTFS because live-route filtering is loaded at startup. Existing HTML copies must be rebuilt/redownloaded. Detailed safe update and deployment procedures: [Operations](docs/OPERATIONS.md).

## Home Assistant OS

The source includes:

- Read-only **`GET /api/next`**: recommendation, next departures per operator, leave-home timestamps, walking times and live-data freshness.
- **`GET /api/plan-train`**: the same backward planner as the browser.
- A **local HA OS app package builder** and REST/template sensor YAML.

Polling `/api/next` makes **zero upstream requests**. It uses the saved timetable and any fresh live cache. Live entity updates require a separate, explicit `/api/live/refresh` call; do not automate this every minute all day under the public quota.

Build the HA OS archive with:

```bash
python package.py
```

Follow [Home Assistant setup](docs/HOME_ASSISTANT.md). No connection has been made to your HA server. Use a locally deployed service, **not the temporary Arena preview**, for persistent entities. The service has no built-in authentication: keep it on a trusted LAN or behind authenticated remote access.

## Documentation / other agents

**Read [AGENTS.md](AGENTS.md) first** before changing code.

- [Architecture & data flows](docs/ARCHITECTURE.md)
- [Operations, updates & packaging](docs/OPERATIONS.md)
- [HTTP API contract](docs/API.md)
- [Home Assistant OS setup](docs/HOME_ASSISTANT.md)
- [Train-planning semantics](docs/TRAIN_PLANNING.md)
- [Verification & remaining limits](docs/VERIFICATION.md)

The browser and JSON API use **one shared calculation engine**, `static/engine.js`. Do not duplicate its logic in Python or HA templates.

## Tests

```bash
node test_engine.js
python -m unittest -v test_access.py test_api.py test_ha_config.py test_delijn_stop.py
# With the server running and Playwright / Chromium installed:
node test_ui.js
```

Optional HA YAML/template checks use `pip install -r requirements-test.txt`; they are not a full HA OS deployment test.

Install the optional browser tooling with `npm install --no-save playwright` and `npx playwright install --with-deps chromium`. Some timetable regression examples are tied to the bundled September 2026 snapshot; review fixtures when replacing GTFS. See the verification log for what actually passed and what has not been tested on real HA OS.

## Attribution

Source: **STIB-MIVB – Open Data – 5 September 2026**. Source: **De Lijn – Open Data – 4 September 2026**. Direct-trip subset adapted for this personal commute dashboard. Operator data: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); [Belgian Mobility terms](https://data.belgianmobility.io/en/terms.html). Current per-provider dates/versions are embedded in `data/timetable.json` and the UI.

Train information: **iRail / SNCB-NMBS**, [API documentation](https://docs.irail.be/). No assertion that the bus-data licence also covers the train API.

Shuttle: original user-supplied 2026 Tour & Taxis PDF, unchanged, plus explicitly agreed user assumptions recorded in `AGENTS.md`. Walking times and pins are user-supplied. Font: Manrope, SIL Open Font License; `static/FONT-LICENSE.txt` is included.
