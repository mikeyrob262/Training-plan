// WHAT THE HISTORY ACTUALLY SAYS about max HR, before deciding how to derive it. A single strap
// spike would poison a derived ceiling permanently and silently, which is the same class of bug as
// the stale field - so this looks at the DISTRIBUTION, not just the maximum.
import { spawn } from 'child_process';
import net from 'net';
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT=9441; const wait=ms=>new Promise(r=>setTimeout(r,ms));
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
  await send('Page.navigate',{url:'https://training-plan.mgrobinson07.workers.dev/?m='+Date.now()});
  await wait(2500);
  await send('Page.reload',{ignoreCache:true});
  for(let i=0;i<70;i++){ if(await ev(`typeof _storeV2Rides!=='undefined'&&_storeV2Rides&&_storeV2Rides.length>0`)) break; await wait(1000); }
  await wait(4000);
  console.log(JSON.stringify(await ev(`(function(){
    var all=[];
    var add=function(r,src){ if(!r||r.deleted) return; var v=parseInt(r.maxHR,10);
      if(v>0) all.push({v:v, d:String(r.date||'').slice(0,10), sp:(typeof rideSport_==='function'?rideSport_(r):(r.sportType||r.type||'')), src:src}); };
    try{ (st.rides||[]).forEach(function(r){ add(r,'st.rides'); }); }catch(e){}
    try{ (typeof getRuns==='function'?getRuns():[]).forEach(function(r){ add(r,'getRuns'); }); }catch(e){}
    all.sort(function(a,b){ return b.v-a.v; });
    var vals=all.map(function(x){return x.v;});
    var q=function(p){ return vals.length?vals[Math.min(vals.length-1,Math.floor(vals.length*p))]:null; };
    var byYear={};
    all.forEach(function(x){ var y=x.d.slice(0,4); if(!byYear[y]||x.v>byYear[y]) byYear[y]=x.v; });
    // How many DISTINCT activities reach each of the top values - a lone spike has a count of 1.
    var counts={};
    vals.forEach(function(v){ counts[v]=(counts[v]||0)+1; });
    var top=all.slice(0,20).map(function(x){ return x.v+' on '+x.d+' ('+x.sp+', '+x.src+')'; });
    var atOrAbove=function(th){ return vals.filter(function(v){return v>=th;}).length; };
    return {
      settingStMaxHR: (st&&st.maxHR)||null,
      maxHR_: (typeof maxHR_==='function')?maxHR_():null,
      runHrMax_: (typeof runHrMax_==='function')?runHrMax_():null,
      activitiesWithMaxHR: vals.length,
      highest: vals[0]||null, second: vals[1]||null, third: vals[2]||null, fifth: vals[4]||null,
      p99:q(0.01), p95:q(0.05), p90:q(0.10), median:q(0.5),
      top20: top,
      countsAtTop: [vals[0],vals[1],vals[2]].map(function(v){ return v+' x'+(counts[v]||0); }),
      nAtOrAbove: { '190':atOrAbove(190), '185':atOrAbove(185), '180':atOrAbove(180), '175':atOrAbove(175), '172':atOrAbove(172) },
      highestPerYear: byYear,
      // The last 24 months on their own - the window a derived ceiling would actually read.
      window24: (function(){
        var cut=new Date(); cut.setMonth(cut.getMonth()-24);
        var ck=cut.getFullYear()+'-'+('0'+(cut.getMonth()+1)).slice(-2)+'-'+('0'+cut.getDate()).slice(-2);
        var w=all.filter(function(x){ return x.d>=ck; });
        return { since:ck, n:w.length, top12:w.slice(0,12).map(function(x){ return x.v+' '+x.d+' '+x.sp; }) };
      })(),
      window36: (function(){
        var cut=new Date(); cut.setMonth(cut.getMonth()-36);
        var ck=cut.getFullYear()+'-'+('0'+(cut.getMonth()+1)).slice(-2)+'-'+('0'+cut.getDate()).slice(-2);
        var w=all.filter(function(x){ return x.d>=ck; });
        return { since:ck, n:w.length, top12:w.slice(0,12).map(function(x){ return x.v+' '+x.d+' '+x.sp; }) };
      })(),
      ageFields: { birthYear:(st&&st.birthYear)||null, age:(st&&st.age)||null, dob:(st&&st.dob)||null },
      lthrSetting: (st&&st.lthr)||null
    };
  })()`),null,1));
}catch(e){console.error('FAILED: '+(e&&e.message||e))}
finally{try{ws&&ws.close()}catch(e){};try{chrome.kill()}catch(e){}}
