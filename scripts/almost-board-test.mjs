// The Almost Board. Its whole promise is that everything listed is genuinely within reach, so the
// assertions are mostly about what must NOT appear.
//
// It also fixes a real bug it uncovered: segment efforts are stored in TWO shapes - the harvester
// writes {d,s,w} (4,855 of 5,062 efforts) and the PR sync writes {date,sec} (the other 207) - and
// segmentRecordsCompute_ read only the second. Every progression line in the app was drawn from
// four percent of the library.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fnBody, section } from './lib-src-window.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const asServed = (s) => s.replace(/\\([\s\S])/g, (_, c) => (c === '\\' ? '\\' : c));
function matchBrace(from) {
  let i = src.indexOf('{', from), d = 0;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') d++; else if (c === '}') { d--; if (!d) return i; } }
  return -1;
}
const exFn = (n) => { const i = src.indexOf('function ' + n + '('); if (i < 0) throw new Error('missing ' + n); return src.slice(i, matchBrace(i) + 1) + '\n'; };
const exVar = (n) => { const m = src.match(new RegExp('^var ' + n + '[^\\n]*$', 'm')); if (!m) throw new Error('missing var ' + n); return m[0] + '\n'; };
const NL = String.fromCharCode(10);

const st = { segments: {}, rides: [] };
const M = new Function('st', asServed(
  exVar('ALMOST_ATTEMPT_MAX') + exVar('ALMOST_MAX_GAIN_SEC') + exVar('ALMOST_NEAR_PCT') + exVar('ALMOST_NEAR_MAX_SEC') +
  exVar('ALMOST_RECENT_DAYS') + exVar('ALMOST_DPR_MAX_SEC') +
  exFn('_segEffortNorm_') + exFn('_segEfforts_') + exFn('_segProgression_') +
  exFn('_almostDaysAgo_') + exFn('_almostDistance_') + exFn('almostBoard_') +
  exFn('_almostTime_') + exFn('_almostAgo_') +
  ';return { _segEffortNorm_, _segEfforts_, _segProgression_, almostBoard_, _almostTime_, ALMOST_NEAR_PCT };'
))(st);

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };
const eq = (l, got, want) => { const g = JSON.stringify(got) === JSON.stringify(want); if (!g) fails++; console.log('  ' + (g ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l + (g ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want))); };
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

console.log('\n' + Y + '=== BOTH effort shapes are read - the bug this uncovered ===' + X);
{
  eq('the harvester shape {d,s} is understood', M._segEffortNorm_({ d: '2026-07-01', s: 300, w: 210 }),
     { sec: 300, date: '2026-07-01', w: 210 });
  eq('the sync shape {date,sec} still is', M._segEffortNorm_({ date: '2026-07-01', sec: 300 }),
     { sec: 300, date: '2026-07-01', w: null });
  eq('an effort with no time is dropped', M._segEffortNorm_({ d: '2026-07-01' }), null);
  eq('an effort with no date is dropped', M._segEffortNorm_({ s: 300 }), null);
  // the records view must read the same normaliser, or the two disagree about what an effort is
  ok('segmentRecordsCompute_ uses the shared reader', /_segProgression_\(_segEfforts_\(s\)\)/.test(exFn('segmentRecordsCompute_')));
  ok('...and no longer filters on the sync shape alone',
     !/e\.sec\)>0 && e\.date/.test(exFn('segmentRecordsCompute_')));
}

console.log('\n' + Y + '=== Closing in: movement, measured ===' + X);
{
  st.segments = {
    a: { name: 'Homerich', efforts: [ { d: daysAgo(90), s: 330 }, { d: daysAgo(40), s: 320 }, { d: daysAgo(10), s: 309 } ] },
    b: { name: 'Never improved', efforts: [ { d: daysAgo(90), s: 300 }, { d: daysAgo(10), s: 340 } ] }
  };
  const B = M.almostBoard_();
  eq('a segment with two improvements is listed', B.closing.length, 1);
  eq('...naming the time actually taken off', B.closing[0].tookSec, 21);
  eq('...and how many improvements it took', B.closing[0].drops, 2);
  eq('...counting every ride on it', B.closing[0].rides, 3);
  ok('a segment that never improved is NOT called closing in', !B.closing.some((x) => x.name === 'Never improved'));
}
{
  // Old movement is history, not a live target.
  st.segments = { a: { name: 'Ancient', efforts: [ { d: '2019-01-01', s: 400 }, { d: '2019-06-01', s: 350 } ] } };
  eq('an improvement from years ago is not a target', M.almostBoard_().closing.length, 0);
}

console.log('\n' + Y + '=== a ride that CROSSED the segment is not an attempt ===' + X);
{
  // The live board's top entry was 'minus 2,241 seconds' - thirty-seven minutes off a segment,
  // which is a ride he stopped on being read as the baseline, not a training gain.
  st.segments = { a: { name: 'Stopped for coffee', efforts: [
    { d: daysAgo(60), s: 2600 }, { d: daysAgo(30), s: 360 }, { d: daysAgo(5), s: 352 } ] } };
  const B = M.almostBoard_();
  eq('the absurd baseline is discarded, not celebrated', B.closing.length ? B.closing[0].tookSec : 0, 8);
  ok('...so no entry claims an implausible gain', !B.closing.some(function(x){ return x.tookSec > 600; }));
}
{
  // The gate must not scale away on a LONG segment. An hour-long segment with a 30-minute 'gain'
  // is exactly what the first, looser version let through on live data.
  st.segments = { a: { name: 'Hour long', efforts: [ { d: daysAgo(60), s: 5424 }, { d: daysAgo(5), s: 3616 } ] } };
  eq('a 30-minute gain on an hour segment is rejected', M.almostBoard_().closing.length, 0);
}
{
  // And a percentage gate alone cannot bound it: 25% of a two-hour segment is 29 minutes, which
  // is what the live board still led with after the ratio had been tightened twice.
  st.segments = { a: { name: 'Two hours', efforts: [ { d: daysAgo(60), s: 8700 }, { d: daysAgo(5), s: 7000 } ] } };
  eq('a 28-minute gain on a two-hour segment is rejected', M.almostBoard_().closing.length, 0);
}
{
  // A real gain of a sensible size must still survive the gate.
  st.segments = { a: { name: 'Real gain', efforts: [ { d: daysAgo(60), s: 400 }, { d: daysAgo(5), s: 360 } ] } };
  eq('a 10% improvement is kept', M.almostBoard_().closing[0].tookSec, 40);
}

console.log('\n' + Y + '=== Almost a PB: only the LAST go counts ===' + X);
{
  st.segments = { a: { name: 'Close', efforts: [ { d: daysAgo(60), s: 300 }, { d: daysAgo(5), s: 303 } ] } };
  const B = M.almostBoard_();
  eq('a recent near miss is listed', B.nearBest.length, 1);
  eq('...with the real gap', B.nearBest[0].gapSec, 3);
}
{
  st.segments = { a: { name: 'Far', efforts: [ { d: daysAgo(60), s: 300 }, { d: daysAgo(5), s: 400 } ] } };
  eq('a big gap is not "almost"', M.almostBoard_().nearBest.length, 0);
}
{
  // 3% of 1200s is 36s, which is over the absolute cap - a long segment must not launder a big gap
  // through a small percentage.
  st.segments = { a: { name: 'Long', efforts: [ { d: daysAgo(60), s: 1200 }, { d: daysAgo(5), s: 1230 } ] } };
  eq('a 30s gap on a long segment is capped out', M.almostBoard_().nearBest.length, 0);
}
{
  st.segments = { a: { name: 'PB last', efforts: [ { d: daysAgo(60), s: 320 }, { d: daysAgo(5), s: 300 } ] } };
  eq('taking the PB is not a near miss', M.almostBoard_().nearBest.length, 0);
}

console.log('\n' + Y + '=== Distance splits ===' + X);
{
  st.segments = {};
  st.rides = [
    { date: '2026-06-01', dpr: { m: { 10: 900 } } },
    { date: '2026-07-01', dpr: { m: { 10: 912 } } },
    { date: '2026-05-01', dpr: { m: { 40: 4000 } } },
    { date: '2026-05-02', dpr: { m: { 40: 4600 } } }
  ];
  const d = M.almostBoard_().distance;
  eq('a near split is listed', d.length, 1);
  eq('...at the right distance', d[0].km, 10);
  eq('...with the real gap', d[0].gapSec, 12);
  ok('a 600s gap is not a near miss', !d.some((x) => x.km === 40));
}

console.log('\n' + Y + '=== empty is stated, never padded ===' + X);
{
  st.segments = {}; st.rides = [];
  const B = M.almostBoard_();
  eq('no segments -> no closing entries', B.closing.length, 0);
  eq('no segments -> no near-best entries', B.nearBest.length, 0);
  eq('no rides -> no distance entries', B.distance.length, 0);
  const r = exFn('aiRenderAlmost_');
  ok('the renderer says so in words', /nothing yet|No segment has two timed improvements/.test(r));
  ok('...and explains why KOM proximity is absent rather than faking a section', /closest gap was 4 seconds/.test(r));
}

console.log('\n' + Y + '=== formatting ===' + X);
{
  eq('under a minute reads as seconds', M._almostTime_(45), '45s');
  eq('over a minute reads as mm:ss', M._almostTime_(309), '5:09');
  eq('...padding the seconds', M._almostTime_(305), '5:05');
}

// A BOARD ROW NAMED A SEGMENT AND THEN WENT NOWHERE. The ids these rows already carry ARE the
// Segment Library's ids — st.segments is keyed by segment id and _saEvaluate_ reads seg.id, so the
// two id spaces are the same one. Verified against the live store: 2,017 of 2,017 keys equal their
// own .id, and all 247 Closing-in entries resolve in the library list.
console.log('\n' + Y + '=== board rows link to the segment they name ===' + X);
{
  const sec = fnBody(src, 'aiRenderAlmost_');
  ok('there is ONE row builder, not per-section navigation', /var segRow=function\(id, inner\)/.test(sec));
  ok('Closing in uses it', /h1\+=segRow\(x\.id,/.test(sec));
  ok('Almost-a-PB uses it too', /h2\+=segRow\(x\.id,/.test(sec));
  ok('...and a linked row is actually clickable', /cursor:pointer/.test(sec));
  ok('...with a visible affordance, not just a cursor', /&rsaquo;/.test(sec));
  // Distance splits are km splits, not segments - they carry no segment id and must NOT pretend to.
  ok('distance splits are not given a fake segment link', !/h3\+=segRow\(/.test(sec));
  // An id that cannot be emitted safely must degrade to a plain row rather than a dead button.
  ok('an id-less row falls back to an unlinked row', /if\(!sid\) return '<div style="display:flex/.test(sec));
  ok('the id is charset-guarded before entering the attribute', /replace\(\/\[\^A-Za-z0-9:_\.-\]\/g,''\)/.test(sec));

  // The opener: order is load-bearing, because _saPaint_ needs the tab mounted first.
  const op = src.slice(src.indexOf('window.almostOpenSeg_'), src.indexOf('window.almostOpenSeg_') + 500);
  ok('the opener exists', op.length > 50);
  ok('it switches to the Segment Library tab', /aiSetTab_\('seglib'\)/.test(op));
  ok('...BEFORE opening the segment', op.indexOf("aiSetTab_('seglib')") < op.indexOf('saOpen_(id)'));
  ok('...and reuses saOpen_ rather than reimplementing detail', /window\.saOpen_\(id\)/.test(op));
  ok('...guarded so a missing tab function cannot throw on tap', /typeof aiSetTab_==='function'/.test(op));
}

console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'almost board: all checks passed' + X));
process.exit(fails ? 1 : 0);
