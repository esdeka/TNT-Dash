/* Playwright regression suite for the compact departure-first dashboard.
   Run with a local server: node test_ui.js. Fixtures are test-only; no synthetic
   predictions are embedded in Dashboard.html. Provider polling is mocked here. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const E=require('./static/engine.js'),D=require('./data/timetable.json');
const URL=process.env.DASHBOARD_URL||'http://127.0.0.1:3000';
const cache=path.join(__dirname,'../.cache');fs.mkdirSync(cache,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true}), errors=[];
 const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'America/New_York'});
 await context.route('**/api/live/refresh',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({serverTime:Date.now()/1000,lastAttempt:Date.now()/1000,providers:{},quota:{refreshesLeft:40}})}));
 const page=await context.newPage();await page.clock.install({time:new Date('2026-09-05T12:00:00Z')});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(URL,{waitUntil:'networkidle'});
 const snap=()=>page.evaluate(()=>CommuteDashboard.getSnapshot());
 async function controls(){if(!await page.locator('#planner').evaluate(e=>e.open))await page.locator('#planner summary').click()}
 async function plan(date,time){await controls();await page.locator('#plan-button').click();await page.locator('#plan-date').fill(date);await page.locator('#plan-time').fill(time);await page.locator('#local-clock').click()}
 async function closeControls(){if(await page.locator('#planner').evaluate(e=>e.open))await page.locator('#planner summary').click()}
 assert.equal(await page.locator('#planner').evaluate(e=>e.open),false);
 assert.equal(await page.locator('#operator-cards,#map-card,.ride-col').count(),0);
 await plan('2026-09-07','08:00');await closeControls();
 let s=await snap();assert.equal(s.best.line,'14');assert.equal(s.best.origin.group,'picard');
 assert.match(await page.locator('#recommendation .departure-cell .primary-label').innerText(),/Bus departure/);
 assert.equal(await page.locator('#recommendation .primary-clock .actual').innerText(),'08:06');
 assert.equal(await page.locator('#recommendation .home-under-departure .actual').innerText(),'08:01');
 assert.equal(await page.locator('#recommendation .home-under-departure .actual').evaluate(e=>getComputedStyle(e).color),'rgb(102, 112, 133)');
 const underneath=await page.evaluate(()=>({bus:document.querySelector('#recommendation .departure-cell .event-clock').getBoundingClientRect().bottom,home:document.querySelector('#recommendation .home-under-departure').getBoundingClientRect().top}));assert.ok(underneath.home>=underneath.bus);
 assert.ok(s.rows.filter(r=>r.line==='14').length>1,'Later buses retained');
 assert.ok(s.rows.filter(r=>r.line==='14').every(r=>r.origin.group==='picard'));
 for(const op of ['stib','delijn','shuttle']){
  const logo=page.locator(`.departure-event .operator-timing-logo.${op}`).first();
  assert.ok(await logo.count()>0,`${op} logo is shown`);
  assert.ok((await logo.getAttribute('src')).startsWith('data:image/png;base64,'));
  await logo.evaluate(img=>img.decode());
  assert.ok(await logo.evaluate(img=>img.naturalWidth>0&&img.naturalHeight>0));
 }
 assert.equal(await page.locator('.departure-event .clock-main > svg.icon').count(),0);
 assert.ok(await page.locator('.arrival-event .clock-main > svg.icon').count()>0);

 assert.ok(s.rows.some(r=>r.dominated));
 assert.equal(await page.locator('#collapsed-options').count(),0);
 assert.ok(await page.locator('.inline-alternatives').count()>0);
 assert.equal(await page.locator('.inline-alternatives').first().evaluate(e=>e.open),false);
 assert.equal(await page.locator('#departure-rows > .collapsed-option').count(),0);
 assert.equal(await page.locator('.inline-alternatives [data-line="T&T"]').count(),0);
 assert.ok(await page.locator('#departure-rows > [data-line="T&T"]').count()>0);
 await page.locator('.inline-alternatives summary').first().click();
 assert.ok(await page.locator('.inline-alt-body .option-card').count()>0);
 assert.match(await page.locator('.inline-alt-body .collapse-reason').first().innerText(),/Collapsed because .* instead of .*Not cancelled/);
 assert.equal(await page.locator('.inline-alt-body .actual').first().evaluate(e=>getComputedStyle(e).textDecorationLine),'none');
 await page.locator('.inline-alternatives summary').first().click();
 const firstCount=await page.locator('.option-card').count();await page.locator('#show-more').click();assert.ok(await page.locator('.option-card').count()>firstCount);
 await controls();await page.locator('#start-tnt').click();s=await snap();assert.ok(s.rows.filter(r=>r.line==='14').every(r=>r.origin.group==='suzan'));assert.ok(s.rows.every(r=>r.walkBeforeMinutes===0));
 assert.match(await page.locator('#recommendation .departure-cell .primary-label').innerText(),/Bus departure/);
 await page.locator('#start-home').click();await closeControls();
 await page.locator('#to-home').click();s=await snap();assert.equal(s.direction,'toTNT');assert.ok(s.rows.filter(r=>r.line==='14').every(r=>r.destination.group==='picard'));assert.ok(s.rows.every(r=>r.homeArrival===r.arrival+r.walkAfterSeconds));
 assert.equal(await page.locator('body').getAttribute('data-direction'),'toTNT');
 assert.ok(await page.locator('#recommendation .home-under-arrival').isVisible());
 assert.ok(await page.locator('#recommendation .home-under-arrival').evaluate(e=>e.getBoundingClientRect().top>=e.closest('.arrival-cell').querySelector('.event-clock').getBoundingClientRect().bottom));
 assert.match(await page.locator('#recommendation .bus-page-link').getAttribute('href'),/line=20&direction=v/);
 await page.locator('#to-bn').click();assert.equal(await page.locator('body').getAttribute('data-direction'),'toBN');
 await controls();await page.locator('#stop-select').selectOption('thurn');s=await snap();assert.ok(s.rows.every(r=>r.line==='88'&&r.walkBeforeMinutes===11));assert.match(await page.locator('#recommendation .bus-page-link').getAttribute('href'),/line=88&direction=v/);
 await page.locator('#to-home').click();s=await snap();assert.ok(s.rows.every(r=>r.line==='88'&&r.walkAfterMinutes===11));assert.match(await page.locator('#recommendation .bus-page-link').getAttribute('href'),/line=88&direction=f/);
 await page.locator('#to-bn').click();await controls();await page.locator('#stop-select').selectOption('all');await closeControls();
 console.log('✓ Preferred stops, later departures, explained collapsed alternatives, home walks both ways, themes and verified line URLs');
 for(const width of [320,360,390,768,1440]){
  await page.setViewportSize({width,height:667});await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0)});
  const g=await page.evaluate(()=>({r:document.getElementById('recommendation').getBoundingClientRect().toJSON(),p:document.getElementById('planner').getBoundingClientRect().toJSON(),w:innerWidth,sw:document.documentElement.scrollWidth,h:innerHeight}));
  assert.ok(g.sw<=g.w+1,`No horizontal overflow at ${width}`);assert.ok(g.r.bottom<g.h);assert.ok(g.r.bottom<=g.p.top);
 }
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0)});await page.screenshot({path:path.join(cache,'glance-home-mobile.png'),fullPage:true});
 await page.locator('#to-home').click();await page.screenshot({path:path.join(cache,'glance-return-mobile.png'),fullPage:true});await page.locator('#to-bn').click();
 for(const tab of ['method','shuttle','walking','stops','sources','technical']){
  await page.locator('.reference-button').click();await page.locator(`#dialog-tabs [data-tab="${tab}"]`).click();assert.ok((await page.locator('#dialog-content').innerText()).length>100);await page.keyboard.press('Escape');
 }
 await page.locator('[data-action="best"]').click();assert.match(await page.locator('#dialog-content').innerText(),/DATA BASIS/);assert.match(await page.locator('.operator-page-link').getAttribute('href'),/direction=f/);await page.keyboard.press('Escape');
 console.log('✓ First-screen departure prominence, 320–1440 layouts, lean page, all reference sections');
 await controls();await page.locator('#train-button').click();await page.locator('#train-date').fill('2026-09-07');await page.locator('#manual-train-time').fill('08:30');await page.locator('[data-action="manual-train"]').click();
 s=await snap();assert.equal(s.trainMargin,5);assert.equal(E.hhmm(s.best.journeyStart),'08:14');assert.ok(s.rows.every(r=>r.arrival<=s.trainResult.deadline));
 await controls();await page.locator('#train-margin').fill('10');await page.locator('#local-clock').click();assert.equal(E.hhmm((await snap()).trainResult.deadline),'08:20');await page.locator('#train-margin').fill('5');await page.locator('#local-clock').click();
 let cancelled=false;const train=E.wallEpoch('2026-09-07','08:30');
 await page.route('**/api/trains?**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,fetchedAt:Date.now()/1000,departures:[{id:'test-train',service:'TEST',destination:'Test destination',scheduledDeparture:train,expectedDeparture:train+1200,delaySeconds:1200,platform:'4',source:'irail',cancelled,left:false}]})}));
 await page.locator('#train-board-time').fill('08:00');await page.locator('#load-trains').click();await page.locator('.train-option').waitFor();await page.locator('.train-option').click();assert.equal(E.hhmm((await snap()).trainResult.deadline),'08:25');
 cancelled=true;await controls();await page.locator('#load-trains').click();await page.waitForFunction(()=>CommuteDashboard.getSnapshot().selectedTrain.cancelled);assert.equal((await snap()).best,null);assert.match(await page.locator('#recommendation').innerText(),/cancelled/);
 await plan('2026-11-11','08:00');await page.locator('#operator-select').selectOption('shuttle');assert.equal((await snap()).count,0);
 await plan('2026-09-07','12:00');assert.equal(E.hhmm((await snap()).best.departure),'12:05');await closeControls();await page.locator('[data-action="best"]').click();assert.match(await page.locator('.lunch-continuation').innerText(),/12:16/);await page.keyboard.press('Escape');
 console.log('✓ Train deadline, adjustable margin, cancellation, no delay extension, holidays and lunch');
 // Fixture-driven punctuality and occupancy: exact GTFS trip/date/stop matches.
 const now=E.wallEpoch('2026-09-07','08:00');
 const raws=E.filterRows(E.allRows(D,{reference:now,direction:'toBN',horizon:60,mode:'plan'}),{operator:'delijn',stop:'picard',sort:'departure'}).filter(r=>r.departure>=now+360).slice(0,4);
 assert.equal(raws.length,4);const trips={};
 for(const [i,r] of raws.entries()){const delay=[0,120,180,-60][i];trips[r.tripId]={date:'20260907',timestamp:now,stops:[{stop:r.origin.id,seq:r.originSequence,departure:{time:r.departure+delay},occupancyStatus:i===0?0:undefined},{stop:r.destination.id,seq:r.destinationSequence,arrival:{time:r.arrival+delay}}]}}
 const cc=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Europe/Brussels'}),cp=await cc.newPage();cp.on('pageerror',e=>errors.push(e.message));await cp.clock.install({time:new Date(now*1000)});
 await cp.route('**/api/live/refresh',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({serverTime:now,lastAttempt:now,providers:{delijn:{ok:true,fetchedAt:now,feedTime:now,trips},stib:{ok:false}},quota:{refreshesLeft:40}})}));
 await cp.goto(URL,{waitUntil:'networkidle'});await cp.locator('#refresh-button').click();await cp.waitForFunction(()=>CommuteDashboard.getSnapshot().live?.providers?.delijn?.ok);await cp.locator('#planner summary').click();await cp.locator('#operator-select').selectOption('delijn');await cp.locator('#stop-select').selectOption('picard');await cp.locator('#planner summary').click();
 for(const [tone,color] of [['on-time','rgb(20, 118, 62)'],['minor-delay','rgb(165, 91, 0)'],['major-delay','rgb(180, 35, 24)'],['early','rgb(23, 92, 211)']]){
  assert.ok(await cp.locator(`#departures .tone-${tone}`).count()>0,tone);
  assert.equal(await cp.locator(`#departures .tone-${tone} .actual`).first().evaluate(e=>getComputedStyle(e).color),color);
 }
 assert.ok(await cp.locator('.original-time').count()>0);assert.equal(await cp.locator('.original-time').first().evaluate(e=>getComputedStyle(e).color),'rgb(0, 0, 0)');assert.ok(await cp.locator('.occupancy[title*="Empty"]').count()>0);
 assert.equal(await cp.locator('#recommendation .home-under-departure .actual').evaluate(e=>getComputedStyle(e).color),'rgb(102, 112, 133)');
 await cp.screenshot({path:path.join(cache,'glance-delays-test-fixture.png'),fullPage:true});await cc.close();
 console.log('✓ Green zero delay, orange <3m, red ≥3m, blue early, black originals, gray home and optional occupancy');
 // The cache/status GET is free. Anonymous mode must never POST automatically.
 async function accessPage(registered){
  const c=await browser.newContext({viewport:{width:390,height:844}}),p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.clock.install({time:new Date(now*1000)});
  await p.addInitScript(({registered})=>{window.__refreshes=0;window.__statusReads=0;window.__hidden=false;window.__quota=40;window.__key=registered;window.__modes=[];Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__hidden});const native=window.fetch;
   const payload=()=>({serverTime:Date.now()/1000,lastAttempt:Date.now()/1000,providers:{},access:{mode:window.__key?'registered':'anonymous',keyConfigured:window.__key,autoRefreshAllowed:window.__key},quota:{refreshesLeft:window.__quota}});
   window.fetch=async(u,o)=>{if(String(u).endsWith('/api/live/refresh')){window.__refreshes++;window.__modes.push(o.headers['X-Commute-Refresh']);return new Response(JSON.stringify(payload()),{status:200,headers:{'Content-Type':'application/json'}})}if(String(u).endsWith('/api/live')){window.__statusReads++;return new Response(JSON.stringify(payload()),{status:200,headers:{'Content-Type':'application/json'}})}return native(u,o)};
  },{registered});await p.goto(URL);await p.waitForFunction(()=>CommuteDashboard.getSnapshot().access!==null);return{c,p};
 }
 const anonymous=await accessPage(false),an=anonymous.p;
 assert.equal(await an.evaluate(()=>window.__refreshes),0);assert.match(await an.locator('#live-status').innerText(),/Manual live/);
 await an.clock.runFor(180000);await an.evaluate(()=>window.dispatchEvent(new Event('focus')));await an.clock.runFor(61000);assert.equal(await an.evaluate(()=>window.__refreshes),0);
 await an.locator('#refresh-button').click();await an.waitForFunction(()=>window.__refreshes===1);assert.equal(await an.evaluate(()=>window.__modes[0]),'manual');
 await an.clock.runFor(180000);assert.equal(await an.evaluate(()=>window.__refreshes),1);await anonymous.c.close();
 const authenticated=await accessPage(true),ap=authenticated.p;
 await ap.waitForFunction(()=>window.__refreshes===1);assert.equal(await ap.evaluate(()=>window.__modes[0]),'automatic');
 await ap.clock.runFor(61000);assert.equal(await ap.evaluate(()=>window.__refreshes),2);
 await ap.evaluate(()=>{window.__hidden=true;document.dispatchEvent(new Event('visibilitychange'))});await ap.clock.runFor(180000);assert.equal(await ap.evaluate(()=>window.__refreshes),2);
 await ap.evaluate(()=>{window.__hidden=false;document.dispatchEvent(new Event('visibilitychange'))});await ap.waitForFunction(()=>window.__refreshes===3);
 await ap.clock.runFor(1200000);const capped=await ap.evaluate(()=>window.__refreshes);assert.ok(capped<=22);await ap.clock.runFor(120000);assert.equal(await ap.evaluate(()=>window.__refreshes),capped);assert.match(await ap.locator('#refresh-label').innerText(),/Resume/);
 await ap.locator('#refresh-button').click();await ap.waitForFunction(n=>window.__refreshes===n+1,capped);assert.equal(await ap.evaluate(()=>window.__modes.at(-1)),'manual');
 await ap.evaluate(()=>window.__quota=0);await ap.clock.runFor(61000);await ap.waitForFunction(()=>CommuteDashboard.getSnapshot().live.quota.refreshesLeft===0);const atLimit=await ap.evaluate(()=>window.__refreshes);await ap.clock.runFor(120000);assert.equal(await ap.evaluate(()=>window.__refreshes),atLimit);
 await ap.evaluate(()=>{window.__quota=40;window.dispatchEvent(new Event('focus'))});await ap.waitForFunction(n=>window.__refreshes>n,atLimit);
 await ap.clock.runFor(6000);await ap.evaluate(()=>{window.__key=false;window.dispatchEvent(new Event('focus'))});await ap.waitForFunction(()=>!CommuteDashboard.getSnapshot().access.autoRefreshAllowed);const switched=await ap.evaluate(()=>window.__refreshes);await ap.clock.runFor(120000);assert.equal(await ap.evaluate(()=>window.__refreshes),switched);
 await authenticated.c.close();console.log('✓ Anonymous manual-only, registered auto lifecycle, hidden pause, 20-minute cap, quota recheck and key removal');
 // A fresh STIB list is authoritative through its last prediction, without
 // claiming exact trip identities; estimated matches/delays are visibly marked.
 const sc=await browser.newContext({viewport:{width:390,height:844}}),sp=await sc.newPage();sp.on('pageerror',e=>errors.push(e.message));await sp.clock.install({time:new Date(now*1000)});
 await sp.route('**/api/live/refresh',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({serverTime:now,lastAttempt:now,access:{mode:'anonymous',autoRefreshAllowed:false},providers:{stib:{ok:true,fetchedAt:now,records:[10,30].map(m=>({stop:'1019',line:'14',destination:{fr:'GARE DU NORD'},time:now+m*60}))}},quota:{refreshesLeft:40}})}));
 await sp.goto(URL,{waitUntil:'networkidle'});await sp.locator('#refresh-button').click();await sp.waitForFunction(()=>CommuteDashboard.getSnapshot().live?.providers?.stib?.ok);await sp.locator('#planner summary').click();await sp.locator('#operator-select').selectOption('stib');await sp.locator('#stop-select').selectOption('picard');
 const sr=await sp.evaluate(()=>CommuteDashboard.getSnapshot().rows);assert.deepEqual(sr.filter(r=>r.quality==='live').map(r=>(r.departure-now)/60).sort((a,b)=>a-b),[10,30]);assert.ok(sr.filter(r=>r.quality==='scheduled').every(r=>r.departure>=now+31*60));assert.ok(sr.filter(r=>r.quality==='live').every(r=>Number.isFinite(r.scheduledDeparture)&&r.delayEstimated&&r.tripId===null));
 assert.ok(await sp.locator('.estimated-delay').count()>0);
 assert.match(await sp.locator('.estimated-delay').first().innerText(),/≈/);
 await sc.close();console.log('✓ STIB live 10m/30m window removes intervening schedules and keeps later timetable calls');
 // Direct De Lijn stop API fixture: paired forecasts override the limited BMC path.
 const dc=await browser.newContext({viewport:{width:390,height:844}}),dp=await dc.newPage();dp.on('pageerror',e=>errors.push(e.message));await dp.clock.install({time:new Date(now*1000)});
 const dr=E.allRows(D,{reference:now,direction:'toBN',mode:'plan',horizon:60}).find(r=>r.operator==='delijn'&&r.line==='R41'&&r.origin.group==='picard'&&E.hhmm(r.departure)==='08:11');
 const bits=dr.tripId.match(/^gt:delijn:(\d+)_(\d+)_/);const jid=`${dr.serviceDate}_${bits[1]}_${bits[2]}`;
 const records=[{stop:dr.origin.id,journeyId:jid,planned:dr.scheduledDeparture,expected:dr.scheduledDeparture+360,realtime:true,vehicleId:'fixture-2659'},{stop:dr.destination.id,journeyId:jid,planned:dr.scheduledArrival,expected:dr.scheduledArrival+420,realtime:true}];
 await dp.route('**/api/live/refresh',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({serverTime:now,lastAttempt:now,access:{mode:'anonymous',autoRefreshAllowed:false,delijnStopKeyConfigured:true,delijnSource:'stop-api'},providers:{delijn:{ok:true,kind:'stop-api',fetchedAt:now,records}},quota:{refreshesLeft:40}})}));
 await dp.goto(URL,{waitUntil:'networkidle'});await dp.locator('#refresh-button').click();await dp.waitForFunction(()=>CommuteDashboard.getSnapshot().rows.some(r=>r.liveSource==='delijn-stop-api'));
 const direct=await dp.evaluate(()=>CommuteDashboard.getSnapshot().rows.find(r=>r.liveSource==='delijn-stop-api'));assert.equal(direct.delay,360);assert.equal(direct.arrivalDelay,420);assert.equal(direct.delayEstimated,false);
 await dc.close();console.log('✓ Direct De Lijn paired stop forecasts, marked MIVB schedule estimates and shuttle exemption');
 // Offline and the viewer's opaque-origin sandbox must remain functional.
 const off=await context.newPage();await off.clock.install({time:new Date('2026-09-05T12:00:00Z')});off.on('pageerror',e=>errors.push(e.message));await off.goto('file://'+path.join(__dirname,'Dashboard.html'));assert.match(await off.locator('#live-status').innerText(),/Offline/);await off.locator('#planner summary').click();await off.locator('#train-button').click();assert.ok(await off.locator('#load-trains').isDisabled());await off.locator('#train-date').fill('2026-09-07');await off.locator('#manual-train-time').fill('08:30');await off.locator('[data-action="manual-train"]').click();assert.equal(await off.evaluate(()=>CommuteDashboard.engine.hhmm(CommuteDashboard.getSnapshot().best.journeyStart)),'08:14');
 const sandbox=await context.newPage();sandbox.on('pageerror',e=>errors.push(e.message));await sandbox.setContent('<iframe sandbox="allow-scripts" style="width:100%;height:100vh"></iframe>');await sandbox.locator('iframe').evaluate((e,html)=>e.srcdoc=html,fs.readFileSync(path.join(__dirname,'Dashboard.html'),'utf8'));const frame=sandbox.frameLocator('iframe');await frame.locator('#planner summary').click();await frame.locator('#plan-button').click();await frame.locator('#plan-date').fill('2026-09-07');await frame.locator('#plan-time').fill('08:00');await frame.locator('#local-clock').click();assert.match(await frame.locator('#recommendation').innerText(),/Picard/);
 assert.deepEqual(errors,[]);console.log('✓ Standalone/manual train plan, opaque iframe and no uncaught browser errors');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
