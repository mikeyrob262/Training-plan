// WHAT CAN AN "EASY PACE" DRIVER HONESTLY BE MEASURED FROM?
//
// The first probe killed the obvious answer: RUN_ZONES' Easy band is 113-121 bpm, and across 2,371
// runs only 32 fall inside it - 1 in the last year. That band is the stale hardcoded one; the live
// calibration is stLthr_() = 170, which is what hrTssFor_ already divides by. So this measures the
// candidates that are actually available, per window:
//
//   A  hrIF = avgHR / LTHR  below a threshold      (measurement, same input as the load itself)
//   B  the PLAN said easyRun                        (_runPlannedEasy_, already used by shin watch)
//   C  the name says easy/recovery                  (the shin watch's own fallback)
//   D  the stored zone breakdown                    (_runZonePct_)
//   E  no filter at all - every run's pace
//
// A driver computed from one or two runs is a fabrication with a percentage sign on it, so the point
// is to find which of these has a sample on BOTH sides of a window comparison, not just to pick the
// nicest definition.
import { spawn } from 'child_process';
import net from 'net';

const URL_ = process.argv[2] || 'https://training-plan.mgrobinson07.workers.dev/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9339;
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
    var runs=(typeof _runAll_==='function')?(_runAll_()||[]):[];
    var L=(typeof stLthr_==='function')?stLthr_():170;
    res.lthr=L; res.totalRuns=runs.length;
    var today=new Date(); today.setHours(0,0,0,0);
    var ago=function(ds){ var d=new Date(String(ds).slice(0,10)+'T00:00:00'); return isFinite(d)?Math.round((today-d)/86400000):null; };
    var secOf=function(r){ return (typeof _durSec_==='function')?_durSec_(r):(+r.movingSecs||0); };
    var miOf=function(r){ return parseFloat(r.distance)||0; };

    // hrIF distribution, so a threshold is CHOSEN from the data rather than asserted.
    var ifs=[];
    runs.forEach(function(r){ var hr=parseFloat(r.avgHR); if(hr>0) ifs.push(hr/L); });
    ifs.sort(function(a,b){ return a-b; });
    var q=function(p){ return ifs.length?Math.round(ifs[Math.floor((ifs.length-1)*p)]*1000)/1000:null; };
    res.hrIF={ n:ifs.length, p10:q(0.10), p25:q(0.25), p50:q(0.50), p75:q(0.75), p90:q(0.90) };

    // How many runs each candidate keeps, in the CURRENT window and the PRIOR one of equal length.
    // A driver needs both sides; a count on one side alone cannot make a comparison.
    var WINS=[['7D',7],['30D',30],['90D',90],['1Y',365]];
    var cands={
      'A hrIF<0.85': function(r){ var hr=parseFloat(r.avgHR); return hr>0 && (hr/L)<0.85; },
      'A hrIF<0.90': function(r){ var hr=parseFloat(r.avgHR); return hr>0 && (hr/L)<0.90; },
      'B planned easyRun': function(r){ var dk=(typeof normDate==='function')?normDate(r.date):String(r.date).slice(0,10);
        return (typeof _runPlannedEasy_==='function') ? (_runPlannedEasy_(dk)===true) : false; },
      'C name says easy': function(r){ return /easy|recovery/i.test(String((typeof actName_==='function')?actName_(r):(r.name||''))); },
      'D zone breakdown, mostly easy': function(r){ var a=(typeof _runZonePct_==='function')?_runZonePct_(r):null; return a!=null && a<=50; },
      'E every run': function(){ return true; }
    };
    res.byCandidate={};
    Object.keys(cands).forEach(function(k){
      var fn=cands[k], row={};
      WINS.forEach(function(w){
        var cur=0, prv=0, curPace=[], prvPace=[];
        runs.forEach(function(r){
          var a=ago(r.date); if(a==null||a<0) return;
          var mi=miOf(r), sec=secOf(r);
          if(!(mi>0&&sec>0)) return;
          if(!fn(r)) return;
          if(a<=w[1]) { cur++; curPace.push(sec/mi); }
          else if(a<=w[1]*2) { prv++; prvPace.push(sec/mi); }
        });
        var mean=function(a){ if(!a.length) return null; var s=0; a.forEach(function(x){ s+=x; }); return Math.round(s/a.length); };
        row[w[0]]={ cur:cur, prv:prv, curPaceSec:mean(curPace), prvPaceSec:mean(prvPace) };
      });
      res.byCandidate[k]=row;
    });

    // Volume, the other honest driver for a rebuilding runner: miles/week and runs/week.
    res.volume={};
    WINS.forEach(function(w){
      var cMi=0,pMi=0,cN=0,pN=0,cSec=0,pSec=0;
      runs.forEach(function(r){
        var a=ago(r.date); if(a==null||a<0) return;
        var mi=miOf(r), sec=secOf(r);
        if(a<=w[1]){ cMi+=mi; cN++; cSec+=sec; }
        else if(a<=w[1]*2){ pMi+=mi; pN++; pSec+=sec; }
      });
      var wk=w[1]/7;
      res.volume[w[0]]={ curMiPerWk:Math.round(cMi/wk*10)/10, prvMiPerWk:Math.round(pMi/wk*10)/10,
                         curRuns:cN, prvRuns:pN,
                         curHrPerWk:Math.round(cSec/3600/wk*10)/10, prvHrPerWk:Math.round(pSec/3600/wk*10)/10 };
    });

    // Longest run in each window - the endurance driver a rebuilding runner actually moves.
    res.longest={};
    WINS.forEach(function(w){
      var c=0,p=0;
      runs.forEach(function(r){ var a=ago(r.date); if(a==null||a<0) return; var mi=miOf(r);
        if(a<=w[1]){ if(mi>c) c=mi; } else if(a<=w[1]*2){ if(mi>p) p=mi; } });
      res.longest[w[0]]={ cur:Math.round(c*10)/10, prv:Math.round(p*10)/10 };
    });

    // Where the run history actually is, so a range toggle can be honest about a dead window.
    var dated=runs.filter(function(r){ return r&&r.date; }).map(function(r){ return String(r.date).slice(0,10); }).sort();
    res.span={ first:dated[0]||null, last:dated[dated.length-1]||null };
    var gaps=[];
    for(var i=1;i<dated.length;i++){ var g=Math.round((new Date(dated[i]+'T00:00:00')-new Date(dated[i-1]+'T00:00:00'))/86400000);
      if(g>=45) gaps.push({from:dated[i-1], to:dated[i], days:g}); }
    res.gapsOver45d=gaps.slice(-8);
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
