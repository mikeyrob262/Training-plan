import { spawn } from 'child_process';
import net from 'net';
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT=9423; const wait=ms=>new Promise(r=>setTimeout(r,ms));
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
    if(r.result&&r.result.exceptionDetails) return {__err:JSON.stringify(r.result.exceptionDetails).slice(0,300)};
    return r.result&&r.result.result&&r.result.result.value};
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1512,height:874,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'https://training-plan.mgrobinson07.workers.dev/?z='+Date.now()});
  await wait(2500);
  await ev(`(function(){try{localStorage.setItem('aiq_layout','desktop')}catch(e){}return 1})()`);
  await send('Page.reload',{ignoreCache:true});
  for(let i=0;i<70;i++){ if(await ev(`typeof _storeV2Runs!=='undefined'&&_storeV2Runs&&_storeV2Runs.length>0`)) break; await wait(1000); }
  await wait(6000);
  for(let i=0;i<12;i++){ await ev(`(function(){try{dsShowRun()}catch(e){}return 1})()`); await wait(700);
    if(await ev(`!!document.getElementById('DS-RUN')`)) break; }
  await ev(`(function(){ runOpenTargetSheet_(); return 1})()`); await wait(700);
  console.log('WHAT IS ABOVE THE SHEET:');
  console.log(JSON.stringify(await ev(`(function(){
    var m=document.getElementById('run-target-modal');
    var pts=[[0.5,0.5],[0.5,0.85],[0.5,0.15]];
    var out={ modalRect:null, stack:[] };
    if(m){ var r=m.getBoundingClientRect(); out.modalRect={w:Math.round(r.width),h:Math.round(r.height),top:Math.round(r.top)};
      out.modalZ=getComputedStyle(m).zIndex; out.modalParent=(m.parentElement&&(m.parentElement.id||m.parentElement.tagName))||null; }
    pts.forEach(function(p){
      var el=document.elementFromPoint(window.innerWidth*p[0], window.innerHeight*p[1]);
      var chain=[];
      while(el && chain.length<6){ var cs=getComputedStyle(el);
        chain.push((el.id||el.tagName+'.'+String(el.className||'').slice(0,24))+' z='+cs.zIndex+' pos='+cs.position);
        el=el.parentElement; }
      out.stack.push({at:p[1], chain:chain, insideModal: !!(m && document.elementFromPoint(window.innerWidth*p[0], window.innerHeight*p[1]) && m.contains(document.elementFromPoint(window.innerWidth*p[0], window.innerHeight*p[1]))) });
    });
    return out;
  })()`),null,1));
  console.log('');
  console.log('TALLEST BLOCKS ON THE RUN PAGE (candidates for the 12-36px):');
  await ev(`(function(){var m=document.getElementById('run-target-modal');if(m)m.remove();return 1})()`);
  console.log(JSON.stringify(await ev(`(function(){
    var sc=document.getElementById('DS-RUN'); if(!sc) return null;
    var out=[];
    [].slice.call(sc.children).forEach(function(c){
      var r=c.getBoundingClientRect(), cs=getComputedStyle(c);
      out.push({ tag:(c.id||c.getAttribute('data-runfull')?'runfull':c.tagName), h:Math.round(r.height),
                 mb:cs.marginBottom, txt:(c.textContent||'').replace(/\s+/g,' ').slice(0,46) });
    });
    return out;
  })()`),null,1));
}catch(e){console.error('FAILED: '+(e&&e.message||e))}
finally{try{ws&&ws.close()}catch(e){};try{chrome.kill()}catch(e){}}
