// IS THERE A VERDICT TO GIVE, OR ONLY A LIST?
//
// The Easy-Run Drift card prints runs that crept above the conversational band and stops. The ask is
// for interpretation: is the drift correlating with anything worth caring about - recovery, HRV, the
// shin - or is it fine given that training is running AHEAD of the plan?
//
// A verdict invented from data that is not there is worse than no verdict, so this measures every
// input such a verdict could possibly use, and reports which ones actually exist:
//
//   SAMPLE     how many easy runs in the window carry a zone breakdown at all
//   HRV        st.hrvLog / st.recoveryLog - the client is documented as DISCARDING the Intervals
//              hrv field, so this is expected to be empty and needs proving either way
//   READINESS  TSB-derived readiness, which exists for every day by construction
//   SHIN       any stored record of the shin: a note, a flag, a log
//   AHEAD      the run-ahead flag's own runs - if the drifted runs ARE the runs that beat the plan,
//              then drift and progress are one fact seen twice and the card can say so
//   LOAD       run ATL / TSB on the drift days vs the non-drift days
import { spawn } from 'child_process';
import net from 'net';

const URL_ = process.argv[2] || 'https://training-plan.mgrobinson07.workers.dev/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9341;
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
  for (let i = 0; i < 24; i++) {
    if (await evalJS(`(function(){ try{ return !!(typeof _storeV2Runs!=='undefined' && _storeV2Runs && _storeV2Runs.length); }catch(e){ return false; } })()`)) break;
    await wait(2500);
  }

  const out = await evalJS(`(function(){
  try{
    var res={};
    // ---- what the card currently computes ----
    var w=(typeof _runShinWatch_==='function')?_runShinWatch_():null;
    res.watch=w?{ sample:w.sample, drifted:w.drifted, enough:w.enough, flag:w.flag,
                  minSample:w.minSample, driftPct:w.driftPct,
                  rows:w.rows.map(function(r){ return {date:r.date, above:r.above, drifted:r.drifted, viaPlan:r.viaPlan}; }) }:null;

    // ---- how much zone data exists AT ALL, so the sample ceiling is known ----
    var runs=(typeof _runAll_==='function')?(_runAll_()||[]):[];
    var today=new Date(); today.setHours(0,0,0,0);
    var ago=function(ds){ var d=new Date(String(ds).slice(0,10)+'T00:00:00'); return isFinite(d)?Math.round((today-d)/86400000):null; };
    var zc={ d120:0, d120WithZones:0, d365:0, d365WithZones:0, everWithZones:0 };
    runs.forEach(function(r){
      var a=ago(r.date); if(a==null||a<0) return;
      var hasZ=(typeof _runZonePct_==='function') && _runZonePct_(r)!=null;
      if(hasZ) zc.everWithZones++;
      if(a<=120){ zc.d120++; if(hasZ) zc.d120WithZones++; }
      if(a<=365){ zc.d365++; if(hasZ) zc.d365WithZones++; }
    });
    res.zoneCoverage=zc;

    // ---- HRV / recovery: does the client hold anything at all? ----
    var S=(typeof st!=='undefined'&&st)?st:{};
    var arrLen=function(k){ var v=S[k]; return Array.isArray(v)?v.length:(v&&typeof v==='object'?Object.keys(v).length:(v==null?null:'scalar')); };
    res.recoveryStores={};
    ['hrvLog','hrv','recoveryLog','recovery','readinessLog','sleepLog','wellness','dailyLog','notes','soreness','injuries','injuryLog']
      .forEach(function(k){ res.recoveryStores[k]=arrLen(k); });
    // Any key on st whose name smells of hrv/recovery/sleep/shin, so a differently-named store is found.
    res.stKeysOfInterest=Object.keys(S).filter(function(k){ return /hrv|recover|sleep|readi|shin|injur|sore|wellness/i.test(k); });

    // ---- shin: any stored record anywhere? ----
    var shinHits=[];
    try{
      (S.rides||[]).forEach(function(r){ if(r && /shin/i.test(String(r.name||'')+' '+String(r.notes||''))) shinHits.push({kind:'ride', date:r.date}); });
    }catch(e){}
    try{
      (S.plan||[]).forEach(function(p){ if(p && /shin/i.test(JSON.stringify(p.note||'')+String(p.notes||''))) shinHits.push({kind:'plan', date:p.date}); });
    }catch(e){}
    res.shinMentions=shinHits.slice(0,10);
    res.shinMentionCount=shinHits.length;

    // ---- the run-ahead flag: are the drifted runs the SAME runs that beat the plan? ----
    var ra=null;
    try{ ra=(typeof _runAheadFlag_==='function')?_runAheadFlag_(new Date()):null; }catch(e){}
    res.runAhead=ra?{ streak:ra.streak, sample:ra.sample, current:ra.current, next:ra.next, thin:ra.thin,
                      runDates:(ra.runs||[]).map(function(x){ return x.date||null; }) }:null;

    // ---- load on drift days vs non-drift days, from the run PMC ----
    var ser=(typeof _rtSeries_==='function')?_rtSeries_():[];
    var byDate={}; ser.forEach(function(p){ byDate[p.date]=p; });
    if(w && w.rows.length){
      res.loadOnRows=w.rows.map(function(r){
        var p=byDate[r.date]||null;
        return { date:r.date, above:r.above, drifted:r.drifted,
                 ctl:p?p.ctl:null, atl:p?p.atl:null, tsb:p?p.tsb:null };
      });
    }

    // ---- readiness, which exists for every day by construction ----
    res.readinessAvailable=(typeof readinessFromTSB_==='function');

    // ---- st.hrvDaily: the store the key scan turned up. Memory said the client DISCARDS the
    // Intervals hrv field, so this needs measuring rather than assuming either way.
    var hd=S.hrvDaily;
    res.hrvDaily={ type:Array.isArray(hd)?'array':(hd&&typeof hd==='object'?'object':String(hd)) };
    try{
      var entries=Array.isArray(hd)?hd.map(function(v,i){ return [String(i),v]; })
                 :(hd&&typeof hd==='object'?Object.keys(hd).map(function(k){ return [k,hd[k]]; }):[]);
      res.hrvDaily.count=entries.length;
      res.hrvDaily.sampleKeys=entries.slice(0,3).map(function(e){ return e[0]; });
      res.hrvDaily.sampleVals=entries.slice(0,3).map(function(e){ return (e[1]&&typeof e[1]==='object')?Object.keys(e[1]).join(','):e[1]; });
      var dates=entries.map(function(e){ return /^\d{4}-\d{2}-\d{2}/.test(e[0])?e[0]:((e[1]&&e[1].date)||null); }).filter(Boolean).sort();
      res.hrvDaily.first=dates[0]||null; res.hrvDaily.last=dates[dates.length-1]||null; res.hrvDaily.dated=dates.length;
      // Coverage over the drift window specifically.
      var inWin=0;
      if(w) w.rows.forEach(function(r){ if(dates.indexOf(r.date)>=0) inWin++; });
      res.hrvDaily.coversDriftRows=inWin;
      // The WHOLE series, so a baseline can be computed rather than eyeballed off the drift days.
      res.hrvDaily.all=entries.map(function(e){ var v=e[1]||{};
        return { date:e[0], hrv:(v.hrv!=null?v.hrv:null), rhr:(v.rhr!=null?v.rhr:null), at:(v.at!=null?v.at:null) }; })
        .sort(function(x,y){ return String(x.date).localeCompare(String(y.date)); });
      // The value on each drift row, so a correlation can be judged rather than asserted.
      if(w) res.hrvDaily.onRows=w.rows.map(function(r){
        var v=null;
        if(hd && !Array.isArray(hd) && hd[r.date]!==undefined) v=hd[r.date];
        else if(Array.isArray(hd)){ for(var i=0;i<hd.length;i++){ if(hd[i]&&hd[i].date===r.date){ v=hd[i]; break; } } }
        return { date:r.date, above:r.above, hrv:(v&&typeof v==='object')?(v.hrv!=null?v.hrv:JSON.stringify(v).slice(0,80)):v };
      });
    }catch(e){ res.hrvDaily.err=String(e&&e.message); }
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
