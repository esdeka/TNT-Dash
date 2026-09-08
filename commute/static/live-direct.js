/* Direct-to-operator live access for the standalone build (no web server).
   Mirrors server.py / delijn_live.py / rail.py behaviour: STIB waiting times
   and De Lijn real-time via Belgian Mobility (anonymous discovery gateway, or
   the registered gateway with your embedded key), the separate De Lijn stop
   API when its key is embedded, and the iRail Brussels North departure board.
   CORS was verified for all four gateways on 2026-09-07. State and quotas
   persist in localStorage, so refresh allowances survive reloads like the
   server cache.

   Key resolution, strongest first: (1) keys typed into this browser
   (Reference → API keys, stored in localStorage), (2) a sibling
   Dashboard-secrets.js next to Dashboard.html (window.COMMUTE_SECRETS,
   loaded with a plain script tag so it also works on file://), (3) keys
   embedded at build time. Without any key the anonymous gateways are used. */
window.CommuteLiveDirect = (() => {
  'use strict';
  const ANONYMOUS_BASE = 'https://api-management-discovery-production.azure-api.net/api/';
  const REGISTERED_BASE = 'https://api-management-opendata-production.azure-api.net/api/';
  const DL_BASE = 'https://api.delijn.be/DLKernOpenData/api/v1/';
  const IRAIL_ENDPOINT = 'https://api.irail.be/liveboard/';
  const STATION_ID = 'BE.NMBS.008812005';
  const FEED_PATHS = { stib: 'datasets/stibmivb/rt/WaitingTimes', delijn: 'gtfs/feed/delijn/rt/trip-update' };
  const TTL = 60, STALE_AFTER = 120;
  const MINUTE_LIMIT = 4, DL_DAILY_LIMIT = 10000;
  const MANUAL_STORE = 'commute.keys.v1';
  function manualKeys() { try { const v = localStorage.getItem(MANUAL_STORE); return v ? (JSON.parse(v) || {}) : {}; } catch { return {}; } }
  function resolveKeys() {
    const manual = manualKeys(), file = window.COMMUTE_SECRETS || {}, embedded = window.COMMUTE_KEYS || {}, out = {};
    for (const k of ['bmc', 'delijn']) {
      const m = String(manual[k] || '').trim(), f = String(file[k] || '').trim(), e = String(embedded[k] || '').trim();
      out[k] = m || f || e;
      out[k + 'Source'] = m ? 'browser storage' : f ? 'secrets file' : e ? 'page build' : 'anonymous';
    }
    return out;
  }
  const modeOf = K => K.bmc ? 'registered' : 'anonymous';
  const dailyLimitOf = K => K.bmc ? 10000 : 80;
  const endpointFor = (K, op) => (K.bmc ? REGISTERED_BASE : ANONYMOUS_BASE) + FEED_PATHS[op];
  const mask = v => v.length > 6 ? v.slice(0, 4) + '…' + v.slice(-2) : '…';
  function keyStatus() {
    const K = resolveKeys();
    return { available: true,
      bmc: K.bmc ? mask(K.bmc) : '', bmcSource: K.bmcSource,
      delijn: K.delijn ? mask(K.delijn) : '', delijnSource: K.delijnSource,
      secretsFileSeen: Boolean((window.COMMUTE_SECRETS || {}).bmc || (window.COMMUTE_SECRETS || {}).delijn),
      storeKey: MANUAL_STORE };
  }
  function setKeys(keys) {
    const k = { bmc: String(keys && keys.bmc || '').trim(), delijn: String(keys && keys.delijn || '').trim() };
    if (k.bmc || k.delijn) store.set(MANUAL_STORE, k); else clearKeys();
    return k;
  }
  function clearKeys() { try { localStorage.removeItem(MANUAL_STORE); } catch { /* sandboxed: nothing to remove */ } }
  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: in-memory only */ } }
  };
  const STATE_KEY = 'commute.direct.state.v3', QUOTA_KEY = 'commute.direct.quota.v3', TRAIN_KEY = 'commute.direct.trains.v1';
  let dataCache = null;
  const DATA = () => { if (!dataCache) dataCache = JSON.parse(document.getElementById('timetable-data').textContent); return dataCache; };
  const nowSeconds = () => Date.now() / 1000;

  function accessInfo() {
    const K = resolveKeys();
    return { mode: modeOf(K), keyConfigured: Boolean(K.bmc), autoRefreshAllowed: Boolean(K.bmc),
             dailyLimit: dailyLimitOf(K), minuteLimit: MINUTE_LIMIT,
             delijnStopKeyConfigured: Boolean(K.delijn), delijnSource: K.delijn ? 'stop-api' : 'bmc-gtfs-rt',
             delijnDailyLimit: K.delijn ? DL_DAILY_LIMIT : null };
  }
  function readState() {
    const s = store.get(STATE_KEY, { providers: {}, lastAttempt: 0 });
    return { providers: s.providers || {}, lastAttempt: s.lastAttempt || 0, accessMode: s.accessMode, delijnSource: s.delijnSource };
  }
  function writeState(s) { store.set(STATE_KEY, s); }
  function readQuota() {
    const q = store.get(QUOTA_KEY, {});
    const buckets = typeof q.buckets === 'object' && q.buckets ? q.buckets : {};
    return { version: 3, buckets: ['anonymous', 'registered', 'delijn_stop']
      .map(name => [name, { calls: (buckets[name] && Array.isArray(buckets[name].calls) ? buckets[name].calls : []) }])
      .reduce((acc, [name, b]) => (acc[name] = b, acc), {}) };
  }
  function writeQuota(q) { store.set(QUOTA_KEY, q); }
  function prune(bucket, now) { bucket.calls = bucket.calls.filter(t => Number.isFinite(t) && t > now - 86400); }

  function longNumber(v) { // MessageToDict longs may be {low,high} pairs; JSON API already gives numbers.
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'object') return (Number(v.high) || 0) * 0x100000000 + (Number(v.low) >>> 0);
    const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  function isoToEpoch(value) { // server: datetime.fromisoformat with Z→+00:00
    if (typeof value !== 'string' || !/[T ]\d{2}:\d{2}/.test(value)) return null;
    const ms = Date.parse(value.replace(' ', 'T'));
    return Number.isNaN(ms) ? null : ms / 1000;
  }

  function normalizeStib(body, fetchedAt) {
    const d = DATA().operators.stib;
    if (!body || typeof body !== 'object' || !Array.isArray(body.results)) throw new Error('Unexpected STIB waiting-time response');
    const records = [], lines = new Set(Object.values(d.routes).map(v => v.line));
    for (const row of body.results) {
      if (!(row.pointid in d.stops) || !lines.has(row.lineid)) continue;
      let pts = row.passingtimes || [];
      if (typeof pts === 'string') pts = JSON.parse(pts);
      for (const p of pts) {
        const destination = p.destination;
        // End-of-service sentinel rows have no destination and are NOT departures.
        if (!destination || typeof destination !== 'object' || !Object.keys(destination).length || !p.expectedArrivalTime) continue;
        const msg = p.message;
        if (msg && (JSON.stringify(msg).toLowerCase().includes('end of service') || JSON.stringify(msg).toLowerCase().includes('service terminé'))) continue;
        const time = isoToEpoch(p.expectedArrivalTime);
        if (time === null) continue;
        records.push({ stop: row.pointid, line: p.lineId || row.lineid, destination, time,
                       message: msg && typeof msg === 'object' ? (msg.en || '') : String(msg || '') });
      }
    }
    return { ok: true, fetchedAt, feedTime: null,
             timestampNote: 'STIB does not expose a feed-generation timestamp here; time shown is the fetch time.',
             records, source: endpointFor(resolveKeys(), 'stib') };
  }
  function normalizeDelijnGtfs(body, fetchedAt) {
    const d = DATA().operators.delijn;
    if (!body || typeof body !== 'object' || !('header' in body)) throw new Error('Unexpected De Lijn trip-update response');
    const updates = {};
    for (const e of body.entity || []) {
      const u = e.tripUpdate || e.trip_update || {}, trip = u.trip || {};
      const tid = trip.tripId || trip.trip_id;
      if (!(tid in d.trips)) continue;
      const relevant = [];
      for (const call of u.stopTimeUpdate || u.stop_time_update || []) {
        const sid = call.stopId || call.stop_id;
        if (!(sid in d.stops)) continue;
        const rec = { stop: sid, seq: call.stopSequence ?? call.stop_sequence,
                      relationship: call.scheduleRelationship ?? call.schedule_relationship ?? 0 };
        const occupancy = call.departureOccupancyStatus ?? call.departure_occupancy_status;
        if (occupancy !== undefined && occupancy !== null) rec.occupancyStatus = occupancy;
        for (const event of ['arrival', 'departure']) if (call[event]) {
          const ev = call[event], item = {};
          if ('time' in ev) item.time = longNumber(ev.time);
          if ('delay' in ev) item.delay = longNumber(ev.delay);
          rec[event] = item;
        }
        relevant.push(rec);
      }
      updates[tid] = { date: trip.startDate || trip.start_date,
                       relationship: trip.scheduleRelationship ?? trip.schedule_relationship ?? 0,
                       timestamp: longNumber(u.timestamp), stops: relevant };
    }
    return { ok: true, fetchedAt, feedTime: longNumber((body.header || {}).timestamp), trips: updates, source: endpointFor(resolveKeys(), 'delijn') };
  }
  function statusValues(value) {
    if (Array.isArray(value)) return new Set(value.map(x => String(x).toUpperCase()));
    if (typeof value === 'string') return new Set((value.toUpperCase().match(/[A-Z]+/g)) || []);
    return new Set();
  }
  function normalizeDelijnStop(body, fetchedAt) {
    if (!body || typeof body !== 'object' || !('halteDoorkomstenLijst' in body) && !('halteDoorkomsten' in body))
      throw new Error('Unexpected De Lijn stop API response');
    const allowed = new Set(Object.keys(DATA().operators.delijn.stops).map(s => s.replace('gs:delijn:', '')));
    const blocks = 'halteDoorkomstenLijst' in body ? body.halteDoorkomstenLijst : [body];
    if (!Array.isArray(blocks)) throw new Error('Unexpected De Lijn stop list');
    let records = [], rejected = 0, total = 0;
    for (const block of blocks) for (const group of block.halteDoorkomsten || []) {
      const groupStop = String(group.haltenummer || '');
      for (const call of group.doorkomsten || []) {
        const stop = String(call.haltenummer || groupStop);
        if (!allowed.has(stop)) continue;
        total += 1;
        const planned = isoToEpoch(call.dienstregelingTijdstip);
        const actual = isoToEpoch(call.doorkomstTijdstip || call['real-timeTijdstip']);
        if (planned === null) { rejected += 1; continue; }
        const statuses = statusValues(call.predictionStatussen);
        const passageId = String(call.doorkomstId || '');
        const match = passageId.match(/^(\d{4}-\d{2}-\d{2})_(\d+)_(\d+)_/);
        const cancelled = ['CANCELLED', 'CANCELED'].includes(String(call.status || '').toUpperCase()) || statuses.has('GESCHRAPT');
        records.push({ stop: 'gs:delijn:' + stop, id: passageId,
          journeyId: match ? `${match[1]}_${match[2]}_${match[3]}` : null,
          lineCode: match ? match[2] : null,
          lineNumber: String(call.lijnnummer || ''), entity: String(call.entiteitnummer || '3'),
          journeyNumber: match ? match[3] : String(call.ritnummer || ''),
          serviceDate: match ? match[1] : null,
          planned, expected: statuses.has('REALTIME') ? actual : null,
          realtime: statuses.has('REALTIME') && actual !== null,
          cancelled, passed: statuses.has('VERSTREKEN'),
          vehicleId: String(call.vrtnum || ''),
          destination: call.bestemmingKort || call.bestemming || '',
          statuses: [...statuses].sort() });
      }
    }
    if (total && !records.length) throw new Error('No usable date/time values in De Lijn stop response');
    const seen = new Set(); records = records.filter(r => { const k = JSON.stringify(r); if (seen.has(k)) return false; seen.add(k); return true; });
    return { ok: true, kind: 'stop-api', fetchedAt, feedTime: null,
             source: DL_BASE + 'haltes/lijst/{configured-stop-keys}/real-time',
             records, recordCount: records.length, liveRecordCount: records.filter(r => r.realtime).length,
             rejectedRecords: rejected, timestampNote: 'Age is measured from the stop API retrieval time.' };
  }
  async function fetchJson(url, headers, maxBytes = 25 * 1024 * 1024) {
    const response = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) {
      const body = (await response.text().catch(() => '')).slice(0, 2048).toLowerCase();
      const err = new Error('HTTP ' + response.status); err.status = response.status; err.body = body; throw err;
    }
    const buf = await response.arrayBuffer();
    if (buf.byteLength > maxBytes) throw new Error('Response too large');
    return JSON.parse(new TextDecoder().decode(buf));
  }
  async function fetchProvider(op) {
    const K = resolveKeys(), delijnKey = K.delijn;
    if (op === 'delijn' && delijnKey) {
      try {
        const codes = [...new Set(Object.keys(DATA().operators.delijn.stops).map(s => s.replace('gs:delijn:', '')))].sort();
        if (!codes.length || codes.length > 20 || codes.some(s => !/^3\d{5}$/.test(s))) throw new Error('Only the configured Brussels corridor stops are supported');
        const keys = codes.map(c => '3_' + c).join('_');
        const body = await fetchJson(DL_BASE + 'haltes/lijst/' + keys + '/real-time?maxAantalDoorkomsten=50', { 'Ocp-Apim-Subscription-Key': delijnKey }, 6 * 1024 * 1024);
        return [op, normalizeDelijnStop(body, nowSeconds())];
      } catch (e) {
        const kind = e.status === 401 || e.status === 403 ? 'authentication' : e.status === 429 ? 'quota' : e.status ? 'upstream' : 'network';
        const message = kind === 'authentication' ? 'De Lijn stop API rejected access; check the separate De Lijn subscription key.'
          : kind === 'network' ? 'De Lijn stop real-time unavailable or response not usable; timetable fallback.'
          : 'De Lijn stop real-time unavailable; timetable fallback.';
        return [op, { ok: false, kind: 'stop-api', attemptedAt: nowSeconds(), errorKind: kind, error: message }];
      }
    }
    try {
      const headers = K.bmc ? { 'Ocp-Apim-Subscription-Key': K.bmc } : {};
      const body = await fetchJson(endpointFor(K, op), headers);
      return [op, op === 'stib' ? normalizeStib(body, nowSeconds()) : normalizeDelijnGtfs(body, nowSeconds())];
    } catch (e) {
      let kind, message;
      if (e.status === 429 || (e.body || '').includes('quota')) { kind = 'quota'; message = 'Operator quota reached; using the timetable.'; }
      else if ((e.status === 401 || e.status === 403) && K.bmc) { kind = 'authentication'; message = 'Registered API access was rejected; check the subscription/key. No anonymous fallback was attempted.'; }
      else if (e.status) { kind = 'upstream'; message = `Operator feed returned HTTP ${e.status}; using the timetable.`; }
      else { kind = 'network'; message = 'Live feed temporarily unavailable; using the timetable.'; }
      return [op, { ok: false, attemptedAt: nowSeconds(), errorKind: kind, error: message }];
    }
  }
  function payload(state, notice) {
    const K = resolveKeys(), mode = modeOf(K), daily = dailyLimitOf(K);
    const quota = readQuota(), now = nowSeconds();
    for (const b of Object.values(quota.buckets)) prune(b, now);
    const calls = quota.buckets[mode].calls, dlCalls = quota.buckets.delijn_stop.calls, bmcCost = K.delijn ? 1 : 2;
    return { ...state, serverTime: now, staleAfter: STALE_AFTER, access: accessInfo(),
      quota: { mode, used: calls.length, limit: daily,
               refreshesLeft: Math.max(0, Math.min(Math.floor((daily - calls.length) / bmcCost), K.delijn ? DL_DAILY_LIMIT - dlCalls.length : daily)),
               bmcCallsPerRefresh: bmcCost,
               delijnStop: K.delijn ? { used: dlCalls.length, limit: DL_DAILY_LIMIT, callsPerRefresh: 1 } : null,
               nextRefreshAt: (state.lastAttempt || 0) + TTL },
      notice: notice || null };
  }
  async function getLive() { // GET /api/live equivalent: shared cache only, never spends quota.
    return payload(readState(), null);
  }
  async function refresh(manual) { // POST /api/live/refresh equivalent.
    const K = resolveKeys(), mode = modeOf(K), daily = dailyLimitOf(K);
    const now = nowSeconds(), quota = readQuota();
    for (const b of Object.values(quota.buckets)) prune(b, now);
    const calls = quota.buckets[mode].calls, dlCalls = quota.buckets.delijn_stop.calls, bmcCost = K.delijn ? 1 : 2;
    const state = readState();
    let message = null, doRefresh = true;
    // Fail closed like the server: a hidden timer must not spend anonymous requests.
    if (!manual && !K.bmc) { doRefresh = false; message = 'Automatic live refresh requires an API key. Press Refresh for an anonymous manual check.'; }
    const sameAccess = (state.accessMode || 'anonymous') === mode && (state.delijnSource || 'bmc-gtfs-rt') === accessInfo().delijnSource;
    let lastAttempt = sameAccess ? (state.lastAttempt || 0) : 0;
    const age = now - lastAttempt;
    if (doRefresh && age >= TTL) {
      const recent = calls.filter(t => t > now - 60).length;
      if (calls.length + bmcCost > daily) { doRefresh = false; message = 'Daily live-refresh allowance reached. Timetable departures remain available.'; }
      else if (recent + bmcCost > MINUTE_LIMIT) { doRefresh = false; message = 'Please wait a minute before refreshing again.'; }
      else if (K.delijn && (dlCalls.length + 1 > DL_DAILY_LIMIT || dlCalls.filter(t => t > now - 60).length + 1 > MINUTE_LIMIT)) { doRefresh = false; message = 'De Lijn stop API allowance reached; using the timetable/cache.'; }
    } else if (doRefresh && age < TTL) { doRefresh = false; message = 'Showing the shared cache. Live feeds can be refreshed once a minute.'; }
    if (doRefresh) {
      for (let i = 0; i < bmcCost; i++) calls.push(now);
      if (K.delijn) dlCalls.push(now);
      writeQuota(quota);
      const results = await Promise.all([fetchProvider('stib'), fetchProvider('delijn')]);
      for (const [op, result] of results) (state.providers = state.providers || {})[op] = result;
      state.lastAttempt = now; state.accessMode = mode; state.delijnSource = accessInfo().delijnSource;
      writeState(state); lastAttempt = now;
    }
    return payload({ ...state, lastAttempt }, message);
  }

  // --- iRail Brussels North departure board (rail.py port) ---
  const trainCache = new Map();
  function validateTrainQuery(date, clock) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Use a date in YYYY-MM-DD format.');
    if (!/^\d{2}:\d{2}$/.test(clock || '')) throw new Error('Use a time in HH:MM format.');
    const year = Number(date.slice(0, 4));
    if (year < 2020 || year > 2099) throw new Error('Train-board dates must be between 2020 and 2099.');
  }
  function normalizeBoard(body, date, clock, fetchedAt) {
    const station = body.stationinfo || {};
    if (station.id !== STATION_ID) throw new Error('The provider response is not for Brussels North.');
    const departures = (body.departures || {}).departure;
    if (!Array.isArray(departures)) throw new Error('Unexpected train departure-board format.');
    const rows = [];
    for (const d of departures) {
      try {
        const scheduled = Number(d.time), delay = Number(d.delay || 0);
        const vehicle = (d.vehicleinfo || {}).shortname || String(d.vehicle || '').replace('BE.NMBS.', '');
        if (!vehicle || !(scheduled > 0)) continue;
        rows.push({
          id: d.departureConnection || `${vehicle}@${scheduled}`,
          service: vehicle, vehicleId: d.vehicle,
          destination: d.station || 'Destination not supplied',
          destinationId: (d.stationinfo || {}).id,
          scheduledDeparture: scheduled, expectedDeparture: scheduled + delay,
          delaySeconds: delay, platform: String(d.platform || '?'),
          platformChanged: String((d.platforminfo || {}).normal ?? '1') === '0',
          cancelled: String(d.canceled || '0') === '1',
          left: String(d.left || '0') === '1', source: 'irail', fetchedAt });
      } catch { /* skip malformed row */ }
    }
    return { ok: true, source: 'iRail · SNCB/NMBS train information', sourceUrl: IRAIL_ENDPOINT,
             station, date, time: clock, fetchedAt, feedTime: longNumber(body.timestamp) || Math.trunc(fetchedAt),
             departures: rows.sort((a, b) => a.scheduledDeparture - b.scheduledDeparture || a.service.localeCompare(b.service)) };
  }
  async function trains(date, clock) { // GET /api/trains equivalent; returns {status,data} like the server response.
    try { validateTrainQuery(date, clock); } catch (e) { return { status: 400, data: { ok: false, departures: [], error: e.message } }; }
    const key = date + '|' + clock, now = nowSeconds();
    const cached = trainCache.get(key);
    if (cached && now < cached.expires) return { status: cached.data.ok ? 200 : 502, data: { ...cached.data, cached: true } };
    const persisted = store.get(TRAIN_KEY, { calls: [] });
    persisted.calls = persisted.calls.filter(t => t > now - 60);
    if (persisted.calls.length >= 20 || (persisted.calls.length && now - persisted.calls[persisted.calls.length - 1] < 1))
      return { status: 429, data: { ok: false, error: 'Please wait before loading another train board.', departures: [] } };
    persisted.calls.push(now); store.set(TRAIN_KEY, persisted);
    const [dd, mm, yy] = [date.slice(8), date.slice(5, 7), date.slice(2, 4)];
    const params = new URLSearchParams({ id: STATION_ID, format: 'json', lang: 'en', arrdep: 'departure', date: dd + mm + yy, time: clock.replace(':', ''), alerts: 'false' });
    let data, ttl = 60, status = 200;
    try {
      const response = await fetch(IRAIL_ENDPOINT + '?' + params, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      const cc = response.headers.get('Cache-Control') || '', m = cc.match(/max-age=(\d+)/i);
      if (m) ttl = Math.max(60, Number(m[1]));
      if (!response.ok) { const err = new Error('HTTP ' + response.status); err.status = response.status; throw err; }
      data = normalizeBoard(await response.json(), date, clock, nowSeconds());
    } catch (e) {
      data = { ok: false, departures: [], error: e.status ? `iRail returned HTTP ${e.status}. Try another date/time, or enter the train departure manually.` : 'Train board unavailable. Try again later or enter the train departure manually.' };
      status = 502;
    }
    trainCache.set(key, { data, expires: nowSeconds() + ttl });
    if (trainCache.size > 80) trainCache.delete(trainCache.keys().next().value);
    return { status, data: { ...data, cached: false } };
  }
  return { available: true,
           get embedded() { const K = resolveKeys(); return { bmc: Boolean(K.bmc), delijn: Boolean(K.delijn) }; },
           keyStatus, setKeys, clearKeys, getLive, refresh, trains };
})();
