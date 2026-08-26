// What does the Aug 25 VO2 session actually carry - the tagged intervals AND the raw stream?
// The fix being asked for is "cross-check against the raw stream", so the first question is whether
// there IS a stream at a resolution that can show a brief dip.
import { spawn } from 'child_process';
import net from 'net';
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT=9455; const wait=ms=>new Promise(r=>setTimeout(r,ms));
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
  await send('Page.navigate',{url:'https://training-plan.mgrobinson07.workers.dev/?v='+Date.now()});
  await wait(2500); await send('Page.reload',{ignoreCache:true});
  for(let i=0;i<70;i++){ if(await ev(`typeof _storeV2Rides!=='undefined'&&_storeV2Rides&&_storeV2Rides.length>0`)) break; await wait(1000); }
  await wait(4000);
  const found=await ev(`(function(){
    var out=[];
    (st.rides||[]).forEach(function(r){
      if(!r||r.deleted) return;
      var d=String(r.date||'').slice(0,10);
      if(d>='2026-08-24' && d<='2026-08-26') out.push({ key:(typeof rideKey==='function'?rideKey(r):null),
        date:r.date, name:r.name, sport:(typeof rideSport_==='function'?rideSport_(r):null),
        stravaId:r.stravaId, icuId:r.icuId||null, hasIcuIv:!!r._icuIv,
        pwrPts:(r.chartPwr||[]).length, hrPts:(r.chartHR||[]).length,
        movingSecs:r.movingSecs, duration:r.duration, avgPwr:r.avgPwr, np:r.np });
    });
    return out;
  })()`);
  console.log('CANDIDATE ACTIVITIES:'); console.log(JSON.stringify(found,null,1));
  const wider=await ev(`(function(){
    var res={ storeV2Rides:0, stRides:0, anyOn25:[], withIcuIv:[], newestRides:[] };
    try{ res.storeV2Rides=(_storeV2Rides||[]).length; }catch(e){}
    try{ res.stRides=(st.rides||[]).length; }catch(e){}
    var scan=function(arr,src){ (arr||[]).forEach(function(r){
      if(!r||r.deleted) return;
      var d=String(r.date||'').slice(0,10);
      if(d==='2026-08-25') res.anyOn25.push(src+': '+d+' '+(r.name||'')+' '+((r.sportType||r.type)||''));
      if(r._icuIv) res.withIcuIv.push(src+': '+d+' '+(r.name||'')+' work='+((r._icuIv.work||[]).length));
    }); };
    try{ scan(st.rides,'st.rides'); }catch(e){}
    try{ scan(_storeV2Rides,'snapshot'); }catch(e){}
    try{ scan(typeof allRidesDeduped_==='function'?allRidesDeduped_():[], 'deduped'); }catch(e){}
    // The newest cycling activities on file, whatever the date.
    try{
      var rides=(st.rides||[]).filter(function(r){ return r&&!r.deleted && /ride/i.test(String((r.sportType||r.type)||'')); });
      rides.sort(function(a,b){ return String(b.date).localeCompare(String(a.date)); });
      res.newestRides=rides.slice(0,6).map(function(r){ return String(r.date).slice(0,10)+' '+(r.name||'')
        +' pts='+((r.chartPwr||[]).length)+' icu='+(r._icuIv?'yes':'no'); });
    }catch(e){}
    return res;
  })()`);
  console.log(''); console.log('WIDER SCAN:'); console.log(JSON.stringify(wider,null,1));
  const detail=await ev(`(function(){
    var target=null;
    (st.rides||[]).forEach(function(r){
      if(!r||r.deleted) return;
      var d=String(r.date||'').slice(0,10);
      if(d==='2026-08-25' && /ride/i.test(String((typeof rideSport_==='function')?rideSport_(r):''))) target=r;
    });
    if(!target) return {err:'no ride on 2026-08-25'};
    var pw=target.chartPwr||[], hr=target.chartHR||[];
    var secs=target.movingSecs||0;
    return {
      name:target.name, movingSecs:secs,
      streamPoints:pw.length,
      secondsPerPoint: (pw.length&&secs)?Math.round(secs/pw.length*10)/10 : null,
      icuIvCached: target._icuIv ? target._icuIv.work : null,
      icuGroups: target._icuIv ? target._icuIv.groups : null,
      hrPoints: hr.length,
      pwrSample: pw.slice(0,40),
      lapsShape: target.laps ? target.laps.slice(0,8) : null
    };
  })()`);
  console.log(''); console.log('DETAIL:'); console.log(JSON.stringify(detail,null,1));
}catch(e){console.error('FAILED: '+(e&&e.message||e))}
finally{try{ws&&ws.close()}catch(e){};try{chrome.kill()}catch(e){}}
