(function () {
  'use strict';
  const E = window.CommuteEngine;
  const DATA = JSON.parse(document.getElementById('timetable-data').textContent);
  const WALKS = JSON.parse(document.getElementById('walking-data').textContent);
  const PDF = JSON.parse(document.getElementById('pdf-data').textContent);
  const LOGOS = JSON.parse(document.getElementById('operator-logos').textContent);
  const FETCH_DATE = E.dateISO(Math.max(...Object.values(DATA.operators).map(d => Date.parse(d.fetchedAt || DATA.generatedAt) / 1000)));
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  const safeURL = value => /^https?:\/\//i.test(value || '') ? esc(value) : '#';
  const OP_NAMES = { shuttle: 'T&T Shuttle', stib: 'MIVB / STIB', delijn: 'De Lijn' };
  const STOP_NAMES = { all: 'All stops', suzan: 'Suzan Daniel', picard: 'Picard', thurn: 'Thurn en Taxis', shuttle: 'T&T shuttle', bn: 'Brussels North' };
  const STIB_LINES = [...new Set(Object.values(DATA.operators.stib.routes).map(r=>r.line))].sort((a,b)=>a.localeCompare(b,'en',{numeric:true}));
  const ICONS = {
    'arrow-right': '<path d="M4 12h15m-6-6 6 6-6 6"/>',
    'arrow-up-right': '<path d="M6 18 18 6M6 6h12v12"/>',
    'chevron-right': '<path d="m9 5 7 7-7 7"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    'calendar': '<rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4m8-4v4M4 11h16m-11 4h1m4 0h1"/>',
    'bolt': '<path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z"/>',
    'swap': '<path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/>',
    'route': '<circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M6 9v6a3 3 0 0 0 3 3h6M10 6h8m-3-3 3 3-3 3"/>',
    'refresh': '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.3 8a7.5 7.5 0 0 1 12.4-3L20 8M4 16l2.3 3A7.5 7.5 0 0 0 18.7 16"/>',
    'bus': '<rect x="5" y="3" width="14" height="16" rx="3"/><path d="M5 11h14M8 19v2m8-2v2M9 7h6M8 15h.01M16 15h.01"/>',
    'info': '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
    'close': '<path d="m6 6 12 12M6 18 18 6"/>',
    'pin': '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    'sort': '<path d="M8 4v16m-3-3 3 3 3-3M16 20V4m-3 3 3-3 3 3"/>',
    'layers': '<path d="m12 3 10 6-10 6L2 9l10-6Zm-9 11 9 5 9-5M3 19l9 5 9-5" transform="translate(0 -1) scale(1 .94)"/>',
    'sparkles': '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
    'clock': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    'moon': '<path d="M21 13.2A9 9 0 0 1 10.8 3 9 9 0 1 0 21 13.2Z"/>',
    'shield': '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
    'download': '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
    'check': '<path d="m5 12 4 4L19 6"/>',
    'warning': '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3h.01"/>',
    'train': '<rect x="5" y="3" width="14" height="15" rx="3"/><path d="M5 10h14m-10 4h.01m6 0h.01M9 18l-3 4m9-4 3 4M8 20h8"/>',
    'walking': '<circle cx="14" cy="4" r="2"/><path d="m8 22 3-8 4 4v4M5 12l4-3 4-2 3 6 4 1M11 14l2-7"/>'
  };
  function icon(name) { return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.info}</svg>`; }
  function fillIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }
  ICONS.arrive='<path d="M4 5v8a4 4 0 0 0 4 4h12m-5-5 5 5-5 5"/>';
  ICONS.people='<circle cx="9" cy="7" r="3"/><path d="M3 21v-5a6 6 0 0 1 12 0v5m1-17a3 3 0 0 1 0 6m3 11v-5a5 5 0 0 0-3-4"/>';
  const realNow=()=>Date.now()/1000;
  function preferences(){try{return JSON.parse(localStorage.getItem('commute:v2')||localStorage.getItem('commute:v1')||localStorage.getItem('northbound:v1')||'{}')}catch{return{}}}
  // URL parameters let a manual refresh reproduce the same trip: direction,
  // start, mode/date/time and the active filters. They win over saved prefs.
  function readURLState(){const q=new URLSearchParams(location.search),out={};
    const dir={bn:'toBN',tnt:'toTNT'}[String(q.get('to')||'').toLowerCase()];if(dir)out.direction=dir;
    const start=q.get('start');if(start==='home'||start==='tnt')out.startPoint=start;
    const mode=q.get('mode');if(['now','plan','train'].includes(mode))out.mode=mode;
    const date=q.get('date');if(date&&/^\d{4}-\d{2}-\d{2}$/.test(date))out.date=date;
    const time=q.get('time');if(time&&/^([01]\d|2[0-3]):[0-5]\d$/.test(time))out.time=time;
    const op=q.get('operator');if(['all','shuttle','stib','delijn'].includes(op))out.operator=op;
    const stop=q.get('stop');if(['all','picard','suzan','thurn','shuttle'].includes(stop))out.stop=stop;
    const horizon=Number(q.get('horizon'));if([60,120,240].includes(horizon))out.horizon=horizon;
    const sort=q.get('sort');if(['arrival','departure','latestStart'].includes(sort))out.sort=sort;
    const margin=Number(q.get('margin'));if(q.get('margin')!==null&&Number.isInteger(margin)&&margin>=0&&margin<=60)out.trainMargin=margin;
    const view=q.get('view');if(['list','timeline'].includes(view))out.view=view;
    if(q.get('collapse')==='1')out.collapse=true;
    return out;}
  const pref=preferences(), initialNow=realNow(), fromURL=readURLState();
  const state={direction:fromURL.direction||(pref.direction==='toTNT'?'toTNT':'toBN'),startPoint:fromURL.startPoint||pref.startPoint||(pref.includeWalking===false?'tnt':'home'),
    includeWalking:pref.startPoint?pref.startPoint==='home':pref.includeWalking!==false,includeReturnWalk:true,includeShuttle:true,walking:WALKS,
    mode:fromURL.mode||'now',planDate:fromURL.date||E.dateISO(initialNow),planTime:fromURL.time||E.hhmm(initialNow),reference:initialNow,horizon:fromURL.horizon||120,operator:fromURL.operator||'all',stop:fromURL.stop||'all',sort:fromURL.mode==='train'?(fromURL.sort||'latestStart'):fromURL.sort==='latestStart'?'arrival':fromURL.sort||'arrival',limit:8,
    live:null,loading:false,networkError:false,rows:[],best:null,comparison:null,dialogTab:null,dialogRow:null,
    collapse:fromURL.collapse===true,view:fromURL.view||'list',
    trainDate:fromURL.date||E.dateISO(initialNow),trainBoardTime:fromURL.time||E.hhmm(initialNow),trainMargin:fromURL.trainMargin??(Number.isInteger(pref.trainMargin)&&pref.trainMargin>=0&&pref.trainMargin<=60?pref.trainMargin:5),
    trainBoard:null,trainLoading:false,trainError:'',trainFilter:'',selectedTrain:null,trainResult:null,
    autoUntil:initialNow+1200,lastRequest:0,autoSessionStarted:initialNow,access:null,statusLoading:false,lastStatusRead:0,liveSequence:0,collapsedLimit:8,openAlternatives:new Set()};
  function savePreferences(){try{localStorage.setItem('commute:v2',JSON.stringify({direction:state.direction,startPoint:state.startPoint,trainMargin:state.trainMargin}))}catch{}}
  // Keep the visible state in the URL so a manual refresh/bookmark restores it.
  function syncURL(){try{
    const p=new URLSearchParams();
    p.set('to',state.direction==='toTNT'?'tnt':'bn');
    if(state.direction==='toBN')p.set('start',state.startPoint);
    if(state.mode!=='now')p.set('mode',state.mode);
    if(state.mode==='plan'){p.set('date',state.planDate);p.set('time',state.planTime)}
    if(state.mode==='train'){p.set('date',state.trainDate);p.set('time',state.trainBoardTime);p.set('margin',String(state.trainMargin))}
    if(state.operator!=='all')p.set('operator',state.operator);
    if(state.stop!=='all')p.set('stop',state.stop);
    if(state.horizon!==120)p.set('horizon',String(state.horizon));
    const defaultSort=state.mode==='train'?'latestStart':'arrival';
    if(state.sort!==defaultSort)p.set('sort',state.sort);
    if(state.collapse)p.set('collapse','1');
    if(state.view!=='list')p.set('view',state.view);
    const query=p.toString();
    history.replaceState(null,'',location.pathname+(query?'?'+query:'')+location.hash);
  }catch{}}
  const clock=epoch=>E.hhmm(epoch);
  const dateLabel=(epoch,style='short')=>new Intl.DateTimeFormat('en-GB',{timeZone:E.ZONE,weekday:style==='long'?'long':'short',day:'numeric',month:style==='long'?'long':'short'}).format(new Date(epoch*1000));
  const shortDate=iso=>new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'numeric',month:'short',year:'numeric'}).format(new Date(iso+'T12:00:00Z'));
  const stopName=s=>STOP_NAMES[s.group]||s.name;
  const localStop=r=>r.origin.group==='bn'?r.destination:r.origin;
  const liveMode=()=>state.mode==='now'||state.mode==='train'&&Boolean(state.trainResult?.usesLive);
  const rankMode=()=>state.mode==='train'?'latestStart':'arrival';
  const duration=s=>E.roundMinuteDelta(Math.max(0,s))/60+'m';
  function sourceText(r){return r.cancelled?'Cancelled':({live:'Live estimate',scheduled:'Published timetable',derived:'Morning departure +8 minutes',assumed:'User-assumed 8-minute peak grid',confirmed:'User-confirmed lunchtime direction'}[r.quality]||'Timetable')}
  function timeReference(){return state.mode==='train'?(state.selectedTrain&&E.dateISO(state.selectedTrain.scheduledDeparture)===E.dateISO(realNow())?realNow():null):state.reference}
  function relative(epoch){const ref=timeReference();if(ref===null)return null;const seconds=epoch-ref;return seconds< -30?'passed':Math.max(0,Math.floor(epoch/60)-Math.floor(ref/60))+'m'}
  function daySuffix(epoch){const base=state.mode==='train'?state.selectedTrain?.scheduledDeparture:state.reference;return base&&E.dateISO(epoch)!==E.dateISO(base)?dateLabel(epoch):''}
  function deltaText(delta){return (delta<0?'−':'+')+Math.abs(E.roundMinuteDelta(delta))/60+'m'}
  function operatorLogo(row){
    const src=LOGOS[row.operator];
    return src?`<img class="operator-timing-logo ${esc(row.operator)}" src="${src}" alt="${esc(OP_NAMES[row.operator]||row.operator)}" width="28" height="22" decoding="sync">`:icon('bus');
  }
  function eventClock(row,event='departure',extra=''){
    const t=E.timingStatus(row,event), rel=relative(t.actual), glyph=event==='departure'?operatorLogo(row):icon('arrive');
    const label=event==='departure'?'Bus departure':'Bus arrival at stop';
    const info=t.delta===null?(row.quality==='live'?'Live prediction; no plausible scheduled-time match':'Timetable; no live delay verification'):t.estimated?`Scheduled ${clock(t.original)} · ${t.delta===0?'0m':deltaText(t.delta)} estimated; ${row.delayEstimated?'STIB scheduled-trip identity is inferred, not provided by the API':'arrival projected from the live departure'}`:t.delta===0?'Operator live estimate matches schedule':`Scheduled ${clock(t.original)} · ${deltaText(t.delta)}`;
    return `<div class="event-clock tone-${t.tone} ${event==='departure'?'departure-event':'arrival-event'} ${extra}" title="${esc(info)}" aria-label="${label}: ${clock(t.actual)}. ${esc(info)}"><div class="clock-main">${glyph}${rel!==null?`<span class="rel-time">${esc(rel)}</span><span class="time-separator">›</span>`:''}<strong class="actual">${clock(t.actual)}</strong></div>${t.delta!==null&&Math.abs(t.delta)>=120?`<div class="clock-delta ${t.estimated?'estimated-delay':''}">(<span class="original-time">${clock(t.original)}</span> <span class="delta-value">${deltaText(t.delta)}</span>)</div>`:''}${daySuffix(t.actual)?`<small class="day-suffix">${esc(daySuffix(t.actual))}</small>`:''}</div>`;
  }
  function homeClock(row,kind='leave',extra=''){
    const epoch=kind==='leave'?row.leaveHomeBy:row.homeArrival;if(!Number.isFinite(epoch))return '';
    const rel=relative(epoch);return `<div class="home-clock ${extra}" title="${kind==='leave'?'Leave home by':'Arrive home'}; ${kind==='leave'?row.walkBeforeMinutes:row.walkAfterMinutes} min walk" aria-label="${kind==='leave'?'Leave home by':'Arrive home'} ${clock(epoch)}"><div class="clock-main">${icon('walking')}${rel!==null?`<span class="rel-time">${esc(rel)}</span><span class="time-separator">›</span>`:''}<strong class="actual">${clock(epoch)}</strong></div>${daySuffix(epoch)?`<small>${esc(daySuffix(epoch))}</small>`:''}</div>`;
  }
  function lineBadge(row){return row.routePageUrl?`<a class="line-badge ${row.operator} bus-page-link" href="${safeURL(row.routePageUrl)}" target="_blank" rel="noopener noreferrer" title="${esc(OP_NAMES[row.operator])} ${esc(row.line)} towards ${esc(row.headsign)}">${esc(row.line)}</a>`:`<span class="line-badge ${row.operator}">${esc(row.line)}</span>`}
  // Like the route links, but for the displayed stop's operator live page.
  function stopBadge(row){const s=localStop(row),url=row.operator==='shuttle'?null:E.stopPage(row.operator,s);return url?`<a class="stop-page-link" href="${safeURL(url)}" target="_blank" rel="noopener noreferrer" title="Live departures at ${esc(s.name)} · ${esc(OP_NAMES[row.operator])}">${esc(stopName(s))}</a>`:`<span>${esc(stopName(s))}</span>`}
  function occupancy(row){const o=row.occupancy;if(!o)return '';return `<span data-status="${esc(o.status)}" class="occupancy ${o.unboardable?'unboardable':''}" title="${esc(o.label+' · '+o.source+' · this departure')}" aria-label="Occupancy: ${esc(o.label)}">${icon('people')}<span>${esc(o.label)}</span></span>`}
  let toastTimer;function toast(text){clearTimeout(toastTimer);$('toast').textContent=text;$('toast').classList.add('visible');toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),4500)}
  const reference=window.CommuteReference({E,DATA,WALKS,PDF,FETCH_DATE,state,OP_NAMES,STIB_LINES,esc,safeURL,icon,realNow,dateLabel,clock,shortDate});

  function renderControls(){
    const inbound=state.direction==='toBN';document.body.dataset.direction=state.direction;
    document.querySelector('meta[name="theme-color"]').content=inbound?'#eaf1fa':'#eaf5ee';
    for(const dir of ['toBN','toTNT']){const b=$(dir==='toBN'?'to-bn':'to-home');b.classList.toggle('selected',state.direction===dir);b.setAttribute('aria-pressed',String(state.direction===dir))}
    $('start-controls').hidden=!inbound;
    for(const start of ['home','tnt']){const b=$('start-'+start);b.classList.toggle('selected',state.startPoint===start);b.setAttribute('aria-pressed',String(state.startPoint===start))}
    for(const mode of ['now','plan','train']){const b=$(mode+'-button');b.classList.toggle('selected',state.mode===mode);b.setAttribute('aria-pressed',String(state.mode===mode))}
    $('plan-fields').hidden=state.mode!=='plan';$('train-fields').hidden=state.mode!=='train';
    for(const [id,v] of [['plan-date',state.planDate],['plan-time',state.planTime],['operator-select',state.operator],['stop-select',state.stop],['horizon',state.horizon],['sort',state.sort]])if(document.activeElement!==$(id))$(id).value=v;
    $('collapse-alts').checked=state.collapse;$('latest-start-sort').hidden=state.mode!=='train';
    for(const option of $('horizon').options)option.textContent=state.mode==='train'?`Look back ${Number(option.value)/60}h`:`Next ${Number(option.value)/60}h`;
    const route=inbound?state.includeWalking?'Home → BN':'TNT stop → BN':'BN → Home (TNT)';
    const when=state.mode==='now'?'Now':state.mode==='train'?state.selectedTrain?`${state.selectedTrain.service} ${clock(state.selectedTrain.scheduledDeparture)} · ${dateLabel(state.selectedTrain.scheduledDeparture)}`:'Choose a train':`${dateLabel(state.reference)} · after ${clock(state.reference)}`;
    $('result-context').textContent=`${route} · ${when}${state.operator!=='all'||state.stop!=='all'?' · filtered':''}`;
    $('planner-summary').textContent=`${when} · ${inbound?state.includeWalking?'from home':'from TNT stop':'walk home included'}`;
    const scopeText=state.mode==='train'?`${state.trainMargin} min station margin. Plan against the scheduled train time.`:'';
    $('scope-note').textContent=scopeText;$('scope-note').hidden=!scopeText;
    renderTrainControls();
  }
  const autoAllowed=()=>state.access?.autoRefreshAllowed===true;
  // Dual transport: the local Python API when served by server.py, otherwise
  // the direct-to-operator layer embedded in the standalone build.
  const directLive=window.COMMUTE_SERVER?null:(window.CommuteLiveDirect?.available?window.CommuteLiveDirect:null);
  const liveLink=Boolean(window.COMMUTE_SERVER)||Boolean(directLive);
  function renderStatus(){
    const now=realNow(),providers=state.live?.providers||{},freshCount=Object.values(providers).filter(p=>E.fresh(p,now)).length;
    const fetched=Object.values(providers).filter(p=>p.fetchedAt).map(p=>p.fetchedAt);
    const errorKinds=Object.values(providers).map(p=>p.errorKind),hasFeedError=Object.values(providers).some(p=>p.error);
    let text;
    if(!liveLink)text='Offline · saved timetable';
    else if(!freshCount&&!state.live?.lastAttempt&&!state.networkError&&!hasFeedError)text=window.COMMUTE_SERVER?'Checking live access…':'Standalone · direct operator APIs';
    else if(!liveMode())text='Planned times · no current bus delays';
    else if(state.loading)text='Updating live data…';
    else if(!state.access&&state.statusLoading)text='Checking live access…';
    else if(providers.delijn?.kind==='stop-api'&&providers.delijn?.errorKind==='authentication')text='De Lijn key rejected · check Reference';
    else if(errorKinds.includes('authentication')&&!freshCount)text='API key rejected · check server settings';
    else if(errorKinds.includes('quota')&&!freshCount)text='Provider quota reached · timetable';
    else if(!autoAllowed())text=state.live?.quota?.refreshesLeft===0?'Manual live · daily limit reached':freshCount?`Manual live · cached ${clock(Math.max(...fetched))}`:state.networkError||hasFeedError?'Manual live · unavailable':'Manual live · press Refresh';
    else if(state.live?.quota?.refreshesLeft===0)text=freshCount?'Live checked · daily limit reached':'Timetable · live daily limit reached';
    else if(freshCount)text=`Updated ${clock(Math.max(...fetched))} · ${now<state.autoUntil?'auto 1m':'auto paused'}`;
    else text=`Timetable · ${state.networkError||hasFeedError?'live unavailable':state.live?'live expired':'checking live'}${now>=state.autoUntil?' · auto paused':''}`;
    $('live-status').textContent=text;$('live-status').className=freshCount?'available':'neutral';
    $('refresh-button').disabled=state.loading||!liveMode()||!liveLink;
    $('refresh-label').textContent=state.loading?'Updating':autoAllowed()&&liveMode()&&now>=state.autoUntil?'Resume':'Refresh';
    $('refresh-button').title=autoAllowed()?'Registered API: refresh and start a 20-minute visible-page session.':'Anonymous API: only this manual action fetches live operator data.';
  }
  function renderCoverage(){
    const date=state.mode==='train'&&state.selectedTrain?E.dateISO(state.selectedTrain.scheduledDeparture):E.dateISO(state.reference), key=E.dateKey(date),notes=[];
    for(const [op,d] of Object.entries(DATA.operators))if(key<d.feedStart||key>d.feedEnd)notes.push(`${OP_NAMES[op]} timetable does not cover ${date}. Update saved schedules.`);
    $('coverage-notice').hidden=!notes.length;$('coverage-notice').innerHTML=notes.length?`${icon('warning')}<span>${notes.map(esc).join('<br>')}</span>`:'';
  }
  function renderRecommendation(){
    const r=state.best,train=state.mode==='train';
    if(!r){let text=train&&!state.selectedTrain?'Choose a train below.':state.selectedTrain?.cancelled&&train?'Selected train cancelled.':train?'No connection meets this train deadline.':'No reachable departure in this window.';
      $('recommendation').innerHTML=`<div class="empty-glance"><h2>${text}</h2><button data-action="controls" class="text-button">Change trip or filters ${icon('chevron-down')}</button></div>`;return;}
    $('recommendation').innerHTML=`<div class="recommended-heading"><div class="service-title">${lineBadge(r)}${stopBadge(r)}${occupancy(r)}</div><button class="row-open" data-action="best" aria-label="Details for recommended trip">${icon('info')}</button></div><div class="recommended-time-grid"><div class="departure-cell"><div class="primary-label">Bus departure${train?' · catch your train':''}</div>${eventClock(r,'departure','primary-clock')}${r.leaveHomeBy!==null?homeClock(r,'leave','home-under-time home-under-departure'):''}</div><div class="arrival-cell"><div class="primary-label">${state.direction==='toBN'?'Arrives BN':'Bus arrives'}</div>${eventClock(r,'arrival','summary-arrival')}${r.homeArrival?homeClock(r,'arrive','home-under-time home-under-arrival'):''}</div></div>${train?`<div class="train-target">${icon('train')} Train <strong>${clock(r.trainDeparture)}</strong> · ${r.stationMargin} min minimum at BN</div>`:''}`;
  }
  function comparedClock(value, other){
    if(clock(value)!==clock(other)||value===other)return clock(value);
    return new Intl.DateTimeFormat('en-GB',{timeZone:E.ZONE,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(value*1000));
  }
  function collapsedReason(row){
    const better=state.rows.find(r=>r.id===row.dominatedBy);
    if(!better)return 'Collapsed: another listed option lets you start later and arrive earlier. This service is not cancelled.';
    const a=E.latestStart(row),b=E.latestStart(better),x=E.finalArrival(row),y=E.finalArrival(better);
    const origin=row.walkBeforeSeconds>0?'leave home':'depart',destination=row.homeArrival?'home':'BN';
    return `Collapsed because ${better.line} via ${stopName(localStop(better))} lets you ${origin} at ${comparedClock(b,a)} instead of ${comparedClock(a,b)}, and reach ${destination} at ${comparedClock(y,x)} instead of ${comparedClock(x,y)}. Not cancelled.`;
  }
  function optionHTML(r,collapsed=false){
    const note=r.cancelled?r.cancellationReason:r.boardingUnavailable?'Not accepting passengers':collapsed?collapsedReason(r):'';
    return `<article role="listitem" class="option-card ${r.id===state.best?.id?'recommended-option':''} ${collapsed?'collapsed-option':''} ${r.cancelled||r.boardingUnavailable?'cancelled':''}" data-row-id="${esc(r.id)}" data-line="${esc(r.line)}" data-stop="${esc(localStop(r).group)}"><div class="option-top"><div class="service-title">${lineBadge(r)}${stopBadge(r)}${occupancy(r)}</div><button class="row-open" data-action="detail" data-id="${esc(r.id)}" aria-label="Details ${esc(r.line)}, ${clock(r.departure)}${note?'; '+esc(note):''}">${icon('chevron-right')}</button></div><div class="option-times"><div class="option-time-cell departure-cell">${eventClock(r)}${r.leaveHomeBy!==null?homeClock(r,'leave','home-under-time home-under-departure'):''}</div><div class="option-time-cell arrival-cell">${eventClock(r,'arrival')}${r.homeArrival?homeClock(r,'arrive','home-under-time home-under-arrival'):''}</div></div>${r.cancelled||r.boardingUnavailable?`<p class="cancel-note">${esc(note)}</p>`:collapsed?`<p class="collapse-reason">${esc(note)}</p>`:''}</article>`;
  }
  // Collapsing only happens when the better option arrives MORE than 2 min
  // earlier (engine rule) and the user enables it; it is off by default.
  const collapseEligible=r=>state.collapse&&r.operator!=='shuttle'&&Boolean(r.collapseEligible ?? r.dominated);
  function timelineEvent(r,pos){
    const t=E.timingStatus(r,'departure'),rel=relative(t.actual);
    return `<div class="timeline-event tone-${t.tone} ${r.cancelled||r.boardingUnavailable?'cancelled':''}" style="top:${pos.top}px" data-dep="${r.departure}" data-action="detail" data-id="${esc(r.id)}" role="button" tabindex="0" aria-label="${esc(r.line)} at ${clock(t.actual)} from ${esc(r.origin.name)} to ${esc(r.destination.name)} toward ${esc(r.headsign)}${r.cancelled?', cancelled':''}"><strong>${clock(t.actual)}</strong>${rel!==null?`<span class="rel">${esc(rel)}</span>`:''}${lineBadge(r)}${t.delta!==null&&Math.abs(t.delta)>=120?`<span class="clock-delta ${t.estimated?'estimated-delay':''}">(<span class="original-time">${clock(t.original)}</span> <span class="delta-value">${deltaText(t.delta)}</span>)</span>`:''}${r.cancelled?`<span class="cancel-note">${esc(r.cancellationReason||'Cancelled')}</span>`:r.boardingUnavailable?'<span class="cancel-note">Not boarding</span>':''}</div>`;
  }
  // Connectors: when one physical trip serves Picard AND Suzan Daniel, both
  // boarding cards are shown and a line links them (catch it at the later stop).
  function drawTwinLinks(board,pairs){
    const box=board.getBoundingClientRect(),segments=[];
    for(const [aId,bId] of pairs){
      const a=board.querySelector(`.timeline-event[data-id="${CSS.escape(aId)}"]`),b=board.querySelector(`.timeline-event[data-id="${CSS.escape(bId)}"]`);
      if(!a||!b)continue;
      const ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect();
      segments.push({x1:ra.right-box.left,y1:ra.top+ra.height/2-box.top,x2:rb.left-box.left,y2:rb.top+rb.height/2-box.top,tone:a.className.match(/tone-([a-z-]+)/)?.[1]||'unknown'});
    }
    if(!segments.length)return;
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('class','tl-links');svg.setAttribute('width',box.width);svg.setAttribute('height',box.height);svg.setAttribute('viewBox',`0 0 ${box.width} ${box.height}`);
    for(const s of segments){
      const mid=(s.x1+s.x2)/2,p=document.createElementNS('http://www.w3.org/2000/svg','path');
      p.setAttribute('d',`M${s.x1} ${s.y1} C ${mid} ${s.y1}, ${mid} ${s.y2}, ${s.x2} ${s.y2}`);p.setAttribute('class','tl-link tone-'+s.tone);svg.appendChild(p);
    }
    board.appendChild(svg);
  }
  // Toggleable timeline: columns per boarding stop towards BN, per operator
  // towards TNT. All cards across all columns sit in one shared chronological
  // order: a later departure never appears above an earlier one, wherever it
  // sits, while uncongested cards stay on their proportional clock position.
  function drawTimeline(){
    const inbound=state.direction==='toBN';
    const cols=inbound?[{group:'shuttle',name:'TNT shuttle'},...(state.startPoint==='home'?[{group:'picard',name:'Picard'}]:[]),{group:'suzan',name:'Suzan Daniel'},{group:'thurn',name:'Thurn en Taxis'}]:[{group:'shuttle',name:'TNT'},{group:'stib',name:'MIVB'},{group:'delijn',name:'De Lijn'}];
    const keyOf=r=>inbound?r.origin.group:r.operator;
    // The timeline keeps both stops of a multi-stop trip; the deduplicated
    // list rows stay untouched, so rebuild rows without preferred-stop selection.
    const now=realNow(),reference=state.reference;
    let timed;
    if(state.mode==='train'){timed=state.rows;}
    else{
      const raw=E.allRows(DATA,{...state,reference:reference-3600,horizon:state.horizon+60,includeWalking:false,includeReturnWalk:false},state.live,now);
      const filtered=raw.filter(r=>(state.operator==='all'||r.operator===state.operator)&&(state.stop==='all'||localStop(r).group===state.stop));
      timed=E.applyWalking(filtered,state).filter(r=>r.departure>=reference-60&&r.departure<=reference+state.horizon*60);
    }
    if(!inbound){
      // One physical vehicle appears once per alighting stop. Collapse to one
      // card per trip: to Picard when served, otherwise to Suzan Daniel.
      const stopRank=r=>({picard:0,suzan:1})[localStop(r).group]??2;
      const byTrip=new Map();
      for(const r of timed){
        const trip=r.tripId||r.estimatedTripId,key=trip?r.operator+'|'+r.serviceDate+'|'+trip:null;
        if(!key){byTrip.set('row-'+r.id,r);continue;}
        const keep=byTrip.get(key);
        if(!keep||stopRank(r)<stopRank(keep)||(stopRank(r)===stopRank(keep)&&r.departure<keep.departure))byTrip.set(key,r);
      }
      timed=[...byTrip.values()];
    }
    const buckets=Object.fromEntries(cols.map(c=>[c.group,[]]));
    for(const r of timed)if(buckets[keyOf(r)])buckets[keyOf(r)].push(r);
    const lists=cols.map(c=>buckets[c.group].sort((a,b)=>a.departure-b.departure).slice(0,20));
    const all=lists.flat();
    if(!all.length){$('departure-rows').innerHTML='<p class="timeline-empty">No departures in this window</p>';return;}
    const t0=Math.floor(Math.min(...all.map(r=>r.departure))/60)*60,tEnd=Math.max(...all.map(r=>r.departure));
    const ppm=(tEnd-t0)>200*60?6:9,CARD=25,TALL=38,GAP=2,SLOP=12;
    const tickAt=t=>(t-t0)*ppm/60;
    const cardH=r=>r.cancelled||r.boardingUnavailable||(t=>t.delta!==null&&Math.abs(t.delta)>=120)(E.timingStatus(r,'departure'))?TALL:CARD;
    // Compact packing: walk all cards in departure order with one shared
    // waterline. Simultaneous (same-minute) departures sit at an identical
    // height across columns; cards in DIFFERENT columns may overlap their
    // predecessor's card vertically by up to SLOP px to stay near their clock
    // position; cards in the same column never overlap.
    const ordered=[...all].sort((a,b)=>a.departure-b.departure||String(a.id).localeCompare(String(b.id)));
    const colOf=new Map();
    for(let ci=0;ci<cols.length;ci++)for(const r of lists[ci])colOf.set(r.id,ci);
    const positions=new Map(),laneBottom=new Map();let bottom=0,cursor=0,prevMinute=null,prevTop=-1;
    for(const r of ordered){
      const h=cardH(r),pos=tickAt(r.departure),minute=Math.floor(r.departure/60),lane=colOf.get(r.id);
      let top=minute===prevMinute&&prevTop>=0?prevTop:Math.max(pos,cursor-SLOP);
      top=Math.max(top,(laneBottom.has(lane)?laneBottom.get(lane):-Infinity)+GAP);
      positions.set(r.id,{top,h});
      laneBottom.set(lane,top+h);cursor=Math.max(cursor,top+h);prevMinute=minute;prevTop=top;
    }
    bottom=Math.max(cursor,CARD);
    const H=Math.max(bottom,(tEnd-t0)*ppm/60+CARD);
    const ticks=[];for(let t=Math.ceil(t0/900)*900;t<=tEnd;t+=900)ticks.push(t);
    // Same-vehicle cards in both Picard and Suzan Daniel (linked twins).
    const twinPairs=[];
    if(inbound){
      const tgroups=new Map();
      for(const r of all){const key=r.tripId||r.estimatedTripId;if(!key)continue;const g=r.origin.group;if(g!=='picard'&&g!=='suzan')continue;const tk=r.operator+'|'+r.serviceDate+'|'+key;if(!tgroups.has(tk))tgroups.set(tk,new Map());tgroups.get(tk).set(g,r);}
      for(const g of tgroups.values())if(g.has('picard')&&g.has('suzan'))twinPairs.push([g.get('picard').id,g.get('suzan').id]);
    }
    $('departure-rows').innerHTML=`<div class="tl-scroll"><div class="timeline-grid tl-board" style="--tl-cols:${cols.length}"><div class="tl-ruler"><div class="tl-ruler-head"></div><div class="tl-lane" style="height:${H}px">${ticks.map(t=>`<span class="tl-tick" style="top:${tickAt(t)}px">${clock(t)}</span>`).join('')}</div></div>${cols.map((c,ci)=>{
      const list=lists[ci],extra=buckets[c.group].length-list.length,last=list.length?positions.get(list[list.length-1].id):null;
      return `<section class="timeline-col" data-group="${c.group}"><h2>${esc(c.name)}</h2><div class="tl-lane" style="height:${H}px">${ticks.map(t=>`<i class="tl-line" style="top:${tickAt(t)}px"></i>`).join('')}${list.map(r=>timelineEvent(r,positions.get(r.id))).join('')}${extra?`<span class="tl-more" style="top:${(last?.top??0)+(last?.h??0)+6}px">+${extra} later</span>`:''}${!list.length?'<p class="timeline-empty">No departures in this window</p>':''}</div></section>`;
    }).join('')}</div></div>`;
    const board=$('departure-rows').querySelector('.tl-board');
    if(!board)return;
    // Re-pack with the real rendered heights (cards can wrap to two lines on
    // narrow columns), keeping the same compact shared order.
    const events=[...board.querySelectorAll('.timeline-event')].sort((a,b)=>(+a.dataset.dep)-(+b.dataset.dep)||a.dataset.id.localeCompare(b.dataset.id));
    let maxBottom=H;cursor=0;prevMinute=null;prevTop=-1;
    const trueLaneBottom=new Map();
    for(const e of events){
      const dep=+e.dataset.dep,minute=Math.floor(dep/60),lane=e.closest('.timeline-col');
      let top=minute===prevMinute&&prevTop>=0?prevTop:Math.max(parseFloat(e.style.top)||0,cursor-SLOP);
      top=Math.max(top,(trueLaneBottom.has(lane)?trueLaneBottom.get(lane):-Infinity)+GAP);
      e.style.top=top+'px';
      trueLaneBottom.set(lane,top+e.offsetHeight);cursor=Math.max(cursor,top+e.offsetHeight);prevMinute=minute;prevTop=top;
    }
    maxBottom=Math.max(maxBottom,cursor);
    for(const col of board.querySelectorAll('.timeline-col')){
      const more=col.querySelector('.tl-more'),evs=[...col.querySelectorAll('.timeline-event')];
      if(!more||!evs.length)continue;
      const last=evs[evs.length-1],top=parseFloat(last.style.top)+last.offsetHeight+6;
      more.style.top=top+'px';maxBottom=Math.max(maxBottom,top+12);
    }
    board.querySelectorAll('.tl-lane').forEach(l=>{l.style.height=maxBottom+'px'});
    if(twinPairs.length)drawTwinLinks(board,twinPairs);
  }
  function renderRows(){
    const timeline=state.view==='timeline';
    $('departures-heading').textContent=state.mode==='train'?'Train connections':'Departures';
    document.querySelectorAll('.view-switch button').forEach(b=>{b.classList.toggle('selected',state.view===b.dataset.view);b.setAttribute('aria-pressed',String(state.view===b.dataset.view))});
    if(timeline){
      $('departure-count').textContent=String(state.rows.length);
      drawTimeline();$('empty-state').hidden=true;$('show-more').hidden=true;
      return;
    }
    const normal=state.rows.filter(r=>!collapseEligible(r)),folded=state.rows.length-normal.length;
    $('departure-count').textContent=`${normal.length}${folded?' + '+folded+' alternatives':''}`;
    let html='',i=0,shown=0;
    while(i<state.rows.length){
      if(collapseEligible(state.rows[i])){
        const group=[];while(i<state.rows.length&&collapseEligible(state.rows[i]))group.push(state.rows[i++]);
        const key=group[0].id,open=state.openAlternatives.has(key);
        html+=`<details class="inline-alternatives" data-alt-group="${esc(key)}" ${open?'open':''} role="listitem"><summary title="Earlier start and later arrival than another available option; not cancelled"><span>${group.length} ${group.length===1?'alternative':'alternatives'}</span>${icon('chevron-down')}</summary><div class="inline-alt-body" role="list"><p class="inline-alt-intro">These leave earlier and arrive later than another listed option. Expand the comparison below; the services are not cancelled.</p>${group.slice(0,state.collapsedLimit).map(r=>optionHTML(r,true)).join('')}${group.length>state.collapsedLimit?'<button class="text-button" data-action="more-inline">More alternatives</button>':''}</div></details>`;
      }else{
        if(shown>=state.limit)break;
        html+=optionHTML(state.rows[i++]);shown++;
      }
    }
    $('departure-rows').innerHTML=html;
    document.querySelectorAll('.inline-alternatives').forEach(el=>el.addEventListener('toggle',()=>{el.open?state.openAlternatives.add(el.dataset.altGroup):state.openAlternatives.delete(el.dataset.altGroup)}));
    $('empty-state').hidden=state.rows.length>0;$('empty-state').innerHTML=state.rows.length?'':'<p>No matching options. Try another time or clear the filters.</p><button class="text-button" data-action="reset-filters">Clear filters</button>';
    $('show-more').hidden=normal.length<=state.limit;$('show-more').textContent=`Show ${Math.min(8,normal.length-state.limit)} more departures`;
  }
  function render(){
    const active=document.activeElement,focus=active?.dataset?.action?{action:active.dataset.action,id:active.dataset.id}:null;
    state.includeWalking=state.startPoint==='home';
    if(state.mode==='train'){
      state.direction='toBN';const t=state.selectedTrain;
      state.trainResult=t&&!t.cancelled&&!t.left?E.planForTrain(DATA,{...state,trainDeparture:t.scheduledDeparture,stationMargin:state.trainMargin},state.live,realNow()):null;
      state.reference=state.trainResult?.reference??E.wallEpoch(state.trainDate,state.trainBoardTime);state.comparison=null;state.rows=E.filterRows(state.trainResult?.rows||[],{...state,sort:state.sort});
    }else{
      state.trainResult=null;state.reference=state.mode==='now'?realNow():E.wallEpoch(state.planDate,state.planTime);
      state.comparison=E.comparison(DATA,state,state.live,realNow());state.rows=state.comparison.rows;
    }
    state.best=E.filterRows(state.rows,{sort:rankMode(),direction:state.direction}).find(r=>!r.cancelled&&!r.boardingUnavailable)||null;
    syncURL();renderControls();renderStatus();renderCoverage();renderRecommendation();renderRows();
    if(focus&&!document.contains(active)){const candidate=[...document.querySelectorAll(`[data-action="${focus.action}"]`)].find(e=>e.dataset.id===focus.id);candidate?.focus({preventScroll:true})}
  }

  // Capability discovery reads our cache only. It never fetches either operator.
  // Auto refresh is fail-closed until the server confirms that a key is configured.
  function beginSession(){state.autoSessionStarted=realNow();state.autoUntil=state.autoSessionStarted+1200}
  function autoDue(){return liveLink&&autoAllowed()&&liveMode()&&!document.hidden&&!state.loading&&realNow()<state.autoUntil&&realNow()-state.lastRequest>=60&&state.live?.quota?.refreshesLeft!==0}
  function acceptLive(payload){state.live=payload;state.access=payload.access||{mode:'anonymous',keyConfigured:false,autoRefreshAllowed:false}}
  async function readLiveCache(resume=false){
    if(!liveLink||state.statusLoading||state.loading)return;
    if(realNow()-state.lastStatusRead<5){if(resume&&autoAllowed())beginSession();maybeRefresh();return;}
    state.lastStatusRead=realNow();state.statusLoading=true;const sequence=++state.liveSequence;renderStatus();
    try{
      const payload=directLive?await directLive.getLive():await (async()=>{const response=await fetch('/api/live',{headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('Cache unavailable');return response.json()})();
      if(sequence===state.liveSequence){acceptLive(payload);if(resume&&autoAllowed())beginSession()}
    }
    catch{if(sequence===state.liveSequence)state.networkError=true}
    finally{state.statusLoading=false;render();if(resume&&autoAllowed()&&liveMode()&&!document.hidden&&!state.loading&&realNow()-state.lastRequest>=60&&state.live?.quota?.refreshesLeft===0)refreshLive();else maybeRefresh()}
  }
  async function refreshLive(manual=false){
    if(!liveLink||!liveMode()||state.loading||(!manual&&!autoAllowed()))return;
    if(manual)beginSession();state.lastRequest=realNow();state.loading=true;state.networkError=false;const sequence=++state.liveSequence;renderStatus();
    try{
      const payload=directLive?await directLive.refresh(manual):await (async()=>{const response=await fetch('/api/live/refresh',{method:'POST',headers:{Accept:'application/json','X-Commute-Refresh':manual?'manual':'automatic'},signal:AbortSignal.timeout(25000)});if(!response.ok)throw new Error('Live unavailable');return response.json()})();
      if(!payload.providers||!payload.serverTime)throw new Error('Invalid response');if(sequence===state.liveSequence)acceptLive(payload);if(manual&&payload.notice)toast(payload.notice)
    }
    catch{state.networkError=true;state.live=null;if(manual)toast('Live data unavailable; showing timetables.')}
    finally{state.loading=false;render();}
  }
  function maybeRefresh(){if(autoDue()){refreshLive();if(state.mode==='train'&&state.selectedTrain?.source==='irail'&&state.trainBoard&&!state.trainLoading)loadTrains(true)}}
  function resumed(){if(document.hidden)return;readLiveCache(true)}
  document.addEventListener('visibilitychange',resumed);window.addEventListener('focus',resumed);window.addEventListener('pageshow',e=>{if(e.persisted)resumed()});
  window.addEventListener('resize',()=>{if(state.view==='timeline')renderRows()}); // keep connectors aligned

  let trainRequest=0;
  function renderTrainControls(){
    if(state.mode!=='train')return;
    for(const [id,value] of [['train-date',state.trainDate],['train-board-time',state.trainBoardTime],['train-margin',state.trainMargin]])if(document.activeElement!==$(id))$(id).value=value;
    $('load-trains').disabled=state.trainLoading||!liveLink;$('load-trains').textContent=state.trainLoading?'Loading…':'Load train departures';
    const board=state.trainBoard;
    $('train-board-status').textContent=!liveLink?'Offline: use a manual train time.':state.trainError||(board?`${board.departures.length} departures · iRail checked ${clock(board.fetchedAt)}`:'Load departures or enter a train time.');
    $('train-filter-label').hidden=!board?.departures?.length;renderTrainBoard();
    const t=state.selectedTrain;$('selected-train').hidden=!t;$('selected-train').innerHTML=t?`<strong>${esc(t.service)} · ${esc(t.destination)} · ${clock(t.scheduledDeparture)}</strong><span>${t.cancelled?'Cancelled':t.left?'Departed':`BN by ${clock(t.scheduledDeparture-state.trainMargin*60)} · ${state.trainMargin} min margin`}</span><small>${t.source==='manual'?'Manual time; no train service verified.':'Scheduled train time used; delays do not extend the deadline.'}</small>`:'';
  }
  function renderTrainBoard(){
    const term=state.trainFilter.toLocaleLowerCase();$('train-board').innerHTML=(state.trainBoard?.departures||[]).filter(t=>(t.service+' '+t.destination).toLocaleLowerCase().includes(term)).map(t=>`<button class="train-option ${state.selectedTrain?.id===t.id?'selected':''}" data-action="select-train" data-id="${esc(t.id)}" ${t.cancelled||t.left?'disabled':''}><strong>${clock(t.scheduledDeparture)}</strong><span><b>${esc(t.destination)}</b><small>${esc(t.service)} · platform ${esc(t.platform)}</small></span><span>${t.cancelled?'Cancelled':t.left?'Departed':t.delaySeconds?'+'+Math.abs(E.roundMinuteDelta(t.delaySeconds))/60+'m':'Select'}</span></button>`).join('');
  }
  async function loadTrains(automatic=false){
    if(!liveLink||state.trainLoading)return;
    const date=$('train-date').value||state.trainDate,time=$('train-board-time').value||state.trainBoardTime;if(!date||!time)return;
    state.trainDate=date;state.trainBoardTime=time;state.trainLoading=true;state.trainError='';const request=++trainRequest;renderTrainControls();
    try{
      const {status,data}=directLive?await directLive.trains(date,time):await (async()=>{const response=await fetch(`/api/trains?date=${encodeURIComponent(date)}&time=${encodeURIComponent(time)}`,{signal:AbortSignal.timeout(25000)});return {status:response.status,data:await response.json()}})();
      if(request!==trainRequest)return;if(status>=400||!data.ok||!Array.isArray(data.departures))throw new Error(data.error||'Train board unavailable');state.trainBoard=data;if(state.selectedTrain?.source==='irail'){const t=data.departures.find(t=>t.id===state.selectedTrain.id);if(t)state.selectedTrain=t}}
    catch(e){if(request===trainRequest){state.trainError=e.message;if(!automatic)state.trainBoard=null}}
    finally{if(request===trainRequest){state.trainLoading=false;render()}}
  }
  function useManualTrain(){const date=$('train-date').value,time=$('manual-train-time').value;if(!date||!time){toast('Choose the train date and time.');return}state.trainDate=date;state.selectedTrain={id:'manual-'+date+'T'+time,source:'manual',service:'Manual train time',destination:'Brussels North',scheduledDeparture:E.wallEpoch(date,time),platform:'?',cancelled:false,left:false};state.sort='latestStart';state.limit=8;render();$('planner').open=false;$('recommendation').scrollIntoView({behavior:'smooth',block:'start'})}

  async function handleKeyAction(action){
    if(state.dialogTab!=='keys')return;
    const D=window.CommuteLiveDirect;
    if(!directLive||!D){toast('Browser keys apply to the standalone build; this copy is server-backed.');return}
    if(action==='save-keys'){
      const bmc=$('key-bmc').value.trim(),delijn=$('key-delijn').value.trim();
      D.setKeys({bmc,delijn});
      toast(bmc||delijn?'Keys saved in this browser.':'No values entered; stored keys removed.');
    }else{
      D.clearKeys();toast('Stored keys removed from this browser.');
    }
    // Re-read access so Refresh/auto state and the quota notice follow the new mode.
    state.access=null;state.lastStatusRead=0;await readLiveCache();openReference('keys');
  }

  function openReference(tab='method'){    state.dialogTab=tab;state.dialogRow=null;$('dialog-eyebrow').textContent='REFERENCE';
    const tabs=[['method','Rules & colours'],['shuttle','Shuttle'],['walking','Walking'],['stops','Stops'],['sources','Sources'],['keys','API keys'],['technical','API & HA']];
    $('dialog-title').textContent=Object.fromEntries(tabs)[tab]||'Reference';$('dialog-tabs').innerHTML=tabs.map(([key,label])=>`<button class="${key===tab?'active':''}" data-action="modal" data-tab="${key}">${label}</button>`).join('');
    $('dialog-content').innerHTML=reference.content(tab);if(!$('details-dialog').open)$('details-dialog').showModal();$('dialog-content').scrollTop=0;
  }
  function showDetail(row){
    if(!row){toast('This departure has moved. Choose another.');return}state.dialogTab='detail';state.dialogRow=row;$('dialog-tabs').innerHTML='';$('dialog-title').textContent=`${row.line} · ${stopName(row.origin)} → ${stopName(row.destination)}`;$('dialog-eyebrow').textContent='TRIP DETAILS';
    const maps=row.origin.lat?`<a href="https://www.google.com/maps/search/?api=1&query=${row.origin.lat},${row.origin.lon}" target="_blank" rel="noopener noreferrer">Boarding stop ${esc(row.origin.code)} ↗</a>`:'';
    const stopLive=row.stopPageUrl?`<a href="${safeURL(row.stopPageUrl)}" target="_blank" rel="noopener noreferrer">Live departures at ${esc(row.origin.name)} ↗</a>`:'';
    const link=row.routePageUrl?`<a class="operator-page-link" href="${safeURL(row.routePageUrl)}" target="_blank" rel="noopener noreferrer">${esc(OP_NAMES[row.operator])} ${esc(row.line)} · ${esc(row.headsign)} ↗</a>`:`<a href="${reference.pdfLink()}" download="TT-SHUTTLE-SCHEDULE.pdf">Original shuttle PDF ↗</a>`;
    const w=row.walkBeforeSeconds||row.walkAfterSeconds;
    $('dialog-content').innerHTML=`<div class="detail-summary">${lineBadge(row)}<strong>${esc(row.headsign)}</strong>${occupancy(row)}</div>${row.cancelled||row.boardingUnavailable?`<div class="notice">${esc(row.cancellationReason||'Not accepting passengers')}</div>`:''}${collapseEligible(row)?'<div class="notice">Collapsed, not cancelled: another listed trip lets you start later and arrive earlier. This departure is kept in its expandable inline alternatives.</div>':''}<div class="detail-clock-grid"><div><h3>Bus departure</h3>${eventClock(row)}</div><div><h3>Bus arrival</h3>${eventClock(row,'arrival')}</div>${row.leaveHomeBy?`<div><h3>Leave home</h3>${homeClock(row,'leave')}</div>`:''}${row.homeArrival?`<div><h3>Arrive home</h3>${homeClock(row,'arrive')}</div>`:''}</div><div class="detail-meta"><div><span>BOARDING STOP</span><strong>${esc(row.origin.name)} · ${esc(row.origin.code)}</strong></div><div><span>ALIGHTING STOP</span><strong>${esc(row.destination.name)} · ${esc(row.destination.code)}</strong></div><div><span>DATA BASIS</span><strong>${esc(sourceText(row))}</strong></div><div><span>DATE</span><strong>${dateLabel(row.departure,'long')} · Brussels time</strong></div></div><p>${esc(row.detail||'')}</p>${row.delayEstimated?'<p class="schedule-match-note"><strong>Estimated schedule match:</strong> the STIB API does not supply a trip ID. The original time and rounded delay are inferred from nearby, ordered GTFS departures; the dashed delay marks this estimate. The live passing time itself is unchanged.</p>':''}${row.liveWindowEnd?`<p>While this response is fresh, the live passing list replaces scheduled departures for this stop, line and direction through ${clock(row.liveWindowEnd)}. Later timetable trips remain.</p>`:''}<p>${w?`${w/60} min walking ${row.walkBeforeSeconds?'before':'after'} the bus. `:''}Bus ride ${duration(row.ride)}; total to ${row.homeArrival?'home':'destination'} ${duration(row.totalJourneySeconds)}. No extra bus-boarding buffer.</p>${row.trainPlan?`<section class="train-detail notice">Train scheduled ${clock(row.trainDeparture)}; arrive at BN by ${clock(row.deadline)} for your ${row.stationMargin}-minute margin. Current train delays do not extend the deadline.</section>`:''}${row.lunch?`<section class="lunch-continuation"><h3>Continues to Rogier</h3><p>TNT ${clock(row.departure)} → BN ${clock(row.arrival)} (assumed) → Rogier ${row.rogierArrival?clock(row.rogierArrival)+' (estimated)':'not specified'}. The Rogier time is your estimate, not another return departure.</p></section>`:''}${row.staffOnly?'<p><strong>Staff-only shuttle.</strong> Ride and peak-grid assumptions are user-supplied, not live tracking.</p>':''}<div class="source-links">${maps}${stopLive}${link}</div>${row.fetchedAt?`<p class="tiny-note">Snapshot of a feed fetched at ${clock(row.fetchedAt)}. The departure list continues updating; re-open details for the latest result.</p>`:''}<p class="tiny-note">${row.operator==='shuttle'?'User 2026 timetable and explicitly agreed assumptions.':esc(DATA.operators[row.operator].attribution)}</p>`;
    if(!$('details-dialog').open)$('details-dialog').showModal();$('dialog-content').scrollTop=0;
  }
  function nextWorkday(hour){let day=E.shiftDate(E.dateISO(realNow()),1);while([0,6].includes(E.dow(day))||E.holiday(day))day=E.shiftDate(day,1);state.planDate=day;state.planTime=hour;state.mode='plan';state.sort='arrival';state.limit=8;render()}
  function setMode(mode){state.mode=mode;if(mode==='train'){state.direction='toBN';state.sort='latestStart'}else if(state.sort==='latestStart')state.sort='arrival';state.limit=8;beginSession();render();maybeRefresh()}
  document.addEventListener('click',event=>{
    const anchor=event.target.closest('a[href^="#"]');if(anchor){event.preventDefault();const node=$(anchor.getAttribute('href').slice(1));node?.scrollIntoView({behavior:'smooth'});return}
    const b=event.target.closest('[data-action]');if(!b||b.disabled)return;
    if(b.dataset.action==='detail'&&event.target.closest('a'))return; // let badge/stop links open normally
    switch(b.dataset.action){
      case'direction':state.direction=b.dataset.direction;if(state.mode==='train'&&state.direction==='toTNT')state.mode='now';state.limit=8;savePreferences();beginSession();render();maybeRefresh();break;
      case'start':state.startPoint=b.dataset.start;state.limit=8;savePreferences();render();break;
      case'mode':setMode(b.dataset.mode);break;
      case'view':state.view=b.dataset.view;renderRows();syncURL();break;
      case'controls':$('planner').open=true;$('planner').scrollIntoView({behavior:'smooth'});break;
      case'refresh':refreshLive(true);break;
      case'more':state.limit+=8;renderRows();break;
      case'more-inline':state.collapsedLimit+=8;renderRows();break;
      case'best':showDetail(state.best);break;
      case'detail':showDetail(state.rows.find(r=>r.id===b.dataset.id));break;
      case'modal':openReference(b.dataset.tab);break;
      case'save-keys':case'clear-keys':handleKeyAction(b.dataset.action);break;
      case'close-dialog':$('details-dialog').close();break;
      case'reset-filters':state.operator='all';state.stop='all';state.limit=8;render();break;
      case'quick-plan':nextWorkday(b.dataset.hour||'08:00');break;
      case'load-trains':loadTrains();break;
      case'manual-train':useManualTrain();break;
      case'select-train':state.selectedTrain=state.trainBoard?.departures.find(t=>t.id===b.dataset.id)||null;state.sort='latestStart';state.limit=8;render();$('planner').open=false;beginSession();maybeRefresh();$('recommendation').scrollIntoView({behavior:'smooth'});break;
    }
  });
  for(const [id,key] of [['operator-select','operator'],['stop-select','stop'],['sort','sort'],['horizon','horizon']])$(id).addEventListener('change',e=>{state[key]=key==='horizon'?Number(e.target.value):e.target.value;state.limit=8;render()});
  $('collapse-alts').addEventListener('change',e=>{state.collapse=e.target.checked;render()});
  function planChange(){if(!$('plan-date').value||!$('plan-time').value||!$('plan-date').validity.valid||!$('plan-time').validity.valid){$('plan-error').textContent='Choose a valid date/time.';return}state.planDate=$('plan-date').value;state.planTime=$('plan-time').value;state.mode='plan';state.sort='arrival';state.limit=8;$('plan-error').textContent='';render()}
  $('plan-date').addEventListener('change',planChange);$('plan-time').addEventListener('change',planChange);
  $('train-date').addEventListener('change',()=>{if(!$('train-date').value)return;state.trainDate=$('train-date').value;state.selectedTrain=null;state.trainBoard=null;state.trainLoading=false;trainRequest++;render()});
  $('train-board-time').addEventListener('change',()=>{if(!$('train-board-time').value)return;state.trainBoardTime=$('train-board-time').value;state.trainBoard=null;state.trainLoading=false;trainRequest++;render()});
  $('train-margin').addEventListener('change',()=>{const v=Number($('train-margin').value);if(!$('train-margin').value||!Number.isInteger(v)||v<0||v>60){$('train-margin').value=state.trainMargin;toast('Margin must be 0–60 minutes.');return}state.trainMargin=v;savePreferences();render()});
  $('train-filter').addEventListener('input',e=>{state.trainFilter=e.target.value;renderTrainBoard()});
  $('details-dialog').addEventListener('click',e=>{if(e.target!==$('details-dialog'))return;const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close()});
  document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches?.('.timeline-event'))showDetail(state.rows.find(r=>r.id===e.target.dataset.id))});
  fillIcons();render();$('local-clock').textContent=clock(realNow());readLiveCache(true);
  let bucket=Math.floor(realNow()/15);
  setInterval(()=>{$('local-clock').textContent=clock(realNow());if(!document.hidden){const next=Math.floor(realNow()/15);if(liveMode()&&next!==bucket){bucket=next;render()}else renderStatus();maybeRefresh()}},1000);
  window.CommuteDashboard={engine:E,getSnapshot:()=>({direction:state.direction,startPoint:state.startPoint,includeWalking:state.includeWalking,includeReturnWalk:state.includeReturnWalk,walkingActive:E.walkingEnabled(state),mode:state.mode,reference:state.reference,rows:state.rows,best:state.best,count:state.rows.length,live:state.live,trainMargin:state.trainMargin,selectedTrain:state.selectedTrain,trainResult:state.trainResult,autoUntil:state.autoUntil,lastRequest:state.lastRequest,autoDue:autoDue(),access:state.access,collapse:state.collapse,view:state.view,stopAlternativesRemoved:state.comparison?.stopAlternativesRemoved})};
  window.Northbound=window.CommuteDashboard;
})();
