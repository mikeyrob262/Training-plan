// What running history actually exists, so milestone tiers are chosen against real numbers rather
// than invented ones - the app's standing rule.
import { spawn } from 'child_process';
import net from 'net';
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT=9459; const wait=ms=>new Promise(r=>setTimeout(r,ms));
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
    if(r.result&&r.result.exceptionDetails) return {__err:JSON.stringify(r.result.exceptionDetails).slice(0,500)};
    return r.result&&r.result.result&&r.result.result.value};
  await send('Page.enable');await send('Runtime.enable');
  await send('Page.navigate',{url:'https://training-plan.mgrobinson07.workers.dev/?r='+Date.now()});
  await wait(2500); await send('Page.reload',{ignoreCache:true});
  for(let i=0;i<70;i++){ if(await ev(`typeof _storeV2Runs!=='undefined'&&_storeV2Runs&&_storeV2Runs.length>0`)) break; await wait(1000); }
  await wait(4000);
  console.log(JSON.stringify(await ev(`(function(){
    var runs=(typeof getRuns==='function')?getRuns():[];
    var mi=0, elev=0, n=0, longest=0, years={}, sec=0;
    var byYear={};
    runs.forEach(function(r){
      if(!r||r.deleted) return;
      var d=parseFloat(r.distance)||0;
      var e=parseFloat(r.elevation!=null?r.elevation:r.elev)||0;
      var s=(r.movingSecs!=null)?(+r.movingSecs):((r.time&&typeof parseDurToMin==='function')?parseDurToMin(r.time)*60:0);
      mi+=d; elev+=e; sec+=s; n++;
      if(d>longest) longest=d;
      var y=String(r.date||'').slice(0,4); if(y){ years[y]=1; byYear[y]=(byYear[y]||0)+d; }
    });
    // How many runs clear the classic race distances - the basis for a PR-style milestone.
    var atLeast=function(x){ var c=0; runs.forEach(function(r){ if((parseFloat(r.distance)||0)>=x) c++; }); return c; };
    // Marathon / half / 10k / 5k bests, by TIME, among runs at or beyond that distance.
    var bestAt=function(x){
      var best=null;
      runs.forEach(function(r){
        var d=parseFloat(r.distance)||0; if(d<x || d>x*1.12) return;
        var s=(r.movingSecs!=null)?(+r.movingSecs):((r.time&&typeof parseDurToMin==='function')?parseDurToMin(r.time)*60:0);
        if(s>0 && (best==null || s<best.sec)) best={sec:s, date:String(r.date).slice(0,10), mi:d};
      });
      return best;
    };
    return {
      runCount:n, lifetimeMiles:Math.round(mi), lifetimeElevFt:Math.round(elev),
      lifetimeHours:Math.round(sec/3600), longestRunMi:Math.round(longest*10)/10,
      calendarYears:Object.keys(years).sort(),
      milesByYear:Object.keys(byYear).sort().map(function(y){ return y+': '+Math.round(byYear[y]); }),
      countsAtDistance:{ '3.1(5k)':atLeast(3.1), '6.2(10k)':atLeast(6.2), '13.1(half)':atLeast(13.1), '26.2(mar)':atLeast(26.2) },
      bests:{ '5k':bestAt(3.1), '10k':bestAt(6.2), 'half':bestAt(13.1), 'marathon':bestAt(26.2) },
      hasDprLayer: runs.filter(function(r){ return r && r.dpr; }).length
    };
  })()`),null,1));
}catch(e){console.error('FAILED: '+(e&&e.message||e))}
finally{try{ws&&ws.close()}catch(e){};try{chrome.kill()}catch(e){}}
