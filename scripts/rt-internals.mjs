import { spawn } from 'child_process';
import net from 'net';
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT=9435; const wait=ms=>new Promise(r=>setTimeout(r,ms));
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
    if(r.result&&r.result.exceptionDetails) return {__err:JSON.stringify(r.result.exceptionDetails).slice(0,300)};
    return r.result&&r.result.result&&r.result.result.value};
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1512,height:682,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:URL+'?f='+Date.now()});
  await wait(2000);
  await ev(`(function(){try{localStorage.setItem('aiq_layout','desktop')}catch(e){}return 1})()`);
  await send('Page.reload',{ignoreCache:true});
  for(let i=0;i<70;i++){ if(await ev(`typeof _storeV2Runs!=='undefined'&&_storeV2Runs&&_storeV2Runs.length>0`)) break; await wait(1000); }
  await wait(5000);
  for(let i=0;i<12;i++){ await ev(`(function(){try{dsShowRun()}catch(e){}return 1})()`); await wait(700);
    if(await ev(`!!document.getElementById('DS-RUN-BODY')`)) break; }
  const walk=`(function(root,depth){
    function rec(el,d){
      var r=el.getBoundingClientRect();
      var out=[Array(d+1).join('  ')+Math.round(r.height)+'px  '+(el.textContent||'').replace(/\s+/g,' ').trim().slice(0,44)];
      if(d<depth) [].slice.call(el.children).forEach(function(c){ out=out.concat(rec(c,d+1)); });
      return out;
    }
    return rec(root,0);
  })`;
  const which = process.env.WHICH || 'rt';
  const target = which==='drift'
    ? `(function(){var e=document.querySelectorAll('#DS-RUN-BODY *');
        for(var i=0;i<e.length;i++){ var t=(e[i].textContent||'');
          if(t.indexOf('Easy-run drift')===0 && e[i].getBoundingClientRect().height>150) return e[i]; }
        return null;})()`
    : which==='pb'
    ? `(function(){var e=document.querySelectorAll('#DS-RUN-BODY *');
        for(var i=0;i<e.length;i++){var t=(e[i].textContent||'');
          if(t.indexOf("Easy-run drift")>=0 && e[i].parentElement && e[i].parentElement.id==='' && e[i].getBoundingClientRect().height>300) return e[i];}
        var cols=document.getElementById('DS-RUN-BODY').children;
        return cols[0]&&cols[0].children[0];})()`
    : `(function(){var e=document.querySelectorAll('[data-runfull="1"]');
        for(var i=0;i<e.length;i++) if((e[i].textContent||'').indexOf('RUNNING TRAJECTORY')>=0) return e[i];
        return null;})()`;
  const lines = await ev(`${walk}(${target}, 3)`);
  console.log((lines||['(not found)']).join('\n'));
}catch(e){console.error('FAILED: '+(e&&e.message||e))}
finally{try{ws&&ws.close()}catch(e){};try{chrome.kill()}catch(e){}}
