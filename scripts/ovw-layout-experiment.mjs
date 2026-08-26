// Two layout options for the Overview card region, MEASURED rather than argued.
//
//   A  Goals + Performance lifted into their own two-column row, the rest balanced below
//   B  the card region balanced into THREE columns instead of two
//
// The region costs its TALLEST COLUMN, so an option that adds a row can easily cost more than it
// saves. Both are applied to the live DOM and re-measured against the shipped two-column baseline.
import { spawn } from 'child_process';
import net from 'net';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9483;
const wait = ms => new Promise(r => setTimeout(r, ms));
const URL = process.env.FIT_URL || 'http://127.0.0.1:8801/';

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
  await send('Page.navigate', { url: URL + '?x=' + Date.now() });
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

  const measure = "(function(){var b=document.querySelector('.ov-bal');if(!b)return null;" +
    "return {regionH:Math.round(b.getBoundingClientRect().height)," +
    "columns:[].slice.call(b.children).map(function(c){return Math.round(c.getBoundingClientRect().height);})};})()";

  // The page must be SETTLED before any of this means anything: an earlier run measured the DNA card
  // at 231px when it is 764 once its radar has drawn, which changes every conclusion below.
  let cardsNow = [];
  for (let i = 0; i < 20; i++) {
    cardsNow = await ev("(function(){var b=document.querySelector('.ov-bal');if(!b)return [];var o=[];" +
      "[].slice.call(b.children).forEach(function(col){[].slice.call(col.children).forEach(function(c){" +
      "o.push(Math.round(c.getBoundingClientRect().height)+'/'+(c.textContent||'').replace(/\s+/g,' ').trim().slice(0,14));});});return o;})()") || [];
    if (cardsNow.length >= 6 && !cardsNow.some(c => /^0\//.test(c))) break;
    await wait(1000);
  }
  console.log('CARDS AS RENDERED (' + cardsNow.length + '):');
  console.log('  ' + JSON.stringify(cardsNow));
  if (cardsNow.length < 6) { console.log('  NOT SETTLED - refusing to compare layouts on a half-rendered page'); process.exit(1); }
  console.log('');
  console.log('BASELINE (2 columns, as shipped):');
  console.log('  ' + JSON.stringify(await ev(measure)));

  await ev("(function(){var b=document.querySelector('.ov-bal');window.__C=[];" +
    "[].slice.call(b.children).forEach(function(col){[].slice.call(col.children).forEach(function(c){window.__C.push(c);});});" +
    "window.__B=b;window.__P=b.parentElement;return window.__C.length;})()");

  const repack = n => "(function(){var b=window.__B,cards=window.__C;" +
    "var x=document.getElementById('__XR');if(x)x.remove();" +
    "while(b.firstChild)b.removeChild(b.firstChild);" +
    "b.setAttribute('style','display:flex;gap:10px;align-items:flex-start');" +
    "var cols=[],hs=[];for(var i=0;i<" + n + ";i++){var d=document.createElement('div');" +
    "d.setAttribute('style','flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:10px');" +
    "b.appendChild(d);cols.push(d);hs.push(0);}" +
    "cards.forEach(function(c){cols[0].appendChild(c);});" +
    "var m=cards.map(function(c){return c.getBoundingClientRect().height;});" +
    "var order=cards.map(function(c,i){return i;}).sort(function(a,z){return m[z]-m[a];});" +
    "order.forEach(function(ix){var lo=0;for(var k=1;k<" + n + ";k++)if(hs[k]<hs[lo])lo=k;" +
    "cols[lo].appendChild(cards[ix]);hs[lo]+=m[ix]+10;});return 1;})()";

  await ev(repack(3)); await wait(600);
  console.log('');
  console.log('OPTION B (3 columns):');
  console.log('  ' + JSON.stringify(await ev(measure)));
  console.log('  cards per column: ' + JSON.stringify(await ev(
    "(function(){return [].slice.call(window.__B.children).map(function(col){" +
    "return [].slice.call(col.children).map(function(c){return (c.textContent||'').replace(/\\s+/g,' ').trim().slice(0,14);}).join(' + ');});})()")));

  await ev(repack(2));
  await ev("(function(){var b=window.__B,cards=window.__C,goals=null,perf=null,rest=[];" +
    "cards.forEach(function(c){var t=(c.textContent||'');" +
    "if(!goals&&t.indexOf('Your goals')>=0)goals=c;" +
    "else if(!perf&&t.indexOf('Performance')>=0&&t.indexOf('Running')<0)perf=c;else rest.push(c);});" +
    "var row=document.createElement('div');row.id='__XR';" +
    "row.setAttribute('style','display:flex;gap:10px;align-items:flex-start;margin-bottom:10px');" +
    "[goals,perf].forEach(function(c){if(c){var w=document.createElement('div');" +
    "w.setAttribute('style','flex:1 1 0;min-width:0');w.appendChild(c);row.appendChild(w);}});" +
    "window.__P.insertBefore(row,b);" +
    "while(b.firstChild)b.removeChild(b.firstChild);" +
    "b.setAttribute('style','display:flex;gap:10px;align-items:flex-start');" +
    "var cols=[],hs=[];for(var i=0;i<2;i++){var d=document.createElement('div');" +
    "d.setAttribute('style','flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:10px');" +
    "b.appendChild(d);cols.push(d);hs.push(0);}" +
    "rest.forEach(function(c){cols[0].appendChild(c);});" +
    "var m=rest.map(function(c){return c.getBoundingClientRect().height;});" +
    "var order=rest.map(function(c,i){return i;}).sort(function(a,z){return m[z]-m[a];});" +
    "order.forEach(function(ix){var lo=0;for(var k=1;k<2;k++)if(hs[k]<hs[lo])lo=k;" +
    "cols[lo].appendChild(rest[ix]);hs[lo]+=m[ix]+10;});return 1;})()");
  await wait(600);
  console.log('');
  console.log('OPTION A (Goals+Performance as their own row, rest in 2 columns):');
  console.log('  ' + JSON.stringify(await ev(
    "(function(){var r=document.getElementById('__XR'),b=window.__B;" +
    "var rh=Math.round(r.getBoundingClientRect().height),bh=Math.round(b.getBoundingClientRect().height);" +
    "return {extraRowH:rh,regionH:bh,totalH:rh+10+bh," +
    "columns:[].slice.call(b.children).map(function(c){return Math.round(c.getBoundingClientRect().height);})};})()")));
} catch (e) {
  console.error('FAILED: ' + (e && e.message || e));
} finally {
  try { ws && ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
}
