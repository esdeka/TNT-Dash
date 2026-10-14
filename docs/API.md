# HTTP API contract (schema version 1)

Base URL: the same origin serving the page, e.g. `http://DASHBOARD_HOST:3000` on your LAN. No built-in authentication; keep the service private (trusted LAN, VPN or authenticated reverse proxy).

The dashboard page itself is the only client of these endpoints. Run the server with `python server/server.py --port 3000`. UI times are Brussels local time; ISO fields are UTC. Missing options are `null`, never 00:00 / epoch zero / an invented departure. The Home Assistant entities API (`/api/next`, `/api/plan-train`) was removed in v1.5.1; older git history retains it if ever needed.

## Endpoints

| Method / path | Purpose | Upstream requests |
|---|---|---|
| `GET /` | `site/index.html` with `window.COMMUTE_SERVER = true` injected (secrets script tag removed) | None |
| `GET /api/health` | Process health, timezone, safe public access capabilities | None |
| `GET /api/live` | Current bus cache, errors, freshness metadata, access and quota | None |
| `POST /api/live/refresh` | STIB + De Lijn refresh, respecting key policy, 60 s shared cache and per-mode quotas (header `X-Commute-Refresh: manual` or `automatic`) | Up to 2, or 3 when a failing De Lijn stop key falls back to the BMC feed (honestly post-charged) |
| `GET /api/trains?date=YYYY-MM-DD&time=HH:MM` | Brussels North iRail departure board | Up to 1, separately cached/rate-limited |
| `GET /<path>` | Any other file under `site/` (CSS, JS, data, fonts, logos, `assets/shuttle-2026.pdf`). Traversal outside `site/` and `Dashboard-secrets.js` return 404 | None |
| `GET /docs/<name>.md` | Whitelisted Markdown docs as plain text | None |

`GET /api/live/refresh` returns the shared cache without an upstream call when the last (successful or failed) attempt is under 60 seconds old. Anonymous mode is manual-only: automatic refreshes fail closed without a configured Belgian Mobility key. A separate De Lijn stop-API key, when configured, is tried first for De Lijn; on any failure the same refresh falls back to the BMC GTFS-RT feed with the BMC key and the payload is annotated `stopApiFallback`, surfacing the stop error only if the BMC attempt also fails.
