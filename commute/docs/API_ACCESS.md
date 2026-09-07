# Private API access — release 1.3.0

## Automatic choice

| Configuration | Gateway / live-refresh policy | App live-call budget |
|---|---|---|
| No non-empty key | Anonymous Discovery API; **manual only** | 80 / rolling 24h, 4 / minute |
| Key configured | Registered gateway; visible-page auto refresh allowed | Default 10,000 / rolling 24h, 4 / minute |

The registered default leaves headroom below the currently advertised indicative Standard quota. Use the quota actually assigned to your subscription. Two operator calls are attempted per refresh; the shared cache is at least 60 seconds. Registered automatic refresh retains the existing one-minute cadence, 20-minute visible session, hidden-page pause and manual Resume.

**No key means no automatic upstream calls on load, tab return, mode changes or timers.** The page may make `GET /api/live` to read existing cached predictions and access capabilities; that request does not contact either operator. A fresh cache from a previous manual check may still be displayed.

## Home Assistant OS

In the **Commute dashboard app → Configuration**, set:

- `bmc_api_key`: your subscription key, in the masked password field. Leave empty for anonymous/manual mode unless you configure a key by environment/file instead.
- `bmc_auth_daily_limit`: default `10000`; lower it if your assigned quota is lower.
- `bmc_auth_base`: normally empty. Set only if your subscription documentation specifies a different HTTPS API base.

Restart the app after changing configuration. App options are stored privately by HA OS under `/data/options.json`; protect backups. The key is passed into the server environment before server startup or an explicitly requested GTFS import. It is never placed in the built HTML, walking/timetable data, API responses, logs or distribution archives.

**Do not paste your actual key into chat.** Enter it locally on your own server. Home Assistant Core's `!secret` YAML convention is not a substitution mechanism for the app Configuration form; use that masked field or an environment/secret-file setup.

## Python / Docker service

Supported environment variables:

```text
BMC_API_KEY                   subscription key (private environment)
BMC_API_KEY_FILE              alternative private file, e.g. /run/secrets/bmc_api_key
BMC_AUTH_DAILY_LIMIT          default 10000; allowed 2–12000
BMC_AUTH_BASE                 optional registered HTTPS API base override
```

A non-empty environment key takes precedence over the file. An empty key/file gives anonymous mode. A configured but unreadable secret file is an error, not an unnoticed downgrade. `.env.example` documents variable names; Python does not automatically load `.env`. Use your service environment or Docker env/secret configuration. Keep real secret files outside the source tree, with appropriate permissions.

Default bases:

- Anonymous: `https://api-management-discovery-production.azure-api.net/api/`
- Registered: `https://api-management-opendata-production.azure-api.net/api/`

The key is sent in **`Ocp-Apim-Subscription-Key`**, never in the URL. It is an unredirected request header, so it is not forwarded to another host if an API response redirects. It is not sent to iRail or operator web-page links. Registered failures do not silently fall back to anonymous access.

The authenticated base is configurable because the assigned subscription documentation is authoritative. **No real registered key was supplied in this workspace, so successful authenticated upstream access has not been verified here.** Mode selection, header construction, no-secret-exposure and error handling were tested with fictional keys and mocked transport. Unauthenticated checks of the registered gateway reached its quota policy, not a successful authenticated data response.

## Client/server handshake

`GET /api/live`, `GET /api/health` and the read-only planning API expose only safe `access` metadata:

```json
{
  "mode": "anonymous",
  "keyConfigured": false,
  "autoRefreshAllowed": false,
  "dailyLimit": 80,
  "minuteLimit": 4
}
```

The UI starts with automatic refresh disabled until that metadata is received. Changes to server configuration are learned on reload/return/cache-status checks. The backend enforces the policy as well, so a stale browser cannot automatically spend anonymous requests.

`POST /api/live/refresh` requires a refresh-purpose header:

- `X-Commute-Refresh: manual` — the explicit Refresh button / manual API action.
- `X-Commute-Refresh: automatic` — a timer/automation; blocked from upstream access without a key.
- Missing/unknown header — treated as automatic, to fail closed for older auto-polling tabs.

Example manual request:

```bash
curl -X POST -H 'X-Commute-Refresh: manual' http://YOUR_HOST:3000/api/live/refresh
```

The bundled HA package has separate `commute_refresh_live` (manual) and `commute_auto_refresh_live` actions. The optional automation uses the latter. External automations must not masquerade as manual requests. An old client without the header may receive cache only until reloaded/upgraded.

## Quota preservation

`quota.json` version 2 has separate anonymous/registered buckets. Legacy `calls` migrate into the anonymous bucket; the previous usage is not discarded. Key changes within registered mode do not reset its bucket. Packaging excludes runtime state and never resets a running allowance.

The static GTFS importer uses the same configured access/key. Its explicitly requested downloads are separate from the live-call counter; reserve quota headroom. iRail remains a separate service with its own limiter.


## Separate De Lijn stop key (app 1.4.0)

See [De Lijn real-time setup](DELIJN_REALTIME.md). `DELIJN_API_KEY` / `DELIJN_API_KEY_FILE` or masked HA `delijn_api_key` selects the supported stop-oriented API. It is not a BMC key. It has a separate `delijn_stop` quota bucket; key rotation does not reset usage. The multi-stop request costs one call. The BMC side then makes just the STIB request. Global automatic refresh still requires BMC credentials; a De Lijn-only key works with manual Refresh.


### Why two key fields?

`bmc_api_key` is issued for BMC's gateway and enables registered BMC access (STIB and the De Lijn GTFS-RT fallback). `delijn_api_key` is issued for De Lijn's own Open Data stop API. Same operator data can be distributed by different API services with different subscriptions. For the direct connector currently implemented, the De Lijn key is separate; neither key is sent to the other gateway. A De Lijn-only key is usable with manual anonymous STIB refresh, so both are not mandatory.
