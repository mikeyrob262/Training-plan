// A CARD THAT SHRINKS WITH overflow:hidden CAN CLIP ITSELF. The trajectory card is now flex:1 1 auto
// so it grows into spare height - which also means it SHRINKS when there is none. This checks it is
// fitting honestly rather than hiding its own content.
import { spawn } from 'child_process';
import net from 'net';
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT=9395; const wait=ms=>new Promise(r=>setTimeout(r,ms));
const G='\x1b[32m',R='\x1b[31m',Y='\x1b[33m',X='\x1b[0m';
async function up(p,t=60){for(let i=0;i<t;i++){const o=await new Promise(res=>{const s=net.connect(p,'127.0.0.1');s.on('connect',()=>{s.destroy();res(true)});s.on('error',()=>res(false))});if(o)return true;await wait(250)}return false}
const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+PORT,'--remote-allow-origins=*','about:blank'],{stdio:'ignore'});
let ws, bad=0;
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
  for(const [w,h] of [[1512,740],[1512,820],[1512,900],[1512,982],[1366,1024],[1024,1366]]){
    await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url:'https://training-plan.mgrobinson07.workers.dev/?cl='+Date.now()});
    await wait(3000);
    await ev(`(function(){try{localStorage.setItem('aiq_layout','desktop')}catch(e){}return 1})()`);
    await send('Page.reload',{ignoreCache:true}); await wait(11000);
    for(let i=0;i<20;i++){ if(await ev(`!!(typeof _storeV2Runs!=='undefined'&&_storeV2Runs&&_storeV2Runs.length)`)) break; await wait(2500); }
    await ev(`(function(){dsShowRun();return 1})()`); await wait(3000);
    const r=await ev(`(function(){
      var c=[].slice.call(document.querySelectorAll('#DS-RUN > div')).filter(function(e2){
        return (e2.innerText||'').indexOf('RUNNING TRAJECTORY')===0; })[0];
      if(!c) return null;
      var svg=c.querySelector('svg[viewBox]');
      // Does the card hide any of its own content, and is anything inside it cut off?
      var clipped=[];
      [].slice.call(c.querySelectorAll('*')).forEach(function(e2){
        if(e2.scrollHeight>e2.clientHeight+2 && getComputedStyle(e2).overflowY==='hidden')
          clipped.push(((e2.innerText||'').trim().split(String.fromCharCode(10))[0]||e2.tagName).slice(0,26)
                       +' '+e2.clientHeight+'/'+e2.scrollHeight);
      });
      var cr=c.getBoundingClientRect();
      return { cardH:Math.round(cr.height), cardSH:c.scrollHeight, cardCH:c.clientHeight,
               selfClips:(c.scrollHeight>c.clientHeight+2),
               svgH:svg?Math.round(svg.getBoundingClientRect().height):null,
               inner:clipped,
               // Is the insight band - the last thing in the card - still fully on screen?
               lastVisible:(function(){ var b=[].slice.call(c.children).pop();
                 if(!b) return null; var r2=b.getBoundingClientRect();
                 return { bottom:Math.round(r2.bottom), cardBottom:Math.round(cr.bottom),
                          inside:(r2.bottom<=cr.bottom+2) }; })() };
    })()`);
    if(!r){ console.log('  '+w+'x'+h+'  '+R+'card not found'+X); bad++; continue; }
    const ok=!r.selfClips && r.inner.length===0 && r.lastVisible && r.lastVisible.inside;
    if(!ok) bad++;
    console.log('  '+String(w+'x'+h).padEnd(10)+(ok?G+' honest ':R+' CLIPS  ')+X+
      ' card '+String(r.cardH).padStart(4)+'px (content '+String(r.cardSH).padStart(4)+
      ')  ridge '+String(r.svgH).padStart(3)+'px'+
      (r.inner.length?('   '+R+JSON.stringify(r.inner)+X):'')+
      (r.lastVisible&&!r.lastVisible.inside?('   '+R+'insight band cut off'+X):''));
  }
}catch(e){console.error('FAILED: '+(e&&e.message||e));bad++}
finally{try{ws&&ws.close()}catch(e){};try{chrome.kill()}catch(e){}}
console.log(bad?(R+bad+' viewport(s) clip'+X):(G+'no viewport hides content'+X));
