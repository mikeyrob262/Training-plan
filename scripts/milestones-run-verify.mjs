import { spawn } from 'child_process';
import net from 'net';
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT=9461; const wait=ms=>new Promise(r=>setTimeout(r,ms));
const URL=process.env.FIT_URL||'https://training-plan.mgrobinson07.workers.dev/';
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
    if(r.result&&r.result.exceptionDetails) return {__err:JSON.stringify(r.result.exceptionDetails).slice(0,500)};
    return r.result&&r.result.result&&r.result.result.value};
  await send('Page.enable');await send('Runtime.enable');
  await send('Page.navigate',{url:URL+'?ms='+Date.now()});
  await wait(2500); await send('Page.reload',{ignoreCache:true});
  for(let i=0;i<70;i++){ if(await ev(`typeof _storeV2Runs!=='undefined'&&_storeV2Runs&&_storeV2Runs.length>0`)) break; await wait(1000); }
  await wait(4000);
  console.log(JSON.stringify(await ev(`(function(){
    var C=_msCatalog_(new Date());
    var runRows=_msRunning_();
    var runs=C.proj.filter(function(p){ return p.category==='Running'; });
    return {
      runRowCount: runRows.length,
      lifetimeRunMiles: Math.round(runRows.reduce(function(s,r){return s+r.mi;},0)),
      runningMilestones: runs.map(function(p){
        return (p.unlocked?'[x] ':'[ ] ')+p.name+'  cur='+Math.round(p.current)
          +' tgt='+p.target+(p.unlocked?(p.date?(' on '+p.date):''):(p.projectedDate?(' -> '+p.projectedDate):' (no projection)'));
      }),
      cyclingStillThere: C.proj.filter(function(p){ return p.category==='Distance'||p.category==='Climbing'; }).length,
      sourceNote: (typeof dataSourceNote_==='function')?dataSourceNote_('deduped'):null
    };
  })()`),null,1));
}catch(e){console.error('FAILED: '+(e&&e.message||e))}
finally{try{ws&&ws.close()}catch(e){};try{chrome.kill()}catch(e){}}
