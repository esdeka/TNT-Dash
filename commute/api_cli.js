'use strict';
/** JSON-in / JSON-out bridge used by server.py.
 * Keep the timetable, walks, cancellation/freshness rules and ranking in the
 * SAME engine as the browser. No parallel Python routing implementation.
 * This process performs zero network requests. Node 20+ is required by /api/next.
 */
const fs = require('node:fs');
const path = require('node:path');
const E = require('./static/engine.js');
const D = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/timetable.json'), 'utf8'));
const W = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/walking.json'), 'utf8'));
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const q = input.query || {};
const now = Number(input.now) || Date.now() / 1000;
const iso = value => Number.isFinite(value) ? new Date(value * 1000).toISOString() : null;
const reference = q.date && q.time ? E.wallEpoch(q.date, q.time) : now;
const settings = {reference, direction: q.direction || 'toBN', mode: q.date ? 'plan' : 'now',
  horizon: Number(q.horizon) || 240, includeShuttle: q.shuttle !== '0',
  includeWalking: q.walking !== '0', includeReturnWalk: q.walking !== '0', walking: W, operator:q.operator || 'all', stop:q.stop || 'all'};
let rows, trainPlan = null;
if (input.action === 'train') {
  trainPlan = E.planForTrain(D, {...settings, trainDeparture: reference,
    stationMargin: q.margin === undefined ? E.DEFAULT_TRAIN_MARGIN : Number(q.margin)}, input.live, now);
  rows = trainPlan.rows;
} else rows = E.comparison(D, settings, input.live, now).rows;
rows = rows.filter(r => !r.cancelled && !r.boardingUnavailable);
const sort = trainPlan ? 'latestStart' : 'arrival';
const filtered = E.filterRows(rows, {operator: q.operator || 'all', stop: q.stop || 'all', sort});
function pack(row) {
  if (!row) return null;
  return {id:row.id, operator: row.operator, line: row.line, headsign: row.headsign, route_page_url: row.routePageUrl || null,
    origin: {id: row.origin.id, name: row.origin.name, group: row.origin.group},
    destination: {id: row.destination.id, name: row.destination.name, group: row.destination.group},
    departure: iso(row.departure), arrival: iso(row.arrival),
    leave_home_at: iso(row.leaveHomeBy), home_arrival:iso(row.homeArrival), journey_arrival:iso(row.journeyArrival ?? row.arrival),
    walk_before_minutes:row.walkBeforeMinutes||0,walk_after_minutes:row.walkAfterMinutes||0,walk_minutes: row.walkMinutes || 0,
    scheduled_departure:iso(row.scheduledDeparture),scheduled_arrival:iso(row.scheduledArrival),
    departure_delay_seconds:E.timingStatus(row).delta,arrival_delay_seconds:E.timingStatus(row,'arrival').delta,
    dominated:Boolean(row.dominated),collapse_eligible:Boolean(row.collapseEligible),dominated_by:row.dominatedBy||null,occupancy:row.occupancy||null,
    delay_estimated:Boolean(row.delayEstimated),arrival_delay_estimated:Boolean(row.arrivalDelayEstimated||row.delayEstimated),
    schedule_match_method:row.scheduleMatchMethod||null,live_source:row.liveSource||null,vehicle_id:row.vehicleId||null,
    ride_minutes: row.ride / 60, total_minutes: row.totalJourneySeconds / 60,
    minutes_until_leave_home: Number.isFinite(row.leaveHomeBy) ? Math.max(0, Math.ceil((row.leaveHomeBy-now)/60)) : null,
    quality: row.quality, live: row.quality === 'live', arrival_estimated: Boolean(row.arrivalApprox || row.quality === 'live'),
    staff_only: Boolean(row.staffOnly), note: row.note || '',
    ...(row.trainPlan ? {train_departure: iso(row.trainDeparture), arrive_by: iso(row.deadline),
      station_margin_minutes: row.stationMargin, station_wait_minutes: row.stationWaitSeconds/60} : {})};
}
const nextByOperator = {}, bestByOperator = {};
for (const op of ['shuttle','stib','delijn']) {
  const group = rows.filter(r => r.operator === op && (q.stop === undefined || q.stop === 'all' || r.origin.group === q.stop || r.destination.group === q.stop));
  nextByOperator[op] = pack(E.filterRows(group, {sort: 'departure'})[0]);
  bestByOperator[op] = pack(E.filterRows(group, {sort})[0]);
}
const providerStatus = Object.fromEntries(['stib','delijn'].map(op => {
  const p = input.live?.providers?.[op];
  return [op, {fresh: E.fresh(p, now), fetched_at: iso(p?.fetchedAt),
    error: p?.error || null, feed_time: iso(p?.feedTime)}];
}));
process.stdout.write(JSON.stringify({schema_version: 1, generated_at: iso(now), reference: iso(reference),
  timezone: E.ZONE, direction: trainPlan ? 'toBN' : settings.direction,
  walking_included: E.walkingEnabled({...settings, direction: trainPlan ? 'toBN' : settings.direction}),
  window_minutes: trainPlan ? Math.min(240, settings.horizon) : settings.horizon, count: filtered.length,
  recommendation: pack(filtered[0]), next_by_operator: nextByOperator, best_by_operator: bestByOperator,
  options: filtered.slice(0, Math.min(20, Math.max(1, Number(q.limit) || 5))).map(pack),
  providers: providerStatus, access: input.live?.access || {mode:'anonymous',autoRefreshAllowed:false}, upstream_requests_made: 0,
  timetable_coverage: Object.fromEntries(Object.entries(D.operators).map(([op,d]) => [op,{start:d.feedStart,end:d.feedEnd,version:d.feedVersion,fetched_at:d.fetchedAt}])),
  ...(trainPlan ? {train_plan: {scheduled_departure: iso(reference), arrive_by: iso(trainPlan.deadline),
    margin_minutes: trainPlan.stationMargin, live_bus_updates_applied_when_fresh: trainPlan.usesLive,
    objective: 'latest start that reaches BN before the transfer deadline'}} : {})}));
