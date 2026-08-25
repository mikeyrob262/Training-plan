// What does the reworked card actually propose, on the real library?
import { spawn } from 'child_process';
import net from 'net';
const URL_='https://training-plan.mgrobinson07.workers.dev/';
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT=9361;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
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
    if(r.result&&r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,600));
    return r.result&&r.result.result&&r.result.result.value};
  await send('Page.enable');await send('Runtime.enable');
  await send('Page.navigate',{url:URL_+'?p='+Date.now()});
  await wait(12000);
  for(let i=0;i<20;i++){ if(await ev(`!!(typeof _storeV2Runs!=='undefined'&&_storeV2Runs&&_storeV2Runs.length)`)) break; await wait(2500); }
  console.log(JSON.stringify(await ev(`(function(){
    var f=_runAheadFlag_(new Date());
    if(!f) return {flag:null};
    return { current:f.current, curTop:f.curTop, streak:f.streak, sample:f.sample, thin:f.thin,
             ranMins:f.runs.map(function(r){return r.ranMin;}),
             target:f.target, injury:f.injury,
             stepPctIsBlockCap:(RUN_STEP_MAX_PCT===BLOCK_RUN_RAMP_MAX),
             ladderCeiling:Math.max.apply(null,_RUN_RUNG_LADDER_().map(_runRangeTopMin_)) };
  })()`),null,2));
}catch(e){console.error('FAILED: '+(e&&e.message||e))}
finally{try{ws&&ws.close()}catch(e){};try{chrome.kill()}catch(e){}}
