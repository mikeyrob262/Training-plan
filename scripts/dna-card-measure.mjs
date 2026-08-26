// What is inside the DNA card on the Overview, block by block. It is 764px of a 958px region - the
// single reason that page does not fit - so any change to it starts here rather than with a guess.
import { spawn } from 'child_process';
import net from 'net';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9487;
const wait = ms => new Promise(r => setTimeout(r, ms));
const URL = process.env.FIT_URL || 'https://training-plan.mgrobinson07.workers.dev/';

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
  await send('Page.navigate', { url: URL + '?d=' + Date.now() });
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

  // No literal-whitespace regex anywhere in here: a source backslash-s does not survive the trip
  // through this harness, and the squeeze is done with split/join instead.
  const probe = [
    "(function(){",
    " var bal=document.querySelector('.ov-bal'); if(!bal) return ['no overview'];",
    " var dna=null;",
    " [].slice.call(bal.children).forEach(function(col){",
    "  [].slice.call(col.children).forEach(function(c){",
    "   if(!dna && (c.textContent||'').indexOf('Athlete DNA')>=0) dna=c; }); });",
    " if(!dna) return ['no DNA card'];",
    " var WS=[String.fromCharCode(32),String.fromCharCode(9),String.fromCharCode(10),String.fromCharCode(13)];",
    " var txt=function(el){ var s=String(el.textContent||'');",
    "   WS.forEach(function(w){ s=s.split(w).join(' '); });",
    "   while(s.indexOf('  ')>=0) s=s.split('  ').join(' ');",
    "   return s.trim(); };",
    " var out=[];",
    " var walk=function(el,d){",
    "  var r=el.getBoundingClientRect();",
    "  if(r.height<6 && d>0) return;",
    "  out.push(Array(d+1).join('  ')+Math.round(r.height)+'px  '+el.tagName.toLowerCase()+'  '+txt(el).slice(0,50));",
    "  if(d<3) [].slice.call(el.children).forEach(function(c){ walk(c,d+1); });",
    " };",
    " walk(dna,0);",
    " return out;",
    "})()"
  ].join('');
  const rows = await ev(probe);
  console.log(Array.isArray(rows) ? rows.join(String.fromCharCode(10)) : JSON.stringify(rows));
} catch (e) {
  console.error('FAILED: ' + (e && e.message || e));
} finally {
  try { ws && ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
}
