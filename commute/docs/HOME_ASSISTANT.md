# Home Assistant OS setup

The user runs **Home Assistant OS**. This project includes a local HA OS app (formerly called an add-on) and a REST/template sensor package. It uses the same engine as the dashboard, including walking, the shuttle's assumed times, service calendars and live-data fallback.

**Not yet installed on your HA server.** The API and configuration are prepared here; HA OS installation / container execution must be verified on your own device. No HA credentials or Supervisor token are required by the app.

## 1. Install the local app

1. Download `Commute-HAOS-app.zip`, or generate it with `python package.py` from the source project.
2. Extract the single **`commute_dashboard/`** directory into HA's local apps directory **`/addons/`**. The Samba app exposes an `addons` share; the official SSH app can also access it. The result must be `/addons/commute_dashboard/config.yaml`, not an extra double-nested folder.
3. In HA, go to **Settings → Apps → App store → ⋮ → Check for updates**. Older versions call this area **Add-ons**. Find **Commute dashboard** under Local apps.
4. Install and start it. This builds a Python/Node container and can take a few minutes. Supported architectures: **aarch64 and amd64**.
5. Open its Web UI, normally `http://homeassistant.local:3000`. If name resolution fails, use the HA machine's LAN IP. If port 3000 is occupied, change the exposed host port in the app's network settings and adjust the URLs below.
6. Verify `http://YOUR_HA_LAN_IP:3000/api/health` and `/api/next` return JSON.

This uses a LAN port, **not HA ingress**. Keep it on the private LAN; it has no built-in authentication/TLS. Do not forward the port to the internet. Do not install Python or Node into the HA OS host: they belong inside this app container.

The official local-app workflow is documented at https://developers.home-assistant.io/docs/apps/tutorial/ . Current HA documentation uses “apps”; the project keeps the conventional `/addons/` directory structure.

## 2. Add the entity package

The source project has `home_assistant/commute.yaml`; the HA app archive also includes it under `commute_dashboard/home_assistant/`.

1. In `/config/configuration.yaml`, enable packages if you do not already use them:

   ```yaml
   homeassistant:
     packages: !include_dir_named packages
   ```

   **Merge into the existing `homeassistant:` section. Do not create a duplicate top-level key.** If you already use another packages convention, adapt the placement to it.

2. Copy `home_assistant/commute.yaml` to `/config/packages/commute.yaml`.
3. Add these values to your own `/config/secrets.yaml`, changing the host/port:

   ```yaml
   commute_next_url: "http://homeassistant.local:3000/api/next?direction=toBN&walking=1&shuttle=1&horizon=240&limit=1"
   commute_live_refresh_url: "http://homeassistant.local:3000/api/live/refresh"
   ```

   These are URL settings, not passwords. Do not use the temporary Arena preview host: it can expire or require preview authorization.

4. Check HA configuration, then restart/reload the relevant configuration as appropriate for your HA version.
5. Inspect `sensor.commute_data` in Developer tools → States, then the generated timestamp sensors. If an existing entity uses one of these names and HA adds a suffix, update the template references accordingly.

## Entities

Names are converted to normal HA entity IDs. The included package creates:

- `sensor.commute_data`: shared JSON payload, fetched once per minute.
- `sensor.commute_next_shuttle_leave_home`
- `sensor.commute_next_shuttle_departure`
- `sensor.commute_next_stib_leave_home`
- `sensor.commute_next_stib_departure`
- `sensor.commute_next_de_lijn_leave_home`
- `sensor.commute_next_de_lijn_departure`
- `sensor.commute_recommended_leave_home`

Timestamp entities carry line, boarding stop, bus departure, BN arrival, walk minutes, quality and staff-only attributes as applicable. The recommendation may not be the first departure: it minimizes arrival time. Per-operator “next” sensors are the chronological next reachable departure.

- Times are emitted as UTC ISO timestamps and displayed in HA's timezone. Set HA to Europe/Brussels.
- `leave_home` includes the user's 5/5/8/11-minute walks. It is different from the bus departure.
- Default lookup window is four hours; no matching trip means unavailable/null, not a fictional midnight time. A weekend shuttle can therefore be unavailable. Increase `horizon` in the URL if desired (maximum 2880 minutes), without extending service calendars or inventing holiday operation.
- A raw-data HTTP failure makes the derived entities unavailable even if old JSON attributes remain in HA.
- If you are not eligible for the staff shuttle, change `shuttle=1` to `shuttle=0`.
- STIB entities now include **line 88 at Thurn en Taxis**, with an 11-minute outbound walk. To dedicate a sensor resource to this stop, use `stop=thurn` in its URL; use separate entity names if duplicating the package. `route_page_url` in the API points to the operator webpage.
- The sensor query is independent of your browser's current filters, selected train and stored walking toggle. Those are local UI preferences, not global HA settings.

You can exclude `sensor.commute_data` from Recorder if you do not want its changing raw payload saved every minute. Derived timestamp sensors remain usable.

## 3. Live updates versus entity polling

**Polling `/api/next` makes zero external API requests.** It recalculates against the saved GTFS/shuttle data and any fresh bus cache. Without a fresh prediction, entities still work, but their quality is scheduled/assumed/derived rather than live.

The package defines an explicit manual HA action (it sends the required manual-purpose header):

```yaml
action: rest_command.commute_refresh_live
```

That calls `/api/live/refresh`, which checks STIB and De Lijn (two upstream requests), respecting the shared 60-second cache and 80-call rolling-day cap.

**Do not run this every minute all day.** The public bus API budget is too small. `optional_live_refresh.yaml` requires a configured BMC API key and uses the separate `commute_auto_refresh_live` action. It is a disabled-by-default example using ten-minute intervals during limited weekday travel windows. Review the hours and enable it only if wanted; it is not loaded automatically by the entity package. This can use roughly 48–52 provider calls/day, plus your manual use. A ten-minute interval does not provide continuous realtime: the 120-second freshness threshold remains strict, so sensors return to scheduled data between checks.

If you need continuously fresh 24/7 predictions, obtain appropriate provider access / quota and redesign refresh policy deliberately. Do not just remove the quota guard or silently label stale estimates live.

## 4. Refresh offline GTFS on HA OS

The app option **`refresh_schedules_on_start`** defaults to false.

To explicitly update:

1. Set the option to true and restart the app.
2. Watch its logs. Both full GTFS archives are downloaded, including about 217 MB for De Lijn. The server starts after importing/rebuilding; allow several minutes.
3. Check the coverage dates in the dashboard / `/api/next`.
4. Set the option back to false to avoid downloading on every subsequent startup.

Successful timetables persist under `/data/timetable.json`. Bus quota/live state persists under `/data/runtime`, and downloaded archives under `/data/gtfs-cache`. A failed import keeps the last complete dataset. No nightly/weekly scheduler is enabled by default. Walking pins and shuttle rules remain separate.

For code changes, rebuild the source package and HA app, bump the app version, copy the updated local folder and update/rebuild it through HA. Preserve app data / take an HA backup. Avoid uninstalling to update because that can remove persistent data and quota history.

## Train-based entities

`GET /api/plan-train?date=2026-09-07&time=08:30&margin=5&walking=1` returns a latest-start plan using the same engine. It does not verify a train exists. The optional browser iRail selector supplies a real board entry; manual inputs and API train times are not bookings.

The supplied default HA sensors expose next departures, not the browser's chosen train. An input_datetime-backed HA train sensor/automation can be added later using the documented endpoint. Do not pretend the browser selection is synchronized with HA.

## Troubleshooting

| Symptom | Check |
|---|---|
| Local app not listed | Correct `/addons/commute_dashboard/config.yaml` nesting; App store update check; Supervisor logs |
| App build fails | Architecture, internet access, base-image/package availability; no container build was executed in this workspace |
| API 503 / Node missing | Run the supplied app image, which installs Node; `/api/health` shows availability |
| HA cannot connect | LAN IP / port, firewall and exposed app port; do not use localhost from another container or the temporary preview URL |
| Sensors unavailable | Raw sensor JSON; four-hour window; weekend/holiday shuttle; expired GTFS coverage |
| Timetabled instead of live | Live refresh not requested, prediction absent/stale, provider failure or quota limit |
| Times look shifted | HA timezone should be Europe/Brussels; entity payload itself is deliberately UTC |

Reference for the REST integration: https://www.home-assistant.io/integrations/rest/ . The YAML was prepared for this project; validation against your running HA version is still required.


### Version 1.1 upgrade and stored data

The 88/Thurn en Taxis addition is packaged as app version **1.1.0**. Copy the updated local app folder and check for updates in HA. The STIB snapshot carries `stopScopeVersion: 2`; the startup selector will not restore an old, narrower STIB snapshot over it merely because that old snapshot was downloaded more recently. A newer compatible De Lijn snapshot is preserved independently. This migration logic is unit-tested; actual HA OS deployment still requires checking on your device.


## Version 1.2 behaviour

The API now applies preferred-stop selection and the user’s direction-specific operator ties, while keeping later buses and dominated alternatives. Return queries (`direction=toTNT&walking=1`) add walking home. `arrival` remains the bus stop; use `home_arrival` / `journey_arrival` for arrival home. Existing default home→BN sensors keep their field meanings. A return resource should use bus `departure` rather than `leave_home_at`, which is null when starting at BN.

New fields include signed departure/arrival delays, paired scheduled times, dominance information and optional exact-departure occupancy. With a BMC key, the browser automatically refreshes while visible for 20 minutes; without a key it is manual-only; its requests share the same 80-call budget with any optional HA live automation. Read-only entity polling still makes zero upstream requests.

App version 1.2.0 changes code, not the stop scope (STIB remains scope 2). Preserve app data when updating; actual HA OS installation remains to be verified on your server.


## Version 1.3: private key and automatic access

See [API key setup](API_ACCESS.md). Add the subscription key to the app's masked **`bmc_api_key`** option and restart; never put it in chat or the HTML. Default empty option uses anonymous/manual access. Optional `bmc_auth_daily_limit` defaults to 10,000 and `bmc_auth_base` is an override only if your subscription documents a different HTTPS base. Registered access is tested with mocks here, not a real account key.

The sensor data exposes safe `access` flags, not credentials. `commute_refresh_live` is manual; `commute_auto_refresh_live` is for automation and is blocked from upstream use when no key is configured. Unmarked legacy refresh requests are treated as automatic. Update the package/actions alongside the app. App version is **1.3.0**; existing quotas and persisted compatible timetables are preserved.


## Version 1.4: direct De Lijn forecasts and estimated MIVB delays

Configure the new masked `delijn_api_key` and optional `delijn_daily_limit` to activate actual stop forecasts. This key comes from the De Lijn Open Data Free product, not BMC. See `DELIJN_REALTIME.md`. With only that key, use manual Refresh; BMC credentials are still required for global automatic refresh. Registered De Lijn upstream access has not been verified here without your key.

STIB matching is now inferred one-to-one and order preserving; API delay fields can be populated but `delay_estimated:true` explicitly marks them. Do not treat those as operator-reported delays in HA automations. Shuttle is excluded from UI folding, and other alternatives use inline expandable separators. App version: **1.4.0**.
