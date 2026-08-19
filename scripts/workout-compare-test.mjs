// SAME SESSION, OVER TIME — bucketed by what a ride measurably WAS.
//
// BUCKETED BY IDENTITY, NOT BY NAME, and the library settles it: 231 virtual rides carry 146
// distinct names, and they are ROUTE names ("Zwift - Big Flat 8 in Watopia", "Evening Ride") because
// Zwift names by course. Exactly 3 rides are literally named for the session they were, so a name
// filter finds 3 and silently under-reports the rest — and gets worse as the library grows.
//
// BLOCK WINDOW ONLY, and it is ONE constraint not two. _blockSessionOf_ resolves structure, then
// intensity, then a whole-ride ratio — and BOTH structure paths consult blockPlanFor_. Outside the
// block they return null and it falls through to the ratio, which averages in warm-up and
// recoveries: the file already records three verbatim VO2 sessions relabelled THRESHOLD that way.
// So a pre-block ride is not merely missing a band, it is in the WRONG BUCKET — and a mislabelled
// row pollutes a trend silently where an absent one does not. Excluded, never blanked.
//
// TARGET-HIT ONLY WHERE A BAND WAS SENT. zwoRx is stamped at export and is PROSPECTIVE; falling back
// to the derived band would reintroduce the exact false miss the stamp exists to prevent.
//
// W/KG IS HISTORICAL OR ABSENT. weightOn_ never falls back to today's weight — pricing a June ride
// with August's weight fabricates the very trend the table exists to show.
//
// Run: node scripts/workout-compare-test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
function mb(from){ let i = src.indexOf('{', from), d = 0;
  for (; i < src.length; i++){ const c = src[i]; if (c === '{') d++; else if (c === '}'){ d--; if (!d) return i; } } return -1; }
const exFn = (n) => { const i = src.indexOf('function ' + n + '('); if (i < 0) throw new Error('missing ' + n); return src.slice(i, mb(i) + 1) + '\n'; };
const exVar = (n) => { const i = src.indexOf('var ' + n + '='); return src.slice(i, src.indexOf('\n', i)) + '\n'; };

const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l); };
const eq = (l, g, w) => { const c = JSON.stringify(g) === JSON.stringify(w); if (!c) fails++;
  console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l + (c ? '' : '   got ' + JSON.stringify(g) + ', want ' + JSON.stringify(w))); };

const RIDES = [
  { date:'2026-07-28', sportType:'VirtualRide', name:'Zwift - Big Flat 8', avgPwr:171, tss:70, avgHR:148, movingSecs:3400 },
  { date:'2026-08-04', sportType:'VirtualRide', name:'Evening Ride',       avgPwr:168, tss:68, avgHR:150, movingSecs:3400 },
  { date:'2026-08-11', sportType:'VirtualRide', name:'Zwift - VO2 Work',   avgPwr:175, tss:72, avgHR:151, movingSecs:3400 },
  { date:'2026-08-07', sportType:'VirtualRide', name:'Zwift - Watopia',    avgPwr:160, tss:65, avgHR:145, movingSecs:3600 },
  { date:'2026-08-14', sportType:'VirtualRide', name:'Zwift - Watopia 2',  avgPwr:158, tss:64, avgHR:144, movingSecs:3600 },
  { date:'2026-06-02', sportType:'VirtualRide', name:'Zwift - VO2 Work',   avgPwr:174, tss:71, avgHR:149, movingSecs:3400 },  // PRE-BLOCK
  { date:'2026-08-05', sportType:'VirtualRide', name:'deleted one', deleted:true, avgPwr:200 }
];
const IDENT = { '2026-07-28':'vo2','2026-08-04':'vo2','2026-08-11':'vo2','2026-08-07':'threshold','2026-08-14':'threshold','2026-06-02':'vo2' };
const STAMP = { '2026-08-11':{ lo:209, hi:228, ftp:190 } };
const MEAS  = { '2026-08-11':{ vals:[210,215,208,220], lo:209, hi:228, source:'laps' } };

function data(weightLog){
  const stub = {
    st:{ rides:RIDES, weightLog:weightLog, ftp:190 },
    normDate:(d)=>String(d).slice(0,10),
    blockPlanFor_:(dk)=>(dk>='2026-07-24' ? { sessions:[{ intent:IDENT[dk]||'z2' }] } : null),
    ftpOn_:()=>190,
    _blockSessionOf_:(r)=>IDENT[String(r.date).slice(0,10)]||null,
    allRidesDeduped_:()=>RIDES.filter((r)=>!r.deleted),
    constRideTSS_:(r)=>r.tss||null,
    _durSec_:(r)=>r.movingSecs||0,
    actName_:(r)=>r.name,
    rideRefOf_:(r)=>RIDES.indexOf(r),
    _stampedRxFor_:(dk)=>STAMP[dk]||null,
    _blockWorkMeasure_:(r,dk)=>MEAS[dk]||null,
    settingsArrLive_:()=>weightLog,
    console:{ error(){}, log(){} }
  };
  const n = Object.keys(stub);
  return new Function(...n, exFn('_wcIntentOf_') + exFn('weightOn_') + exFn('_wcRows_') + exFn('_wcTypes_')
    + 'return {_wcIntentOf_,weightOn_,_wcRows_,_wcTypes_};')(...n.map((k)=>stub[k]));
}
function render(rows, counts){
  const stub = {
    _wcTypes_:()=>counts, _wcRows_:()=>rows,
    rideRefOk_:(r)=>(typeof r==='number' ? r>=0 : !!r),
    rideRefAttr_:(r)=>(typeof r==='number' ? String(r) : "'"+r+"'"),
    document:{ getElementById:()=>null }
  };
  const n = Object.keys(stub);
  return new Function(...n, exVar('_WC_LBL') + "var _wcSel='';" + exFn('_wcFmtDur_') + exFn('_wcHTML_') + 'return _wcHTML_;')(...n.map((k)=>stub[k]))();
}

console.log('\n' + Y + '=== bucketing, and the block window as the gate ===' + X);
{
  const f = data([]);
  eq('three VO2 rides inside the block', f._wcRows_('vo2').map((r)=>r.date), ['2026-07-28','2026-08-04','2026-08-11']);
  ok('NEG: the pre-block VO2 ride is EXCLUDED, not shown blank', f._wcRows_('vo2').every((r)=>r.date>='2026-07-24'));
  eq('threshold buckets separately', f._wcRows_('threshold').map((r)=>r.date), ['2026-08-07','2026-08-14']);
  eq('type counts ignore pre-block rides', f._wcTypes_(), { vo2:3, threshold:2 });
  eq('oldest first, so the trend reads DOWN the table', f._wcRows_('vo2').map((r)=>r.date), ['2026-07-28','2026-08-04','2026-08-11']);
  ok('a name filter would have found only ONE of those three',
     RIDES.filter((r)=>!r.deleted && /VO2/i.test(r.name) && r.date>='2026-07-24').length === 1);
  ok('NEG: a deleted ride never appears', f._wcRows_('vo2').every((r)=>r.name!=='deleted one'));
}

console.log('\n' + Y + '=== target-hit only where a band was actually sent ===' + X);
{
  const rows = data([])._wcRows_('vo2');
  eq('unstamped rows carry no band', rows.slice(0,2).map((r)=>r.band), [null,null]);
  eq('...and NO computed pass/fail', rows.slice(0,2).map((r)=>r.hit), [null,null]);
  eq('the stamped row reports intervals in band', [rows[2].hit.inBand, rows[2].hit.n], [3,4]);
  eq('...against the band that was SENT', [rows[2].hit.lo, rows[2].hit.hi], [209,228]);
}

console.log('\n' + Y + "=== W/kg is historical or absent, never today's weight ===" + X);
{
  eq('no weight log -> null everywhere', data([])._wcRows_('vo2').map((r)=>r.wkg), [null,null,null]);
  const f = data([{ date:'2026-07-01', weight:170 }, { date:'2026-08-10', weight:165 }]);
  eq('walks to the last entry on or before the date', f.weightOn_('2026-08-04'), 170);
  eq('...picks up a later entry once it exists', f.weightOn_('2026-08-11'), 165);
  eq('...and is NULL before any entry', f.weightOn_('2026-06-01'), null);
  const rows = f._wcRows_('vo2');
  ok('W/kg uses the weight in force THAT DAY', Math.abs(rows[0].wkg - 171/(170/2.20462)) < 0.01);
  ok('...and a later row uses the later weight', Math.abs(rows[2].wkg - 175/(165/2.20462)) < 0.01);
  ok('NEG: weightOn_ never falls back to stWeightLb_', !/stWeightLb_/.test(exFn('weightOn_')));
}

console.log('\n' + Y + '=== the other columns read through their canonical helpers ===' + X);
{
  const rows = data([])._wcRows_('vo2');
  eq('TSS via constRideTSS_', rows.map((r)=>r.tss), [70,68,72]);
  ok('NEG: never raw r.tss', !/parseFloat\(r\.tss\)/.test(exFn('_wcRows_')));
  eq('avg HR', rows.map((r)=>r.avgHR), [148,150,151]);
  eq('duration in seconds', rows.map((r)=>r.secs), [3400,3400,3400]);
  ok('every row carries a ref for linking', rows.every((r)=>r.ref!=null));
  ok('refs come from rideRefOf_, the RIDE resolver', /rideRefOf_\(r\)/.test(exFn('_wcRows_')));
  // _runRefFor_ is sport-filtered to runs and would fail to resolve every row on a cycling table.
  ok('NEG: not the run resolver', !/_runRefFor_/.test(exFn('_wcRows_')));
}

console.log('\n' + Y + '=== the table ===' + X);
{
  const base = { date:'2026-08-11', ref:3, avgPwr:175, wkg:2.34, tss:72, avgHR:151, secs:3400, band:null, hit:null };
  let h = render([base, { ...base, date:'2026-08-04', ref:-1 }], { vo2:2, threshold:3 });
  ok('renders a table', /<table/.test(h));
  ok('a live ref is clickable', /recOpenRide_\(3\)/.test(h));
  ok('NEG: a dead ref is PLAIN TEXT, never a dead click', !/recOpenRide_\(-1\)/.test(h));
  ok('an unstamped target is a dash', /&mdash;<\/td><\/tr>/.test(h));
  ok('...and says WHY it is blank, not that it was missed', /It is not a miss/.test(h));
  ok('the block-window limit is stated on the card', /inside the current training block/.test(h));
  ok('the bucketing is stated on the card', /not by its name/.test(h));

  h = render([{ ...base, band:{lo:209,hi:228}, hit:{ inBand:4, n:4, lo:209, hi:228 } }], { vo2:2 });
  ok('a full hit shows 4/4 with its own band', /4\/4<\/span><span style="font-size:10px;color:var\(--d-dim\)"> 209-228W/.test(h));
  ok('...and the note switches to the sent-band wording', /band that session was actually sent/.test(h));
  h = render([{ ...base, band:{lo:209,hi:228}, hit:{ inBand:2, n:4, lo:209, hi:228 } }], { vo2:2 });
  ok('a partial hit is amber, not green', /c-amber/.test(h) && !/c-green/.test(h));

  // One session is not a trend.
  eq('a bucket with a single session renders NOTHING', render([base], { vo2:1 }), '');
  eq('no buckets at all renders nothing', render([], {}), '');

  // Z2 is always the busiest bucket; opening on it buries what the target column is for.
  const pick = (counts) => { const m = render([base], counts).match(/border:1px solid #FC4C02[^>]*>([A-Za-z0-9 ]+) </); return m && m[1].trim(); };
  eq('defaults to VO2 even when Z2 is far more frequent', pick({ vo2:3, threshold:3, z2:40 }), 'VO2');
  eq('...threshold when there is no VO2', pick({ threshold:3, z2:40 }), 'Threshold');
  eq('...and Z2 only when it is all there is', pick({ z2:4 }), 'Z2 Endurance');

  // House style.
  ok('NEG: no pill/progress bars', !/border-radius:4px;background:/.test(h));
  ok('NEG: no var() inside an SVG presentation attribute', !/<(circle|rect|path)[^>]*fill="var\(/.test(h));
}

console.log('\n' + Y + '=== it is mounted, and self-hides ===' + X);
ok('mounted on the Activities page', /wcHost\.id='wc-host';/.test(src));
ok('...between the title bar and the list', src.indexOf('wrap.appendChild(wcHost);') > src.indexOf('wrap.appendChild(titleBar);')
   && src.indexOf('wrap.appendChild(wcHost);') < src.indexOf('wrap.appendChild(list);'));
ok('...hidden entirely when there is nothing to compare', /if\(!_wcH\) wcHost\.style\.display='none';/.test(src));
ok('...with its own scroll so it cannot squeeze the list', /max-height:44vh;overflow-y:auto/.test(src));

console.log('');
if (fails) { console.log(R + 'workout compare: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'workout compare: all checks passed' + X + '\n');
