// WHERE DOES THE PAGE ACTUALLY TIP, and what is inside the plan card?
// Sweeps realistic VIEWPORT heights - a 982px screen gives a browser far less than 982 once tab bar,
// URL bar, OS menu bar and dock are taken off - and itemises the plan card so a cut can be priced.
import { spawn } from 'child_process';
import net from 'net';
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT=9381; const wait=ms=>new Promise(r=>setTimeout(r,ms));
const G='\x1b[32m',R='\x1b[31m',Y='\x1b[33m',X='\x1b[0m';
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
  let first=true;
  for(const h of [740,780,820,860,900,940,982]){
    await send('Emulation.setDeviceMetricsOverride',{width:1512,height:h,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url:'https://training-plan.mgrobinson07.workers.dev/?pc='+Date.now()});
    await wait(3000);
    await ev(`(function(){try{localStorage.setItem('aiq_layout','desktop')}catch(e){}return 1})()`);
    await send('Page.reload',{ignoreCache:true}); await wait(11000);
    for(let i=0;i<20;i++){ if(await ev(`!!(typeof _storeV2Runs!=='undefined'&&_storeV2Runs&&_storeV2Runs.length)`)) break; await wait(2500); }
    await ev(`(function(){dsShowRun();return 1})()`); await wait(3000);
    const r=await ev(`(function(){
      var wrap=document.getElementById('DS-RUN');
      var parts={};
      [].slice.call(wrap.children).forEach(function(el){
        var n=(el.innerText||'').trim().split(String.fromCharCode(10))[0].slice(0,20)||el.id;
        parts[n]=Math.round(el.getBoundingClientRect().height); });
      var pc=[].slice.call(wrap.children).filter(function(e2){
        return (e2.innerText||'').indexOf('THE PLAN IS BEHIND YOU')===0; })[0];
      var inner=null;
      if(pc) inner=[].slice.call(pc.children).map(function(k){
        return { h:Math.round(k.getBoundingClientRect().height),
                 t:(k.innerText||'').trim().split(String.fromCharCode(10))[0].slice(0,40) }; });
      return { content:wrap.scrollHeight, box:wrap.clientHeight, over:wrap.scrollHeight-wrap.clientHeight,
               parts:parts, plan:pc?Math.round(pc.getBoundingClientRect().height):null, planInner:inner,
               planStyle:pc?getComputedStyle(pc).padding:null };
    })()`);
    const fits=r.over<=2;
    console.log('  1512x'+String(h).padEnd(4)+'  '+(fits?G+'FITS      '+X:R+'over '+String(r.over).padStart(4)+'px'+X)+
      '  content '+String(r.content).padStart(5));
    if(first){ first=false;
      console.log('             '+Y+JSON.stringify(r.parts)+X);
      console.log('             '+Y+'plan card '+r.plan+'px  padding '+r.planStyle+X);
      (r.planInner||[]).forEach(k => console.log('                '+String(k.h).padStart(4)+'px  '+k.t));
    }
  }
}catch(e){console.error('FAILED: '+(e&&e.message||e))}
finally{try{ws&&ws.close()}catch(e){};try{chrome.kill()}catch(e){}}
