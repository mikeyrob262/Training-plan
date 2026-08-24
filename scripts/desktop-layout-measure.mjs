// Measure the DEPLOYED page in a real browser. No puppeteer: Node's built-in WebSocket speaks CDP
// directly, so this needs nothing installed.
//
// Reasoning about flex rules is how the stat-tile clip cost two needless CSS ships. Measure the box.
import { spawn } from 'child_process';
import net from 'net';

const URL_ = process.argv[2] || 'https://training-plan.mgrobinson07.workers.dev/';
const WIDTH = +(process.argv[3] || 1600);
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;

const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function portUp(p, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const ok = await new Promise(res => {
      const s = net.connect(p, '127.0.0.1');
      s.on('connect', () => { s.destroy(); res(true); });
      s.on('error', () => res(false));
    });
    if (ok) return true;
    await wait(250);
  }
  return false;
}

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + PORT, '--remote-allow-origins=*',
  '--window-size=' + WIDTH + ',1000', 'about:blank'
], { stdio: 'ignore' });

let ws;
try {
  if (!await portUp(PORT)) throw new Error('chrome did not open the debug port');
  const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
  const page = targets.find(t => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params) => new Promise(res => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    return r.result && r.result.result && r.result.result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL_ });
  await wait(9000);   // the app boots, merges state, and paints

  const out = await evalJS(`(function(){
    try{
      // Force the desktop shell regardless of any stored layout override (isDesktop() reads
      // localStorage 'aiq_layout' BEFORE the width check and can strand a mobile render).
      try{ localStorage.setItem('aiq_layout','desktop'); }catch(e){}

      // Seed ONE synthetic ride with a full lap set, so the Laps panel has something to draw.
      // Deliberately wide values - a 4-digit power and an hours-long lap are the realistic worst
      // case for a 5-column table in a 286px rail.
      window.st = window.st || {};
      st.rides = st.rides || [];
      var laps=[]; for(var i=0;i<8;i++) laps.push({distance:12.4, time:5025, avgPower:1234, avgHR:148});
      // A REAL TRACK. Without GPS the ride-detail map never mounts and #rd-map is replaced by a
      // 200px "GPS data unavailable" placeholder — measuring that instead of the map is how the
      // first pass of this probe reported a box that does not exist in the case being asked about.
      var la=[], lo=[];
      for(var g=0; g<220; g++){ var th=g/220*Math.PI*2;
        la.push(42.8700 + 0.018*Math.sin(th)); lo.push(-85.5900 + 0.024*Math.cos(th)); }
      st.rides.unshift({ id:'probe', stravaId:999999, date:'2026-08-20', name:'Probe Ride',
        type:'Ride', sportType:'Ride', distance:42.5, movingTime:9000, elapsedTime:9300,
        avgPower:215, np:228, avgHR:142, maxHR:171, elev:1450, calories:900, laps:laps,
        lats:la, lons:lo, gpsLats:la, gpsLons:lo });

      if(typeof openDesktopRideDetail!=='function') return {err:'openDesktopRideDetail missing'};
      openDesktopRideDetail(0, true);
      return {ok:true};
    }catch(e){ return {err:String(e&&e.message||e)}; }
  })()`);
  console.log('seed ->', JSON.stringify(out));
  await wait(2500);

  const geom = await evalJS(`(function(){
    var r=function(sel){ var el=document.querySelector(sel); if(!el) return null;
      var b=el.getBoundingClientRect();
      return {sel:sel, x:Math.round(b.x), right:Math.round(b.right), w:Math.round(b.width),
              y:Math.round(b.y), bottom:Math.round(b.bottom), h:Math.round(b.height),
              sw:el.scrollWidth, cw:el.clientWidth, sh:el.scrollHeight, ch:el.clientHeight}; };
    var main=r('#ds-main-area'), rp=r('#ds-rpanel')||r('.ds-rpanel'), laps=r('table.ds-laps');
    var rdmap=r('#rd-map'), rdscroll=r('#rd-scroll'), stats=r('#rd-tab-overview > div:nth-of-type(2)');
    var _m=document.getElementById('rd-map');
    var _mi={found:!!_m};
    if(_m){ var cs=getComputedStyle(_m);
      _mi.inlineStyle=_m.getAttribute('style');
      _mi.computed={width:cs.width,height:cs.height,maxWidth:cs.maxWidth,aspectRatio:cs.aspectRatio,margin:cs.margin};
      _mi.parentId=_m.parentElement?(_m.parentElement.id||_m.parentElement.className):null;
      _mi.count=document.querySelectorAll('#rd-map').length;
      _mi.hasLeaflet=!!_m.querySelector('.leaflet-container');
    }
    var shell=r('#desktop-shell');
    var rps=[].slice.call(document.querySelectorAll('.ds-rpanel .ds-rp')).map(function(el,i){
      var b=el.getBoundingClientRect();
      var t=el.querySelector('div');
      return {i:i, label:(t?t.textContent:'').trim().slice(0,22),
              x:Math.round(b.x), right:Math.round(b.right), w:Math.round(b.width),
              y:Math.round(b.y), bottom:Math.round(b.bottom),
              sw:el.scrollWidth, cw:el.clientWidth, overflowsX:(el.scrollWidth>el.clientWidth+1)};
    });
    return {viewport:{w:innerWidth,h:innerHeight}, shell:shell, main:main, rpanel:rp, lapsTable:laps, rdmap:rdmap, rdmapInfo:_mi, rdscroll:rdscroll, statsRow:stats,
            panels:rps,
            rpanelStyle:(function(){ var el=document.querySelector('.ds-rpanel'); if(!el) return null;
              var c=getComputedStyle(el); return {position:c.position, width:c.width, flexShrink:c.flexShrink, overflowX:c.overflowX}; })(),
            mainStyle:(function(){ var el=document.querySelector('#ds-main-area'); if(!el) return null;
              var c=getComputedStyle(el); return {minWidth:c.minWidth, overflow:c.overflow, flex:c.flex}; })()};
  })()`);
  console.log('\n' + JSON.stringify(geom, null, 2));

  if (geom && geom.main && geom.rpanel) {
    const overlap = geom.main.right > geom.rpanel.x + 1;
    console.log('\n--- VERDICT ---');
    console.log('main right edge : ' + geom.main.right);
    console.log('rpanel left edge: ' + geom.rpanel.x);
    console.log('MAIN/RPANEL OVERLAP: ' + (overlap ? 'YES (' + (geom.main.right - geom.rpanel.x) + 'px)' : 'no'));
    const bleed = (geom.panels || []).filter(p => p.overflowsX);
    console.log('PANEL BLOCKS OVERFLOWING HORIZONTALLY: ' + (bleed.length ? JSON.stringify(bleed.map(b => b.label + ' (' + b.sw + ' > ' + b.cw + ')')) : 'none'));
    if (geom.lapsTable && geom.rpanel) {
      console.log('laps table right: ' + geom.lapsTable.right + '  vs rpanel right: ' + geom.rpanel.right +
        '  -> ' + (geom.lapsTable.right > geom.rpanel.right + 1 ? 'BLEEDS OUT' : 'contained'));
    }
  }
} catch (e) {
  console.error('FAILED: ' + (e && e.message || e));
} finally {
  try { ws && ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
}
