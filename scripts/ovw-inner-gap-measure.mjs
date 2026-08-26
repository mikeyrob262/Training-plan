// Gaps BETWEEN elements inside a card, and unused space beside a short column in a flex row.
//
// Trailing slack at the foot of every Overview card measures 1px, so the reported "empty gap in the
// lower section" and "space below the tag buttons" are not space at the bottom. They are either a
// gap between two children, or unused height beside a short column in a side-by-side row. This
// finds both.
import { spawn } from 'child_process';
import net from 'net';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9493;
const wait = ms => new Promise(r => setTimeout(r, ms));
const URL = process.env.FIT_URL || 'https://training-plan.mgrobinson07.workers.dev/';
const WANT = (process.env.CARD || 'Athlete DNA');

async function up(p, t = 60) {
  for (let i = 0; i < t; i++) {
    const o = await new Promise(res => {
      const s = net.connect(p, '127.0.0.1');
      s.on('connect', () => { s.destroy(); res(true); });
      s.on('error', () => res(false));
    });
    if (o) return true;
    await wait(250);
  }
  return false;
}

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=' + PORT, '--remote-allow-origins=*', 'about:blank'], { stdio: 'ignore' });
let ws;
try {
  if (!await up(PORT)) throw new Error('no port');
  const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
  ws = new WebSocket(list.find(x => x.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (m, p) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  const ev = async x => {
    const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __err: JSON.stringify(r.result.exceptionDetails).slice(0, 400) };
    return r.result && r.result.result && r.result.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1512, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL + '?g=' + Date.now() });
  await wait(2500);
  await ev("(function(){try{localStorage.setItem('aiq_layout','desktop')}catch(e){}return 1})()");
  await send('Page.reload', { ignoreCache: true });
  for (let i = 0; i < 70; i++) {
    if (await ev("typeof _storeV2Rides!=='undefined'&&_storeV2Rides&&_storeV2Rides.length>0")) break;
    await wait(1000);
  }
  await wait(6000);
  for (let i = 0; i < 14; i++) {
    await ev("(function(){try{ if(typeof dsShowAthleteIntel==='function') dsShowAthleteIntel(); }catch(e){} return 1})()");
    await wait(800);
    if (await ev("!!document.querySelector('.ov-bal')")) break;
  }

  const probe = [
    "(function(){",
    " var bal=document.querySelector('.ov-bal'); if(!bal) return ['no overview'];",
    " var WS=[String.fromCharCode(32),String.fromCharCode(9),String.fromCharCode(10),String.fromCharCode(13)];",
    " var txt=function(el){ var s=String(el.textContent||'');",
    "  WS.forEach(function(w){ s=s.split(w).join(' '); });",
    "  while(s.indexOf('  ')>=0) s=s.split('  ').join(' ');",
    "  return s.trim(); };",
    " var card=null;",
    " [].slice.call(bal.children).forEach(function(col){",
    "  [].slice.call(col.children).forEach(function(c){",
    "   if(!card && txt(c).indexOf(" + JSON.stringify(WANT) + ")>=0) card=c; }); });",
    " if(!card) return ['card not found: ' + " + JSON.stringify(WANT) + "];",
    " var out=[];",
    " var walk=function(el,d,label){",
    "  var kids=[].slice.call(el.children).filter(function(c){ return c.getBoundingClientRect().height>2; });",
    "  if(!kids.length) return;",
    "  var pad=getComputedStyle(el), r=el.getBoundingClientRect();",
    "  var isRow=(pad.display.indexOf('flex')>=0 && pad.flexDirection.indexOf('row')>=0);",
    "  if(isRow){",
    "   var tallest=0; kids.forEach(function(c){ var h=c.getBoundingClientRect().height; if(h>tallest) tallest=h; });",
    "   kids.forEach(function(c){",
    "    var h=c.getBoundingClientRect().height;",
    "    if(tallest-h>18) out.push(Array(d+1).join('  ')+'ROW GAP '+Math.round(tallest-h)+'px unused beside a '+Math.round(h)+'px column :: '+txt(c).slice(0,40));",
    "   });",
    "  } else {",
    "   for(var i=1;i<kids.length;i++){",
    "    var g=kids[i].getBoundingClientRect().top-kids[i-1].getBoundingClientRect().bottom;",
    "    if(g>14) out.push(Array(d+1).join('  ')+'GAP '+Math.round(g)+'px between :: '+txt(kids[i-1]).slice(0,26)+'  ||  '+txt(kids[i]).slice(0,26));",
    "   }",
    "  }",
    "  if(d<3) kids.forEach(function(c){ walk(c,d+1); });",
    " };",
    " out.push('CARD ' + Math.round(card.getBoundingClientRect().width) + 'w x ' + Math.round(card.getBoundingClientRect().height) + 'h');",
    " walk(card,0);",
    " if(out.length===1) out.push('  no gap over 14px and no row column short by more than 18px');",
    " return out;",
    "})()"
  ].join(String.fromCharCode(10));
  const rows = await ev(probe);
  console.log(Array.isArray(rows) ? rows.join(String.fromCharCode(10)) : JSON.stringify(rows));
} catch (e) {
  console.error('FAILED: ' + (e && e.message || e));
} finally {
  try { ws && ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
}
