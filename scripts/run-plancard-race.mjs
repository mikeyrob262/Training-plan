// THE PLAN CARD AGAINST THE BOOT RACE.
//
// Every previous probe of this card WAITED for the /store_v2 snapshot to arm before opening the Run
// page - which is exactly the condition under which the bug cannot happen. This one opens the page
// as soon as it can, the way a person does, and records what the card and the flag each say at that
// moment and again once the snapshot has landed.
import { spawn } from 'child_process';
import net from 'net';
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT=9412; const wait=ms=>new Promise(r=>setTimeout(r,ms));
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
  await send('Emulation.setDeviceMetricsOverride',{width:1512,height:982,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'https://training-plan.mgrobinson07.workers.dev/?r='+Date.now()});
  await wait(2500);
  await ev(`(function(){try{localStorage.setItem('aiq_layout','desktop')}catch(e){}return 1})()`);
  await send('Page.reload',{ignoreCache:true});

  // Open the Run page the INSTANT the renderer exists - do not wait for the snapshot.
  let opened=false;
  for(let i=0;i<120;i++){
    const ready=await ev(`typeof dsShowRun==='function' && typeof _runAheadFlag_==='function'`).catch(()=>false);
    if(ready){ await ev(`(function(){try{dsShowRun()}catch(e){return 'threw: '+e.message}return 1})()`); opened=true; break; }
    await wait(120);
  }
  if(!opened) throw new Error('renderer never appeared');

  const snap=async()=>ev(`(function(){
    return {
      armed: !!(typeof _storeV2Runs!=='undefined' && _storeV2Runs && _storeV2Runs.length),
      storeV2RunCount: (typeof _storeV2Runs!=='undefined' && _storeV2Runs) ? _storeV2Runs.length : 0,
      getRunsCount: (function(){try{return (getRuns()||[]).length}catch(e){return 'threw'}})(),
      runsWithReadableMinutes: (function(){try{
        var n=0; (getRuns()||[]).forEach(function(r){ if(_runLoggedMin_(r)!=null) n++; }); return n;
      }catch(e){return 'threw'}})(),
      flagIsNull: (function(){try{return _runAheadFlag_(new Date())===null}catch(e){return 'threw'}})(),
      flagStreak: (function(){try{var f=_runAheadFlag_(new Date());return f?f.streak:null}catch(e){return 'threw'}})(),
      cardOnPage: !!(function(){
        var els=document.querySelectorAll('[data-runfull="1"]');
        for(var i=0;i<els.length;i++) if((els[i].textContent||'').indexOf('The plan is behind you')>=0) return true;
        return false; })()
    };
  })()`);

  const hasFix=await ev(`typeof _runArmWatch_==='function'`);
  const build=await ev(`(typeof window.__BUILD__!=='undefined')?String(window.__BUILD__):'(none)'`);
  console.log('served build: '+build+'   _runArmWatch_ present: '+hasFix);
  const tStart=await ev(`(function(){window.__armT0=performance.now();return 1})()`);
  const t0=await snap();
  console.log('AT FIRST RENDER (snapshot not yet armed):'); console.log(JSON.stringify(t0,null,1));

  for(let i=0;i<80;i++){ if(await ev(`!!(typeof _storeV2Runs!=='undefined'&&_storeV2Runs&&_storeV2Runs.length)`)) break; await wait(500); }
  const armMs=await ev(`Math.round(performance.now()-window.__armT0)`);
  console.log('');
  console.log('snapshot armed '+armMs+'ms after the page was opened (watcher window is 20000ms)');
  await wait(1500);
  const t1=await snap();
  console.log('\nAFTER THE SNAPSHOT ARMS (page NOT re-rendered):'); console.log(JSON.stringify(t1,null,1));

  await ev(`(function(){try{dsShowRun()}catch(e){return 'threw: '+e.message}return 1})()`); await wait(600);
  const t2=await snap();
  console.log('\nAFTER A MANUAL RE-RENDER:'); console.log(JSON.stringify(t2,null,1));

  const reproduced = t0.cardOnPage===false && t1.flagIsNull===false && t1.cardOnPage===false && t2.cardOnPage===true;
  console.log('\n'+(reproduced?'\x1b[32mREPRODUCED\x1b[0m':'\x1b[33mnot reproduced this run\x1b[0m')
    +' - flag says one thing, page shows another: '+reproduced);
}catch(e){console.error('FAILED: '+(e&&e.message||e))}
finally{try{ws&&ws.close()}catch(e){};try{chrome.kill()}catch(e){}}
