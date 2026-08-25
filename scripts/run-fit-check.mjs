// DOES THE RUN PAGE FIT? One number per viewport, plus the column count it chose.
import { spawn } from 'child_process';
import net from 'net';
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT=9377; const wait=ms=>new Promise(r=>setTimeout(r,ms));
const G='\x1b[32m',R='\x1b[31m',Y='\x1b[33m',X='\x1b[0m';
async function up(p,t=60){for(let i=0;i<t;i++){const o=await new Promise(res=>{const s=net.connect(p,'127.0.0.1');s.on('connect',()=>{s.destroy();res(true)});s.on('error',()=>res(false))});if(o)return true;await wait(250)}return false}
const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+PORT,'--remote-allow-origins=*','about:blank'],{stdio:'ignore'});
let ws, fails=0;
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
  for(const [w,h] of [[1600,900],[1512,982],[1600,1080],[1280,800]]){
    await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url:'https://training-plan.mgrobinson07.workers.dev/?f='+Date.now()});
    await wait(3000);
    await ev(`(function(){try{localStorage.setItem('aiq_layout','desktop')}catch(e){}return 1})()`);
    await send('Page.reload',{ignoreCache:true}); await wait(11000);
    for(let i=0;i<20;i++){ if(await ev(`!!(typeof _storeV2Runs!=='undefined'&&_storeV2Runs&&_storeV2Runs.length)`)) break; await wait(2500); }
    await ev(`(function(){dsShowRun();return 1})()`); await wait(3500);
    const r=await ev(`(function(){
      var wrap=document.getElementById('DS-RUN'), body=document.getElementById('DS-RUN-BODY');
      var cols=body?(body.children.length&&body.firstElementChild&&body.firstElementChild.style.flexDirection==='column'?body.children.length:0):0;
      var parts={};
      [].slice.call(wrap.children).forEach(function(el){
        var n=(el.innerText||'').trim().split(String.fromCharCode(10))[0].slice(0,22)||el.id;
        parts[n]=Math.round(el.getBoundingClientRect().height); });
      return { content:wrap.scrollHeight, box:wrap.clientHeight, over:wrap.scrollHeight-wrap.clientHeight,
               cols:cols, parts:parts, bodyH:body?Math.round(body.getBoundingClientRect().height):null,
               // WHAT SETS THE TRAJECTORY CARD'S HEIGHT. Shrinking the chart saved nothing, which
               // means the chart is not the tallest thing in it - so the three columns are measured
               // separately rather than assumed.
               traj:(function(){
                 var c=[].slice.call(wrap.children).filter(function(e2){
                   return (e2.innerText||'').indexOf('RUNNING TRAJECTORY')===0; })[0];
                 if(!c) return null;
                 var row=[].slice.call(c.children).filter(function(e2){ return e2.children.length>=3; })[0];
                 var svg=c.querySelector('svg[viewBox]');
                 return { card:Math.round(c.getBoundingClientRect().height),
                          svgH:svg?Math.round(svg.getBoundingClientRect().height):null,
                          cols:row?[].slice.call(row.children).map(function(k){
                            return { h:Math.round(k.getBoundingClientRect().height),
                                     t:(k.innerText||'').trim().split(String.fromCharCode(10))[0].slice(0,20) }; }):null,
                          bands:[].slice.call(c.children).map(function(k){
                            return Math.round(k.getBoundingClientRect().height); }) };
               })() };
    })()`);
    const fits=r.over<=2;
    if(!fits) fails++;
    console.log('  '+String(w+'x'+h).padEnd(10)+' '+(fits?G+'FITS   '+X:R+'over '+String(r.over).padStart(4)+'px'+X)+
      '  content '+String(r.content).padStart(5)+' / box '+String(r.box).padStart(5)+
      '   '+r.cols+' cols, lower section '+r.bodyH+'px');
    console.log('             '+Y+JSON.stringify(r.parts)+X);
    if(r.traj) console.log('             traj card '+r.traj.card+'px  svg '+r.traj.svgH+
      'px  bands '+JSON.stringify(r.traj.bands)+'  cols '+JSON.stringify(r.traj.cols));
  }
}catch(e){console.error('FAILED: '+(e&&e.message||e));fails++}
finally{try{ws&&ws.close()}catch(e){};try{chrome.kill()}catch(e){}}
console.log(fails?(R+fails+' viewport(s) still scroll'+X):(G+'fits every tested viewport'+X));
