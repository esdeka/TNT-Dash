# Planning around a train from Brussels North

## User choice

The user requested train-based trip selection and chose a **5-minute station-transfer / boarding margin**. This is a user estimate, not a measured pedestrian route from every bus bay to every rail platform. It is adjustable from 0 to 60 minutes; use more time if the platform, luggage, accessibility needs or walking pace require it.

## UI flow

1. Choose **Catch a train**. Direction becomes TNT → BN; swapping direction is disabled in this mode.
2. Select a date and the start time for the departure-board search.
3. Load the board from iRail through the local server. Filter by final destination or train number if useful. This is a departure board, not a complete search of all intermediate destinations.
4. Select a train. Scheduled time, last reported delay and platform are displayed. Canceled / departed services cannot be selected.
5. The top result shows the **latest time to leave home**, the connecting bus/shuttle, BN arrival and train departure. Other listed options also meet the deadline.

When offline, when the board fails or when looking beyond the provider's supported dates, enter a train departure time manually. This does not verify a real service exists at that time. Manual deadline planning uses the saved bus calendars and shuttle rules; it is fully usable in the standalone HTML within their coverage.

## Calculation

```text
BN arrival deadline = scheduled train departure − station margin
candidate must arrive at BN no later than the deadline
home start = bus departure − user walk (or bus departure when already at stop)
recommendation = candidate with latest home/stop start
```

Ties in latest start prefer earlier arrival, then departure / route ordering. The search looks back two hours by default in the UI; the window control can change it to one or four hours. It only considers direct routes. It is not a global multi-leg journey planner.

For today's near-term trains, the search cannot recommend a start in the past. Fresh cached bus updates may be applied to relevant trains within four hours today. The walking reachability check occurs after those predictions. Canceled bus trips are excluded. Future-date plans use scheduled buses, not today's delays.

**A train delay never extends the departure deadline.** Trains can recover delay. The user did not authorize relying on delayed departures to leave home later. If a selected board entry is reported canceled on reload, the recommendation is withdrawn.

## Example from the bundled September 2026 timetable

Train scheduled from BN on **7 September at 08:30**, margin **5 min**:

- Reach the BN bus stop by **08:25**.
- The bundled data recommends STIB 14 from Picard at **08:19**, arriving **08:25**.
- Walk to Picard: **5 min** → latest home start **08:14**.
- Home → BN takes 5 min walking + 6 min riding = **11 min**.
- Add 5 min at BN → **16 min** from latest home start until the scheduled train.

The train time in this example is a planning input, not a claim that a specific real train runs at 08:30. Future GTFS imports can change the connecting bus.

## Avoid these implementation mistakes

- Do not rank train connections by earliest arrival if the objective is latest feasible start.
- Do not add the pre-bus walk to the already absolute bus arrival timestamp.
- Do not use the lookback-window start as the actual home start. Engine `queryReference` is just a search bound; `journeyStart` is the recommended start for that row.
- In train rows, `totalJourneySeconds` ends at BN. `stationWaitSeconds` is separate. Together they equal train departure minus journeyStart.
- Do not reinterpret the user's 5-minute station margin as a walk home on BN → TNT. Reverse ordinary trips now include walking home; the older outbound-only rule was superseded by the user.
- Do not call a manually supplied train time a live or confirmed train.
- Do not bypass expired bus GTFS coverage merely because iRail returns a train.
- Keep the fixed station identity **BE.NMBS.008812005**. It is Brussels North, not another Brussels station or the Tour-et-Taxis railway station.

## Data / limitations

The train board is supplied by **iRail**, which exposes SNCB/NMBS train information. This is not a direct SNCB API integration. iRail can reject dates far in the past/future; see https://docs.irail.be/#liveboard . The backend caches boards for at least 60 seconds. A selected near-term train today can be rechecked during the active visible-page session; no hidden/future-date polling.

There is no rail-ticket purchase, train reservation, guarantee of transfer, platform walking route, full station accessibility model or end-to-end train journey calculation. Recheck cancellations/platform changes before traveling. An exact BN shuttle bay is still unspecified. The default HA entities are not synchronized to the browser's selected train; the separate `/api/plan-train` endpoint supports a future HA input_datetime integration.
