// WHAT THE RUN PAGE IS MADE OF, AT 1512 WIDE, MEASURED - so a plan to fit 682 is arithmetic and not
// another estimate. Reports the top-level blocks and, inside the balanced host, every individual card
// with its column, because the host costs the TALLEST COLUMN and not the sum.
import { spawn } from 'child_process';
import net from 'net';
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT=9431; const wait=ms=>new Promise(r=>setTimeout(r,ms));
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
  await send('Emulation.setDeviceMetricsOverride',{width:1512,height:682,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'https://training-plan.mgrobinson07.workers.dev/?f='+Date.now()});
  await wait(2500);
  await ev(`(function(){try{localStorage.setItem('aiq_layout','desktop')}catch(e){}return 1})()`);
  await send('Page.reload',{ignoreCache:true});
  for(let i=0;i<70;i++){ if(await ev(`typeof _storeV2Runs!=='undefined'&&_storeV2Runs&&_storeV2Runs.length>0`)) break; await wait(1000); }
  await wait(6000);
  for(let i=0;i<12;i++){ await ev(`(function(){try{dsShowRun()}catch(e){}return 1})()`); await wait(700);
    if(await ev(`!!document.getElementById('DS-RUN-BODY')`)) break; }
  const out=await ev(`(function(){
    var sc=document.getElementById('DS-RUN'), host=document.getElementById('DS-RUN-BODY');
    var top=[].slice.call(sc.children).map(function(c){
      var r=c.getBoundingClientRect(), cs=getComputedStyle(c);
      return { what:(c.id||(c.getAttribute('data-runfull')?'full-width card':'block')),
               h:Math.round(r.height), mb:parseFloat(cs.marginBottom)||0,
               label:(c.textContent||'').replace(/\s+/g,' ').trim().slice(0,40) };
    });
    var cols=[].slice.call(host.children).map(function(col,ci){
      return { col:ci, h:Math.round(col.getBoundingClientRect().height),
        cards:[].slice.call(col.children).map(function(c){
          return { h:Math.round(c.getBoundingClientRect().height),
                   label:(c.textContent||'').replace(/\s+/g,' ').trim().slice(0,38) }; }) };
    });
    var scs=getComputedStyle(sc);
    return { viewport:window.innerHeight, scrollH:sc.scrollHeight, clientH:sc.clientHeight,
             padding:(parseFloat(scs.paddingTop)||0)+(parseFloat(scs.paddingBottom)||0),
             topBlocks:top, hostColumns:cols };
  })()`);
  console.log(JSON.stringify(out,null,1));
}catch(e){console.error('FAILED: '+(e&&e.message||e))}
finally{try{ws&&ws.close()}catch(e){};try{chrome.kill()}catch(e){}}
