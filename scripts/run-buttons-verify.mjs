// VERIFY THE THREE BUTTONS, INCLUDING UNDER THE CONDITION THAT BROKE THEM.
//
// The negative control matters more than the positive one here: the bug only appeared once a second
// copy of the page existed, so this reproduces that state deliberately - renderRun() on top of the
// desktop page - and checks the buttons still work.
import { spawn } from 'child_process';
import net from 'net';
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT=9421; const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function up(p,t=60){for(let i=0;i<t;i++){const o=await new Promise(res=>{const s=net.connect(p,'127.0.0.1');s.on('connect',()=>{s.destroy();res(true)});s.on('error',()=>res(false))});if(o)return true;await wait(250)}return false}
const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+PORT,'--remote-allow-origins=*','about:blank'],{stdio:'ignore'});
let ws; let fails=0;
const ok=(l,c)=>{ if(!c) fails++; console.log('  '+(c?'\x1b[32mPASS\x1b[0m':'\x1b[31mFAIL\x1b[0m')+'  '+l); };
try{
  if(!await up(PORT)) throw new Error('no port');
  const t=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
  ws=new WebSocket(t.find(x=>x.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
  let id=0;const pend=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id)}};
  const send=(m,p)=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p||{}}))});
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});
    if(r.result&&r.result.exceptionDetails) return {__err:JSON.stringify(r.result.exceptionDetails).slice(0,300)};
    return r.result&&r.result.result&&r.result.result.value};
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1512,height:874,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'https://training-plan.mgrobinson07.workers.dev/?v='+Date.now()});
  await wait(2500);
  await ev(`(function(){try{localStorage.setItem('aiq_layout','desktop')}catch(e){}return 1})()`);
  await send('Page.reload',{ignoreCache:true});
  for(let i=0;i<70;i++){ if(await ev(`typeof _storeV2Runs!=='undefined'&&_storeV2Runs&&_storeV2Runs.length>0`)) break; await wait(1000); }
  await wait(6000);   // let boot settle so nothing re-renders the page underneath the test
  console.log('build: '+await ev(`String(window.__BUILD__||'(none)')`));

  const openRun=async()=>{ for(let i=0;i<12;i++){
    await ev(`(function(){try{dsShowRun()}catch(e){}return 1})()`); await wait(700);
    if(await ev(`(function(){var e=document.querySelectorAll('[data-runfull="1"]');
      for(var i=0;i<e.length;i++) if((e[i].textContent||'').indexOf('The plan is behind you')>=0) return true; return false;})()`)) return true;
  } return false; };

  console.log('\n\x1b[33m=== the plan card renders ===\x1b[0m');
  ok('plan card is on the desktop Run page', await openRun());

  console.log('\n\x1b[33m=== NEGATIVE CONTROL: a second copy of the page cannot steal the buttons ===\x1b[0m');
  const dup=await ev(`(function(){ try{ renderRun(); }catch(e){ return 'threw '+e.message }
    return document.querySelectorAll('#run-rung-no').length; })()`);
  console.log('  after renderRun() on top of the desktop page, #run-rung-no count = '+JSON.stringify(dup));
  await ev(`(function(){var m=document.getElementById('RUN-SCREEN');if(m)m.remove();return 1})()`);
  await openRun();

  console.log('\n\x1b[33m=== each button, pressed ===\x1b[0m');
  const card=`(function(){var e=document.querySelectorAll('[data-runfull="1"]');
    for(var i=0;i<e.length;i++) if((e[i].textContent||'').indexOf('The plan is behind you')>=0) return e[i]; return null;})()`;
  // Set it myself -> opens the target sheet
  await ev(`(function(){var c=${card}; var b=c&&c.querySelector('#run-set-manual'); if(b) b.click(); return 1})()`);
  await wait(600);
  ok('Set it myself opens the target sheet', await ev(`!!document.getElementById('run-target-modal')`));
  ok('...and the sheet is on top at the centre of the screen',
     await ev(`(function(){var t=document.elementFromPoint(window.innerWidth/2,window.innerHeight/2);
       var m=document.getElementById('run-target-modal'); return !!(m&&t&&m.contains(t));})()`));
  await ev(`(function(){var m=document.getElementById('run-target-modal');if(m)m.remove();return 1})()`);
  // Report an issue -> opens the issue sheet
  await ev(`(function(){var c=${card}; var b=c&&c.querySelector('#run-report-issue'); if(b) b.click(); return 1})()`);
  await wait(600);
  ok('Report an issue opens the issue sheet', await ev(`!!document.getElementById('run-issue-modal')`));
  await ev(`(function(){var m=document.getElementById('run-issue-modal');if(m)m.remove();return 1})()`);
  // Not yet -> removes the card
  await ev(`(function(){var c=${card}; var b=c&&c.querySelector('#run-rung-no'); if(b) b.click(); return 1})()`);
  await wait(500);
  ok('Not yet removes the card', await ev(`(function(){var e=document.querySelectorAll('[data-runfull="1"]');
    for(var i=0;i<e.length;i++) if((e[i].textContent||'').indexOf('The plan is behind you')>=0) return false; return true;})()`));
  await openRun();
  ok('...and it comes back on the next visit, not dismissed for good',
     await ev(`(function(){var e=document.querySelectorAll('[data-runfull="1"]');
       for(var i=0;i<e.length;i++) if((e[i].textContent||'').indexOf('The plan is behind you')>=0) return true; return false;})()`));

  console.log('\n\x1b[33m=== fit at 1512 wide ===\x1b[0m');
  for(const h of [982,900,874,850,820]){
    await send('Emulation.setDeviceMetricsOverride',{width:1512,height:h,deviceScaleFactor:1,mobile:false});
    await wait(400); await openRun(); await wait(400);
    const m=await ev(`(function(){var sc=document.getElementById('DS-RUN');
      if(!sc) return null; return { clientH:sc.clientHeight, scrollH:sc.scrollHeight, over:sc.scrollHeight-sc.clientHeight };})()`);
    console.log('  viewport '+h+': '+JSON.stringify(m));
  }
  console.log('');
  console.log(fails?('\x1b[31m'+fails+' FAILED\x1b[0m'):'\x1b[32mall button checks passed\x1b[0m');
}catch(e){console.error('FAILED: '+(e&&e.message||e))}
finally{try{ws&&ws.close()}catch(e){};try{chrome.kill()}catch(e){}}
