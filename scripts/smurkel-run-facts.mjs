// What is Dr. Smurkel actually TOLD about a run? Print the facts for the reported activity.
import { spawn } from 'child_process';
import net from 'net';
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT=9451; const wait=ms=>new Promise(r=>setTimeout(r,ms));
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
  await send('Page.navigate',{url:'https://training-plan.mgrobinson07.workers.dev/?s='+Date.now()});
  await wait(2500); await send('Page.reload',{ignoreCache:true});
  for(let i=0;i<70;i++){ if(await ev(`typeof _storeV2Rides!=='undefined'&&_storeV2Rides&&_storeV2Rides.length>0`)) break; await wait(1000); }
  await wait(4000);
  const out=await ev(`(function(){
    var found=null;
    (st.rides||[]).forEach(function(r){
      if(!r||r.deleted) return;
      if(String(r.date||'').slice(0,10)==='2023-07-18') found=r;
    });
    if(!found) return { err:'activity not found in st.rides on 2023-07-18',
      near:(st.rides||[]).filter(function(r){return r&&String(r.date||'').slice(0,7)==='2023-07';})
        .map(function(r){return r.date+' '+(r.name||'')+' '+(r.sportType||r.type);}) };
    var dk=String(found.date).slice(0,10);
    var C=_smurkelContext_(dk, found);
    var facts=_smurkelFacts_(C);
    return {
      activity: { name:found.name, date:found.date, sportType:found.sportType, type:found.type,
                  rideSport: (typeof rideSport_==='function')?rideSport_(found):null,
                  distance:found.distance, avgHR:found.avgHR, avgPwr:found.avgPwr, np:found.np },
      profile: { noun:C.noun, cyclingPower:C.cyclingPower },
      priorComparable: C.prior ? { date:C.prior.date, name:C.prior.name, daysAgo:C.prior.daysAgo } : null,
      factsText: facts
    };
  })()`);
  if(out && out.err){ console.log(JSON.stringify(out,null,1)); }
  else {
    console.log('ACTIVITY: '+JSON.stringify(out.activity));
    console.log('PROFILE : '+JSON.stringify(out.profile));
    console.log('PRIOR   : '+JSON.stringify(out.priorComparable));
    console.log('');
    console.log('---- FACTS AS GIVEN TO THE MODEL ----');
    console.log(typeof out.factsText==='string'?out.factsText:JSON.stringify(out.factsText,null,1));
  }
}catch(e){console.error('FAILED: '+(e&&e.message||e))}
finally{try{ws&&ws.close()}catch(e){};try{chrome.kill()}catch(e){}}
