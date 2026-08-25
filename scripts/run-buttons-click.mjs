// CLICK THEM. Wiring proves nothing - the report is that pressing them does nothing, so press them.
import { spawn } from 'child_process';
import net from 'net';
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT=9419; const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function up(p,t=60){for(let i=0;i<t;i++){const o=await new Promise(res=>{const s=net.connect(p,'127.0.0.1');s.on('connect',()=>{s.destroy();res(true)});s.on('error',()=>res(false))});if(o)return true;await wait(250)}return false}
const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+PORT,'--remote-allow-origins=*','about:blank'],{stdio:'ignore'});
let ws;
try{
  if(!await up(PORT)) throw new Error('no port');
  const t=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
  ws=new WebSocket(t.find(x=>x.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
  let id=0;const pend=new Map();const errs=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);
    if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error') errs.push((m.params.args||[]).map(a=>a.value||a.description||'').join(' '));
    if(m.method==='Runtime.exceptionThrown') errs.push('THROWN: '+(m.params.exceptionDetails&&m.params.exceptionDetails.text)+' '+((m.params.exceptionDetails||{}).exception||{}).description);
    if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id)}};
  const send=(m,p)=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p||{}}))});
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});
    if(r.result&&r.result.exceptionDetails) return {__err:JSON.stringify(r.result.exceptionDetails).slice(0,400)};
    return r.result&&r.result.result&&r.result.result.value};
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1512,height:874,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'https://training-plan.mgrobinson07.workers.dev/?c='+Date.now()});
  await wait(2500);
  await ev(`(function(){try{localStorage.setItem('aiq_layout','desktop')}catch(e){}return 1})()`);
  await send('Page.reload',{ignoreCache:true});
  for(let i=0;i<60;i++){ if(await ev(`typeof _storeV2Runs!=='undefined'&&_storeV2Runs&&_storeV2Runs.length>0`)) break; await wait(1000); }
  // Boot keeps re-rendering for a while, and a late dashboard render replaces #ds-content under us.
  // Open Run until it STAYS open.
  let opened='never';
  for(let i=0;i<15;i++){
    const rv=await ev(`(function(){ if(!document.getElementById('ds-content')) return 'no ds-content';
      try{ dsShowRun() }catch(e){ return 'threw '+e.message } return 'called'; })()`);
    await wait(900);
    const n=await ev(`document.querySelectorAll('[data-runfull="1"]').length`);
    opened=rv+' -> '+n+' full cards';
    if(n>0) break;
  }
  console.log('opening Run: '+opened);

  const state=()=>ev(`(function(){return {
    planCards: document.querySelectorAll('[data-runfull="1"]').length,
    planCardText: (function(){var e=document.querySelectorAll('[data-runfull="1"]');
      for(var i=0;i<e.length;i++) if((e[i].textContent||'').indexOf('The plan is behind you')>=0) return true; return false;})(),
    targetModal: !!document.getElementById('run-target-modal'),
    issueModal: !!document.getElementById('run-issue-modal'),
    mobileOverlay: !!document.getElementById('RUN-SCREEN')
  }})()`);

  console.log('before any click: '+JSON.stringify(await state()));
  for(const btn of ['run-set-manual','run-report-issue','run-rung-no']){
    errs.length=0;
    const r=await ev(`(function(){var b=document.getElementById('${btn}');
      if(!b) return 'MISSING';
      if(!b.onclick) return 'NO HANDLER';
      try{ b.click(); }catch(e){ return 'CLICK THREW: '+e.message; }
      return 'clicked';
    })()`);
    await wait(700);
    const s=await state();
    console.log('');
    console.log('--- '+btn+' -> '+JSON.stringify(r));
    console.log('    '+JSON.stringify(s));
    // What is actually on screen and on top, in the middle of the viewport?
    const vis=await ev(`(function(){
      var m=document.getElementById('run-target-modal')||document.getElementById('run-issue-modal');
      if(!m) return null;
      var cs=getComputedStyle(m), r=m.getBoundingClientRect();
      var top=document.elementFromPoint(window.innerWidth/2, window.innerHeight/2);
      return { display:cs.display, visibility:cs.visibility, opacity:cs.opacity, zIndex:cs.zIndex,
               w:Math.round(r.width), h:Math.round(r.height),
               parent:(m.parentElement&&(m.parentElement.id||m.parentElement.tagName))||null,
               topmostAtViewportCentre: top?(top.id||top.tagName+'.'+String(top.className).slice(0,30)):null };
    })()`);
    if(vis) console.log('    modal: '+JSON.stringify(vis));
    if(errs.length) console.log('    errors: '+JSON.stringify(errs.slice(0,4)));
    // clean up between clicks
    await ev(`(function(){['run-target-modal','run-issue-modal'].forEach(function(k){var m=document.getElementById(k);if(m)m.remove();});return 1})()`);
  }
}catch(e){console.error('FAILED: '+(e&&e.message||e))}
finally{try{ws&&ws.close()}catch(e){};try{chrome.kill()}catch(e){}}
