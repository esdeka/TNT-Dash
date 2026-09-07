# De Lijn stop real-time connector — 1.4.0

## Activate with your own key

The supported De Lijn stop API is now implemented. It requires a **De Lijn Open Data subscription key**, separate from the Belgian Mobility (BMC) key.

- Subscribe to the **Open Data Free** product at https://data.delijn.be/products . It includes real-time information for stops.
- In the HA OS app Configuration, enter the key in masked **`delijn_api_key`**, then restart the app.
- For a normal server, configure **`DELIJN_API_KEY`** or **`DELIJN_API_KEY_FILE`** privately. Default app budget is `DELIJN_DAILY_LIMIT=10000`, within the assigned subscription quota.
- Never paste the key into chat, HTML, a URL or a source file. The request key is an unredirected `Ocp-Apim-Subscription-Key` header, not forwarded on redirects.

**No real De Lijn key was supplied in this workspace.** The connector, normalization, matching, security and browser rendering were verified with fictional keys and documented-schema fixtures. Successful authenticated upstream access must still be checked with your own key. Without it, the dashboard continues using the limited BMC GTFS-RT fallback, so Picard predictions can still be missing. Do not claim the stop feed is active just because the code is installed.

The existing global automatic-refresh rule remains controlled by the **BMC key**, because it also authorizes STIB's automatic requests. With only a De Lijn key, use manual Refresh. With both keys, the visible-page one-minute / 20-minute session refreshes both. No anonymous STIB requests are silently automated.

## Endpoint and request

Documented operation:

https://data.delijn.be/api-details#api=kernopendataservicesv1&operation=get-haltes-lijst-haltesleutels-real-time

```text
GET https://api.delijn.be/DLKernOpenData/api/v1/haltes/lijst/{haltesleutels}/real-time?maxAantalDoorkomsten=50
```

Keys alternate entity and stop number, separated by underscores. All configured De Lijn corridor stops belong to entity 3, e.g. `3_310790_3_303916`. The connector batches the configured boarding and alighting stops into **one request**, so it can use destination forecasts too. It is bounded to at most 20 configured entity-3 stops; do not generalize this entity mapping to arbitrary new regions without checking.

The module is `delijn_live.py`. It uses the documented API, **not** the website's private browser/session endpoint, a borrowed API key, or copied cookies.

## Normalization

Official response containers:

- batch: `halteDoorkomstenLijst[]`
- per-stop groups: `halteDoorkomsten[]`
- individual passages: `doorkomsten[]`

Fields retained:

| Source | Meaning |
|---|---|
| `doorkomstId` | Passage identity; contains service date, line code and journey number |
| `haltenummer` | Actual stop ID |
| `dienstregelingTijdstip` | Planned passing time |
| `doorkomstTijdstip` | Real-time passing time |
| `predictionStatussen` | REALTIME, GEENREALTIME, GESCHRAPT, VERSTREKEN |
| `status` | CANCELLED if the trip is cancelled |
| `vrtnum` | Vehicle identifier |

A valid real-time time plus an explicit **REALTIME** status is required for a live prediction. A timestamp merely equal to the schedule without REALTIME is not treated as verified on time. Date-only values are rejected rather than interpreted as midnight. Naive datetimes are interpreted in Europe/Brussels; offset-aware values retain their instant.

GEENREALTIME stays scheduled/unknown. GESCHRAPT/CANCELLED cannot win. VERSTREKEN is passed, not cancellation, and is removed from upcoming departures. Identical repeated records are de-duplicated; conflicting ambiguous records do not become guessed forecasts.

## Matching to the saved corridor

The engine matches **service date + line/journey identity + stop**, using the operator passage ID and the corresponding GTFS trip prefix. An exact planned timestamp disambiguates repeated visits to a stop. A unique identity match can accept the stop API's newer planned time; the original GTFS values are kept separately for audit. Ambiguous matches are not applied.

Where both endpoints have matching live values, bus departure and arrival both use them. If only boarding prediction is available, destination arrival is projected using the saved GTFS ride duration and marked approximate. No first-stop delay is propagated through a BMC NO_DATA field and passed off as a Picard prediction: this is a separate authoritative stop source.

Rows carry `liveSource: 'delijn-stop-api'`, paired planned times, signed delay, vehicle ID, and the matched network journey ID. The API exports `live_source`, `vehicle_id`, `delay_estimated`, and `arrival_delay_estimated`. `arrival_delay_estimated` can be true for a projected destination even when the boarding delta is operator-paired.

## Quotas and cache

The De Lijn stop batch has its own persisted `delijn_stop` bucket. With a configured De Lijn key, a refresh uses one BMC call for STIB and one De Lijn stop-batch call; without it, the existing two-call BMC path remains. The same 60-second shared cache and two-minute freshness limit apply. Key/source changes invalidate the source cache identity, but never reset usage history. A failed authorized stop call does not silently spend an additional anonymous BMC call.

## Why this was needed

The user's Picard screenshot was correct. On 7 September, operator stop data reported real delays and early running for the same vehicles that the BMC feed marked NO_DATA at Picard. BMC had some running deviations at preceding stops, but not the needed Picard forecasts. This connector addresses the source gap once the user's own key is configured.


## Verify after you configure the key

1. Restart the app and open `/api/health`: `access.delijnStopKeyConfigured` should be true and `delijnSource` should be `stop-api`. This proves configuration presence, not successful authentication.
2. Press manual Refresh. In `/api/live`, check `providers.delijn.ok`, `kind: "stop-api"`, `recordCount`, `liveRecordCount` and any error.
3. A matched forecast in `/api/next` has `live_source: "delijn-stop-api"`, operator-paired schedule/actual values and signed delay. If a destination forecast is absent, its arrival is explicitly estimated.
4. If access is rejected, confirm you subscribed to the Free Open Data product containing stop real-time, not just the GTFS download product. Do not paste the key into chat.


## Is this the same API as BMC?

BMC distributes De Lijn data, but the endpoints are not interchangeable. The BMC path used by this project is the De Lijn **GTFS-RT trip-update feed**. The new connector goes directly to **De Lijn Open Data v1 Core, stop real-time** on `api.delijn.be`. For this implemented direct connector, configure a De Lijn-issued key in `delijn_api_key` / `DELIJN_API_KEY`, not the BMC key. The shared Azure header name does not make the subscriptions interchangeable.

You do not necessarily need two keys: a De Lijn key plus manual anonymous STIB/BMC access works. A BMC key is optional for higher BMC quota and the app's current global automatic-refresh policy. BMC's public catalogue lists De Lijn GTFS-RT trip updates/service alerts; this project has not verified an equivalent stop-level product in a private BMC subscriber catalogue. If such a product is available to the user, its documented endpoint/access can be evaluated separately rather than assuming the current BMC feed is equivalent.
