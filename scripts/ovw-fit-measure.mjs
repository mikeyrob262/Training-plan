// What the Athlete Intelligence Overview is made of, block by block, so a change to it is arithmetic.
import { spawn } from 'child_process';
import net from 'net';
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT=9481; const wait=ms=>new Promise(r=>setTimeout(r,ms));
const VH=+(process.env.VH||900);
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
    if(r.result&&r.result.exceptionDetails) return {__err:JSON.stringify(r.result.exceptionDetails).slice(0,400)};
    return r.result&&r.result.result&&r.result.result.value};
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1512,height:VH,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:URL+'?o='+Date.now()});
  await wait(2500);
  await ev(`(function(){try{localStorage.setItem('aiq_layout','desktop')}catch(e){}return 1})()`);
  await send('Page.reload',{ignoreCache:true});
  for(let i=0;i<70;i++){ if(await ev(`typeof _storeV2Rides!=='undefined'&&_storeV2Rides&&_storeV2Rides.length>0`)) break; await wait(1000); }
  await wait(6000);
  for(let i=0;i<14;i++){
    await ev(`(function(){try{ if(typeof dsShowAthleteIntel==='function') dsShowAthleteIntel(); }catch(e){} return 1})()`);
    await wait(800);
    if(await ev(`!!document.querySelector('.ov-bal')`)) break;
  }
  console.log(JSON.stringify(await ev(`(function(){
    var bal=document.querySelector('.ov-bal');
    if(!bal) return {err:'overview not rendered'};
    // The scroller the page lives in.
    var sc=bal.parentElement;
    while(sc && sc!==document.body){ var cs=getComputedStyle(sc);
      if(/(auto|scroll)/.test(cs.overflowY)) break; sc=sc.parentElement; }
    var lbl=function(el){ return (el.textContent||'').replace(/\s+/g,' ').trim().slice(0,34); };
    var topBlocks=[];
    var host=bal.parentElement;
    [].slice.call(host.children).forEach(function(c){
      var r=c.getBoundingClientRect(), cs=getComputedStyle(c);
      topBlocks.push(Math.round(r.height)+'+'+(parseFloat(cs.marginBottom)||0)+'  '+(c.className||c.tagName)+'  '+lbl(c));
    });
    var cols=[].slice.call(bal.children).map(function(col){
      return Math.round(col.getBoundingClientRect().height)+'px: '+[].slice.call(col.children).map(function(c){
        return Math.round(c.getBoundingClientRect().height)+'/'+lbl(c); }).join(' | ');
    });
    return {
      viewport:window.innerHeight,
      scroller:(sc&&(sc.id||sc.className))||'none',
      content:sc?sc.scrollHeight:null, box:sc?sc.clientHeight:null,
      OVER: sc?(sc.scrollHeight-sc.clientHeight):null,
      topBlocks:topBlocks, balColumns:cols
    };
  })()`),null,1));
}catch(e){console.error('FAILED: '+(e&&e.message||e))}
finally{try{ws&&ws.close()}catch(e){};try{chrome.kill()}catch(e){}}
