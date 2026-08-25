// WHICH LAYOUT DOES AN iPAD GET, AND WHERE DOES THE HEIGHT CHAIN STOP FILLING?
// No forced aiq_layout - it is cleared, so this reproduces what the device actually decides.
import { spawn } from 'child_process';
import net from 'net';
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT=9391; const wait=ms=>new Promise(r=>setTimeout(r,ms));
const Y='\x1b[33m',X='\x1b[0m',R='\x1b[31m',G='\x1b[32m';
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
    if(r.result&&r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,700));
    return r.result&&r.result.result&&r.result.result.value};
  await send('Page.enable');await send('Runtime.enable');
  const DEVICES=[
    ['iPad 11 portrait',820,1180],['iPad 11 landscape',1180,820],
    ['iPad Pro 12.9 portrait',1024,1366],['iPad Pro 12.9 landscape',1366,1024],
    ['iPad mini portrait',744,1133],['iPad mini landscape',1133,744],
  ];
  for(const [name,w,h] of DEVICES){
    await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:2,mobile:true});
    await send('Page.navigate',{url:'https://training-plan.mgrobinson07.workers.dev/?ip='+Date.now()});
    await wait(3000);
    // CLEAR the override so the device decides, which is what the athlete sees.
    await ev(`(function(){try{localStorage.removeItem('aiq_layout')}catch(e){}return 1})()`);
    await send('Page.reload',{ignoreCache:true}); await wait(11000);
    for(let i=0;i<20;i++){ if(await ev(`!!(typeof _storeV2Runs!=='undefined'&&_storeV2Runs&&_storeV2Runs.length)`)) break; await wait(2500); }
    const desk=await ev(`(function(){ return (typeof isDesktop==='function')?isDesktop():null })()`);
    await ev(`(function(){ try{ if(isDesktop()) dsShowRun(); else renderRun(); }catch(e){ return String(e&&e.message); } return 1 })()`);
    await wait(3000);
    const r=await ev(`(function(){
      var box=function(sel){ var e2=(sel[0]==='#'||sel[0]==='.')?document.querySelector(sel):document.getElementById(sel);
        if(!e2) return null; var b=e2.getBoundingClientRect(), c=getComputedStyle(e2);
        return { h:Math.round(b.height), top:Math.round(b.top), sh:e2.scrollHeight, ch:e2.clientHeight,
                 css:c.height, minH:c.minHeight, flex:c.flex, pos:c.position, ov:c.overflowY }; };
      var chain={};
      ['html','body','#app-shell','#desktop-shell','#ds-main-area','#ds-content','#DS-RUN','#DS-RUN-BODY','#RUN-SCREEN']
        .forEach(function(s2){ var k=s2.replace(/[#.]/,''); chain[k]=box(s2==='html'?'html':(s2==='body'?'body':s2)); });
      // Where does painted content actually stop?
      var deepest=0;
      [].slice.call(document.querySelectorAll('#DS-RUN *, #RUN-SCREEN *')).forEach(function(e2){
        var b=e2.getBoundingClientRect(); if(b.height>0 && b.bottom>deepest) deepest=b.bottom; });
      return { vw:innerWidth, vh:innerHeight, htmlClass:document.documentElement.className,
               chain:chain, contentBottom:Math.round(deepest), dead:Math.round(innerHeight-deepest) };
    })()`);
    console.log('\n'+Y+name+'  '+w+'x'+h+X);
    console.log('  viewport '+r.vw+'x'+r.vh+'   isDesktop() '+desk+'   html.'+r.htmlClass);
    console.log('  content stops at '+r.contentBottom+'px  -> '+
      (r.dead>40?R+r.dead+'px DEAD SPACE'+X:G+'fills ('+r.dead+'px)'+X));
    Object.keys(r.chain).forEach(function(k){
      var c=r.chain[k]; if(!c) return;
      console.log('    '+k.padEnd(14)+' h='+String(c.h).padStart(5)+'  css-h='+String(c.css).padEnd(9)+
        ' minH='+String(c.minH).padEnd(7)+' flex='+String(c.flex).padEnd(12)+' pos='+c.pos+' ovY='+c.ov);
    });
  }
}catch(e){console.error('FAILED: '+(e&&e.message||e))}
finally{try{ws&&ws.close()}catch(e){};try{chrome.kill()}catch(e){}}
