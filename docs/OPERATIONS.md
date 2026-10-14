# Operations, updates and delivery

## Run / restart

**Static (primary):** open `site/index.html`, or copy the `site/` folder to any static host. No runtime dependencies. Edits to `site/` take effect on browser reload.

**Server (optional):** Python 3.10+.

```bash
pip install -r server/requirements.txt   # tzdata (Windows) + optional De Lijn protobuf parser
python server/server.py --port 3000      # or: npm run serve
```

The server binds to `0.0.0.0`. Use the machine's LAN address from another device. Browser API URLs are relative. It reads `site/` files on each request, so front-end edits only need a browser reload. A running Python process does not reload backend source: restart after changes to `server/*.py` or imported GTFS.

Node.js 20+ is only needed for the test suites.

## Update offline bus schedules

The **Refresh timetables** GitHub Action does this every Monday (anonymous gateway, sanity check, fixture-based tests, commit only if changed, then redeploys Pages); trigger it from the Actions tab when needed. STIB publishes only about four weeks ahead, so it must keep running. Locally it is a manual operation. Do not confuse live refresh with GTFS refresh.

1. Commit or otherwise keep the current `data/timetable.json` if you need rollback (git history is enough).
2. Download and extract the new operator feeds; this also regenerates `site/js/data/`:

   ```bash
   python tools/refresh_schedules.py
   ```

3. Inspect the printed dates, routes and stop IDs; metadata is in `data/timetable.json`.
4. Reload the page. Restart the server if you use it.
5. Commit `data/timetable.json` together with the regenerated `site/js/data/timetable.js`.
6. Re-run the tests (`npm test`). Calendar / exact-departure examples in tests refer to the bundled September 2026 data; review those fixtures deliberately when replacing it. Do not change an assertion just to hide a real routing regression.

By default the importer makes **two public requests**, one per full-network GTFS ZIP. `--operators stib` or `--operators delijn` limits work to that operator and preserves the other saved data. Each selected operator needs one download; with `--cached`, existing selected archives are reused. De Lijn was about 217 MB compressed and its stop-times table about 1.7 GB uncompressed; the script streams it. Retained corridor data is about 4 MB. Allow time, network bandwidth and disk space. Do not repeat downloads while debugging CSS.

By default, archives live in `.cache/transit/` at the repository root (git-ignored). Override with environment variable `COMMUTE_GTFS_CACHE` if desired. `--cached` reuses existing archives; if an archive is missing it is downloaded. It is **not** an instruction to obtain a fresh timetable.

```bash
python tools/refresh_schedules.py --cached
```

The timetable JSON and generated data scripts are replaced atomically. The downloader can leave an incomplete cached ZIP after a network interruption; run a normal fresh download to replace it rather than trying `--cached` on that partial file.

Walking pins in `data/walking.json` (run `python tools/build_data.py` after editing) and shuttle rules in `site/js/engine.js` are separate. Do not overwrite them during GTFS imports. The original 2026 shuttle PDF is not an automatically updating source; get explicit user confirmation before changing its assumptions or extending to another year.

## Live bus data

Direct mode (`site/js/live-direct.js`) and the server's `POST /api/live/refresh` behave identically: a refresh explicitly attempts both operators. It uses a minimum 60-second shared cache and a per-access-mode rolling-day cap; every refresh attempt costs two provider requests, including failed upstream attempts. The browser polls once a minute during a visible 20-minute session only if a private API key is configured. Without a key, upstream refresh is manual-only; cache/status reads are safe on open/return. Hidden pages and expired sessions pause; the backend quota still applies.

A 15-second display rerender is **not** itself a feed download; the separate 60-second visible-session controller handles polling. If live data expires, schedule values remain, with truthful quality labels.

Do not delete `server/state/quota.json` (or the `commute.direct.*` localStorage entries) to get more requests. Version 2 retains separate anonymous/registered buckets; legacy `calls` are migrated to anonymous without resetting them. Other services using the same public IP may have their own usage of the public BMC allowance.

## Runtime state / environment

| Item | Default | Purpose |
|---|---|---|
| `COMMUTE_STATE_DIR` | `server/state/` (git-ignored) | `quota.json` and `live-state.json` |
| `COMMUTE_GTFS_CACHE` | `.cache/transit/` (git-ignored) | Large operator archives and metadata |
| `IRAIL_USER_AGENT` | Meaningful private-planner identifier | Optional actual contact information for a self-hosted iRail client |

Only use a real contact address in a custom iRail user agent; do not invent one. Train-board caches are in memory and separate from bus quotas. They contain public station departure data and are rebuilt on demand.


## Delivery

There is no build or packaging step. `site/` is deployed to GitHub Pages by `.github/workflows/pages.yml` on every push that touches it (enable once: Settings → Pages → Source: GitHub Actions). Alternatively copy `site/` to any static host, or run `server/server.py` from a checkout. Put a git-ignored `site/Dashboard-secrets.js` beside `index.html` only where you alone can reach it; otherwise enter keys per device in Reference → API keys. Never commit `server/state/`, `.cache/` or any secrets file.


## Checks before delivery

- `npm test` (engine, Python and Playwright suites; the UI suite starts its own server with a throwaway state directory).
- Confirm `/api/health` and the page work if you use the server. Verify an iRail response separately if claiming real train-board connectivity.
- Check mobile widths from 320 px upward: no horizontal page scroll; the recommendation is above controls and inside the first screen.
- The UI suite also covers `file://` copies of `site/` and an opaque-origin sandboxed iframe. In-page navigation is intercepted to prevent hash links from navigating an opaque iframe to a blank page.
- Update `docs/VERIFICATION.md` and `AGENTS.md` with actual results and deployment limitations.

## Security / privacy

This stdlib server has **no built-in authentication or TLS**. Use a trusted LAN, VPN or authenticated reverse proxy. Do not forward port 3000 directly to the public internet.

The browser stores direction, walking/shuttle inclusion and the train margin locally. No GPS permission, location analytics, credentials or real home coordinate are collected. User-supplied public stop pins are embedded in the private dashboard. External map links are only followed when explicitly clicked.


## Compact view release 1.2.0

Main UI/controller: `site/js/app.js`; reference material: `site/js/reference.js`; final theme/layout: `site/css/glance.css`. All callers must use `engine.comparison()` so preferred stops, return walks, dominance and operator priorities remain identical. Raw `allRows()` deliberately still supports diagnostics.

Auto checks on open/refocus are throttled by the last attempt, including failures. A daily-limit response pauses automatic calls. Returning to the page can recheck the server so a client cached at zero allowance is not stuck after the rolling quota resets. Every client shares the same budget: do not add unbounded polling.


## Registered key setup / manual anonymous mode

See `API_ACCESS.md`. Set `BMC_API_KEY` or `BMC_API_KEY_FILE` on the server. Restart after changing access. `BMC_AUTH_DAILY_LIMIT` defaults to 10,000, while no-key access remains 80/day. `BMC_AUTH_BASE` is an optional HTTPS override matching the approved subscription. No secret may be stored in committed files or the HTML.

Manual HTTP calls require `X-Commute-Refresh: manual`. The automatic header (or no header) is blocked from anonymous upstream use. Reload old browser tabs after upgrading. The app's default is now manual-only unless you configure a key. Authenticated upstream access still needs verification with your own real key.


## 1.4 stop-source / matching update

`server/delijn_live.py` (server) and `site/js/live-direct.js` (browser) implement this source. Supply a private De Lijn stop API key to activate the new source; no shared website credential is used. See `DELIJN_REALTIME.md`. Quota schema 3 adds a direct-stop bucket without resetting existing buckets. BMC remains the global auto-refresh authorization; direct De Lijn-only deployments use manual combined refresh.

No GTFS download is needed just to apply code/UI changes; reload the browser. MIVB matched originals/delays are explicitly estimates; do not convert them into unqualified official delays.
