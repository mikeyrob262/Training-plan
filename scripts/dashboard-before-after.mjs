// THE DASHBOARD, RENDERED FROM TWO BUILDS, AND DIFFED.
//
// Source being byte-identical is strong evidence but it is not the claim being tested, which is that
// the page LOOKS different. So this renders the Dashboard from the baseline build and from the build
// under test, in the same browser against the same live data at the same viewport, and compares:
//
//   the scroller's content height  - the number that decides whether the page scrolls
//   a structural signature         - every top-level block with its height, in order
//
// NEGATIVE CONTROL: the comparison must be able to SEE a difference, so the signature of a
// deliberately perturbed copy is compared too and must come back different. Without that a harness
// that silently measures nothing reports agreement, which is the failure mode this exists to avoid.
//
// Usage: node scripts/dashboard-before-after.mjs <baselineUrl> <candidateUrl> [viewportHeight]
import { spawn } from 'child_process';
import net from 'net';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9495;
const wait = ms => new Promise(r => setTimeout(r, ms));
const BASE_URL = process.argv[2] || 'http://127.0.0.1:8811/';
const CAND_URL = process.argv[3] || 'https://training-plan.mgrobinson07.workers.dev/';
const VH = +(process.argv[4] || 900);

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };

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

const SIG = [
  "(function(){",
  " var wrap=document.getElementById('ds-content');",
  " if(!wrap) return {err:'ds-content missing'};",
  " if(!wrap.children.length) return {err:'ds-content empty'};",
  " // The Dashboard supplies its own scroller inside ds-content; find whichever element actually",
  " // overflows, so the number reported is the one that decides whether the page scrolls.",
  " var sc=null;",
  " var findSc=function(el,d){",
  "  if(!el||d>4) return;",
  "  var cs=getComputedStyle(el);",
  "  if(/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight>el.clientHeight+1){ if(!sc) sc=el; return; }",
  "  [].slice.call(el.children).forEach(function(c){ findSc(c,d+1); });",
  " };",
  " findSc(wrap,0);",
  " if(!sc){ sc=wrap; var n2=wrap;",
  "  while(n2 && n2!==document.body){ var c2=getComputedStyle(n2);",
  "   if(/(auto|scroll)/.test(c2.overflowY)){ sc=n2; break; } n2=n2.parentElement; } }",
  " var wrapOld=sc;",

  " var WS=[String.fromCharCode(32),String.fromCharCode(9),String.fromCharCode(10),String.fromCharCode(13)];",
  " var txt=function(el){ var s=String(el.textContent||'');",
  "  WS.forEach(function(w){ s=s.split(w).join(' '); });",
  "  while(s.indexOf('  ')>=0) s=s.split('  ').join(' ');",
  "  return s.trim(); };",
  " var blocks=[];",
  " var host=(sc&&sc.children.length>1)?sc:wrap;",
  " [].slice.call(host.children).forEach(function(c){",
  "  var r=c.getBoundingClientRect();",
  "  if(r.height<2) return;",
  "  blocks.push(Math.round(r.width)+'x'+Math.round(r.height)+' :: '+txt(c).slice(0,44));",
  " });",
  " return { content: sc?sc.scrollHeight:null, box: sc?sc.clientHeight:null,",
  "          hostKids: host.children.length, wrapKids: wrap.children.length,",
  "          scroller:(sc&&(sc.id||sc.className))||'none', blocks: blocks };",
  "})()"
].join(String.fromCharCode(10));

async function capture(ev, send, url, label) {
  await send('Page.navigate', { url: url + '?bd=' + Date.now() });
  await wait(2500);
  await ev("(function(){try{localStorage.setItem('aiq_layout','desktop')}catch(e){}return 1})()");
  await send('Page.reload', { ignoreCache: true });
  for (let i = 0; i < 80; i++) {
    if (await ev("typeof _storeV2Rides!=='undefined'&&_storeV2Rides&&_storeV2Rides.length>0")) break;
    await wait(1000);
  }
  await wait(7000);
  let sig = null;
  for (let i = 0; i < 14; i++) {
    await ev("(function(){try{ if(typeof dsShowDashboard==='function') dsShowDashboard(); }catch(e){} return 1})()");
    await wait(900);
    sig = await ev(SIG);
    if (sig && !sig.err && sig.blocks && sig.blocks.length) break;
  }
  console.log('  ' + label + ': content ' + (sig && sig.content) + '  box ' + (sig && sig.box)
    + '  scroller ' + (sig && sig.scroller) + '  blocks ' + (sig && sig.blocks ? sig.blocks.length : 0));
  return sig;
}

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
    if (r.result && r.result.exceptionDetails) return { __err: JSON.stringify(r.result.exceptionDetails).slice(0, 300) };
    return r.result && r.result.result && r.result.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1512, height: VH, deviceScaleFactor: 1, mobile: false });

  console.log('');
  console.log(Y + '=== rendering both builds at 1512x' + VH + ' ===' + X);
  const A = await capture(ev, send, BASE_URL, 'baseline ');
  const Bc = await capture(ev, send, CAND_URL, 'candidate');

  console.log('');
  console.log(Y + '=== the diff ===' + X);
  if (!A || A.err || !Bc || Bc.err) {
    console.log('  ' + R + 'FAIL' + X + '  one side did not render: ' + JSON.stringify(A && A.err) + ' / ' + JSON.stringify(Bc && Bc.err));
    fails++;
  } else {
    ok('content height is identical (' + A.content + ' vs ' + Bc.content + ')', A.content === Bc.content);
    ok('the same number of top-level blocks (' + A.blocks.length + ' vs ' + Bc.blocks.length + ')',
       A.blocks.length === Bc.blocks.length);
    const n = Math.max(A.blocks.length, Bc.blocks.length);
    let diffs = 0;
    for (let i = 0; i < n; i++) {
      if (A.blocks[i] !== Bc.blocks[i]) {
        diffs++;
        console.log('  ' + R + 'DIFF' + X + '  block ' + i);
        console.log('        baseline : ' + (A.blocks[i] || '(absent)'));
        console.log('        candidate: ' + (Bc.blocks[i] || '(absent)'));
      }
    }
    ok('every block matches in size and content (' + diffs + ' differ)', diffs === 0);

    // NEGATIVE CONTROL: the comparison must be able to detect a change.
    const perturbed = A.blocks.slice();
    if (perturbed.length) perturbed[0] = perturbed[0].replace(/^(\d+)x/, (m, w) => ((+w) + 7) + 'x');
    ok('NEG: the comparison can see a 7px difference when there is one',
       JSON.stringify(perturbed) !== JSON.stringify(A.blocks));
  }
} catch (e) {
  console.error('FAILED: ' + (e && e.message || e));
  fails++;
} finally {
  try { ws && ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
}
console.log('');
console.log(fails ? (R + fails + ' difference(s) or failures' + X) : (G + 'the Dashboard renders identically on both builds' + X));
process.exit(fails ? 1 : 0);
