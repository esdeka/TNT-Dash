# Operations, updates and delivery

## Run / restart

Python 3.10+ is sufficient for the web dashboard and upstream proxies. Node.js 20+ is required for `/api/next`, `/api/plan-train` and engine tests. Optional De Lijn protobuf parser: `pip install -r requirements.txt`.

```bash
cd commute
python build.py
python server.py --port 3000
```

The server binds to `0.0.0.0`. Use the machine's LAN address from another device. Browser API URLs are relative; never put a sandbox `localhost` address into browser code.

A running Python process does not reload backend source automatically. Stop it and restart after changes to `server.py`, `rail.py`, or imported GTFS. HTML/CSS/JS changes need a rebuild and browser reload; the server reads the HTML file on each request.

In Arena, use the background-process tool named **Commute dashboard**, not a long-running bash command. Check whether the old server still exists. Server processes / installed dependencies may disappear with a new sandbox, while files persist. A tool's temporary preview is not an always-on Home Assistant endpoint.

## Update offline bus schedules

This is a **manual operation by default**. Do not confuse live refresh with GTFS refresh.

1. Keep a copy of the current `data/timetable.json` and `Dashboard.html` if you need rollback.
2. Download and extract the new operator feeds:

   ```bash
   python refresh_schedules.py
   ```

3. Inspect the printed dates, routes and stop IDs; metadata is in `data/timetable.json`.
4. Rebuild the self-contained file:

   ```bash
   python build.py
   ```

5. Restart `server.py`, then reload all browser copies. Distribute the rebuilt HTML if someone uses the standalone file.
6. Re-run the tests. Calendar / exact-departure examples in tests refer to the bundled September 2026 data; review those fixtures deliberately when replacing it. Do not change an assertion just to hide a real routing regression.

By default the importer makes **two public requests**, one per full-network GTFS ZIP. `--operators stib` or `--operators delijn` limits work to that operator and preserves the other saved data. Each selected operator needs one download; with `--cached`, existing selected archives are reused. De Lijn was about 217 MB compressed and its stop-times table about 1.7 GB uncompressed; the script streams it. Retained corridor data is about 4 MB. Allow time, network bandwidth and disk space. Do not repeat downloads while debugging CSS.

By default, archives live in `../.cache/transit/`. Override with environment variable `COMMUTE_GTFS_CACHE` if desired. `--cached` reuses existing archives; if an archive is missing it is downloaded. It is **not** an instruction to obtain a fresh timetable.

```bash
python refresh_schedules.py --cached
python build.py
```

The final timetable JSON and HTML are replaced atomically. The downloader can leave an incomplete cached ZIP after a network interruption; run a normal fresh download to replace it rather than trying `--cached` on that partial file.

Walking pins in `data/walking.json` and shuttle rules in `engine.js` are separate. Do not overwrite them during GTFS imports. The original 2026 shuttle PDF is not an automatically updating source; get explicit user confirmation before changing its assumptions or extending to another year.

## Live bus data

`POST /api/live/refresh` explicitly attempts both operators. It uses a minimum 60-second shared cache and a per-access-mode rolling-day cap; every refresh attempt costs two provider requests, including failed upstream attempts. The browser polls once a minute during a visible 20-minute session only if a private API key is configured. Without a key, upstream refresh is manual-only; cache/status reads are safe on open/return. Hidden pages and expired sessions pause; the backend quota still applies.

A 15-second display rerender is **not** itself a feed download; the separate 60-second visible-session controller handles polling. `/api/next` polling is also read-only. If live data expires, schedule values remain, with truthful quality labels.

Do not delete `quota.json` to get more requests. Version 2 retains separate anonymous/registered buckets; legacy `calls` are migrated to anonymous without resetting them. Other services using the same public IP may have their own usage of the public BMC allowance.

## Runtime state / environment

| Item | Default | Purpose |
|---|---|---|
| `COMMUTE_STATE_DIR` | `commute/data/` | `quota.json` and `live-state.json` |
| `COMMUTE_GTFS_CACHE` | `../.cache/transit/` | Large operator archives and metadata |
| `IRAIL_USER_AGENT` | Meaningful private-planner identifier | Optional actual contact information for a self-hosted iRail client |

Only use a real contact address in a custom iRail user agent; do not invent one. Train-board caches are in memory and separate from bus quotas. They contain public station departure data and are rebuilt on demand.

## Home Assistant OS app updates

See [HA setup](HOME_ASSISTANT.md). The supplied app runs the same Python/Node code; it does not install packages into the HA OS host or modify Home Assistant Core.

- Runtime bus state persists in `/data/runtime`.
- Successful offline timetables persist at `/data/timetable.json`; newer compatible data is selected per operator at startup. Stop-scope versions prevent an older narrow STIB extraction from hiding line 88 on upgrade.
- `refresh_schedules_on_start` defaults to **false**. If explicitly enabled in the HA app settings, startup downloads both full feeds and rebuilds before serving. This can take minutes. Set it back to false after the desired update; otherwise every subsequent start requests downloads again.
- Failed imports keep the last complete dataset and log a warning. Inspect its coverage rather than assuming it became current.
- There is no automatic nightly/weekly update job. Schedule one only if the user deliberately chooses its bandwidth and API usage.
- Source-code changes require repackaging, copying the updated local app folder and rebuilding/updating the app. Bump `ha_app/config.yaml`'s version for a normal Supervisor update. Preserve `/data` / make an HA backup; don't uninstall merely to update, since uninstalling can remove persistent state.

## Packaging

```bash
python package.py
```

Creates two archives beside the project:

- `Commute-dashboard-project.zip`: source, docs, tests, data and the self-contained HTML.
- `Commute-HAOS-app.zip`: one `commute_dashboard/` folder ready to copy into HA's `/addons/`, plus sensor YAML and setup guide. It is generated from the same runtime files, not a fork.

Excluded: runtime live/quota JSON, `secrets.yaml`, caches, node_modules, browser files, `.git`, temporary files, full-network GTFS ZIPs and font-download scratch metadata. Packaging never resets the running quota.

Do not edit the generated archive copy. Edit source, test, rebuild and repackage. Do not deliver an archive made before the latest source/build changes.

## Checks before delivery

- `node test_engine.js`
- `python -m unittest -v test_api.py`
- Start server, then `node test_ui.js` with Playwright / Chromium installed.
- Confirm `/api/health`, `/api/next`, and actual HTML all work. Verify an iRail response separately if claiming real train-board connectivity.
- Check mobile widths from 320 px upward: no horizontal page scroll; the recommendation is above controls and inside the first screen.
- Test standalone HTML and opaque `srcdoc` iframe. In-page navigation is intercepted to prevent hash links from navigating an opaque iframe to a blank page.
- Update `docs/VERIFICATION.md` and `AGENTS.md` with actual results and deployment limitations.

## Security / privacy

This stdlib server has **no built-in authentication or TLS**. Use a trusted LAN, VPN or authenticated reverse proxy. Do not forward port 3000 directly to the public internet. The HA app uses an exposed LAN port, not HA ingress. It requests no Home Assistant or Supervisor API token.

The browser stores direction, walking/shuttle inclusion and the train margin locally. No GPS permission, location analytics, credentials or real home coordinate are collected. User-supplied public stop pins are embedded in the private dashboard. External map links are only followed when explicitly clicked.


## Compact view release 1.2.0

Main UI/controller: `static/app.js`; reference material: `static/reference.js`; final theme/layout: `static/glance.css`. Both browser and API must use `engine.comparison()` so preferred stops, return walks, dominance and operator priorities remain identical. Raw `allRows()` deliberately still supports diagnostics.

Auto checks on open/refocus are throttled by the last attempt, including failures. A daily-limit response pauses automatic calls. Returning to the page can recheck the server so a client cached at zero allowance is not stuck after the rolling quota resets. Both HA refresh automations and the browser share the same budget: do not add unbounded polling.


## Registered key setup / manual anonymous mode

See `API_ACCESS.md`. In HA app Configuration use the masked `bmc_api_key`; on a normal server set `BMC_API_KEY` or `BMC_API_KEY_FILE`. Restart after changing access. `BMC_AUTH_DAILY_LIMIT` defaults to 10,000, while no-key access remains 80/day. `BMC_AUTH_BASE` is an optional HTTPS override matching the approved subscription. No secret may be stored in the project or HTML. `.env.example` is documentation, not an automatically loaded env file.

Manual HTTP calls require `X-Commute-Refresh: manual`. The automatic header (or no header) is blocked from anonymous upstream use. Reload old browser tabs after upgrading. The app's default is now manual-only unless you configure a key. Authenticated upstream access still needs verification with your own real key.


## 1.4 stop-source / matching update

Include `delijn_live.py` in runtime deployments. Supply a private De Lijn stop API key to activate the new source; no shared website credential is used. See `DELIJN_REALTIME.md`. Quota schema 3 adds a direct-stop bucket without resetting existing buckets. BMC remains the global auto-refresh authorization; direct De Lijn-only deployments use manual combined refresh.

No GTFS download is needed just to apply these code/UI changes. Bump/rebuild the HA app and reload the browser. MIVB matched originals/delays are explicitly estimates; do not convert them into unqualified official delays.
