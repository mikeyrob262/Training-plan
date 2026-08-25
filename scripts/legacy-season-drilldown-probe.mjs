// What can a Greatest-Seasons card actually drill INTO?
//
// The Athletic Life hero's month drill-down stopped one level short of activities because that
// surface is a MONTH AGGREGATE (_zsCompute_ keeps {ym, score, mi, byDay} and throws the rows away),
// and re-resolving a month back into st.rides only matched a fraction. The season cards are a
// different shape: _lgByYear_ is handed the SAME row arrays it aggregates. So the question is not
// "can we match" but "what do those rows already carry".
//
// Measures, per season, on the DEPLOYED page:
//   - how many rows the card counted
//   - field presence on those rows (name / distance / duration / elev / avgHR / stravaId)
//   - how many resolve to a LIVE st.rides record, which is what openRideDetail(idx) requires
//
// NEGATIVE CONTROL: a deliberately bogus stravaId must resolve to nothing. Without it a resolver
// that matches everything would report a perfect hit rate.
import { spawn } from 'child_process';
import net from 'net';

const URL_ = process.argv[2] || 'https://training-plan.mgrobinson07.workers.dev/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9337;
const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function portUp(p, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const ok = await new Promise(res => { const s = net.connect(p, '127.0.0.1');
      s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); });
    if (ok) return true; await wait(250);
  }
  return false;
}
const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--remote-debugging-port='+PORT,'--remote-allow-origins=*','--window-size=1600,1000','about:blank'], {stdio:'ignore'});
let ws;
try {
  if (!await portUp(PORT)) throw new Error('chrome did not open the debug port');
  const targets = await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
  const page = targets.find(t => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id:i, method, params: params||{}})); });
  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', {expression: expr, returnByValue: true, awaitPromise: true});
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,600));
    return r.result && r.result.result && r.result.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', {url: URL_});
  await wait(10000);

  // The run snapshot primes on its own chain. Poll rather than assume - reading before it primes
  // measures getRunsLegacy_, the inflated union, which is not what the page renders.
  let primed = false;
  for (let i = 0; i < 24; i++) {
    primed = await evalJS(`(function(){ try{ return !!(typeof _lgRunsPrimed_==='function' && _lgRunsPrimed_()); }catch(e){ return false; } })()`);
    if (primed) break;
    await wait(2500);
  }
  console.log('run snapshot primed: ' + primed);

  const out = await evalJS(`(function(){
  try{
    var res={};

    // ---- live st.rides index, the thing openRideDetail(idx) needs ----
    var live=(window.st&&st.rides)?st.rides:[];
    var byStrava={}, liveLive=0;
    live.forEach(function(r,i){ if(!r) return; if(!r.deleted) liveLive++;
      var sid=r.stravaId; if(sid!==undefined&&sid!==null&&sid!=='') { var k=String(sid); if(byStrava[k]===undefined) byStrava[k]={idx:i, deleted:!!r.deleted}; } });
    res.store={ stRidesTotal:live.length, stRidesLive:liveLive, distinctStravaIds:Object.keys(byStrava).length };

    // ---- CYCLING: the season rows come off allRidesLegacy_ via _msCycling_ ----
    // _msCycling_ strips identity, so re-run its OWN filter over the source to see what the
    // underlying records carry before the map throws it away.
    var ded=(typeof allRidesLegacy_==='function')?allRidesLegacy_():[];
    var sp=function(r){ return (typeof rideSport_==='function')?rideSport_(r):String(r.sportType||r.type||''); };
    var scOf=function(r){ return (typeof storeV2Sport_==='function')?storeV2Sport_(r):String(sp(r)).replace(/[ _-]/g,''); };
    var isRun=function(r){ return /^(run|trailrun|virtualrun|treadmill)$/i.test(scOf(r)); };
    var isRide=function(r){ return !isRun(r)&&(/ride/i.test(sp(r))||/virtual/i.test(sp(r))||/zwift/i.test(String(r.name||''))||r.trainer===true); };
    var cycSrc=ded.filter(function(r){ return r&&r.date&&isRide(r)&&(parseFloat(r.distance)||0)>0; });
    var cycCard=(typeof _msCycling_==='function')?(_msCycling_()||[]):[];
    res.cycling={ cardRows:cycCard.length, srcRows:cycSrc.length,
      cardRowKeys:cycCard.length?Object.keys(cycCard[0]):[], srcSample:null, byYear:{} };
    var s0=cycSrc[cycSrc.length-1];
    if(s0){ res.cycling.srcSample={}; ['date','name','distance','elev','duration','movingSecs','stravaId','id','source','avgPower','avgHR'].forEach(function(f){ res.cycling.srcSample[f]=(s0[f]===undefined?'(absent)':(typeof s0[f]==='object'?'(obj)':s0[f])); }); }
    cycSrc.forEach(function(r){
      var y=+String(r.date).slice(0,4); if(!(y>=2024)) return;
      var b=res.cycling.byYear[y]||(res.cycling.byYear[y]={n:0, name:0, dist:0, dur:0, elev:0, sid:0, inStRides:0, inStRidesLive:0});
      b.n++;
      if(r.name) b.name++;
      if((parseFloat(r.distance)||0)>0) b.dist++;
      if((+(r.movingSecs||r.duration)||0)>0) b.dur++;
      if(r.elev!==undefined&&r.elev!==null) b.elev++;
      var sid=r.stravaId; if(sid!==undefined&&sid!==null&&sid!==''){ b.sid++;
        var hit=byStrava[String(sid)]; if(hit){ b.inStRides++; if(!hit.deleted) b.inStRidesLive++; } }
    });

    // ---- RUNNING: the season rows come off getRuns() = the store_v2 snapshot ----
    var runs=(typeof _lgRuns_==='function')?(_lgRuns_()||[]):[];
    res.running={ cardRows:runs.length, rowKeys:runs.length?Object.keys(runs[0]):[], sample:null, byYear:{} };
    var r0=runs[runs.length-1];
    if(r0){ res.running.sample={}; ['date','name','distance','elev','elevation','time','movingSecs','duration','avgHR','pace','stravaId','id','type','sportType'].forEach(function(f){ res.running.sample[f]=(r0[f]===undefined?'(absent)':(typeof r0[f]==='object'?'(obj)':r0[f])); }); }
    runs.forEach(function(r){
      var y=+String(r.date).slice(0,4); if(!(y>=2016&&y<=2024)) return;
      var b=res.running.byYear[y]||(res.running.byYear[y]={n:0, name:0, dist:0, dur:0, elev:0, hr:0, sid:0, inStRides:0, inStRidesLive:0});
      b.n++;
      if(r.name) b.name++;
      if((parseFloat(r.distance)||0)>0) b.dist++;
      if((+(r.movingSecs||r.duration)||0)>0 || r.time) b.dur++;
      if((r.elev!==undefined&&r.elev!==null)||(r.elevation!==undefined&&r.elevation!==null)) b.elev++;
      if(r.avgHR!==undefined&&r.avgHR!==null) b.hr++;
      var sid=r.stravaId; if(sid!==undefined&&sid!==null&&sid!==''){ b.sid++;
        var hit=byStrava[String(sid)]; if(hit){ b.inStRides++; if(!hit.deleted) b.inStRidesLive++; } }
    });

    // ---- THE REAL LINK TEST -------------------------------------------------------------------
    // The naive stravaId scan above is NOT how a run row links. _runRefFor_ is the shipped
    // resolver (handle -> stravaId scan -> unique content match) and rideRefOk_ is its gate;
    // run-pb-link-test already covers it. Measure THAT, per season, or the scoping answer is
    // wrong by however much the content-match path recovers.
    if(typeof _runRefFor_==='function' && typeof rideRefOk_==='function'){
      runs.forEach(function(r){
        var y=+String(r.date).slice(0,4); if(!(y>=2016&&y<=2024)) return;
        var b=res.running.byYear[y]; if(!b) return;
        b.linkable=(b.linkable||0)+(rideRefOk_(_runRefFor_(r))?1:0);
      });
    }
    // Cycling rows ARE st.rides records, so their handle resolves directly.
    if(typeof rideHandle_==='function' && typeof rideResolveIdx_==='function'){
      cycSrc.forEach(function(r){
        var y=+String(r.date).slice(0,4); if(!(y>=2024)) return;
        var b=res.cycling.byYear[y]; if(!b) return;
        var h=rideHandle_(r), hi=h?rideResolveIdx_(h):-1;
        b.linkable=(b.linkable||0)+((hi>=0 && st.rides[hi] && !st.rides[hi].deleted)?1:0);
      });
    }

    // ---- NEGATIVE CONTROL ----
    // A fabricated run that is not in the library must NOT resolve. Without this a resolver that
    // returns a match for anything would report a perfect linkable rate.
    res.negControl={ bogusStravaIdResolves: !!byStrava['999999999999'] };
    try{
      var fake={ date:'1994-03-07', distance:3.14159, movingSecs:1234, name:'Not A Real Run', stravaId:999999999999 };
      res.negControl.fabricatedRunLinks = (typeof _runRefFor_==='function' && typeof rideRefOk_==='function')
        ? rideRefOk_(_runRefFor_(fake)) : 'n/a';
    }catch(e){ res.negControl.fabricatedRunLinks='threw:'+String(e&&e.message); }

    // ---- name quality: actName_ is the standing rule, raw r.name is never printed ----
    var fb=0, tot=0;
    runs.slice(0,400).forEach(function(r){ if(typeof actNameInfo_==='function'){ tot++; if(actNameInfo_(r).isFallback) fb++; } });
    res.running.nameFallbackOf400={ checked:tot, fallback:fb };
    var cfb=0, ctot=0;
    cycSrc.slice(-400).forEach(function(r){ if(typeof actNameInfo_==='function'){ ctot++; if(actNameInfo_(r).isFallback) cfb++; } });
    res.cycling.nameFallbackOfLast400={ checked:ctot, fallback:cfb };

    return res;
  }catch(e){ return {err:String((e&&e.stack)||e)}; }
  })()`);

  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error('FAILED: ' + (e && e.message || e));
} finally {
  try { ws && ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
}
