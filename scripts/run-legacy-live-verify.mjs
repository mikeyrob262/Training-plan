// RUN THE NEW CODE AGAINST THE REAL LIBRARY, WITHOUT DEPLOYING IT.
//
// Unit tests run on data I chose. The failures this app actually ships are the ones where real data
// has a shape nobody wrote a fixture for - a formatted duration string, a tombstone winning a
// handle, a snapshot run with no stored load. So this loads the DEPLOYED page (real stores, primed),
// injects the new functions from the LOCAL worker.js, and runs them against what is actually there.
//
// It is not a substitute for verifying a deploy - it proves the CODE works on the DATA, not that the
// bytes shipped. That check belongs after a push.
//
// NEGATIVE CONTROLS throughout: a season that does not exist must not render numbers, a fabricated
// run must not resolve, and the injected code must be provably the local code and not the page's.
import { spawn } from 'child_process';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const URL_ = process.argv[2] || 'https://training-plan.mgrobinson07.workers.dev/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9343;

const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l); };
const info = (l) => console.log('  ' + Y + '·' + X + '     ' + l);

function mb(from){ let i = src.indexOf('{', from), d = 0;
  for (; i < src.length; i++){ const c = src[i]; if (c === '{') d++; else if (c === '}'){ d--; if (!d) return i; } } return -1; }
const exFn = (n) => { const i = src.indexOf('function ' + n + '('); if (i < 0) throw new Error('missing ' + n); return src.slice(i, mb(i) + 1) + '\n'; };
const exVar = (re) => { const m = src.match(re); if (!m) throw new Error('missing var ' + re); return m[0] + '\n'; };

const INJECT = [
  exVar(/var _LG_MON=\[[^\]]*\];/),
  exVar(/var _LG_CYC_FROM=\d+;/), exVar(/var _LG_RUN_FROM=\d+;/), exVar(/var _LG_RUN_TO=\d+;/),
  exVar(/var _PT_COLS=\{[^}]*\};/),
  exVar(/var _RT_RANGES=\[\[[^\n]*?\]\];/), exVar(/var _RT_COLS=\{[^}]*\};/),
  exVar(/var _RT_BASE_FLOOR=\d+;/), exVar(/var _RT_EASY_HRIF=[\d.]+;/), exVar(/var _RT_VOL_FLOOR=[\d.]+;/),
  exVar(/var DRIFT_HRV_BASE_MIN=\d+;/), exVar(/var DRIFT_HRV_MIN_N=\d+;/),
  'var _LG_SEL=null, _lgDown=null, _rtRange="90D", _rtCache={key:null,out:null};',
  // _msCycling_ MUST be injected too. _lgRowsFor_('cyc') delegates to it, so without it the
  // check runs the local reader over the DEPLOYED projection - which is the very thing being
  // fixed, and the result reads as a failed fix rather than an unfixed harness.
  ...['_msCycling_','_lgEsc_','_lgSportCfg_','_lgRowsFor_','_lgRowMi_','_lgRowSec_','_lgRowsInYear_','_lgRefFor_',
      '_lgMonthlyPts_','_lgByYear_','_lgNum_','_lgMonthTable_','_lgActivityTable_','_lgBackBar_',
      '_lgSeasonDetailHTML_','_lgSeasonCard_',
      '_ptChart_',
      '_rtInvalidate_','_rtDailyTss_','_rtSeries_','_rtWindow_','_rtDelta_','_rtLayoff_','_rtVerdict_',
      '_rtIsEasy_','_rtDrivers_','_rtInsight_','_rtCardHTML_',
      '_runDriftHrvBaseline_','_runHrvOn_','_runDriftVerdict_','_runShinCardHTML_'].map(exFn)
].join('\n');

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
  const targets = await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
  const page = targets.find(t => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id:i, method, params: params||{}})); });
  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', {expression: expr, returnByValue: true, awaitPromise: true});
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 900));
    return r.result && r.result.result && r.result.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', {url: URL_});
  await wait(10000);
  let primed = false;
  for (let i = 0; i < 24; i++) {
    primed = await evalJS(`(function(){ try{ return !!(typeof _storeV2Runs!=='undefined' && _storeV2Runs && _storeV2Runs.length); }catch(e){ return false; } })()`);
    if (primed) break;
    await wait(2500);
  }
  console.log('\n' + Y + '=== the live page ===' + X);
  ok('run snapshot primed', primed);

  // NEGATIVE CONTROL on the injection itself: these must NOT exist before it runs, or the test
  // would be measuring the deployed code and reporting it as the local code.
  const before = await evalJS(`(function(){ return { detail:(typeof _lgSeasonDetailHTML_), rt:(typeof _rtSeries_), verdict:(typeof _runDriftVerdict_) }; })()`);
  ok('NEG: the new functions are NOT already on the deployed page', before.detail === 'undefined' && before.rt === 'undefined' && before.verdict === 'undefined');

  const inj = await evalJS(`(function(){ try{ (0,eval)(${JSON.stringify(INJECT)}); return 'ok'; }catch(e){ return 'ERR '+(e&&e.message); } })()`);
  ok('the local code injected cleanly', inj === 'ok');
  if (inj !== 'ok') { console.log('  ' + R + inj + X); throw new Error(inj); }

  console.log('\n' + Y + '=== Legacy season drill-down, on the real library ===' + X);
  const lg = await evalJS(`(function(){
    var out={};
    ['cyc','run'].forEach(function(sp){
      var cfg=_lgSportCfg_(sp), rows=_lgRowsFor_(sp), seasons=_lgByYear_(rows, cfg.from, cfg.to);
      out[sp]={ seasons:seasons.map(function(s){ return {year:s.year, n:s.n, mi:Math.round(s.mi)}; }), detail:[] };
      seasons.forEach(function(s){
        _LG_SEL={ sport:sp, year:s.year };
        var html='', err=null;
        try{ html=_lgSeasonDetailHTML_(); }catch(e){ err=String(e&&e.message); }
        var list=_lgRowsInYear_(rows, s.year);
        var linkable=0;
        list.forEach(function(r){ if(rideRefOk_(_lgRefFor_(r, sp))) linkable++; });
        // Footer totals, straight out of the rendered month table, so the check is on what the
        // reader sees rather than on the inputs.
        var foot=(html.match(/<tfoot>[\\s\\S]*?<\\/tfoot>/)||[''])[0].replace(/<[^>]+>/g,'|').split('|').filter(Boolean);
        out[sp].detail.push({ year:s.year, err:err, len:html.length,
          cardN:s.n, listN:list.length, footN:foot[1]||null, footMi:foot[2]||null,
          cardMi:Math.round(s.mi*10)/10, cardMiStr:String(Math.round(s.mi*10)/10),
          rows:(html.match(/<tr[ >]/g)||[]).length, linkable:linkable,
          arows:(html.match(/class="lg-arow"/g)||[]).length,
          // A row whose name falls back to "<Sport> - N mi" is a row that lost its identity in the
          // projection. Counted, because 340 of 340 cycling rows did exactly that.
          named:list.filter(function(r){ return !actNameInfo_(r).isFallback; }).length });
      });
    });
    _LG_SEL=null;
    // NEGATIVE CONTROL: a season that is not in the ranked set must claim nothing.
    _LG_SEL={ sport:'cyc', year:1990 };
    var ghost=_lgSeasonDetailHTML_();
    _LG_SEL=null;
    out.ghost={ len:ghost.length, saysNoClaim:(ghost.indexOf('no longer in the ranked set')>0),
                hasTable:(ghost.indexOf('<table')>=0) };
    out.fabricated = rideRefOk_(_lgRefFor_({ date:'1994-03-07', distance:3.14159, movingSecs:1234, stravaId:999999999999 }, 'cyc'));
    return out;
  })()`);

  ['cyc','run'].forEach(sp => {
    const label = sp === 'cyc' ? 'cycling' : 'running';
    ok(label + ': at least one season ranks', lg[sp].seasons.length > 0);
    const errs = lg[sp].detail.filter(d => d.err);
    ok(label + ': every season detail renders without throwing', errs.length === 0);
    if (errs.length) console.log('    ' + R + JSON.stringify(errs) + X);
    ok(label + ': the list length equals the card count', lg[sp].detail.every(d => d.listN === d.cardN));
    ok(label + ': the month-table footer count equals the card count', lg[sp].detail.every(d => String(d.cardN) === d.footN));
    // Compared as NUMBERS. toLocaleString() puts a thousands separator in the footer ("1,908.5"),
    // so a string compare fails on formatting rather than on arithmetic - which is a test bug, not a
    // disagreement between the table and the card.
    const num = (x) => parseFloat(String(x).replace(/,/g, ''));
    ok(label + ': the month-table footer miles equal the card miles',
       lg[sp].detail.every(d => Math.abs(num(d.footMi) - d.cardMi) < 0.15));
    lg[sp].detail.filter(d => Math.abs(num(d.footMi) - d.cardMi) >= 0.15)
      .forEach(d => console.log('    ' + R + d.year + ': footer ' + d.footMi + ' vs card ' + d.cardMi + X));
    ok(label + ': every activity is rendered, none trimmed', lg[sp].detail.every(d => d.rows >= d.listN));
    ok(label + ': the clickable rows are exactly the resolvable ones', lg[sp].detail.every(d => d.arows === d.linkable));
    // Cycling rows come from live st.rides records, so every one of them should carry a real name
    // and resolve. Anything less means the projection dropped identity again.
    if (sp === 'cyc') {
      ok('cycling: every activity carries its real name, not the sport fallback',
         lg[sp].detail.every(d => d.named === d.listN));
      ok('cycling: every activity opens in full - they ARE live library records',
         lg[sp].detail.every(d => d.linkable === d.listN));
    }
    lg[sp].detail.forEach(d => info(label + ' ' + d.year + ': ' + d.listN + ' activities, ' +
      d.linkable + ' open in full (' + Math.round(d.linkable / Math.max(1, d.listN) * 100) + '%)'));
  });
  ok('NEG: an unranked season claims nothing and draws no table', lg.ghost.saysNoClaim && !lg.ghost.hasTable);
  ok('NEG: a fabricated activity does not resolve', lg.fabricated === false);

  console.log('\n' + Y + '=== Running Trajectory, on the real library ===' + X);
  const rt = await evalJS(`(function(){
    var out={};
    var ser=_rtSeries_();
    out.series={ n:ser.length, first:ser.length?ser[0].date:null, last:ser.length?ser[ser.length-1].date:null,
                 lastCtl:ser.length?ser[ser.length-1].ctl:null,
                 tripleOk:ser.every(function(p){ return Math.abs((p.ctl-p.atl)-p.tsb)<1e-9; }),
                 peak:ser.reduce(function(m,p){ return p.ctl>m?p.ctl:m; },0) };
    out.byRange={};
    ['7D','30D','90D','1Y','ALL'].forEach(function(k){
      _rtRange=k;
      var w=_rtWindow_(k), d=_rtDelta_(w.pts), v=_rtVerdict_(d), lay=_rtLayoff_(w.days), f=_rtDrivers_(w.days);
      var html='', err=null;
      try{ html=_rtCardHTML_(); }catch(e){ err=String(e&&e.message); }
      out.byRange[k]={ err:err, len:html.length,
        head:v.head, pct:(d?d.pct:null), weakBase:(d?d.weakBase:null), from:(d?d.from:null), to:(d?d.to:null),
        layoff:lay.gap, rows:f.rows.map(function(r){ return r.label+' '+(r.pct!=null?(r.pct+'%'):(r.delta+' '+r.unit))+(r.better?' (better)':''); }),
        miss:f.miss, insight:_rtInsight_(d, w, f, lay),
        // NEGATIVE CONTROLS on the rendered card.
        hasNaN:(html.indexOf('NaN')>=0), hasUndef:(html.indexOf('undefined')>=0),
        hasInfinity:(html.indexOf('Infinity')>=0) };
    });
    _rtRange='90D';
    return out;
  })()`);
  ok('a running CTL series exists at all', rt.series.n > 0);
  ok('fitness minus fatigue equals form on every single day', rt.series.tripleOk === true);
  info('series: ' + rt.series.n + ' days, ' + rt.series.first + ' to ' + rt.series.last +
       ', peak run CTL ' + rt.series.peak + ', today ' + rt.series.lastCtl);
  ['7D','30D','90D','1Y','ALL'].forEach(k => {
    const b = rt.byRange[k];
    ok(k + ': the card renders without throwing', !b.err && b.len > 500);
    ok(k + ': NEG: no NaN, undefined or Infinity reaches the page', !b.hasNaN && !b.hasUndef && !b.hasInfinity);
    info(k + ': "' + b.head + '" ' + (b.weakBase ? (b.from + ' -> ' + b.to + ' (base too low for a %)') : (b.pct + '%')) +
         (b.layoff >= 21 ? ('  [' + b.layoff + '-day break]') : ''));
    info('     drivers: ' + (b.rows.length ? b.rows.join(' | ') : '(none)') + (b.miss.length ? ('   missing: ' + b.miss.join(', ')) : ''));
    info('     "' + b.insight + '"');
  });

  console.log('\n' + Y + '=== Easy-Run Drift verdict, on the real library ===' + X);
  const dv = await evalJS(`(function(){
    var w=_runShinWatch_(), v=_runDriftVerdict_(w), html='', err=null;
    try{ html=_runShinCardHTML_(); }catch(e){ err=String(e&&e.message); }
    return { sample:w.sample, drifted:w.drifted, flag:w.flag,
             tone:v.tone, head:v.head, body:v.body,
             same:v.same, hrv:v.hrv, err:err, len:html.length,
             hasNaN:(html.indexOf('NaN')>=0), hasUndef:(html.indexOf('undefined')>=0),
             saysShin:(html.indexOf('Nothing about the shin is recorded')>0),
             oldClaim:(html.indexOf('shin flare-up')>=0) };
  })()`);
  ok('the card renders without throwing', !dv.err && dv.len > 300);
  ok('NEG: no NaN or undefined reaches the page', !dv.hasNaN && !dv.hasUndef);
  ok('it states that the shin is not recorded', dv.saysShin === true);
  ok('NEG: the old flare-up claim is gone', dv.oldClaim === false);
  ok('the overlap with the run-ahead card was checked', dv.same.checked === true);
  ok('a recovery baseline was available', dv.hrv.have === true);
  info('verdict [' + dv.tone + ']: ' + dv.head);
  dv.body.forEach(b => info('   ' + b));
  info('overlap ' + dv.same.n + ' of ' + dv.same.of + '  ·  HRV ' + dv.hrv.below + ' of ' + dv.hrv.rated +
       ' below a ' + dv.hrv.base + ' ms median from ' + dv.hrv.baseN + ' days');

  console.log('');
  console.log(fails ? (R + fails + ' FAILED' + X) : (G + 'all live checks passed' + X));
} catch (e) {
  console.error(R + 'FAILED: ' + (e && e.message || e) + X);
  fails++;
} finally {
  try { ws && ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
}
process.exit(fails ? 1 : 0);
