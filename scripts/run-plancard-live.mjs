// WHY IS THE PLAN CARD ABSENT? Ask the detector, on the live library, step by step.
import { spawn } from 'child_process';
import net from 'net';
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT=9401; const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function up(p,t=60){for(let i=0;i<t;i++){const o=await new Promise(res=>{const s=net.connect(p,'127.0.0.1');s.on('connect',()=>{s.destroy();res(true)});s.on('error',()=>res(false))});if(o)return true;await wait(250)}return false}
const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+PORT,'--remote-allow-origins=*','about:blank'],{stdio:'ignore'});
let ws;
try{
  if(!await up(PORT)) throw new Error('no port');
  const t=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
  ws=new WebSocket(t.find(x=>x.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
  let id=0;const pend=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id)}};
  const send=(m,p)=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p||{}}))});
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});
    if(r.result&&r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,900));
    return r.result&&r.result.result&&r.result.result.value};
  await send('Page.enable');await send('Runtime.enable');
  const W=+(process.argv[2]||1512), H=+(process.argv[3]||982), MOB=(process.argv[4]==='1');
  await send('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:2,mobile:MOB});
  await send('Page.navigate',{url:'https://training-plan.mgrobinson07.workers.dev/?pl='+Date.now()});
  await wait(3000);
  await ev(`(function(){try{localStorage.setItem('aiq_layout','desktop')}catch(e){}return 1})()`);
  await send('Page.reload',{ignoreCache:true}); await wait(11000);
  for(let i=0;i<20;i++){ if(await ev(`!!(typeof _storeV2Runs!=='undefined'&&_storeV2Runs&&_storeV2Runs.length)`)) break; await wait(2500); }
  await ev(`(function(){dsShowRun();return 1})()`); await wait(3000);
  console.log(JSON.stringify(await ev(`(function(){
    var out={};
    // Look for it ANYWHERE on either surface, not just as a direct child of the desktop scroller -
    // a card that got orphaned into the wrong container is still "present" and that distinction is
    // the whole question.
    out.cardOnPage=(document.body.innerText||'').toUpperCase().indexOf('THE PLAN IS BEHIND YOU')>=0;
    out.cardIsDirectChild=[].slice.call(document.querySelectorAll('#DS-RUN > div')).some(function(e2){
      return (e2.innerText||'').toUpperCase().indexOf('THE PLAN IS BEHIND YOU')>=0; });
    out.layout=(typeof isDesktop==='function')?isDesktop():null;
    out.vp=innerWidth+'x'+innerHeight;
    var pcEl=[].slice.call(document.querySelectorAll('[data-runfull]'));
    out.runfullCount=pcEl.length;
    out.runfullWhere=pcEl.map(function(e2){
      var r2=e2.getBoundingClientRect();
      return { label:(e2.innerText||'').trim().split(String.fromCharCode(10))[0].slice(0,24),
               parent:(e2.parentElement&&(e2.parentElement.id||e2.parentElement.className))||'?',
               h:Math.round(r2.height), top:Math.round(r2.top), display:getComputedStyle(e2).display }; });
    var f=null, err=null;
    try{ f=_runAheadFlag_(new Date()); }catch(e){ err=String(e&&e.message); }
    out.flagError=err;
    out.flagNull=(f===null);
    if(f) out.flag={ current:f.current, curTop:f.curTop, streak:f.streak, sample:f.sample,
                     ranMins:f.runs.map(function(r){return r.ranMin;}), target:f.target };
    // Walk the detector's own gates by hand so a null has a REASON rather than a shrug.
    var today=new Date();
    var runs=(typeof getRuns==='function')?(getRuns()||[]):[];
    var byDate={};
    runs.forEach(function(r){ if(!r||r.deleted) return;
      var k=(typeof normDate==='function')?normDate(r.date):String(r.date||'').slice(0,10);
      var mn=(typeof _runLoggedMin_==='function')?_runLoggedMin_(r):null;
      if(!k||mn==null) return; if(!byDate[k]||mn>byDate[k]) byDate[k]=mn; });
    var pairs=[], lib=0;
    for(var d=1; d<=RUN_AHEAD_LOOKBACK_D; d++){
      var dt=new Date(today.getTime()-d*86400000), dk=_tbDK_(dt);
      if(byDate[dk]!=null) lib++;
      if(dt.getDay()===0) continue;
      var bp=null; try{ bp=blockPlanFor_(dk); }catch(e){ continue; }
      if(!bp||!bp.sessions) continue;
      var slot=null; bp.sessions.forEach(function(s2){ if(!slot&&s2&&s2.intent==='easyRun') slot=s2; });
      if(!slot) continue;
      var top=_runRangeTopMin_(slot.struct); if(top==null) continue;
      if(byDate[dk]==null) continue;
      pairs.push({ dk:dk, ran:Math.round(byDate[dk]), top:top, ahead:byDate[dk]>top, struct:slot.struct });
    }
    out.lookbackDays=RUN_AHEAD_LOOKBACK_D;
    out.needStreak=RUN_AHEAD_N;
    out.libraryRuns=lib;
    out.pairs=pairs.slice(0,12);
    var st2=0; for(var i=0;i<pairs.length;i++){ if(pairs[i].ahead) st2++; else break; }
    out.computedStreak=st2;
    out.acceptedTargets=((typeof st!=='undefined'&&st&&st.runRungs)||[]).filter(function(x){return x&&!x.deleted;})
      .map(function(x){ return {from:x.from, struct:x.struct||('rung '+x.rung)}; });
    return out;
  })()`),null,1));
}catch(e){console.error('FAILED: '+(e&&e.message||e))}
finally{try{ws&&ws.close()}catch(e){};try{chrome.kill()}catch(e){}}
