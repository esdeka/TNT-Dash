'use strict';
const assert = require('node:assert/strict');
const E = require('./static/engine.js');
const D = require('./data/timetable.json');
const W = require('./data/walking.json');
let count=0;
function test(name, fn) { fn(); console.log('✓',name); count++; }
const ref = (d,t) => E.wallEpoch(d,t);
const planned = (d,t,dir='toBN',extra={}) => E.allRows(D,{reference:ref(d,t),direction:dir,mode:'plan',horizon:120,...extra});

test('Brussels summer and winter time do not depend on browser timezone',()=>{
 assert.equal(ref('2026-09-07','08:00'),Date.parse('2026-09-07T06:00:00Z')/1000);
 assert.equal(ref('2026-12-01','08:00'),Date.parse('2026-12-01T07:00:00Z')/1000);
 assert.equal(E.hhmm(ref('2026-09-07','08:00')),'08:00');
});
test('First morning shuttle TNT returns are 05:37, 05:47 (BN + 7)',()=>{
 const r=E.shuttleRows(ref('2026-09-07','05:00'),'toBN',45);
 assert.deepEqual(r.map(x=>E.hhmm(x.departure)),['05:37']);
 const r2=E.shuttleRows(ref('2026-09-07','05:00'),'toBN',60);
 assert.deepEqual(r2.map(x=>E.hhmm(x.departure)),['05:37','05:47','05:57']);
 assert.equal(r2[0].quality,'derived'); assert.equal(r2[0].ride,420);
});
test('BN morning departures are not incorrectly shifted',()=>{
 assert.deepEqual(E.shuttleRows(ref('2026-09-07','05:00'),'toTNT',55).map(x=>E.hhmm(x.departure)),['05:30','05:40','05:50']);
});
test('Peak departures use the user-assumed grid anchored at 07:00',()=>{
 const r=E.shuttleRows(ref('2026-09-07','07:00'),'toTNT',150);
 assert.deepEqual(r.map(x=>E.hhmm(x.departure)),E.MORNING_PEAK);
 assert.deepEqual(r.slice(0,4).map(x=>E.hhmm(x.departure)),['07:00','07:08','07:16','07:24']);
 assert.equal(r[0].quality,'scheduled'); // 07:00 also appears explicitly in the PDF.
 assert.ok(r.slice(1).every(x=>x.quality==='assumed'&&x.assumedPeak));
 assert.ok(r.every(x=>!x.frequency&&x.departureLatest===x.departure&&x.arrivalLatest===x.arrival));
 assert.deepEqual(E.shuttleRows(ref('2026-09-07','08:00'),'toTNT',30).map(x=>E.hhmm(x.departure)),['08:04','08:12','08:20','08:28']);
 assert.deepEqual(E.shuttleRows(ref('2026-09-07','08:00'),'toBN',30).map(x=>E.hhmm(x.departure)),['08:03','08:11','08:19','08:27']);
 for(const dir of ['toBN','toTNT']) assert.ok(E.shuttleRows(ref('2026-09-07','08:00'),dir,30).every(x=>x.arrival-x.departure===E.RIDE_SECONDS));
});
test('Morning TNT peak is shifted +7 minutes, with no duplicate overlap',()=>{
 const r=E.shuttleRows(ref('2026-09-07','07:00'),'toBN',158);
 const expected=E.MORNING_PEAK.map(t=>E.hhmm(ref('2026-09-07',t)+E.RIDE_SECONDS));
 assert.deepEqual(r.map(x=>E.hhmm(x.departure)),expected);
 assert.equal(r.filter(x=>E.hhmm(x.departure)==='07:07').length,1);
 assert.equal(r[0].quality,'derived');
 assert.ok(r.slice(1).every(x=>x.quality==='assumed'&&x.returnOffset===7));
 assert.equal(new Set(r.map(x=>x.id)).size,r.length);
});
test('Peak end clipping preserves the off-peak departures after the grid',()=>{
 const a=E.shuttleRows(ref('2026-09-07','09:20'),'toTNT',20);
 assert.deepEqual(a.map(x=>E.hhmm(x.departure)),['09:24','09:35']);
 const b=E.shuttleRows(ref('2026-09-07','09:28'),'toBN',20);
 assert.deepEqual(b.map(x=>E.hhmm(x.departure)),['09:31','09:42']);
 const c=E.shuttleRows(ref('2026-09-07','18:20'),'toBN',25);
 assert.deepEqual(c.map(x=>E.hhmm(x.departure)),['18:24','18:40']);
});
test('Afternoon TNT grid starts at 16:00; BN returns use the +7 rule',()=>{
 assert.equal(E.shuttleRows(ref('2026-09-07','14:00'),'toBN',10)[0].departure,ref('2026-09-07','14:05'));
 const r=E.shuttleRows(ref('2026-09-07','16:00'),'toBN',150);
 assert.deepEqual(r.map(x=>E.hhmm(x.departure)),E.AFTERNOON_PEAK);
 assert.ok(r.every(x=>x.quality==='assumed'));
 assert.deepEqual(E.shuttleRows(ref('2026-09-07','16:30'),'toBN',20).map(x=>E.hhmm(x.departure)),['16:32','16:40','16:48']);
 assert.deepEqual(E.shuttleRows(ref('2026-09-07','14:00'),'toTNT',40).map(x=>E.hhmm(x.departure)),['14:12','14:22','14:37']);
 assert.deepEqual(E.shuttleRows(ref('2026-09-07','16:00'),'toTNT',35).map(x=>E.hhmm(x.departure)),['16:00','16:05','16:07','16:15','16:23','16:31']);
});
test('Confirmed lunch starts at TNT; all eight BN arrivals are +7 minutes',()=>{
 const r=E.shuttleRows(ref('2026-09-07','12:00'),'toBN',120);
 assert.equal(r.length,8);
 assert.deepEqual(r.map(x=>E.hhmm(x.departure)),E.LUNCH);
 assert.deepEqual(r.map(x=>E.hhmm(x.arrival)),['12:12','12:27','12:42','12:57','13:12','13:27','13:42','13:57']);
 assert.ok(r.every(x=>x.lunch&&x.quality==='confirmed'&&x.arrivalApprox&&x.origin.group==='shuttle'&&x.destination.group==='bn'));
 assert.ok(r.every(x=>x.headsign.includes('Rogier')));
 assert.equal(E.shuttleStatus(ref('2026-09-07','12:15'),'toBN').kind,'confirmed');
});
test('Rogier continues 3 minutes after BN for every lunch trip',()=>{
 const r=E.shuttleRows(ref('2026-09-07','12:00'),'toBN',120);
 assert.ok(r.every(x=>x.rogierArrival-x.departure===(E.RIDE_SECONDS+E.ROGIER_EXTRA_SECONDS)));
 assert.deepEqual(r.map(x=>E.hhmm(x.rogierArrival)),['12:15','12:30','12:45','13:00','13:15','13:30','13:45','14:00']);
});
test('Lunch BN returns to TNT leave 7 minutes after the TNT start',()=>{
 const r=E.shuttleRows(ref('2026-09-07','12:00'),'toTNT',120);
 assert.deepEqual(r.map(x=>E.hhmm(x.departure)),['12:12','12:27','12:42','12:57','13:12','13:27','13:42','13:57']);
 assert.ok(r.every(x=>x.quality==='derived'&&x.origin.group==='bn'&&x.destination.group==='shuttle'&&x.arrival-x.departure===E.RIDE_SECONDS));
 assert.equal(E.shuttleStatus(ref('2026-09-07','12:13'),'toTNT').kind,'scheduled');
});
test('22:00 is the stated last TNT departure; its BN return leaves at 22:07',()=>{
 assert.deepEqual(E.shuttleRows(ref('2026-09-07','21:41'),'toBN',60).map(x=>E.hhmm(x.departure)),['22:00']);
 assert.deepEqual(E.shuttleRows(ref('2026-09-07','21:41'),'toTNT',60).map(x=>E.hhmm(x.departure)),['21:47','22:07']);
 assert.equal(E.hhmm(E.shuttleRows(ref('2026-09-07','21:30'),'toBN',30)[0].departure),'21:40');
 assert.equal(E.shuttleStatus(ref('2026-09-07','22:05'),'toBN').kind,'closed');
});
test('No weekend shuttle; holiday operations remain unconfirmed',()=>{
 assert.equal(E.shuttleRows(ref('2026-09-05','08:00'),'toBN',600).length,0);
 assert.equal(E.shuttleRows(ref('2026-11-11','08:00'),'toBN',600).length,0);
 assert.equal(E.shuttleStatus(ref('2026-11-11','08:00'),'toBN').kind,'warning');
 assert.equal(E.shuttleRows(ref('2027-09-07','08:00'),'toBN',600).length,0);
});
test('Official bus records provide both directions, correct stop order and dates',()=>{
 for(const dir of ['toBN','toTNT']) {
  const r=planned('2026-09-07','08:00',dir);
  for(const op of ['stib','delijn']) assert.ok(r.some(x=>x.operator===op));
  assert.ok(r.every(x=>(x.destination.group==='bn')===(dir==='toBN')));
  assert.ok(r.every(x=>x.arrival>=x.departure));
  assert.ok(r.every(x=>x.departure>=ref('2026-09-07','08:00')));
  for(const x of r.filter(x=>x.operator!=='shuttle')) assert.ok(x.destinationSequence>x.originSequence);
 }
});
test('STIB 14, 20 and 88 connect; 20 does not serve Picard',()=>{
 const r=planned('2026-09-07','08:00').filter(x=>x.operator==='stib');
 assert.deepEqual([...new Set(r.map(x=>x.line))].sort(),['14','20','88']);
 assert.ok(E.filterRows(r,{stop:'picard'}).every(x=>x.line==='14'));
});
test('GTFS exception additions override weekdays; removals override regular service',()=>{
 const fake={calendar:[{service_id:'regular',monday:'1',start_date:'20260101',end_date:'20261231'}],exceptions:[{service_id:'regular',date:'20260907',exception_type:'2'},{service_id:'extra',date:'20260907',exception_type:'1'}]};
 assert.deepEqual([...E.activeServices(fake,'2026-09-07')],['extra']);
});
test('Post-midnight services from the previous service day are included',()=>{
 const r=planned('2026-09-05','00:05');
 assert.ok(r.some(x=>x.serviceDate==='2026-09-04'));
 assert.ok(r.every(x=>x.departure>=ref('2026-09-05','00:05')));
});
test('No indefinite extrapolation beyond GTFS validity',()=>{
 assert.equal(planned('2026-12-07','08:00').filter(x=>x.operator!=='shuttle').length,0);
 assert.equal(planned('2026-09-28','08:00').filter(x=>x.operator==='stib').length,0);
});
test('All filters combine and shuttle eligibility toggle is respected',()=>{
 const r=planned('2026-09-07','08:00','toBN',{includeShuttle:false});
 assert.equal(r.some(x=>x.operator==='shuttle'),false);
 assert.ok(E.filterRows(r,{operator:'stib',stop:'picard'}).every(x=>x.operator==='stib'&&x.origin.group==='picard'));
});
test('Live predictions expire at 120 seconds, including the De Lijn feed timestamp',()=>{
 assert.equal(E.fresh({ok:true,fetchedAt:1000},1120),true);
 assert.equal(E.fresh({ok:true,fetchedAt:1000},1121),false);
 assert.equal(E.fresh({ok:true,fetchedAt:1100,feedTime:900},1120),false);
 assert.equal(E.fresh({ok:false,fetchedAt:1100},1120),false);
});
const base=planned('2026-09-07','08:00').find(x=>x.operator==='delijn');
const now=ref('2026-09-07','08:00');
const provider=u=>({ok:true,fetchedAt:now,feedTime:now,trips:{[base.tripId]:{date:E.dateKey(base.serviceDate),stops:[],...u}}});
test('De Lijn delay uses exact trip ID, date and explicit stop update',()=>{
 const live=E.applyDeLijn(base,provider({stops:[{stop:base.origin.id,seq:base.originSequence,relationship:0,departure:{delay:180}}]}),now);
 assert.equal(live.departure,base.departure+180);assert.equal(live.arrival,base.arrival+180);
 assert.equal(live.quality,'live');assert.equal(live.arrivalApprox,true);
});
test('De Lijn NO_DATA stops are not turned into predictions',()=>{
 const live=E.applyDeLijn(base,provider({stops:[{stop:base.origin.id,relationship:2,departure:{delay:180}}]}),now);
 assert.equal(live.quality,'scheduled');
});
test('GTFS trip cancellation enum is 3; skipped stop enum is 1',()=>{
 assert.equal(E.applyDeLijn(base,provider({relationship:3}),now).cancelled,true);
 assert.equal(E.applyDeLijn(base,provider({relationship:3,timestamp:now-3600}),now).cancelled,true);
 assert.equal(E.applyDeLijn(base,provider({relationship:'CANCELED'}),now).cancelled,true);
 assert.equal(E.applyDeLijn(base,provider({relationship:2}),now).cancelled,undefined);
 assert.equal(E.applyDeLijn(base,provider({stops:[{stop:base.origin.id,relationship:1}]}),now).cancelled,true);
});
test('STIB mapped delays remain explicitly estimated, with no operator trip ID',()=>{
 const rows=planned('2026-09-07','08:00'),r=rows.find(x=>x.operator==='stib');
 const p={ok:true,fetchedAt:now,records:[{stop:r.origin.id,line:r.line,time:r.departure+120,destination:{fr:r.headsign}}]};
 const result=E.applySTIB(rows,p,now).filter(x=>x.quality==='live');
 assert.ok(result.length>0);assert.ok(Number.isFinite(result[0].delay));assert.equal(result[0].delayEstimated,true);assert.equal(result[0].tripId,null);assert.equal(result[0].arrivalApprox,true);
});
test('Planning mode never applies a live feed',()=>{
 const settings={reference:now,direction:'toBN',mode:'plan'};
 const r=E.allRows(D,settings,{providers:{delijn:provider({relationship:3})}},now);
 assert.ok(r.every(x=>!x.cancelled&&x.quality!=='live'));
});
test('Earliest-arrival and departure sorting are distinct; cancelled buses do not win',()=>{
 const rows=[{id:'a',departure:1,arrivalLatest:10,line:'1'},{id:'b',departure:2,arrivalLatest:4,line:'2'},{id:'c',departure:0,arrivalLatest:1,cancelled:true,line:'3'}];
 assert.equal(E.filterRows(rows,{sort:'arrival'})[0].id,'b');
 assert.equal(E.filterRows(rows,{sort:'departure'})[0].id,'a');
});
test('User walk profiles and exact reference pins are retained',()=>{
 assert.equal(W.profiles.picard.minutes,5);assert.equal(W.profiles.shuttle.minutes,5);assert.equal(W.profiles.suzan.minutes,8);
 assert.equal(W.profiles.picard.lat,50.86404643162095);assert.equal(W.profiles.picard.lon,4.343968608510816);
 assert.equal(W.profiles.shuttle.lat,50.86394437949276);assert.equal(W.profiles.shuttle.lon,4.346459999157837);
 assert.equal(W.profiles.suzan.lat,50.863076897694725);assert.equal(W.profiles.suzan.lon,4.346976807605478);
});
const homeSettings={reference:ref('2026-09-07','08:00'),direction:'toBN',mode:'plan',includeWalking:true,walking:W};
test('Walking filters out departures that cannot be reached from home',()=>{
 const r=E.allRows(D,homeSettings),unwalked=E.allRows(D,{...homeSettings,includeWalking:false});
 assert.ok(r.length<unwalked.length);
 assert.ok(r.every(x=>x.departure>=homeSettings.reference+x.walkMinutes*60));
 const best=E.filterRows(r)[0];
 assert.equal(best.operator,'stib');assert.equal(best.line,'14');assert.equal(best.origin.group,'picard');
 assert.equal(E.hhmm(best.departure),'08:06');assert.equal(E.hhmm(best.arrival),'08:12');
});
test('Latest home departure, wait and total avoid double-counting the walk',()=>{
 const best=E.filterRows(E.allRows(D,homeSettings))[0];
 assert.equal(best.walkMinutes,5);assert.equal(E.hhmm(best.leaveHomeBy),'08:01');
 assert.equal(E.hhmm(best.walkReadyAt),'08:05');assert.equal(best.waitAfterWalk,60);
 assert.equal(best.totalJourneySeconds,12*60);
 assert.equal(best.walkSeconds+best.waitAfterWalk+best.ride,best.totalJourneySeconds);
 assert.equal(best.arrival,ref('2026-09-07','08:12'));
});
test('A walk cut-off is exact, with no silent extra boarding buffer',()=>{
 const reference=ref('2026-09-07','12:00');
 const lunch=E.allRows(D,{...homeSettings,reference}).find(x=>x.operator==='shuttle');
 assert.equal(E.hhmm(lunch.departure),'12:05');assert.equal(E.hhmm(lunch.arrival),'12:12');
 assert.equal(lunch.waitAfterWalk,0);assert.equal(lunch.leaveHomeBy,reference);
 assert.equal(lunch.totalJourneySeconds,12*60);assert.equal(E.hhmm(lunch.rogierArrival),'12:15');
 const later=E.allRows(D,{...homeSettings,reference:reference+1}).find(x=>x.operator==='shuttle');
 assert.equal(E.hhmm(later.departure),'12:20');
});
test('The eight-minute Suzan Daniel estimate covers all approved operator platforms',()=>{
 const r=E.allRows(D,homeSettings).filter(x=>x.origin.group==='suzan');
 assert.ok(r.some(x=>x.operator==='stib'));assert.ok(r.some(x=>x.operator==='delijn'));
 assert.ok(r.every(x=>x.walkMinutes===8&&x.walkReference.lat===W.profiles.suzan.lat));
 for(const x of r){
  const original=D.operators[x.operator].stops[x.origin.id];
  assert.equal(x.origin.lat,original.lat);assert.equal(x.origin.lon,original.lon);
 }
 assert.ok(r.some(x=>x.origin.lon!==x.walkReference.lon));
});
test('TNT pickup uses the user pin without changing any BN shuttle bay',()=>{
 const r=E.allRows(D,homeSettings).find(x=>x.operator==='shuttle');
 assert.equal(r.origin.lat,W.profiles.shuttle.lat);assert.equal(r.origin.lon,W.profiles.shuttle.lon);
 assert.equal(r.destination.lat,undefined);
 const back=E.allRows(D,{...homeSettings,direction:'toTNT'}).find(x=>x.operator==='shuttle');
 assert.equal(back.destination.lat,W.profiles.shuttle.lat);assert.equal(back.origin.lat,undefined);
});
test('BN-to-TNT includes the walk home while preserving bus-stop arrival timestamps',()=>{
 const withFlag=E.allRows(D,{...homeSettings,direction:'toTNT'});
 const withoutFlag=E.allRows(D,{...homeSettings,direction:'toTNT',includeWalking:false});
 assert.equal(E.walkingEnabled({...homeSettings,direction:'toTNT'}),true);
 assert.deepEqual(withFlag.map(x=>[x.id,x.departure,x.arrival]),withoutFlag.map(x=>[x.id,x.departure,x.arrival]));
 assert.ok(withFlag.every(x=>x.walkingActive&&x.walkAfterSeconds>0&&x.leaveHomeBy===null&&x.homeArrival===x.arrival+x.walkAfterSeconds));
 assert.ok(withoutFlag.every(x=>x.walkMinutes===0&&x.homeArrival===null));
});
test('Walking can be switched off for an already-at-stop comparison',()=>{
 const r=E.allRows(D,{...homeSettings,includeWalking:false});
 assert.ok(r.every(x=>x.walkMinutes===0&&!x.walkingActive));
 assert.equal(E.filterRows(r)[0].line,'X60');
 assert.equal(E.hhmm(E.filterRows(r)[0].departure),'08:01');
});
test('A missing walking time is not silently counted as zero',()=>{
 const cfg={profiles:{...W.profiles}};delete cfg.profiles.suzan;
 const r=E.allRows(D,{...homeSettings,walking:cfg});
 assert.ok(r.every(x=>x.origin.group!=='suzan'));
});
test('Real-time delay is applied before walking reachability',()=>{
 const reference=homeSettings.reference;
 const original={...base,origin:{...base.origin,group:'picard'},departure:reference+240,scheduledDeparture:reference+240,arrival:reference+540,scheduledArrival:reference+540,ride:300,serviceDate:'2026-09-07'};
 assert.equal(E.applyWalking([original],homeSettings).length,0);
 const p={ok:true,fetchedAt:reference,feedTime:reference,trips:{[original.tripId]:{date:'20260907',stops:[{stop:original.origin.id,seq:original.originSequence,relationship:0,departure:{delay:120}}]}}};
 const updated=E.applyDeLijn(original,p,reference);
 const result=E.applyWalking([updated],homeSettings);
 assert.equal(result.length,1);assert.equal(result[0].quality,'live');
 assert.equal(result[0].leaveHomeBy,reference+60);assert.equal(result[0].arrival,reference+660);
});
const trainSettings={...homeSettings,trainDeparture:ref('2026-09-07','08:30'),horizon:120};
const earlierDay=ref('2026-09-05','12:00');
test('Train planning uses the requested five-minute margin and latest start',()=>{
 const p=E.planForTrain(D,trainSettings,null,earlierDay);
 assert.equal(p.stationMargin,5);assert.equal(E.hhmm(p.deadline),'08:25');
 assert.ok(p.rows.length);assert.ok(p.rows.every(r=>r.arrivalLatest<=p.deadline));
 assert.equal(E.hhmm(p.rows[0].journeyStart),'08:14');
 assert.equal(E.hhmm(p.rows[0].departure),'08:19');assert.equal(E.hhmm(p.rows[0].arrival),'08:25');
 for(let i=1;i<p.rows.length;i++)assert.ok(p.rows[i-1].journeyStart>=p.rows[i].journeyStart);
});
test('Increasing the station margin cannot grant a later start',()=>{
 const a=E.planForTrain(D,trainSettings,null,earlierDay);
 const b=E.planForTrain(D,{...trainSettings,stationMargin:10},null,earlierDay);
 assert.equal(E.hhmm(b.deadline),'08:20');assert.ok(b.rows[0].journeyStart<=a.rows[0].journeyStart);
 assert.ok(b.rows.every(r=>r.stationWaitSeconds>=600));
});
test('A train delay does not extend the scheduled-departure deadline',()=>{
 const a=E.planForTrain(D,trainSettings,null,earlierDay);
 const b=E.planForTrain(D,{...trainSettings,expectedTrainDeparture:trainSettings.trainDeparture+1800},null,earlierDay);
 assert.equal(a.deadline,b.deadline);assert.deepEqual(a.rows.map(r=>r.id),b.rows.map(r=>r.id));
});
test('Train journey duration starts at the calculated latest start, not the search bound',()=>{
 const p=E.planForTrain(D,trainSettings,null,earlierDay);
 for(const r of p.rows){
  assert.equal(r.waitAfterWalk,0);assert.equal(r.walkReadyAt,r.departure);
  assert.equal(r.totalJourneySeconds,r.walkSeconds+r.ride);
  assert.equal(r.totalJourneySeconds+r.stationWaitSeconds,r.trainDeparture-r.journeyStart);
 }
});
test('Today train plans cannot start before now or meet an already-passed deadline',()=>{
 const now=ref('2026-09-07','08:00');
 const p=E.planForTrain(D,trainSettings,null,now);
 assert.equal(p.usesLive,true);assert.ok(p.rows.every(r=>r.journeyStart>=now));
 const tooLate=E.planForTrain(D,{...trainSettings,trainDeparture:ref('2026-09-07','08:04')},null,now);
 assert.equal(tooLate.rows.length,0);
});
test('Fresh bus cancellations are excluded from a same-day train plan',()=>{
 const now=ref('2026-09-07','08:00');
 const basePlan=E.planForTrain(D,trainSettings,null,now);
 const row=basePlan.rows.find(r=>r.operator==='delijn');assert.ok(row);
 const live={providers:{delijn:{ok:true,fetchedAt:now,feedTime:now,trips:{[row.tripId]:{date:'20260907',relationship:3,timestamp:now-3600,stops:[]}}}}};
 const changed=E.planForTrain(D,trainSettings,live,now);
 assert.ok(changed.rows.every(r=>r.tripId!==row.tripId));
});
test('A future-date train plan never consumes current live bus delays',()=>{
 const p=E.planForTrain(D,trainSettings,{providers:{stib:{ok:true,fetchedAt:earlierDay,records:[]}}},earlierDay);
 assert.equal(p.usesLive,false);assert.ok(p.rows.every(r=>r.quality!=='live'));
});
test('STIB 88 serves Thurn en Taxis, with the correct direction-specific platforms',()=>{
 for(const [direction,from,to] of [['toBN','1349','1083'],['toTNT','3400','1356']]){
  const rows=E.allRows(D,{...homeSettings,direction}).filter(r=>r.operator==='stib'&&r.line==='88');
  assert.ok(rows.length);assert.ok(rows.every(r=>r.origin.id===from&&r.destination.id===to));
  assert.ok(rows.every(r=>(r.origin.group==='thurn'||r.destination.group==='thurn')));
 }
});
test('Thurn en Taxis has an eleven-minute walk at the home end, not a guessed user pin',()=>{
 assert.equal(W.profiles.thurn.minutes,11);assert.equal(W.profiles.thurn.coordinateSource,'operator-gtfs');
 assert.equal(W.profiles.thurn.lat,undefined);
 const rows=E.filterRows(E.allRows(D,homeSettings),{stop:'thurn',sort:'departure'});
 assert.ok(rows.length);assert.ok(rows.every(r=>r.walkMinutes===11&&r.departure>=homeSettings.reference+660));
 assert.equal(E.hhmm(rows[0].departure),'08:15');assert.equal(E.hhmm(rows[0].leaveHomeBy),'08:04');
 assert.equal(rows[0].origin.lat,D.operators.stib.stops['1349'].lat);
 const back=E.filterRows(E.allRows(D,{...homeSettings,direction:'toTNT'}),{stop:'thurn'});
 assert.ok(back.every(r=>r.walkMinutes===11&&r.walkAfterMinutes===11&&r.leaveHomeBy===null&&r.homeArrival===r.arrival+660));
});
test('STIB 88 uses the same live matching and approximate ride logic as the other buses',()=>{
 const now=homeSettings.reference;
 const live={providers:{stib:{ok:true,fetchedAt:now,records:[{stop:'1349',line:'88',destination:{fr:'DE BROUCKERE'},time:now+12*60}]}}};
 const rows=E.allRows(D,{...homeSettings,mode:'now'},live,now).filter(r=>r.line==='88'&&r.quality==='live');
 assert.equal(rows.length,1);assert.equal(rows[0].walkMinutes,11);assert.equal(rows[0].leaveHomeBy,now+60);
 assert.equal(rows[0].arrivalApprox,true);assert.equal(rows[0].tripId,null);
});
test('Bus rows expose verified operator webpage directions',()=>{
 const rows=E.allRows(D,homeSettings);
 const stib=rows.find(r=>r.line==='88');
 assert.equal(stib.routePageUrl,'https://www.stib-mivb.be/startpagina/reizen/real-time/lijnen?line=88&direction=v');
 for(const row of rows.filter(r=>r.operator==='delijn'))assert.equal(row.routePageUrl,D.operators.delijn.routes[row.routeId].url);
 assert.equal(E.operatorPage('shuttle','T&T'),null);
});
test('Boarding stops link to their public live pages, like the route links',()=>{
 const rows=E.allRows(D,homeSettings);
 assert.equal(rows.find(r=>r.line==='88').stopPageUrl,'https://www.stib-mivb.be/startpagina/reizen/real-time/haltes?stop=1349');
 for(const row of rows.filter(r=>r.operator==='delijn'))assert.equal(row.stopPageUrl,D.operators.delijn.stops[row.origin.id].url);
 assert.equal(E.stopPage('shuttle',{}),null);
});
test('Preferred stop changes from Picard at home to Suzan Daniel at TNT; return uses Picard',()=>{
 const home=E.comparison(D,homeSettings).rows.filter(r=>r.operator==='stib'&&r.line==='14');
 const tnt=E.comparison(D,{...homeSettings,includeWalking:false}).rows.filter(r=>r.operator==='stib'&&r.line==='14');
 const back=E.comparison(D,{...homeSettings,direction:'toTNT'}).rows.filter(r=>r.operator==='stib'&&r.line==='14');
 assert.ok(home.length>1&&tnt.length>1&&back.length>1,'Later departures remain');
 assert.ok(home.every(r=>r.origin.group==='picard'));
 assert.ok(tnt.every(r=>r.origin.group==='suzan'));
 assert.ok(back.every(r=>r.destination.group==='picard'));
});
test('The two R41 stop choices become one preferred boarding option per vehicle',()=>{
 const baseRow={operator:'delijn',line:'R41',tripId:'same',serviceDate:'2026-09-07',destination:{group:'bn'},arrival:500,arrivalLatest:500};
 const rows=[{...baseRow,id:'p',origin:{group:'picard'},departure:100},{...baseRow,id:'s',origin:{group:'suzan'},departure:220}];
 assert.equal(E.preferredStops(rows,homeSettings)[0].id,'p');
 assert.equal(E.preferredStops(rows,{...homeSettings,includeWalking:false})[0].id,'s');
 const skipped=[{...rows[0],cancelled:true},rows[1]];
 assert.equal(E.preferredStops(skipped,homeSettings)[0].id,'s');
});
test('Strictly dominated alternatives are marked only with a >2 min arrival gap',()=>{
 const rows=[{id:'a',journeyStart:100,journeyArrivalLatest:500},{id:'b',journeyStart:120,journeyArrivalLatest:360},{id:'equal',journeyStart:90,journeyArrivalLatest:480}];
 const r=E.markDominated(rows);assert.equal(r.length,3);assert.equal(r[0].dominated,true);assert.equal(r[0].dominatedBy,'b');
 assert.equal(r[1].dominated,false);assert.equal(r[2].dominated,false);assert.equal(r[0].cancelled,undefined);
 assert.equal(E.markDominated([rows[0],{...rows[1],cancelled:true}])[0].dominated,false);
 // A 2-minute gap exactly, or less, keeps both options visible.
 assert.equal(E.markDominated([{id:'x',journeyStart:100,journeyArrivalLatest:620},{id:'y',journeyStart:110,journeyArrivalLatest:500}])[0].dominated,false);
 assert.equal(E.markDominated([{id:'x',journeyStart:100,journeyArrivalLatest:620},{id:'y',journeyStart:110,journeyArrivalLatest:499}])[0].dominated,true);
});
test('Direction-specific operator preferences break arrival ties, not faster arrivals',()=>{
 const rows=['delijn','stib','shuttle'].map((op,i)=>({id:String(i),operator:op,line:op==='stib'?'14':op==='shuttle'?'T&T':'R41',origin:{group:'picard'},destination:{group:'bn'},departure:100,arrival:500,arrivalLatest:500}));
 assert.deepEqual(E.filterRows(rows,{direction:'toBN'}).map(r=>r.operator),['shuttle','delijn','stib']);
 assert.deepEqual(E.filterRows(rows,{direction:'toTNT'}).map(r=>r.operator),['shuttle','stib','delijn']);
 const fastest={...rows[1],arrival:499,arrivalLatest:499};assert.equal(E.filterRows([rows[2],fastest])[0].operator,'stib');
 const m88={...rows[1],line:'88'};assert.equal(E.filterRows([m88,rows[1]],{direction:'toTNT'})[0].line,'14');
});
test('Punctuality colours follow the displayed minute: blue early, green 0–2, orange 2–5, red 5+',()=>{
 for(const [delta,tone] of [[0,'on-time'],[44,'on-time'],[120,'on-time'],[164,'on-time'],[165,'minor-delay'],[284,'minor-delay'],[285,'major-delay'],[300,'major-delay'],[-44,'on-time'],[-45,'early'],[-60,'early']])assert.equal(E.timingStatus({quality:'live',departure:1000+delta,scheduledDeparture:1000}).tone,tone);
 assert.equal(E.timingStatus({quality:'scheduled',departure:1000,scheduledDeparture:1000}).tone,'unknown');
 assert.equal(E.timingStatus({quality:'live',departure:1000,scheduledDeparture:null}).delta,null);
 assert.equal(E.timingStatus({quality:'live',arrival:1200,scheduledArrival:1000},'arrival').tone,'minor-delay');
 // Sub-45-second remainders round down to the previous minute, larger ones up.
 assert.deepEqual([0,44,45,104,105,164,165,224,225,1064,1065,-44,-45].map(s=>E.roundMinuteDelta(s)+0),[0,0,60,60,120,120,180,180,240,1020,1080,0,-60]);
});
test('Verified STIB v/f mapping follows each line destination, not one universal direction',()=>{
 for(const [line,head,dir] of [['14','GARE DU NORD','f'],['14','UZ-VUB','v'],['20','GARE DU NORD','f'],['20','HUNDERENVELD','v'],['88','DE BROUCKERE','v'],['88','UZ-VUB','f']])assert.ok(E.operatorPage('stib',line,{},head).endsWith('&direction='+dir));
 assert.ok(!E.operatorPage('stib','99',{},'Unknown').includes('direction='));
});
test('Occupancy is optional, exact-trip/stop-specific, and unknown is not invented',()=>{
 assert.equal(E.occupancyInfo(undefined),null);assert.equal(E.occupancyInfo(7),null);assert.equal(E.occupancyInfo(0).label,'Empty');
 const now=ref('2026-09-07','08:00');
 const row={...base,serviceDate:'2026-09-07'};
 const p={ok:true,fetchedAt:now,feedTime:now,trips:{[row.tripId]:{date:'20260907',timestamp:now,stops:[{stop:row.origin.id,seq:row.originSequence,relationship:2,occupancyStatus:0}]}}};
 const got=E.applyDeLijn(row,p,now);assert.equal(got.occupancy.status,'EMPTY');assert.notEqual(got.quality,'live');
 p.trips[row.tripId].stops[0].occupancyStatus=6;assert.equal(E.applyDeLijn(row,p,now).boardingUnavailable,true);
});
test('Fresh STIB 10m/30m predictions replace every scheduled call through the last displayed minute',()=>{
 const now=homeSettings.reference;
 const seed=E.allRows(D,{...homeSettings,includeWalking:false}).find(r=>r.operator==='stib'&&r.line==='88');
 const scheduled=[5,15,20,30,30.5,35].map((m,i)=>({...seed,id:'window-'+i,quality:'scheduled',departure:now+m*60,departureLatest:now+m*60,scheduledDeparture:now+m*60,arrival:now+m*60+420,arrivalLatest:now+m*60+420,scheduledArrival:now+m*60+420,ride:420}));
 const provider={ok:true,fetchedAt:now,records:[10,30].map(m=>({stop:seed.origin.id,line:'88',destination:{fr:'DE BROUCKERE'},time:now+m*60}))};
 const rows=E.applySTIB(scheduled,provider,now);
 assert.deepEqual(rows.filter(r=>r.quality==='live').map(r=>(r.departure-now)/60),[10,30]);
 assert.deepEqual(rows.filter(r=>r.quality==='scheduled').map(r=>(r.departure-now)/60),[35]);
 assert.ok(rows.filter(r=>r.quality==='live').every(r=>Number.isFinite(r.scheduledDeparture)&&r.delayEstimated&&r.tripId===null&&r.liveWindowEnd===now+1800));
 const reachable=E.applyWalking(rows,homeSettings);
 assert.deepEqual(reachable.filter(r=>r.quality==='live').map(r=>(r.departure-now)/60),[30]);
 assert.deepEqual(reachable.filter(r=>r.quality==='scheduled').map(r=>(r.departure-now)/60),[35]);
});
test('STIB live-window replacement is scoped to the boarding stop, line and destination',()=>{
 const now=homeSettings.reference;
 const seeds=E.allRows(D,{...homeSettings,includeWalking:false}).filter(r=>r.operator==='stib');
 const r=seeds.find(r=>r.line==='14'&&r.origin.group==='picard');
 const otherLine=seeds.find(r=>r.line==='20');
 const otherStop=seeds.find(r=>r.line==='14'&&r.origin.group==='suzan');
 const rows=[r,otherLine,otherStop].map((r,i)=>({...r,id:'scope-'+i,departure:now+900,departureLatest:now+900,scheduledDeparture:now+900,arrival:now+1200,arrivalLatest:now+1200,scheduledArrival:now+1200,ride:300}));
 const p={ok:true,fetchedAt:now,records:[{stop:rows[0].origin.id,line:'14',destination:{fr:rows[0].headsign},time:now+1800}]};
 const result=E.applySTIB(rows,p,now);
 assert.ok(!result.some(x=>x.id==='scope-0'));
 assert.ok(result.some(x=>x.id==='scope-1'));
 assert.ok(result.some(x=>x.id==='scope-2'));
 assert.deepEqual(E.applySTIB(rows,p,now+121),rows,'Expired predictions restore timetable fallback');
});
test('STIB scheduling matches are one-to-one and order preserving',()=>{
 const group=[1000,1600,2200].map((t,i)=>({scheduledDeparture:t,tripId:'s'+i}));
 const matches=E.matchSTIBSchedules([{time:1300},{time:1400}],group);
 assert.deepEqual(matches.map(r=>r.scheduledDeparture),[1000,1600]);
 assert.equal(E.matchSTIBSchedules([{time:10000}],group)[0],null);
 assert.equal(E.timingStatus({quality:'live',departure:1020,scheduledDeparture:1000,delayEstimated:true}).delta,0);
 assert.equal(E.timingStatus({quality:'live',departure:1020,scheduledDeparture:1000,delayEstimated:true}).estimated,true);
});
function directFixture(){
 const now=homeSettings.reference;
 const row=E.allRows(D,{...homeSettings,includeWalking:false}).find(r=>r.operator==='delijn'&&r.line==='R41'&&r.origin.group==='picard'&&E.hhmm(r.departure)==='08:11');
 assert.ok(row);const m=row.tripId.match(/^gt:delijn:(\d+)_(\d+)_/);const journeyId=`${row.serviceDate}_${m[1]}_${m[2]}`;
 const a={id:'a',stop:row.origin.id,journeyId,planned:row.scheduledDeparture,expected:row.scheduledDeparture+360,realtime:true,vehicleId:'fixture-vehicle'};
 const b={id:'b',stop:row.destination.id,journeyId,planned:row.scheduledArrival,expected:row.scheduledArrival+420,realtime:true};
 return {now,row,a,b,p:{ok:true,kind:'stop-api',fetchedAt:now,records:[a,b]}};
}
test('De Lijn stop API applies paired actual departure and arrival, not BMC NO_DATA',()=>{
 const {now,row,a,b,p}=directFixture();const got=E.applyDeLijn(row,p,now);
 assert.equal(got.departure,a.expected);assert.equal(got.arrival,b.expected);
 assert.equal(got.delay,360);assert.equal(got.arrivalDelay,420);assert.equal(got.liveSource,'delijn-stop-api');
 assert.equal(got.delayEstimated,false);assert.equal(got.arrivalApprox,false);assert.equal(got.vehicleId,'fixture-vehicle');
});
test('De Lijn stop API early running and arrival projection are marked correctly',()=>{
 const {now,row,a,p}=directFixture();a.expected=a.planned-120;p.records=[a];
 const got=E.applyDeLijn(row,p,now);assert.equal(got.delay,-120);assert.equal(got.arrival,got.departure+row.ride);
 assert.equal(got.arrivalApprox,true);assert.equal(E.timingStatus(got,'arrival').estimated,true);
 assert.equal(E.timingStatus(got).tone,'early');
});
test('De Lijn stop API honours cancellation, passed, unknown, ambiguity and freshness',()=>{
 let {now,row,a,b,p}=directFixture();a.cancelled=true;assert.equal(E.applyDeLijn(row,p,now).cancelled,true);
 a.cancelled=false;a.passed=true;assert.equal(E.applyDeLijn(row,p,now).passed,true);
 a.passed=false;a.realtime=false;assert.equal(E.applyDeLijn(row,p,now).quality,'scheduled');
 a.realtime=true;p.records.push({...a,expected:a.expected+60});assert.equal(E.applyDeLijn(row,p,now).quality,'scheduled');
 p.records=[a,b];assert.equal(E.applyDeLijn(row,p,now+121).quality,'scheduled');
 a.journeyId='wrong-date-or-trip';assert.equal(E.applyDeLijn(row,p,now).quality,'scheduled');
});
test('Shuttle can be mathematically dominated but must never be collapsed',()=>{
 const rows=[{id:'sh',operator:'shuttle',journeyStart:100,journeyArrivalLatest:500},{id:'bus',operator:'stib',journeyStart:120,journeyArrivalLatest:360}];
 const r=E.markDominated(rows);assert.equal(r[0].dominated,true);assert.equal(r[0].collapseEligible,false);
});
console.log(`\n${count} engine tests passed.`);
