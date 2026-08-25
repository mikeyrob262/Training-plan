// The Why card, rendered, against the real library.
import { spawn } from 'child_process';
import net from 'net';
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT=9447; const wait=ms=>new Promise(r=>setTimeout(r,ms));
const URL=process.env.FIT_URL||'http://127.0.0.1:8799/';
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
    if(r.result&&r.result.exceptionDetails) return {__err:JSON.stringify(r.result.exceptionDetails).slice(0,400)};
    return r.result&&r.result.result&&r.result.result.value};
  await send('Page.enable');await send('Runtime.enable');
  await send('Page.navigate',{url:URL+'?w='+Date.now()});
  await wait(2500); await send('Page.reload',{ignoreCache:true});
  for(let i=0;i<70;i++){ if(await ev(`typeof _storeV2Rides!=='undefined'&&_storeV2Rides&&_storeV2Rides.length>0`)) break; await wait(1000); }
  await wait(4000);
  console.log(JSON.stringify(await ev(`(function(){
    var w=_runWhy_(90);
    var html=_runWhyCardHTML_();
    return {
      drivers: w.drivers.map(function(d){ return d.key+' '+(d.rawDelta>0?'+':'')+d.rawDelta+'% ('
        +Math.round(d.prior*10)/10+' -> '+Math.round(d.recent*10)/10+' '+d.unit+')'; }),
      stillCarriesAValenceField: w.drivers.some(function(d){ return d.delta!==undefined; }),
      greenInCard: (html.match(/--c-green/g)||[]).length,
      redInCard: (html.match(/--c-red/g)||[]).length,
      leadLine: (html.match(/Inputs behind the verdict[^<]*/)||[''])[0],
      driftVerdictBeside: (function(){ try{ var v=_runShinVerdict_?_runShinVerdict_():null; return v&&v.head; }catch(e){ return '(n/a)'; } })()
    };
  })()`),null,1));
}catch(e){console.error('FAILED: '+(e&&e.message||e))}
finally{try{ws&&ws.close()}catch(e){};try{chrome.kill()}catch(e){}}
