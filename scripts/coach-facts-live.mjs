// What does the briefing now get TOLD about the race and today's venue?
import { spawn } from 'child_process';
import net from 'net';
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT=9405; const wait=ms=>new Promise(r=>setTimeout(r,ms));
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
    if(r.result&&r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,900));
    return r.result&&r.result.result&&r.result.result.value};
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1512,height:982,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'https://training-plan.mgrobinson07.workers.dev/?cf='+Date.now()});
  await wait(3000);
  await ev(`(function(){try{localStorage.setItem('aiq_layout','desktop')}catch(e){}return 1})()`);
  await send('Page.reload',{ignoreCache:true}); await wait(11000);
  for(let i=0;i<20;i++){ if(await ev(`!!(typeof _storeV2Rides!=='undefined'&&_storeV2Rides&&_storeV2Rides.length)`)) break; await wait(2500); }
  console.log(JSON.stringify(await ev(`(function(){
    var nr=null; try{ nr=getNextRace_(); }catch(e){}
    var out={
      rawCalendarName: nr?nr.name:null,
      rawDaysOut: nr?nr.daysOut:null,
      BRIEFING_GETS: _coachRaceFacts_(),
      today: getTodayKey(),
      venue: _coachVenueToday_(getTodayKey()),
      weatherRule: _coachWeatherRule_(_coachVenueToday_(getTodayKey()))
    };
    // Spot-check a day that prescribes VO2, so the indoor path is exercised even if today is a rest.
    var probe=null;
    for(var d=0; d<14 && !probe; d++){
      var dt=new Date(); dt.setDate(dt.getDate()+d);
      var dk=_tbDK_(dt);
      var v=_coachVenueToday_(dk);
      if(v.known && /vo2/.test(v.line)) probe={ date:dk, venue:v, rule:_coachWeatherRule_(v) };
    }
    out.nextVo2Day=probe;
    return out;
  })()`),null,1));
}catch(e){console.error('FAILED: '+(e&&e.message||e))}
finally{try{ws&&ws.close()}catch(e){};try{chrome.kill()}catch(e){}}
