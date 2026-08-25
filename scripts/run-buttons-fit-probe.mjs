// THREE QUESTIONS AT ONCE, ALL AGAINST THE DEPLOYED PAGE.
//   1 did the arm watcher actually re-render, and if not, why
//   2 are the four plan-card buttons wired, and does clicking each one do anything
//   3 does the page fit a 1512x982 laptop at 100% zoom - measured as the CONTENT box, not the guess
import { spawn } from 'child_process';
import net from 'net';
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT=9417; const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function up(p,t=60){for(let i=0;i<t;i++){const o=await new Promise(res=>{const s=net.connect(p,'127.0.0.1');s.on('connect',()=>{s.destroy();res(true)});s.on('error',()=>res(false))});if(o)return true;await wait(250)}return false}
const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+PORT,'--remote-allow-origins=*','about:blank'],{stdio:'ignore'});
let ws;
try{
  if(!await up(PORT)) throw new Error('no port');
  const t=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
  ws=new WebSocket(t.find(x=>x.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
  let id=0;const pend=new Map();const logs=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);
    if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error') logs.push((m.params.args||[]).map(a=>a.value||a.description||'').join(' '));
    if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id)}};
  const send=(m,p)=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p||{}}))});
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});
    if(r.result&&r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,600));
    return r.result&&r.result.result&&r.result.result.value};
  await send('Page.enable');await send('Runtime.enable');
  // 1512x982 SCREEN. Chrome takes ~108px of chrome on a laptop (tab strip + omnibox + bookmarks),
  // so the viewport a real 100%-zoom window gets is smaller than the screen. Measured both.
  const VIEW=874;
  await send('Emulation.setDeviceMetricsOverride',{width:1512,height:VIEW,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'https://training-plan.mgrobinson07.workers.dev/?b='+Date.now()});
  await wait(2500);
  await ev(`(function(){try{localStorage.setItem('aiq_layout','desktop')}catch(e){}return 1})()`);
  await send('Page.reload',{ignoreCache:true});

  // Open Run the instant it exists, exactly as before - this is the watcher's scenario.
  for(let i=0;i<200;i++){ if(await ev(`typeof dsShowRun==='function'`).catch(()=>false)) break; await wait(100); }
  await ev(`(function(){try{dsShowRun()}catch(e){return 'threw '+e.message}return 1})()`);
  await wait(500);
  console.log('=== 1. THE ARM WATCHER ===');
  console.log(JSON.stringify(await ev(`(function(){return {
    watcherFnExists: typeof _runArmWatch_==='function',
    timerArmed: (typeof _runArmTimer!=='undefined') ? (_runArmTimer!==null) : 'var not visible',
    hostExists: !!document.getElementById('DS-RUN-BODY'),
    armedNow: (typeof _runArmed_==='function')?_runArmed_():'n/a'
  }})()`),null,1));
  for(let i=0;i<60;i++){ if(await ev(`(typeof _runArmed_==='function')&&_runArmed_()`)) break; await wait(400); }
  await wait(3000);
  console.log('after arming + 3s:');
  console.log(JSON.stringify(await ev(`(function(){return {
    timerCleared: (typeof _runArmTimer!=='undefined') ? (_runArmTimer===null) : 'n/a',
    cardOnPage: (function(){var e=document.querySelectorAll('[data-runfull="1"]');
      for(var i=0;i<e.length;i++) if((e[i].textContent||'').indexOf('The plan is behind you')>=0) return true; return false; })()
  }})()`),null,1));

  // Force a clean render so buttons and fit are measured on a good page.
  await ev(`(function(){try{dsShowRun()}catch(e){return 'threw '+e.message}return 1})()`);
  await wait(900);

  console.log('');console.log('=== 2. THE FOUR BUTTONS ===');
  console.log(JSON.stringify(await ev(`(function(){
    var ids=['run-rung-yes','run-rung-no','run-set-manual','run-report-issue'];
    var out={openersDefined:{ target: typeof runOpenTargetSheet_, issue: typeof runOpenIssueSheet_ }, buttons:{}};
    ids.forEach(function(k){
      var all=document.querySelectorAll('#'+k);
      var el=document.getElementById(k);
      var r=el?el.getBoundingClientRect():null;
      // WHAT IS ACTUALLY ON TOP AT THE BUTTON'S OWN CENTRE. A handler that exists on an element
      // something else is covering is a button that does nothing when you click it.
      var hit=null;
      if(r && r.width){ var h=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
        hit=h?(h.id||h.tagName+'.'+(h.className||'').toString().slice(0,30)):'nothing'; }
      out.buttons[k]={ count:all.length, hasOnclick: !!(el&&el.onclick),
        rect: r?{w:Math.round(r.width),h:Math.round(r.height),top:Math.round(r.top),left:Math.round(r.left)}:null,
        topmostAtCentre: hit, isItself: !!(el&&hit===k) };
    });
    return out;
  })()`),null,1));

  console.log('');console.log('=== 3. FIT AT 1512 WIDE ===');
  console.log(JSON.stringify(await ev(`(function(){
    var sc=null, n=document.getElementById('DS-RUN-BODY');
    while(n && n!==document.body){ var cs=getComputedStyle(n);
      if(/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight>n.clientHeight+1){ sc=n; break; } n=n.parentElement; }
    if(!sc){ n=document.getElementById('DS-RUN-BODY');
      while(n && n!==document.body){ var c2=getComputedStyle(n); if(/(auto|scroll)/.test(c2.overflowY)){ sc=n; break; } n=n.parentElement; } }
    return { viewportH: window.innerHeight,
             scroller: sc?(sc.id||sc.className.toString().slice(0,40)):'none',
             clientH: sc?sc.clientHeight:null, scrollH: sc?sc.scrollHeight:null,
             overflowPx: sc?(sc.scrollHeight-sc.clientHeight):null,
             docOverflow: document.documentElement.scrollHeight-window.innerHeight };
  })()`),null,1));
  if(logs.length){ console.log('');console.log('console errors: '+JSON.stringify(logs.slice(0,6),null,1)); }
}catch(e){console.error('FAILED: '+(e&&e.message||e))}
finally{try{ws&&ws.close()}catch(e){};try{chrome.kill()}catch(e){}}
