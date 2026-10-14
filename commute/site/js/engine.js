/* Northbound's timetable engine. All timestamps are epoch seconds.
   Pure functions; no DOM, network, timers or fabricated live data. */
(function (root) {
  'use strict';
  const ZONE = 'Europe/Brussels';
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  const pad = n => String(n).padStart(2, '0');
  function parts(epoch) {
    return Object.fromEntries(formatter.formatToParts(new Date(epoch * 1000))
      .filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  }
  function dateISO(epoch) { const p = parts(epoch); return `${p.year}-${p.month}-${p.day}`; }
  function hhmm(epoch) { const p = parts(epoch); return `${p.hour}:${p.minute}`; }
  function wallEpoch(iso, time = '00:00') {
    const [y, m, d] = iso.split('-').map(Number);
    const [h, min, sec = 0] = time.split(':').map(Number);
    const target = Date.UTC(y, m - 1, d, h, min, sec) / 1000;
    let guess = target;
    for (let i = 0; i < 3; i++) {
      const p = parts(guess);
      const represented = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) / 1000;
      guess += target - represented;
    }
    return guess;
  }
  // GTFS defines its service-day origin as local noon minus 12 hours (including on DST days).
  function serviceBase(iso) { return wallEpoch(iso, '12:00') - 12 * 3600; }
  function shiftDate(iso, delta) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + delta, 12)).toISOString().slice(0, 10);
  }
  function dateKey(iso) { return iso.replaceAll('-', ''); }
  function dateFromKey(key) { return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`; }
  function dow(iso) { return new Date(`${iso}T12:00:00Z`).getUTCDay(); }
  function activeServices(data, iso) {
    const key = dateKey(iso), result = new Set();
    const day = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][dow(iso)];
    for (const c of data.calendar) {
      if (c.start_date <= key && c.end_date >= key && c[day] === '1') result.add(c.service_id);
    }
    for (const c of data.exceptions) {
      if (c.date === key) c.exception_type === '1' ? result.add(c.service_id) : result.delete(c.service_id);
    }
    return result;
  }
  function fresh(provider, now, maxAge = 120) {
    if (!provider?.ok || !provider.fetchedAt || now - provider.fetchedAt > maxAge || provider.fetchedAt - now > 30) return false;
    return !provider.feedTime || (now - provider.feedTime <= maxAge && provider.feedTime - now < 30);
  }
  const relIs = (v, n, s) => v === n || v === s || v === String(n);
  function eventTime(ev, scheduled) {
    if (!ev) return null;
    if (Number.isFinite(ev.time) && ev.time > 0) return ev.time;
    if (Number.isFinite(ev.delay)) return scheduled + ev.delay;
    return null;
  }
  function directDeLijnRecord(row, provider, stop, planned) {
    const m=String(row.tripId||'').match(/^gt:delijn:(\d+)_(\d+)_/);
    if(!m)return null;
    const identity=`${row.serviceDate}_${m[1]}_${m[2]}`;
    const matches=(provider.records||[]).filter(r=>{
      if(r.stop!==stop)return false;
      if(r.journeyId)return r.journeyId===identity;
      const code=String(r.entity||'')+String(r.lineNumber||'').padStart(3,'0');
      return String(r.journeyNumber)===m[2] && (code===m[1]||String(r.lineNumber)===m[1]) && r.planned===planned;
    });
    const exact=matches.filter(r=>r.planned===planned);
    return exact.length===1?exact[0]:matches.length===1?matches[0]:null;
  }
  function applyDeLijnStop(row, provider, now) {
    if(!fresh(provider,now))return row;
    const a=directDeLijnRecord(row,provider,row.origin.id,row.scheduledDeparture);
    const b=directDeLijnRecord(row,provider,row.destination.id,row.scheduledArrival);
    const base={...row,networkJourneyId:a?.journeyId||b?.journeyId||null};
    if(a?.cancelled||b?.cancelled)return {...base,cancelled:true,quality:'cancelled',cancellationReason:'Cancelled by De Lijn stop API'};
    if(a?.passed)return {...base,passed:true};
    if(!a?.realtime||!Number.isFinite(a.expected)||!Number.isFinite(a.planned))return base;
    const dep=a.expected, directArrival=b?.realtime && Number.isFinite(b.expected) && b.expected>=dep;
    const arr=directArrival?b.expected:dep+row.ride;
    const scheduledArrival=Number.isFinite(b?.planned)?b.planned:a.planned+row.ride;
    return {...base,id:`live-delijn-stop-${a.journeyId||row.tripId}-${row.origin.id}-${row.destination.id}`,
      departure:dep,departureLatest:dep,arrival:arr,arrivalLatest:arr,
      scheduledDeparture:a.planned,scheduledArrival,
      gtfsScheduledDeparture:row.scheduledDeparture,gtfsScheduledArrival:row.scheduledArrival,
      quality:'live',departureApprox:false,arrivalApprox:!directArrival,liveArrival:Boolean(directArrival),
      delay:dep-a.planned,arrivalDelay:arr-scheduledArrival,delayEstimated:false,arrivalDelayEstimated:!directArrival,
      fetchedAt:provider.fetchedAt,vehicleId:a.vehicleId||null,liveSource:'delijn-stop-api',
      ride:arr-dep,detail:directArrival?'De Lijn stop API: matched journey and stops with paired planned and real-time passing times.':'De Lijn stop API: paired planned/live departure. Arrival is projected using the saved GTFS ride duration.'};
  }
  function applyDeLijn(row, provider, now) {
    if(provider?.kind==='stop-api')return applyDeLijnStop(row,provider,now);
    if (!fresh(provider, now)) return row;
    const u = provider.trips?.[row.tripId];
    if (!u || (u.date && u.date !== dateKey(row.serviceDate))) return row;
    if (relIs(u.relationship, 1, 'ADDED') || relIs(u.relationship, 2, 'UNSCHEDULED') || relIs(u.relationship, 6, 'DUPLICATED')) return row;
    const a = u.stops.find(s => s.stop === row.origin.id && (!s.seq || +s.seq === row.originSequence));
    const b = u.stops.find(s => s.stop === row.destination.id && (!s.seq || +s.seq === row.destinationSequence));
    if (relIs(u.relationship, 3, 'CANCELED') || relIs(u.relationship, 7, 'DELETED')) {
      return { ...row, cancelled: true, cancellationReason: 'Cancelled', quality: 'cancelled' };
    }
    if (relIs(a?.relationship, 1, 'SKIPPED') || relIs(b?.relationship, 1, 'SKIPPED')) {
      return { ...row, cancelled: true, cancellationReason: 'Stop skipped', quality: 'cancelled' };
    }
    // An unchanged cancellation / skipped stop in a fresh feed still applies.
    // The per-trip age limit is for time predictions, not persistent service status.
    if (u.timestamp && now - u.timestamp > 300) return row;
    const occupancy = u.date === dateKey(row.serviceDate) && a?.seq && +a.seq === row.originSequence ? occupancyInfo(a.occupancyStatus) : null;
    const baseRow = occupancy ? {...row, occupancy:{...occupancy,source:'De Lijn GTFS-RT departure occupancy',fetchedAt:provider.fetchedAt}, boardingUnavailable:occupancy.unboardable} : row;
    // Never propagate a delay through explicit NO_DATA stop updates.
    const dep = !relIs(a?.relationship, 2, 'NO_DATA') ? eventTime(a?.departure, row.scheduledDeparture) : null;
    const arr = !relIs(b?.relationship, 2, 'NO_DATA') ? eventTime(b?.arrival, row.scheduledArrival) : null;
    if (dep === null) return baseRow;
    const arrival = arr !== null && arr >= dep ? arr : dep + row.ride;
    return { ...baseRow, departure: dep, departureLatest: dep, arrival, arrivalLatest: arrival,
      quality: 'live', departureApprox: true, arrivalApprox: arr === null,
      liveArrival: arr !== null, fetchedAt: provider.fetchedAt,
      delay: dep - row.scheduledDeparture, arrivalDelay: arrival - row.scheduledArrival, ride: arrival - dep,
      detail: arr === null ? 'Live departure. Arrival estimated using the scheduled ride time.' : 'Live departure and arrival estimates from De Lijn.' };
  }
  function normalizeName(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function matchSTIBSchedules(predictions, group, maxDelta=1800) {
    const schedules=[...new Map([...group].sort((a,b)=>a.scheduledDeparture-b.scheduledDeparture).map(r=>[r.scheduledDeparture,r])).values()];
    const m=predictions.length,n=schedules.length,penalty=maxDelta+1;
    const cost=Array.from({length:m+1},()=>new Float64Array(n+1));
    const choice=Array.from({length:m+1},()=>new Uint8Array(n+1));
    for(let i=1;i<=m;i++)cost[i][0]=i*penalty;
    for(let i=1;i<=m;i++)for(let j=1;j<=n;j++) {
      let best=cost[i][j-1],action=0; // skip a schedule; ties keep the earlier match
      const unmatched=cost[i-1][j]+penalty;
      if(unmatched<best){best=unmatched;action=1;}
      const delta=Math.abs(predictions[i-1].time-schedules[j-1].scheduledDeparture);
      const matched=cost[i-1][j-1]+delta;
      if(delta<=maxDelta && matched<best){best=matched;action=2;}
      cost[i][j]=best;choice[i][j]=action;
    }
    const result=Array(m).fill(null);let i=m,j=n;
    while(i>0){if(j===0){i--;continue;}const action=choice[i][j];if(action===0){j--;continue;}if(action===1){i--;continue;}result[i-1]=schedules[j-1];i--;j--;}
    return result;
  }
  function applySTIB(rows, provider, now) {
    if (!fresh(provider, now)) return rows;
    const others = rows.filter(r => r.operator !== 'stib');
    const groups = new Map();
    for (const row of rows.filter(r => r.operator === 'stib')) {
      const key = `${row.origin.id}|${row.line}|${row.destination.id}|${normalizeName(row.headsign)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    for (const group of groups.values()) {
      const sample = group[0];
      const matching = (provider.records || []).filter(p => Number.isFinite(p.time) && p.stop === sample.origin.id && p.line === sample.line &&
        Object.values(p.destination || {}).some(s => normalizeName(s) === normalizeName(sample.headsign)) && p.time >= now - 30)
        .sort((a, b) => a.time - b.time);
      const predictions = [...new Map(matching.map(p => [p.time,p])).values()];
      if (!predictions.length) { others.push(...group); continue; }
      const generated = [], matches=matchSTIBSchedules(predictions,group);
      for (let i = 0; i < predictions.length; i++) {
        const p = predictions[i];
        const matched=matches[i];
        const template = matched || group.reduce((a, b) => Math.abs(a.scheduledDeparture - p.time) < Math.abs(b.scheduledDeparture - p.time) ? a : b);
        if (Math.abs(template.scheduledDeparture - p.time) > 3600) continue;
        generated.push({ ...template, id: `live-stib-${sample.origin.id}-${sample.destination.id}-${sample.line}-${p.time}`,
          tripId: null, departure: p.time, departureLatest: p.time, arrival: p.time + template.ride,
          arrivalLatest: p.time + template.ride, quality: 'live', departureApprox: true, arrivalApprox: true,
          scheduledDeparture:matched?.scheduledDeparture??null, scheduledArrival:matched?.scheduledArrival??null,
          delay:matched?p.time-matched.scheduledDeparture:null, delayEstimated:Boolean(matched),
          estimatedTripId:matched?.tripId||null, scheduleMatchMethod:matched?'order-preserving nearest GTFS time':null,
          fetchedAt: provider.fetchedAt,
          detail: matched?'STIB expected passing time. The original scheduled time is an estimated one-to-one, order-preserving GTFS match (within 30 minutes), not an operator-provided trip identity. Displayed delay is approximate and rounded to minutes. Arrival uses that schedule’s ride duration.':'STIB live passing estimate; no plausible scheduled-time match. Arrival uses a nearby route template; no delay can be calculated.', message: p.message });
      }
      if (!generated.length) { others.push(...group); continue; }
      const last = Math.max(...generated.map(r => r.departure));
      const coveredUntil = Math.floor(last / 60) * 60 + 60; // suppress the last displayed minute too
      // The next-passing list is authoritative for this boarding stop, line and
      // direction while fresh. A 10m/30m live list replaces ALL scheduled calls
      // through the 30m boundary, not just guessed matching trip timestamps.
      // Beyond that boundary retain GTFS. Do not suppress other lines/stops.
      const assigned=new Set(matches.filter(Boolean).map(r=>r.scheduledDeparture));
      others.push(...group.filter(r => r.scheduledDeparture >= coveredUntil && !assigned.has(r.scheduledDeparture)),
        ...generated.map(r => ({...r, liveWindowEnd:last, liveCoverageUntil:coveredUntil})));
    }
    return others;
  }
  // Verified against the operator's rendered pages and stop links, 2026-09-05.
  // STIB uses v/f (NOT v/r); direction depends on line and destination.
  const STIB_WEB_DIRECTIONS = {
    '14': {GAREDUNORD:'f', NOORDSTATION:'f', UZVUB:'v'},
    '20': {GAREDUNORD:'f', NOORDSTATION:'f', HUNDERENVELD:'v'},
    '88': {DEBROUCKERE:'v', UZVUB:'f'}
  };
  function operatorPage(operator, line, route = {}, headsign = '') {
    if (operator === 'stib') {
      const dir = STIB_WEB_DIRECTIONS[line]?.[normalizeName(headsign)];
      return 'https://www.stib-mivb.be/startpagina/reizen/real-time/lijnen?line=' + encodeURIComponent(line) + (dir ? '&direction=' + dir : '');
    }
    if (operator === 'delijn' && /^https?:\/\//i.test(route.url || '')) return route.url;
    return null;
  }
  // Public live-departure page of a single stop, next to the route links.
  // De Lijn halte URLs come from GTFS; STIB uses its real-time stop page.
  function stopPage(operator, stop = {}) {
    if (operator === 'delijn' && /^https?:\/\//i.test(stop.url || '')) return stop.url;
    if (operator === 'stib' && stop.code) return 'https://www.stib-mivb.be/startpagina/reizen/real-time/haltes?stop=' + encodeURIComponent(stop.code);
    return null;
  }
  // Delays display in whole minutes: a seconds remainder under 45 s rounds
  // down to the previous minute, otherwise up. Colour follows that displayed
  // minute so tone and text can never disagree: blue early, green 0–2 min,
  // orange over 2 and under 5 min, red 5 min or more.
  function roundMinuteDelta(seconds) {
    const a = Math.abs(Math.round(seconds));
    return Math.sign(seconds) * (a % 60 < 45 ? Math.floor(a / 60) : Math.ceil(a / 60)) * 60;
  }
  function timingStatus(row, event = 'departure') {
    const arrival = event === 'arrival', actual = arrival ? row.arrival : row.departure;
    const original = arrival ? row.scheduledArrival : row.scheduledDeparture;
    // A missing live comparison is UNKNOWN, not proof of on-time operation.
    const known = row.quality === 'live' && Number.isFinite(original) && Number.isFinite(actual);
    const rawDelta = known ? actual - original : null;
    const estimated = Boolean(row.delayEstimated || arrival && row.arrivalDelayEstimated);
    const delta = rawDelta === null ? null : roundMinuteDelta(rawDelta);
    const tone = delta === null ? 'unknown' : delta < 0 ? 'early' : delta <= 120 ? 'on-time' : delta < 300 ? 'minor-delay' : 'major-delay';
    return {actual, original: known ? original : null, delta, rawDelta, tone, estimated,
      approximate: arrival ? Boolean(row.arrivalApprox) : Boolean(row.delayEstimated) || row.quality === 'live' && !known};
  }
  function occupancyInfo(value) {
    const keys = ['EMPTY','MANY_SEATS_AVAILABLE','FEW_SEATS_AVAILABLE','STANDING_ROOM_ONLY','CRUSHED_STANDING_ROOM_ONLY','FULL','NOT_ACCEPTING_PASSENGERS','NO_DATA_AVAILABLE','NOT_BOARDABLE'];
    const key = typeof value === 'number' || /^\d+$/.test(String(value)) ? keys[Number(value)] : value;
    const labels = {EMPTY:'Empty', MANY_SEATS_AVAILABLE:'Many seats', FEW_SEATS_AVAILABLE:'Few seats', STANDING_ROOM_ONLY:'Standing only', CRUSHED_STANDING_ROOM_ONLY:'Very crowded', FULL:'Full', NOT_ACCEPTING_PASSENGERS:'Not accepting passengers', NOT_BOARDABLE:'Not boardable'};
    return labels[key] ? {status:key,label:labels[key],unboardable:['NOT_ACCEPTING_PASSENGERS','NOT_BOARDABLE'].includes(key)} : null;
  }
  function busRows(timetable, reference, direction, horizon = 120, live = null, now = reference) {
    const end = reference + horizon * 60;
    const firstDay = shiftDate(dateISO(reference), -1);
    const lastDay = shiftDate(dateISO(end), 1);
    let rows = [];
    for (const [op, data] of Object.entries(timetable.operators)) {
      for (let iso = firstDay; iso <= lastDay; iso = shiftDate(iso, 1)) {
        if (dateKey(iso) < data.feedStart || dateKey(iso) > data.feedEnd) continue;
        const active = activeServices(data, iso);
        const base = serviceBase(iso);
        for (const [tid, from, to, dep, arr, fromSeq, toSeq] of data.legs) {
          const [rid, service, headsign] = data.trips[tid];
          if (!active.has(service)) continue;
          const a = data.stops[from], b = data.stops[to];
          if ((direction === 'toBN') !== (b.group === 'bn')) continue;
          const departure = base + dep, arrival = base + arr;
          if (departure < reference - 7200 || departure > end + 3600) continue;
          const row = { id: `${op}-${iso}-${tid}-${from}-${to}`, operator: op, tripId: tid,
            serviceDate: iso, line: data.routes[rid].line, routeId: rid, headsign,
            routePageUrl: operatorPage(op, data.routes[rid].line, data.routes[rid], headsign),
            stopPageUrl: stopPage(op, a),
            origin: { id: from, ...a }, destination: { id: to, ...b },
            originSequence: fromSeq, destinationSequence: toSeq,
            departure, departureLatest: departure, arrival, arrivalLatest: arrival,
            scheduledDeparture: departure, scheduledArrival: arrival,
            ride: arrival - departure, quality: 'scheduled', arrivalApprox: false,
            detail: 'Published GTFS timetable. No live prediction has been applied to this departure.' };
          rows.push(op === 'delijn' && live ? applyDeLijn(row, live.providers?.delijn, now) : row);
        }
      }
    }
    if (live) rows = applySTIB(rows, live.providers?.stib, now);
    return [...new Map(rows.filter(r => !r.passed && r.departure >= reference && r.departure <= end).map(r=>[r.id,r])).values()];
  }
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = (h + l - 7 * m + 114) % 31 + 1;
    return `${y}-${pad(month)}-${pad(day)}`;
  }
  function holiday(iso) {
    const y = +iso.slice(0, 4), suffix = iso.slice(5), e = easter(y);
    return ['01-01', '05-01', '07-21', '08-15', '11-01', '11-11', '12-25'].includes(suffix) ||
      [1, 39, 50].some(n => shiftDate(e, n) === iso);
  }
  const MORNING = ['05:30', '05:40', '05:50', '06:00', '06:10', '06:20', '06:30', '06:40', '06:50', '07:00',
    '09:35', '09:45', '09:55', '10:05', '10:20', '10:35', '10:50', '11:05', '11:20', '11:30', '11:40', '11:50'];
  const AFTERNOON = ['14:05', '14:15', '14:30', '14:45', '15:00', '15:10', '15:20', '15:30', '15:37', '15:44', '15:53', '15:58',
    '18:40', '18:50', '19:05', '19:15', '19:30', '19:45', '20:00', '20:20', '20:40', '21:00', '21:20', '21:40', '22:00'];
  // User-approved assumption: an anchored eight-minute headway grid, clipped
  // to the PDF's peak windows. Do not reset the grid at each clock hour.
  function peakTimes(start, finish) {
    const minutes = t => t.split(':').map(Number).reduce((h, m) => h * 60 + m);
    const times = [];
    for (let t = minutes(start); t <= minutes(finish); t += 8) times.push(`${pad(Math.floor(t / 60))}:${pad(t % 60)}`);
    return times;
  }
  const MORNING_PEAK = peakTimes('07:00', '09:30');
  const AFTERNOON_PEAK = peakTimes('16:00', '18:30');
  // Lunchtime row confirmed by the user as TNT departures.
  const LUNCH = ['12:05', '12:20', '12:35', '12:50', '13:05', '13:20', '13:35', '13:50'];
  const RIDE_SECONDS = 7 * 60; // user assumption from 2026-09-07: TNT ↔ BN is 7 minutes
  const ROGIER_EXTRA_SECONDS = 3 * 60; // lunch trips continue: BN + 3 minutes
  function shuttleRows(reference, direction, horizon = 120) {
    const end = reference + horizon * 60, result = [], seen = new Set();
    for (let iso = dateISO(reference); iso <= dateISO(end); iso = shiftDate(iso, 1)) {
      if (iso.slice(0, 4) !== '2026' || [0, 6].includes(dow(iso)) || holiday(iso)) continue;
      const reverse = direction === 'toBN';
      const origin = { id: reverse ? 'tnt-shuttle' : 'bn-shuttle', group: reverse ? 'shuttle' : 'bn', name: reverse ? 'Tour & Taxis shuttle' : 'Brussels North shuttle', code: 'T&T' };
      const destination = { id: reverse ? 'bn-shuttle' : 'tnt-shuttle', group: reverse ? 'bn' : 'shuttle', name: reverse ? 'Brussels North shuttle' : 'Tour & Taxis shuttle', code: 'T&T' };
      function fixed(clock, shift = 0, { assumedPeak = false, lunch = false } = {}) {
        const baseDeparture = wallEpoch(iso, clock);
        const departure = baseDeparture + shift * 60;
        const id = `shuttle-${iso}-${departure}`;
        if (departure < reference || departure > end || seen.has(id)) return;
        seen.add(id);
        const quality = assumedPeak ? 'assumed' : lunch ? 'confirmed' : shift ? 'derived' : 'scheduled';
        let detail;
        if (assumedPeak) {
          detail = 'Exact departure generated from your assumed eight-minute peak grid, not an exact time published in the PDF and not live-tracked. ' +
            (shift ? (reverse ? 'The morning grid starts at 07:00 from BN; TNT departures use that grid plus 7 minutes. ' :
              'BN departures use that grid plus 7 minutes, after the listed TNT start. ') :
              reverse ? 'The afternoon TNT grid starts at 16:00. ' : 'The morning BN grid starts at 07:00. ') +
            'Arrival adds your 7-minute ride estimate. Traffic or irregular operation can change both times.';
        } else if (lunch) {
          detail = 'You confirmed the lunchtime row starts at TNT (12:05–13:50). BN is 7 minutes after the TNT departure and Rogier 3 minutes after BN, both from your assumptions. Not live-tracked.';
        } else if (shift) {
          detail = (reverse ? 'Morning TNT departure = listed BN departure + 7 minutes, using your return-trip rule. ' :
            'Lunch/afternoon BN departure = listed TNT start + 7 minutes, using your return-trip rule. ') +
            'Not live-tracked. Ride time: 7 minutes, supplied by you.';
        } else {
          detail = 'Departure transcribed from the 2026 shuttle PDF. The 7-minute ride is supplied by you; arrival is approximate. Staff-only service.';
        }
        result.push({ id, operator: 'shuttle', line: 'T&T', origin, destination,
          headsign: lunch ? 'Rogier (via Brussels North)' : reverse ? 'Brussels North' : 'Tour & Taxis',
          serviceDate: iso, departure, departureLatest: departure,
          arrival: departure + RIDE_SECONDS, arrivalLatest: departure + RIDE_SECONDS,
          ride: RIDE_SECONDS, baseDeparture, publishedDeparture: assumedPeak ? null : baseDeparture,
          quality, assumedPeak, lunch, returnOffset: shift,
          rogierArrival: lunch ? departure + RIDE_SECONDS + ROGIER_EXTRA_SECONDS : null,
          arrivalApprox: true, staffOnly: true, detail });
      }
      // Add published points first so 07:00 (and its 07:07 TNT return) does not
      // appear twice where the PDF's fixed list overlaps the assumed peak grid.
      MORNING.forEach(t => fixed(t, reverse ? 7 : 0));
      MORNING_PEAK.forEach(t => fixed(t, reverse ? 7 : 0, { assumedPeak: true }));
      if (reverse) {
        LUNCH.forEach(t => fixed(t, 0, { lunch: true }));
        AFTERNOON.forEach(t => fixed(t));
        AFTERNOON_PEAK.forEach(t => fixed(t, 0, { assumedPeak: true }));
      } else {
        // Your +7 rule: lunch and afternoon BN returns leave BN 7 minutes after
        // the TNT start (lunch 12:12–13:57, afternoon 14:12 … 22:07).
        LUNCH.forEach(t => fixed(t, 7));
        AFTERNOON.forEach(t => fixed(t, 7));
        AFTERNOON_PEAK.forEach(t => fixed(t, 7, { assumedPeak: true }));
      }
    }
    return result.sort((a, b) => a.departure - b.departure);
  }
  function shuttleStatus(reference, direction) {
    const iso = dateISO(reference), t = hhmm(reference);
    if (iso.slice(0, 4) !== '2026') return { title: '2026 timetable only', note: 'No confirmed shuttle timetable for this year.', kind: 'warning' };
    if ([0, 6].includes(dow(iso))) return { title: 'Weekdays only', note: 'The staff shuttle is not listed for weekends.', kind: 'closed' };
    if (holiday(iso)) return { title: 'Holiday service unconfirmed', note: 'Public-holiday operation is not specified in the PDF.', kind: 'warning' };
    if (direction === 'toBN' && t >= '12:00' && t < '14:05') return { title: 'Lunch departs from TNT', note: 'TNT departures confirmed by you; BN is 7 minutes later, Rogier 3 minutes after BN.', kind: 'confirmed' };
    if (direction === 'toBN' && t > '22:00') return { title: 'Finished for today', note: '22:00 is the stated last TNT departure; its BN return leaves at 22:07.', kind: 'closed' };
    return { title: 'Staff shuttle', note: '7-minute ride · timetable + your peak-grid assumption, not live-tracked.', kind: 'scheduled' };
  }
  function walkingEnabled(settings) {
    if (!settings.walking?.profiles) return false;
    return (settings.direction || 'toBN') === 'toBN' ? Boolean(settings.includeWalking) : Boolean(settings.includeReturnWalk ?? settings.includeWalking);
  }
  function applyWalking(rows, settings) {
    const active = walkingEnabled(settings), profiles = settings.walking?.profiles || {};
    const inbound = (settings.direction || 'toBN') === 'toBN', reference = settings.reference;
    const result = [];
    for (const original of rows) {
      const row = {...original, direction: settings.direction || 'toBN'};
      const shuttlePin = profiles.shuttle;
      if (row.operator === 'shuttle' && shuttlePin) {
        for (const endpoint of ['origin','destination']) if (row[endpoint].id === 'tnt-shuttle') row[endpoint] = {...row[endpoint],lat:shuttlePin.lat,lon:shuttlePin.lon,locationSource:'User-provided shuttle pin'};
      }
      const profile = profiles[(inbound ? row.origin : row.destination).group];
      if (active && !(Number.isFinite(profile?.minutes) && profile.minutes >= 0)) continue;
      const walkMinutes = active ? profile.minutes : 0;
      const before = inbound ? walkMinutes*60 : 0, after = inbound ? 0 : walkMinutes*60;
      const readyAt = reference + before;
      if (row.departure < readyAt) continue;
      Object.assign(row, {walkingActive:active,walkMinutes,walkSeconds:walkMinutes*60,
        walkBeforeSeconds:before,walkAfterSeconds:after,walkBeforeMinutes:before/60,walkAfterMinutes:after/60,
        walkReadyAt:readyAt,leaveHomeBy:inbound && active ? row.departure-before : null,
        homeArrival:!inbound && active ? row.arrival+after : null,
        journeyStart:row.departure-before,journeyArrival:row.arrival+after,
        journeyArrivalLatest:row.arrivalLatest+after,
        waitAfterWalk:Math.max(0,row.departure-readyAt),walkReference:active?{...profile}:null,
        totalJourneySeconds:row.arrival+after-reference});
      result.push(row);
    }
    return result;
  }
  const localStop = row => row.origin.group === 'bn' ? row.destination : row.origin;
  const finalArrival = row => row.journeyArrivalLatest ?? row.arrivalLatest ?? row.arrival;
  const latestStart = row => row.journeyStart ?? row.leaveHomeBy ?? row.departure;
  function operatorPriority(row, direction = row.destination?.group === 'bn' ? 'toBN' : 'toTNT') {
    if (row.operator === 'shuttle') return 0;
    if (direction === 'toBN') return row.operator === 'delijn' ? 1 : row.line === '88' ? 3 : 2;
    return row.operator === 'delijn' ? 3 : row.line === '88' ? 2 : 1;
  }
  function preferredStops(rows, settings) {
    const order = (settings.direction || 'toBN') === 'toBN' && !settings.includeWalking ? ['suzan','picard','thurn','shuttle'] : ['picard','suzan','thurn','shuttle'];
    const rank = r => {const n=order.indexOf(localStop(r).group);return n<0?99:n;};
    const grouped = new Map();
    for (const row of rows) {
      // STIB waiting records have no trip IDs. Apply the explicit stop policy
      // across that line, rather than fabricating a pairing between two stops.
      const key = row.operator === 'stib' ? `stib|${row.line}|${row.serviceDate}` : `${row.operator}|${row.serviceDate}|${row.networkJourneyId || row.tripId || row.id}`;
      if (!grouped.has(key)) grouped.set(key,[]);
      grouped.get(key).push(row);
    }
    const result=[];
    for (const group of grouped.values()) {
      const usable=group.filter(r=>!r.cancelled && !r.boardingUnavailable);
      const pool=usable.length?usable:group;
      const bestGroup=localStop([...pool].sort((a,b)=>rank(a)-rank(b))[0]).group;
      result.push(...group.filter(r=>localStop(r).group===bestGroup));
    }
    return result;
  }
  function markDominated(rows) {
    // Strictly later start AND a final arrival MORE than two minutes earlier.
    // Equal arrivals are left to the user's operator preference, and an
    // arrival gap of two minutes or less keeps both options visible.
    // Cancellation is separate.
    const ARRIVAL_GAP=120;
    const ordered=[...rows].sort((a,b)=>latestStart(b)-latestStart(a));
    const marked=new Map();let best=null;
    for (let i=0;i<ordered.length;) {
      let j=i+1;while(j<ordered.length && latestStart(ordered[j])===latestStart(ordered[i]))j++;
      for(let k=i;k<j;k++) {
        const r=ordered[k], dominated=!r.cancelled && !r.boardingUnavailable && best && finalArrival(r)-finalArrival(best)>ARRIVAL_GAP;
        marked.set(r.id,{...r,dominated:Boolean(dominated),collapseEligible:Boolean(dominated)&&r.operator!=='shuttle',dominatedBy:dominated?best.id:null});
      }
      for(let k=i;k<j;k++) {const r=ordered[k];if(!r.cancelled && !r.boardingUnavailable && (!best||finalArrival(r)<finalArrival(best)))best=r;}
      i=j;
    }
    return rows.map(r=>marked.get(r.id));
  }
  function comparison(timetable, settings, live=null, now=Date.now()/1000) {
    // Keep up to one hour of previous calls while choosing a preferred stop.
    // Otherwise a passed Picard call could incorrectly turn into a Suzan option.
    const reference=settings.reference, horizon=Number(settings.horizon)||120;
    const raw=allRows(timetable,{...settings,reference:reference-3600,horizon:horizon+60,includeWalking:false,includeReturnWalk:false},live,now);
    const filtered=raw.filter(r=>(!settings.operator||settings.operator==='all'||r.operator===settings.operator) && (!settings.stop||settings.stop==='all'||localStop(r).group===settings.stop));
    const selected=preferredStops(filtered,settings);
    const reachable=applyWalking(selected,settings).filter(r=>r.departure<=reference+horizon*60);
    return {rows:filterRows(markDominated(reachable),settings),stopAlternativesRemoved:filtered.length-selected.length,
      unreachableRemoved:selected.length-reachable.length,reference};
  }
  function allRows(timetable, settings, live = null, now = Date.now() / 1000) {
    const { reference, direction = 'toBN', horizon = 120, includeShuttle = true, mode = 'now' } = settings;
    const list = busRows(timetable, reference, direction, horizon, mode === 'now' ? live : null, now);
    if (includeShuttle) list.push(...shuttleRows(reference, direction, horizon));
    return settings.walking ? applyWalking(list, settings) : list;
  }
  const DEFAULT_TRAIN_MARGIN = 5;
  function planForTrain(timetable, settings, live = null, now = Date.now() / 1000) {
    const trainDeparture = Number(settings.trainDeparture);
    const suppliedMargin = Number(settings.stationMargin ?? DEFAULT_TRAIN_MARGIN);
    const stationMargin = Number.isFinite(suppliedMargin) ? Math.max(0, Math.min(60, suppliedMargin)) : DEFAULT_TRAIN_MARGIN;
    const lookback = Math.max(30, Math.min(240, Number(settings.horizon) || 120));
    if (!Number.isFinite(trainDeparture)) return {rows: [], reference: now, deadline: null, usesLive: false, stationMargin};
    const deadline = trainDeparture - stationMargin * 60;
    const sameDay = dateISO(trainDeparture) === dateISO(now);
    const historical = dateISO(trainDeparture) < dateISO(now);
    const usesLive = sameDay && trainDeparture >= now && trainDeparture <= now + 4 * 3600;
    const reference = Math.max(deadline - lookback * 60, sameDay || historical ? now : -Infinity);
    const horizon = Math.max(0, (deadline - reference) / 60);
    if (deadline < reference) return {rows: [], reference, deadline, usesLive, stationMargin, trainDeparture};
    const candidates = comparison(timetable, {...settings, direction:'toBN', reference, horizon, mode:usesLive?'now':'plan'}, live, now).rows;
    const rows = candidates.filter(r => !r.cancelled && !r.boardingUnavailable && r.arrivalLatest <= deadline).map(r => {
      const journeyStart = r.walkingActive ? r.leaveHomeBy : r.departure;
      return {...r, trainPlan: true, trainDeparture, stationMargin, deadline, journeyStart,
        // With the latest possible home start, waiting is at BN, not before the bus.
        queryReference: reference, walkReadyAt: r.departure, waitAfterWalk: 0,
        totalJourneySeconds: r.arrival - journeyStart,
        stationWaitSeconds: trainDeparture - r.arrival,
        extraMarginSeconds: deadline - r.arrivalLatest};
    });
    return {rows: filterRows(rows, {sort: 'latestStart'}), reference, deadline, usesLive, stationMargin, trainDeparture};
  }
  function filterRows(rows, {operator='all',stop='all',sort='arrival',direction} = {}) {
    return rows.filter(r=>(operator==='all'||r.operator===operator) && (stop==='all'||localStop(r).group===stop))
      .sort((a,b)=>(a.cancelled||a.boardingUnavailable?1:0)-(b.cancelled||b.boardingUnavailable?1:0) ||
        (sort==='latestStart' ? latestStart(b)-latestStart(a) : sort==='departure' ? a.departure-b.departure : finalArrival(a)-finalArrival(b)) ||
        operatorPriority(a,direction)-operatorPriority(b,direction) ||
        (sort==='latestStart' ? finalArrival(a)-finalArrival(b) : latestStart(b)-latestStart(a)) ||
        a.line.localeCompare(b.line,'en',{numeric:true}));
  }
  const api = { ZONE, parts, dateISO, hhmm, wallEpoch, serviceBase, shiftDate, dateKey, dateFromKey,
    dow, activeServices, fresh, eventTime, operatorPage, stopPage, timingStatus, roundMinuteDelta, occupancyInfo, STIB_WEB_DIRECTIONS, comparison, preferredStops, markDominated, operatorPriority, finalArrival, latestStart, busRows, shuttleRows, shuttleStatus, allRows, filterRows, walkingEnabled, applyWalking, planForTrain, DEFAULT_TRAIN_MARGIN,
    holiday, easter, MORNING, AFTERNOON, MORNING_PEAK, AFTERNOON_PEAK, LUNCH, RIDE_SECONDS, ROGIER_EXTRA_SECONDS, peakTimes, applyDeLijn, applyDeLijnStop, directDeLijnRecord, matchSTIBSchedules, applySTIB };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CommuteEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
