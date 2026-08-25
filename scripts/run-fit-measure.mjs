// One number that matters, plus the block breakdown behind it. Runs against a LOCAL wrangler dev
// server so a measurement does not need a deploy first.
import { spawn } from 'child_process';
import net from 'net';
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT=9433; const wait=ms=>new Promise(r=>setTimeout(r,ms));
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
    if(r.result&&r.result.exceptionDetails) return {__err:JSON.stringify(r.result.exceptionDetails).slice(0,300)};
    return r.result&&r.result.result&&r.result.result.value};
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1512,height:682,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:URL+'?f='+Date.now()});
  await wait(2500);
  await ev(`(function(){try{localStorage.setItem('aiq_layout','desktop')}catch(e){}return 1})()`);
  await send('Page.reload',{ignoreCache:true});
  for(let i=0;i<70;i++){ if(await ev(`typeof _storeV2Runs!=='undefined'&&_storeV2Runs&&_storeV2Runs.length>0`)) break; await wait(1000); }
  await wait(6000);
  for(let i=0;i<12;i++){ await ev(`(function(){try{dsShowRun()}catch(e){}return 1})()`); await wait(700);
    if(await ev(`!!document.getElementById('DS-RUN-BODY')`)) break; }
  const o=await ev(`(function(){
    var sc=document.getElementById('DS-RUN'), host=document.getElementById('DS-RUN-BODY');
    if(!sc||!host) return {err:'run page not rendered'};
    return {
      build:String(window.__BUILD__||''),
      viewport:window.innerHeight, content:sc.scrollHeight, box:sc.clientHeight,
      OVER: sc.scrollHeight-sc.clientHeight,
      blocks:[].slice.call(sc.children).map(function(c){var r=c.getBoundingClientRect(),cs=getComputedStyle(c);
        return (c.id||'card')+' '+Math.round(r.height)+'px +'+(parseFloat(cs.marginBottom)||0)+'  '
          +(c.textContent||'').replace(/\s+/g,' ').trim().slice(0,30);}),
      columns:[].slice.call(host.children).map(function(col){
        return Math.round(col.getBoundingClientRect().height)+'px: '
          +[].slice.call(col.children).map(function(c){return Math.round(c.getBoundingClientRect().height)
            +'/'+(c.textContent||'').replace(/\s+/g,' ').trim().slice(0,20);}).join(' | ');})
    };
  })()`);
  console.log(JSON.stringify(o,null,1));
  console.log('');
  console.log(o.OVER<=0 ? '\x1b[32mFITS 682\x1b[0m' : ('\x1b[31mOVER BY '+o.OVER+'px\x1b[0m'));
}catch(e){console.error('FAILED: '+(e&&e.message||e))}
finally{try{ws&&ws.close()}catch(e){};try{chrome.kill()}catch(e){}}
