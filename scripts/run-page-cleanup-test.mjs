// A RED LIST WITH NO READING IS A WARNING BY IMPLICATION, AND THE IMPLICATION WAS WRONG.
//
// The Easy-Run Drift card printed eight runs in red and stopped. Measured on the live library, those
// eight runs are THE SAME EIGHT the run-ahead card above them reads as progress - one behaviour,
// shown twice, once as good news and once as a red list, with nothing connecting them.
//
// The verdict this test guards has three parts and each has its own way of going wrong:
//
//   OVERLAP  set identity, not correlation - so it must be computed from the run-ahead card's OWN
//            dates (.dk, not .date - reading the wrong field yields a silent zero overlap and the
//            card would go back to saying nothing).
//   RECOVERY st.hrvDaily is real (31 dated {hrv,rhr} rows) and covers all eight. The live split is
//            4 below the median and 4 above - a coin flip. Calling that a pattern is precisely the
//            fabrication this card is being fixed for, so an even split must NOT raise a concern.
//   SHIN     nothing about the shin is stored anywhere. The old subtitle invoked "the last shin
//            flare-up" as though the card were watching for it. It must say it cannot.
//
// Also guards the four page-cleanup changes, each of which could regress quietly: the run map gone,
// the growth chart unmounted from THIS page but still alive in You vs. You, the stat rows condensed
// without losing a figure, and "Not yet" no longer yanking the page under the reader.
//
// Run: node scripts/run-page-cleanup-test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
function mb(from){ let i = src.indexOf('{', from), d = 0;
  for (; i < src.length; i++){ const c = src[i]; if (c === '{') d++; else if (c === '}'){ d--; if (!d) return i; } } return -1; }
const exFn = (n) => { const i = src.indexOf('function ' + n + '('); if (i < 0) throw new Error('missing ' + n); return src.slice(i, mb(i) + 1) + '\n'; };

const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l); };
const eq = (l, got, want) => { const c = JSON.stringify(got) === JSON.stringify(want); if (!c) fails++;
  console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l + (c ? '' : '   got '+JSON.stringify(got)+', want '+JSON.stringify(want))); };

const FNS = ['_runDriftHrvBaseline_','_runHrvOn_','_runDriftVerdict_'];
let bundle = '';
for (const n of FNS) { const s = exFn(n); ok('extracted ' + n, s.indexOf('function ' + n) === 0 && s.trim().endsWith('}')); bundle += s; }
const BASE_MIN = +(src.match(/var DRIFT_HRV_BASE_MIN=(\d+);/) || [])[1];
const MIN_N    = +(src.match(/var DRIFT_HRV_MIN_N=(\d+);/) || [])[1];
ok('DRIFT_HRV_BASE_MIN found', BASE_MIN > 0);
ok('DRIFT_HRV_MIN_N found', MIN_N > 0);

// The LIVE numbers, so this is a regression test against reality and not against invented data.
const LIVE_ROWS = [
  { date:'2026-08-24', above:79, drifted:true,  name:'Run' },
  { date:'2026-08-19', above:47, drifted:false, name:'Run' },
  { date:'2026-08-17', above:69, drifted:true,  name:'Run' },
  { date:'2026-08-12', above:58, drifted:true,  name:'Run' },
  { date:'2026-08-10', above:58, drifted:true,  name:'Run' },
  { date:'2026-08-05', above:53, drifted:true,  name:'Run' },
  { date:'2026-08-03', above:59, drifted:true,  name:'Run' },
  { date:'2026-07-29', above:56, drifted:true,  name:'Run' }
];
const LIVE_HRV = { '2026-07-25':38,'2026-07-26':27,'2026-07-27':34,'2026-07-28':45,'2026-07-29':28,
  '2026-07-30':28,'2026-07-31':26,'2026-08-01':28,'2026-08-03':44,'2026-08-04':32,'2026-08-05':29,
  '2026-08-07':28,'2026-08-08':43,'2026-08-09':29,'2026-08-10':37,'2026-08-11':36,'2026-08-12':30,
  '2026-08-13':35,'2026-08-14':27,'2026-08-15':32,'2026-08-16':29,'2026-08-17':41,'2026-08-18':35,
  '2026-08-19':31,'2026-08-20':32,'2026-08-21':33,'2026-08-22':38,'2026-08-23':38,'2026-08-24':38,
  '2026-08-25':41 };

function build(opts) {
  opts = opts || {};
  const hrvDaily = {};
  Object.keys(opts.hrv || LIVE_HRV).forEach(k => { hrvDaily[k] = { hrv:(opts.hrv || LIVE_HRV)[k], rhr:54, at:1 }; });
  const harness = `
    // The two thresholds must be declared here. Without them the extracted function hits a
    // ReferenceError, its own catch swallows it, and every baseline comes back null - a green-looking
    // harness measuring nothing.
    var DRIFT_HRV_BASE_MIN=${BASE_MIN}, DRIFT_HRV_MIN_N=${MIN_N};
    var st={ hrvDaily:${JSON.stringify(hrvDaily)} };
    function _ovwMedian_(a){ a=a.slice().sort(function(x,y){ return x-y; });
      var m=Math.floor(a.length/2); return a.length%2?a[m]:(a[m-1]+a[m])/2; }
    var __W=${JSON.stringify({ rows: opts.rows || LIVE_ROWS,
                               sample: (opts.rows || LIVE_ROWS).length,
                               drifted: (opts.rows || LIVE_ROWS).filter(r => r.drifted).length,
                               flag: opts.flag !== false, driftPct: 50, minSample: 4, enough: true })};
    function _runShinWatch_(){ return __W; }
    var __AHEAD=${JSON.stringify(opts.ahead === undefined ? { streak:8, runs:LIVE_ROWS.map(r => ({ dk:r.date })) } : opts.ahead)};
    function _runAheadFlag_(){ return __AHEAD; }
    ${bundle}
    return { verdict:_runDriftVerdict_, base:_runDriftHrvBaseline_, hrvOn:_runHrvOn_ };
  `;
  return new Function(harness)();
}

console.log('\n' + Y + '=== 1. the recovery baseline is a median, over enough days ===' + X);
{
  const F = build();
  const b = F.base();
  eq('every readable day counts toward the baseline', b.n, 30);
  eq('the baseline is the median, not the mean', b.median, 32.5);
  // NEGATIVE CONTROL: the mean is pulled by the 44s and 45s, which is why it is not used.
  const vals = Object.values(LIVE_HRV);
  const mean = Math.round(vals.reduce((a,c)=>a+c,0)/vals.length*10)/10;
  ok('NEG: the mean would have been a different number', mean !== b.median);
  // Too few days is NOT a baseline, and must not silently become one.
  const F2 = build({ hrv: { '2026-08-01':30, '2026-08-02':31, '2026-08-03':32 } });
  eq('NEG: three days is not a baseline', F2.base().median, null);
  eq('...and it still reports how many it had', F2.base().n, 3);
  // A blank value never coerces to zero and drags the median down.
  const F3 = build({ hrv: Object.assign({}, LIVE_HRV, { '2026-08-02': null }) });
  eq('a null reading is skipped, not read as 0', F3.base().n, 30);
  eq('...and the median is unmoved', F3.base().median, 32.5);
  eq('a day with a reading resolves', F.hrvOn('2026-08-24'), 38);
  eq('NEG: a day with none returns null, not 0', F.hrvOn('2026-08-06'), null);
  eq('NEG: an unknown date returns null', F.hrvOn('1999-01-01'), null);
}

console.log('\n' + Y + '=== 2. an even split is NOT a pattern ===' + X);
{
  const F = build();
  const v = F.verdict();
  eq('all seven drifted runs were rated against the baseline', v.hrv.rated, 7);
  eq('the live split is 3 below the median', v.hrv.below, 3);
  ok('the sample is big enough to speak to', v.hrv.thin === false);
  ok('NEG: a near-even split does NOT raise a concern', v.tone !== 'watch');
  ok('...and the card does not tell him to ease off', v.head.indexOf('easing off') < 0);
  ok('the split is stated with its denominator', v.body.join(' ').indexOf('3 of the 7') > 0);
  ok('...and named as close to even', /even split/.test(v.body.join(' ')));

  // NEGATIVE CONTROL: make the split lopsided and the concern MUST fire, or the rule is inert.
  const lowDays = {};
  Object.keys(LIVE_HRV).forEach(k => { lowDays[k] = LIVE_HRV[k]; });
  LIVE_ROWS.filter(r => r.drifted).forEach(r => { lowDays[r.date] = 20; });   // every drift day well under
  const F2 = build({ hrv: lowDays });
  const v2 = F2.verdict();
  eq('a lopsided split rates the same runs', v2.hrv.rated, 7);
  eq('...all of them below', v2.hrv.below, 7);
  eq('and THAT raises the concern', v2.tone, 'watch');
  ok('...with the action named', /easing off/.test(v2.head));
}

console.log('\n' + Y + '=== 3. the overlap is an identity, and it is read from the right field ===' + X);
{
  const F = build();
  const v = F.verdict();
  ok('the overlap was actually checked', v.same.checked === true);
  eq('all eight are the same runs', [v.same.n, v.same.of], [8, 8]);
  eq('so the verdict is that this IS the progress', v.tone, 'ok');
  ok('...and says so in words', /same running the card above/.test(v.head));
  ok('the body states the overlap with both counts', /8 of these 8 are the same runs/.test(v.body.join(' ')));
  ok('...and names it as one behaviour, not two findings', /one behaviour, not two findings/.test(v.body.join(' ')));

  // NEGATIVE CONTROL: the run-ahead card carries .dk, NOT .date. Reading .date yields zero overlap
  // and the card silently loses its whole verdict - the exact bug this pins.
  const F2 = build({ ahead: { streak:8, runs: LIVE_ROWS.map(r => ({ date:r.date })) } });
  eq('NEG: a runs[] with no .dk overlaps nothing', F2.verdict().same.n, 0);
  ok('NEG: ...and then it does not claim to be the progress signal', !/same running the card above/.test(F2.verdict().head));

  // No run-ahead card at all: the overlap is not checked, and nothing is asserted about it.
  const F3 = build({ ahead: null });
  const v3 = F3.verdict();
  ok('with no run-ahead flag the overlap is not checked', v3.same.checked === false);
  ok('NEG: and no overlap sentence is printed', !/same runs counted above/.test(v3.body.join(' ')));

  // A MINORITY overlap must not be dressed up as one fact.
  const F4 = build({ ahead: { streak:2, runs: [{ dk:'2026-08-24' }, { dk:'2026-08-19' }] } });
  eq('a minority overlap is counted honestly', F4.verdict().same.n, 2);
  ok('NEG: ...and does not claim the two cards are one signal', !/same running the card above/.test(F4.verdict().head));
}

console.log('\n' + Y + '=== 4. the shin is not claimed, because nothing about it is stored ===' + X);
{
  const F = build();
  const body = F.verdict().body.join(' ');
  ok('the card says the shin is not recorded', /Nothing about the shin is recorded/.test(body));
  ok('...and hands the judgement back', /still yours to make/.test(body));
  // NEGATIVE CONTROL: the old subtitle implied the card was watching for a flare-up. It must be gone
  // from the sufficient-sample path.
  const card = exFn('_runShinCardHTML_');
  ok('NEG: no flare-up claim survives on the card', card.indexOf('shin flare-up') < 0);
  ok('the thin-sample path says what it can and cannot read', /no record of how your leg feels/.test(card));
}

console.log('\n' + Y + '=== 5. the verdict leads, the list is evidence under it ===' + X);
{
  const card = exFn('_runShinCardHTML_');
  ok('the card computes a verdict', /_runDriftVerdict_\(w\)/.test(card));
  ok('the verdict head is rendered before the rows', card.indexOf('v.head') < card.indexOf('w.rows.map'));
  ok('the count is still shown, under the reading', /w\.drifted\+' of the last '\+w\.sample/.test(card));
  ok('each row carries the HRV for that day, so the claim is checkable line by line', /_runHrvOn_\(r\.date\)/.test(card));
  ok('a below-baseline day is marked on its own row', /lowMark/.test(card));
  ok('NEG: verdict text is escaped, never interpolated raw', /_runEsc_\(v\.head\)/.test(card));
}

console.log('\n' + Y + '=== 6. the page cleanup ===' + X);
{
  const rn = exFn('renderRunInto_');
  // The per-run GPS map, and the button whose only job was to feed it.
  ok('no Leaflet mini-map is built on the run page', rn.indexOf('buildRouteMap') < 0);
  // Anchored on the button being BUILT, not on the phrase: the comment that records the removal
  // names the button, and a bare phrase search finds that and reports a regression that is not one.
  ok('NEG: and the Load GPS Map button went with it', !/loadMapBtn/.test(src));
  ok('NEG: ...and nothing on this page still fetches GPS for it', !/fetchStravaGPS/.test(rn));
  ok('the removal is explained where it happened', /NO MAP HERE, BY DECISION/.test(rn));

  // The Running Growth chart: off THIS page, still alive where it belongs.
  // The CALL, not the name - the comment recording the move names _rgSection_ too.
  ok('the growth chart is not mounted on the run page', !/_rgSection_\(\)/.test(rn));
  ok('NEG: and no orphan defer variable is left behind', rn.indexOf('_rgDefer') < 0);
  ok('_rgSection_ itself still exists', src.indexOf('function _rgSection_(') > 0);
  ok('...and still mounts inside You vs. You', /_rgSection_==='function'\)\?_rgSection_\(\)/.test(src));

  // The stat strip: condensed, but not by dropping a figure.
  ['Miles YTD','This month','YTD runs','Streak','Longest run','Best pace','Avg pace','Elev YTD']
    .forEach(l => ok('still shows ' + l, rn.indexOf("'" + l + "'") > 0));
  ok('one shared row builder, not two copies', (rn.match(/var statRow=function/g) || []).length === 1);
  // Scoped to the stat strip. The per-run detail card has its own legitimate 4-column grid further
  // down, and a file-wide search for the rule finds that instead and fails on innocent code.
  {
    const strip = rn.slice(rn.indexOf('var statRow='), rn.indexOf('// Zone pills'));
    ok('NEG: the old boxed grid is gone from the stat strip', strip.indexOf('grid-template-columns') < 0);
    ok('NEG: ...and so is the three-line tile with its own panel', strip.indexOf('border-radius:10px;padding:8px 4px') < 0);
    ok('the strip is one panel with hairline dividers', /border-left:1px solid var\(--b1\)/.test(strip));
  }
  ok('it wraps rather than scrolling sideways', /flex-wrap:wrap/.test(rn.slice(rn.indexOf('var statRow='), rn.indexOf('var statRow=') + 600)));
  // The floor is SIZED FROM THE 390px BUDGET, not picked: 358px after page margins, 352px inside
  // the panel padding, four cells -> 88px each, and each cell spends 10px of that on its own
  // padding. 62 is the floor that lets four fit on one row; the first attempt used 82 and wrapped
  // to two, making the strip taller than the boxed grid it replaced. The exact number is asserted
  // because raising it silently reintroduces the wrap.
  ok('the cell floor still fits four across at 390px', /min-width:62px/.test(rn));
  ok('...and the basis leaves room to grow into the space that is there', /flex:1 1 70px/.test(rn));

  // "Not yet" must not yank the page.
  ok('dismiss goes through the scroll-preserving helper', /_runRemoveKeepScroll_\(raCard\)/.test(rn));
  ok('NEG: the bare remove() is gone', rn.indexOf('raCard.remove()') < 0);
  const rm = exFn('_runRemoveKeepScroll_');
  ok('it measures the height about to disappear', /offsetHeight/.test(rm));
  ok('...margins included', /marginTop/.test(rm) && /marginBottom/.test(rm));
  ok('...and takes it back off scrollTop', /scrollTop=Math\.max\(0, before-h\)/.test(rm));
  ok('only when the card was above the fold', /if\(above && before>0\)/.test(rm));
  const sp = exFn('_runScrollParent_');
  ok('the scroller is found by walking up, not hardcoded', /overflowY/.test(sp) && /parentElement/.test(sp));
  ok('NEG: neither surface is named in the lookup', sp.indexOf('RUN-SCREEN') < 0 && sp.indexOf('aiq-vscroll') < 0);
  ok('the element is still removed even if the maths throws', /catch\(e\)\{ try\{ el && el\.remove\(\)/.test(rm));
}

console.log('');
console.log(fails ? (R + fails + ' FAILED' + X) : (G + 'all assertions passed' + X));
process.exit(fails ? 1 : 0);
