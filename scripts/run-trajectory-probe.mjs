// CAN A RUNNING CTL BE COMPUTED AT ALL, AND OVER WHAT WINDOW?
//
// The Dashboard's Performance Trajectory rides on pmcSeries_, which is ALL-SPORT: _pmcDailyTss_
// merges allRidesLegacy_ with getRuns() and sums r.tss whatever produced it. A running-only version
// needs a running-only daily load, and that only exists where runs actually carry a TSS.
//
// Two things could make a run-only CTL a fiction rather than a measurement:
//   1 NO LOAD. applyRunHrTss_ writes r.tss onto st.rides records from avgHR and LTHR. Snapshot runs
//     from /store_v2 are a different object graph. If the snapshot runs carry no usable load, a run
//     CTL would be computed from the handful of runs that do - a curve shaped by coverage, not form.
//   2 NO RECENT RUNS. A 7D/30D toggle on a series whose last real point is months old draws a decay
//     curve to zero and calls it "fitness dropping sharply", which is a statement about the calendar.
//
// Also measures what an "easy pace" driver could read from: how many runs carry avgHR, and how many
// fall in the easy band, per window.
//
// NEGATIVE CONTROL: a fabricated run with no HR must yield no load. Without it a scorer that
// returns a number for anything would report perfect coverage.
import { spawn } from 'child_process';
import net from 'net';

const URL_ = process.argv[2] || 'https://training-plan.mgrobinson07.workers.dev/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9338;
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
  let primed = false;
  for (let i = 0; i < 24; i++) {
    primed = await evalJS(`(function(){ try{ return !!(typeof _storeV2Runs!=='undefined' && _storeV2Runs && _storeV2Runs.length); }catch(e){ return false; } })()`);
    if (primed) break;
    await wait(2500);
  }
  console.log('run snapshot primed: ' + primed);

  const out = await evalJS(`(function(){
  try{
    var res={};
    var today=new Date(); today.setHours(0,0,0,0);
    var dayOf=function(ds){ var d=new Date(String(ds).slice(0,10)+'T00:00:00'); return isFinite(d)?Math.round((today-d)/86400000):null; };
    var isRunSp=function(r){
      var s=(typeof storeV2Sport_==='function')?storeV2Sport_(r):String((r&&(r.sportType||r.type))||'').replace(/[ _-]/g,'');
      return /^(run|trailrun|virtualrun|treadmill)$/i.test(s);
    };

    // ---- every run the app can see, from BOTH stores, deduped the way _pmcDailyTss_ does ----
    var liveRuns=((typeof st!=='undefined'&&st&&st.rides)||[]).filter(function(r){ return r && !r.deleted && r.date && isRunSp(r); });
    var snapRuns=(typeof getRuns==='function')?(getRuns()||[]).filter(function(r){ return r && r.date; }):[];
    res.counts={ liveStRidesRuns:liveRuns.length, getRunsRows:snapRuns.length };

    var seen={}, merged=[];
    liveRuns.concat(snapRuns).forEach(function(r){
      var k=((typeof normDate==='function')?normDate(r.date):String(r.date||'').slice(0,10))
        +'|'+String(r.name||'').trim().toLowerCase()
        +'|'+(Math.round((parseFloat(r.distance)||0)*10)/10);
      if(seen[k]) return; seen[k]=1; merged.push(r);
    });
    res.counts.mergedRuns=merged.length;

    // ---- load coverage, through the SHARED accessor the PMC already uses ----
    var WINS=[['7D',7],['30D',30],['90D',90],['1Y',365],['ALL',100000]];
    res.loadCoverage={};
    WINS.forEach(function(w){
      var b={ runs:0, withTss:0, withRawTss:0, withAvgHR:0, withRss:0, withRelEffort:0, tssSum:0, srcs:{} };
      merged.forEach(function(r){
        var ago=dayOf(r.date); if(ago==null || ago<0 || ago>w[1]) return;
        b.runs++;
        if(r.avgHR!=null && +r.avgHR>0) b.withAvgHR++;
        if(r.rss!=null && +r.rss>0) b.withRss++;
        if(r.relativeEffort!=null && +r.relativeEffort>0) b.withRelEffort++;
        if(r.tss!=null && +r.tss>0) b.withRawTss++;
        var t=(typeof constRideTSS_==='function')?constRideTSS_(r):null;
        if(t!=null && t>0){ b.withTss++; b.tssSum+=t; if(r.tssSource) b.srcs[r.tssSource]=(b.srcs[r.tssSource]||0)+1; else b.srcs['(none)']=(b.srcs['(none)']||0)+1; }
      });
      res.loadCoverage[w[0]]=b;
    });

    // ---- could hrTssFor_ SCORE them on the fly, without a stored tss? ----
    var L=(typeof stLthr_==='function')?stLthr_():null;
    res.lthr=L;
    res.onTheFly={};
    WINS.forEach(function(w){
      var n=0, ok=0, sum=0;
      merged.forEach(function(r){
        var ago=dayOf(r.date); if(ago==null || ago<0 || ago>w[1]) return;
        n++;
        var v=(typeof hrTssFor_==='function')?hrTssFor_(r, L):null;
        if(v!=null && v>0){ ok++; sum+=v; }
      });
      res.onTheFly[w[0]]={ runs:n, scored:ok, meanTss: ok?Math.round(sum/ok*10)/10 : null };
    });

    // ---- when was the last run at all? A range toggle over a dead series is a calendar fact. ----
    var newest=null;
    merged.forEach(function(r){ var d=String(r.date).slice(0,10); if(!newest || d>newest) newest=d; });
    res.newestRun=newest;
    res.newestRunDaysAgo=newest?dayOf(newest):null;
    // Per calendar year, so the honest range can be chosen rather than assumed.
    var byYear={};
    merged.forEach(function(r){ var y=String(r.date).slice(0,4); if(!byYear[y]) byYear[y]={n:0, scored:0};
      byYear[y].n++;
      var v=(typeof hrTssFor_==='function')?hrTssFor_(r, L):null; if(v!=null&&v>0) byYear[y].scored++; });
    res.byYear=byYear;

    // ---- easy-pace driver feasibility ----
    // The Easy band is an HR band (RUN_ZONES). Measure how many runs could be classified at all.
    res.easyBand=(typeof RUN_ZONES!=='undefined' && RUN_ZONES && RUN_ZONES[0]) ? {lo:RUN_ZONES[0].lo, hi:RUN_ZONES[0].hi} : null;
    res.paceable={};
    WINS.forEach(function(w){
      var n=0, withPace=0, easyByHR=0, noHR=0;
      merged.forEach(function(r){
        var ago=dayOf(r.date); if(ago==null || ago<0 || ago>w[1]) return;
        n++;
        var mi=parseFloat(r.distance)||0, sec=(typeof _durSec_==='function')?_durSec_(r):0;
        if(mi>0 && sec>0) withPace++;
        var hr=parseFloat(r.avgHR);
        if(!(hr>0)) noHR++;
        else if(res.easyBand && hr<=res.easyBand.hi) easyByHR++;
      });
      res.paceable[w[0]]={ runs:n, withPace:withPace, easyByHR:easyByHR, noHR:noHR };
    });

    // ---- NEGATIVE CONTROLS ----
    res.neg={};
    res.neg.noHrRunScores = (typeof hrTssFor_==='function') ? (hrTssFor_({date:'2026-08-01', distance:5, movingSecs:3000}, L) != null) : 'n/a';
    res.neg.noDurationScores = (typeof hrTssFor_==='function') ? (hrTssFor_({date:'2026-08-01', distance:5, avgHR:150}, L) != null) : 'n/a';
    res.neg.zeroTssPasses = (typeof constRideTSS_==='function') ? (constRideTSS_({tss:0, movingSecs:3600}) != null) : 'n/a';

    // ---- for scale: what the ALL-SPORT series looks like today ----
    var fs=(typeof fitnessSeries_==='function')?(fitnessSeries_()||[]):[];
    res.allSportSeries={ points:fs.length, first:fs.length?fs[0].date:null, last:fs.length?fs[fs.length-1].date:null,
                         lastCtl:fs.length?fs[fs.length-1].ctl:null };
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
