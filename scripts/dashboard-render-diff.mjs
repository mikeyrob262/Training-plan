// DOES THE DASHBOARD CARD RENDER THE SAME HTML IT DID BEFORE THIS SESSION?
//
// Source being byte-identical is strong evidence but not the claim the athlete asked about, which
// was about APPEARANCE. So this runs BOTH versions - the baseline one pulled out of git, and the
// one on the live page - against the SAME real data in the same browser, and diffs the HTML they
// produce. Identical strings mean identical pixels.
//
// NEGATIVE CONTROL: the diff must be able to detect a difference, so a deliberately altered copy of
// the baseline is compared too and MUST come back different.
import { spawn, execFileSync } from 'child_process';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = '9a64e43';
const URL_ = process.argv[2] || 'https://training-plan.mgrobinson07.workers.dev/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9355;

const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l); };
const info = (l) => console.log('  ' + Y + '·' + X + '     ' + l);

const base = execFileSync('git', ['show', BASELINE + ':worker.js'], { cwd: ROOT, maxBuffer: 64*1024*1024 }).toString('utf8');
function body(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return null;
  let d = 0;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (!d) return src.slice(i, j + 1); }
  }
  return null;
}
// The baseline card plus the baseline chart, renamed so they can live beside the live ones.
const BASE_SRC = (body(base, '_ptCardHTML_') + '\n' + body(base, '_ptChart_') + '\n')
  .replace(/function _ptCardHTML_\(/, 'function __baseCard_(')
  .replace(/function _ptChart_\(/, 'function __baseChart_(')
  .replace(/_ptChart_\(/g, '__baseChart_(');

const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function portUp(p, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const okp = await new Promise(res => { const s = net.connect(p, '127.0.0.1');
      s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); });
    if (okp) return true; await wait(250);
  }
  return false;
}
const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--remote-debugging-port='+PORT,'--remote-allow-origins=*','--window-size=1600,1000','about:blank'], {stdio:'ignore'});
let ws;
try {
  if (!await portUp(PORT)) throw new Error('chrome did not open the debug port');
  const t = await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
  ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (m, p) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id:i, method:m, params:p||{}})); });
  const ev = async (x) => { const r = await send('Runtime.evaluate', {expression:x, returnByValue:true, awaitPromise:true});
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,700));
    return r.result && r.result.result && r.result.result.value; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: URL_ + '?d=' + Date.now() });
  await wait(12000);
  for (let i = 0; i < 20; i++) { if (await ev(`!!(typeof _storeV2Rides!=='undefined'&&_storeV2Rides&&_storeV2Rides.length)`)) break; await wait(2500); }

  console.log('\n' + Y + '=== the Dashboard card, baseline vs live, on the same real data ===' + X);
  const inj = await ev(`(function(){ try{ (0,eval)(${JSON.stringify(BASE_SRC)}); return typeof __baseCard_; }catch(e){ return 'ERR '+(e&&e.message); } })()`);
  ok('the ' + BASELINE + ' card was injected alongside the live one', inj === 'function');
  if (inj !== 'function') { console.log('  ' + R + inj + X); throw new Error(String(inj)); }

  // Both cards need the page's own lbl/link helpers, which live inside dsShowDashboard. Rebuild the
  // exact same two so both sides are given identical inputs - any difference is then the card's.
  const out = await ev(`(function(){
    function lbl(t,right){ return '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><span style="font-size:10px;font-weight:700;color:var(--d-dim);text-transform:uppercase;letter-spacing:.09em">'+t+'</span>'+(right||'')+'</div>'; }
    function link(t,act){ return '<span data-act="'+act+'" style="font-size:10px;font-weight:600;color:var(--c-green);cursor:pointer">'+t+'</span>'; }
    var res={ ranges:{} };
    ['7D','30D','90D','1Y','ALL'].forEach(function(k){
      _ptRange=k;
      var a='', b='', ea=null, eb=null;
      try{ a=__baseCard_(lbl,link); }catch(e){ ea=String(e&&e.message); }
      try{ b=_ptCardHTML_(lbl,link); }catch(e){ eb=String(e&&e.message); }
      res.ranges[k]={ same:(a===b), lenA:a.length, lenB:b.length, ea:ea, eb:eb,
        firstDiff:(function(){ if(a===b) return null;
          for(var i=0;i<Math.max(a.length,b.length);i++){ if(a[i]!==b[i]) return { at:i,
            base:a.slice(Math.max(0,i-60), i+60), live:b.slice(Math.max(0,i-60), i+60) }; } return null; })() };
    });
    _ptRange='90D';
    // NEGATIVE CONTROL: a deliberately altered baseline MUST come back different, or the whole
    // comparison is vacuous.
    var mutated=String(__baseCard_).replace('width:186px','width:187px');
    var fn=new Function('return '+mutated)();
    var m='', o='';
    try{ o=__baseCard_(lbl,link); m=fn(lbl,link); }catch(e){}
    res.negControl={ detectsAOneCharChange:(m!==o), bothRendered:(!!m && !!o) };
    return res;
  })()`);

  let allSame = true;
  ['7D','30D','90D','1Y','ALL'].forEach(k => {
    const r = out.ranges[k];
    if (r.ea || r.eb) { ok(k + ': both versions rendered', false); console.log('    ' + R + (r.ea||'') + ' / ' + (r.eb||'') + X); allSame = false; return; }
    ok(k + ': the live card is character-for-character the ' + BASELINE + ' card', r.same);
    if (!r.same) {
      allSame = false;
      console.log('    ' + R + 'first difference at char ' + r.firstDiff.at + X);
      console.log('      baseline: ' + JSON.stringify(r.firstDiff.base));
      console.log('      live    : ' + JSON.stringify(r.firstDiff.live));
    } else info(k + ': ' + r.lenA + ' characters, identical');
  });
  ok('NEG: the comparison detects a one-character change', out.negControl.detectsAOneCharChange);
  ok('NEG: ...and both sides of that control actually rendered', out.negControl.bothRendered);

  console.log('');
  console.log(fails ? (R + fails + ' FAILED' + X)
    : (G + 'the Dashboard card renders identically to ' + BASELINE + ' across all five ranges' + X));
} catch (e) {
  console.error(R + 'FAILED: ' + (e && e.message || e) + X);
  fails++;
} finally {
  try { ws && ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
}
process.exit(fails ? 1 : 0);
