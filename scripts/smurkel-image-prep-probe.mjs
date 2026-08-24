// Run _smImgPrep_ in a REAL browser against real image bytes. The unit test pins the wire shape;
// this pins the thing it cannot reach — FileReader -> Image -> canvas, the PNG-stays-PNG choice,
// the 1568px downscale, and that a decode failure is reported rather than thrown.
import { spawn } from 'child_process';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const BS = String.fromCharCode(92);
const asServed = (s) => s.replace(new RegExp(BS + BS + '([' + BS + 's' + BS + 'S])', 'g'), (_, c) => (c === BS ? BS : c));
function matchBrace(from) { let i = src.indexOf('{', from), d = 0;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') d++; else if (c === '}') { d--; if (!d) return i; } } return -1; }
const exFn = (n) => { const i = src.indexOf('function ' + n + '('); return src.slice(i, matchBrace(i) + 1) + '\n'; };
const exVar = (n) => src.match(new RegExp('var ' + n + BS + 's*=[^;]*;'))[0] + '\n';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9335;
const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function portUp(p) { for (let i = 0; i < 60; i++) {
  const ok = await new Promise(res => { const s = net.connect(p, '127.0.0.1');
    s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); });
  if (ok) return true; await wait(250); } return false; }

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=' + PORT, '--remote-allow-origins=*', 'about:blank'], { stdio: 'ignore' });

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };

let ws;
try {
  if (!await portUp(PORT)) throw new Error('no debug port');
  const t = (await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()).find(x => x.type === 'page');
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
    return r.result.result.value;
  };
  await send('Runtime.enable');

  const inject = asServed(exVar('_SM_IMG_MAX_EDGE') + exVar('_SM_IMG_MAX_B64') + exVar('_SM_IMG_OK') + exFn('_smImgPrep_'));
  await evalJS('(function(){' + JSON.stringify(inject) + ';eval(' + JSON.stringify(inject) + ');window._prep=_smImgPrep_;window._MAXE=_SM_IMG_MAX_EDGE;})()');

  const run = (mkFile) => evalJS(`new Promise(function(res){
    ${mkFile}
    window._prep(f, function(err, im){ res(err ? {err:err} : {mt:im.media_type, w:im.w, h:im.h, len:im.data.length, head:im.data.slice(0,8)}); });
  })`);

  console.log('\n' + Y + '=== a PNG screenshot, already small ===' + X);
  {
    const r = await run(`
      var c=document.createElement('canvas'); c.width=900; c.height=500;
      var x=c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,900,500);
      x.fillStyle='#000'; x.font='28px sans-serif'; x.fillText('F3 Lake Half Marathon',40,120);
      var b=atob(c.toDataURL('image/png').split(',')[1]); var u=new Uint8Array(b.length);
      for(var i=0;i<b.length;i++) u[i]=b.charCodeAt(i);
      var f=new File([u],'reg.png',{type:'image/png'});`);
    console.log('     -> ' + JSON.stringify(r));
    ok('stays PNG — text does not get JPEG artifacts', r.mt === 'image/png');
    ok('not upscaled or resized', r.w === 900 && r.h === 500);
    ok('base64 carries no data: prefix', r.head.indexOf('data:') < 0);
  }

  console.log('\n' + Y + '=== an oversized photo is downscaled to the model’s own limit ===' + X);
  {
    const r = await run(`
      var c=document.createElement('canvas'); c.width=4000; c.height=3000;
      var x=c.getContext('2d');
      var g=x.createLinearGradient(0,0,4000,3000); g.addColorStop(0,'#c33'); g.addColorStop(1,'#36c');
      x.fillStyle=g; x.fillRect(0,0,4000,3000);
      for(var i=0;i<4000;i+=7){ x.fillStyle='rgb('+(i%255)+','+((i*3)%255)+','+((i*7)%255)+')'; x.fillRect(i,(i*11)%3000,6,6); }
      var b=atob(c.toDataURL('image/jpeg',0.95).split(',')[1]); var u=new Uint8Array(b.length);
      for(var i=0;i<b.length;i++) u[i]=b.charCodeAt(i);
      var f=new File([u],'photo.jpg',{type:'image/jpeg'});`);
    console.log('     -> ' + JSON.stringify(r));
    ok('long edge capped at 1568', r.w === 1568);
    ok('aspect ratio preserved', Math.abs(r.h - Math.round(1568 * 3000 / 4000)) <= 1);
    ok('re-encoded as JPEG', r.mt === 'image/jpeg');
    ok('comfortably under the 3MB base64 cap', r.len < 3145728);
  }

  console.log('\n' + Y + '=== a file the browser cannot decode ===' + X);
  {
    const r = await run(`
      var u=new Uint8Array([0,0,0,32,102,116,121,112,104,101,105,99,0,0,0,0]);
      var f=new File([u],'IMG_4021.HEIC',{type:'image/heic'});`);
    console.log('     -> ' + JSON.stringify(r));
    ok('it is attempted, then reported — not thrown', !!r.err);
    ok('the message names Safari so it is actionable', /Safari/.test(r.err || ''));
    ok('NEG: it did not silently succeed', !r.mt);
  }
} catch (e) {
  fails++; console.error('FAILED: ' + (e && e.message || e));
} finally {
  try { ws && ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
}
console.log(fails ? '\n' + R + fails + ' FAILED' + X + '\n' : '\n' + G + 'image prep: all checks passed' + X + '\n');
process.exit(fails ? 1 : 0);
