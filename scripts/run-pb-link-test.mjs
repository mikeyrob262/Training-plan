// Personal Bests / 10k Race Pace -> the run that set it.
//
// Three things can go wrong here and only one of them is visible by looking at the page:
//
//   DEAD CLICKS. A career best from 2015 is exactly the row whose run is most likely to be gone
//   from the library. A row must link only when its run actually resolves, and stay plain text
//   otherwise - a click that opens nothing is worse than no link.
//
//   THE POSITION-0 TRAP. _runRefFor_ returns a handle STRING, a POSITION, or ''. Position 0 is a
//   perfectly good reference and is falsy, so any truthiness test silently refuses to link the
//   first ride in the library. Everything here tests through rideRefOk_, and this pins that.
//
//   ATTRIBUTE QUOTING. The onclick is built into a double-quoted attribute. A handle like
//   k:2026-04-01_0_3639 must arrive single-quoted or it parses as an identifier and throws
//   ReferenceError on click - silently, since nothing catches it. A position must arrive bare.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
const exBlock = (n) => { const i = src.indexOf('var ' + n + '='); const j = src.indexOf('\n];', i); return src.slice(i, j + 3) + '\n'; };

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };

// st.rides is the library. Two runs are IN it; the 2015 one deliberately is not.
// Durations carried here because the board now RANKS this array - a library record without a
// movingSecs cannot win a timed event, and real records have one.
const st = {
  rides: [
    { stravaId: 900, date: '2026-03-01', distance: 6.2, sportType: 'Run', movingSecs: 2900 },   // position 0 ON PURPOSE
    { stravaId: 901, date: '2023-05-05', distance: 6.2, sportType: 'Run', movingSecs: 2850 },
    { stravaId: 902, date: '2026-07-07', distance: 4.0, sportType: 'Run', movingSecs: 1500, deleted: true }
  ]
};
// getRuns() PROJECTIONS - deliberately not the same objects as st.rides, which is the whole reason
// _runRefFor_ has to resolve rather than indexOf.
const RUNS = [
  { date: '2026-03-01', distance: 6.2, movingSecs: 2900, stravaId: 900 },   // this year 10k, in library
  { date: '2023-05-05', distance: 6.2, movingSecs: 2850, stravaId: 901 },   // best since 60, in library
  { date: '2015-04-04', distance: 6.2, movingSecs: 2472, stravaId: 555 }    // career best, NOT in library
];

let DESK = false, opened = null;
const M = new Function(
  'st', 'getRuns', '_covFor_', '_durSec_', 'normDate', 'isDesktop',
  'openRideDetail', 'openDesktopRideDetail', 'document', 'window', '_runAll_', '_runCard_', 'getTodayKey', 'rideSport_',
  asServed(
    exFn('rideKey') + exFn('rideHandle_') + exFn('rideRefOk_') + exFn('rideRefData_') + exFn('rideRefAttr_') +
    'var STORE_V2_HANDLES=true;\n' +
    'function rideResolveIdx_(ref){ if(typeof ref==="number") return ref;\n' +
    '  for(var i=0;i<st.rides.length;i++){ if(rideHandle_(st.rides[i])===String(ref)) return i; } return -1; }\n' +
    exVar('_PR_BAND_START') + exVar('_PR_BAND_LABEL') + exBlock('_PR_EVENTS') +
    exFn('_prFmtTime_') + exFn('_prFmtGap_') + exFn('_runRefFor_') + exFn('_runOpenRef_') +
    // The board now ranks the LIVE LIBRARY (_prLiveRuns_) rather than the snapshot getRuns() serves,
    // so every row links by construction. _prSnapshotOnly_ prices what that trade costs and is pulled
    // in from real source too, so it cannot silently stop reporting.
    exFn('_prLiveRuns_') + exFn('_prSnapshotOnly_') + exFn('_pbRefWhy_') +
    // The board renders as a one-at-a-time horizontal rail now, so its builder has to be in the
    // bundle. Pulled from real source rather than stubbed - a stub would let the rail stop emitting
    // the link markup without this test noticing, which is the one thing it exists to watch.
    'var _RN_GAP=10;' + exFn('_runRail_') +
    exFn('_prCompute_') + exFn('_prSection_') +
    exVar('RUN_RACE') + exFn('_runPaceStr_') + exFn('_runCurrentPace_') +
    exFn('_run10kPlan_') + exFn('_run10kCardHTML_') +
    'return { _runRefFor_, _runOpenRef_, _prCompute_, _prSection_, _run10kPlan_, _run10kCardHTML_, rideRefAttr_, rideRefOk_, _prLiveRuns_, _prSnapshotOnly_ };'
  ))(
  st, () => RUNS.slice(), () => ({ rankable: 147 }), (r) => +r.movingSecs || 0,
  (d) => String(d).slice(0, 10), () => DESK,
  (i) => { opened = { surface: 'mobile', ref: i }; },
  (i) => { opened = { surface: 'desktop', ref: i }; },
  { getElementById: () => null }, {}, () => RUNS.slice(),
  (t, s, b) => '<card t="' + t + '">' + b + '</card>', () => '2026-08-13', (r) => (r && (r.sportType || r.type)) || '');

console.log('\n' + Y + '=== a stat resolves back to the run that set it ===' + X);
{
  ok('a run in the library resolves', M.rideRefOk_(M._runRefFor_(RUNS[0])));
  ok('...and a run that is NOT in the library does not', !M.rideRefOk_(M._runRefFor_(RUNS[2])));
  ok('a deleted record is not a resolution target',
     !M.rideRefOk_(M._runRefFor_({ stravaId: 902, date: '2026-07-07', distance: 4 })));
  // REWRITTEN 2026-08-19, because it was passing vacuously. This sandbox did not supply rideSport_,
  // so tier 3's run filter rejected every candidate and NOTHING could content-match - the assertion
  // held for a reason that had nothing to do with stravaId. With the accessor supplied, tier 3 does
  // what a437771 added it for: resolve a projection carrying no stravaId (0 of 2,201 snapshot runs
  // carry one) by unique date+distance. "Refused, not guessed" is still the rule - but the guess it
  // forbids is an AMBIGUOUS match, not a content match per se.
  ok('a no-stravaId projection resolves by unique content match, which is tier 3\'s whole purpose',
     M.rideRefOk_(M._runRefFor_({ date: '2026-03-01', distance: 6.2 })));
  ok('...to the right record', M._runRefFor_({ date: '2026-03-01', distance: 6.2 }) === 0);
  ok('...but a date with no library run is still refused',
     !M.rideRefOk_(M._runRefFor_({ date: '2015-04-04', distance: 6.2 })));
  ok('...and a distance outside tolerance on a matching date is refused',
     !M.rideRefOk_(M._runRefFor_({ date: '2026-03-01', distance: 9.9 })));
  // stravaId is a string on some records and a number on others - the scan String()-coerces both.
  ok('a string stravaId still matches a numeric one',
     M.rideRefOk_(M._runRefFor_({ stravaId: '900', date: '2026-03-01', distance: 6.2 })));
}

console.log('\n' + Y + '=== position 0 is a REFERENCE, not a falsy value ===' + X);
{
  const ref = M._runRefFor_(RUNS[0]);
  ok('the first ride in the library resolves to something usable', M.rideRefOk_(ref));
  ok('...and rideRefOk_ accepts a bare 0', M.rideRefOk_(0));
  ok('...where plain truthiness would have refused it', !0 === true);
  ok('...so its row is actually rendered as a link', /_runOpenRef_\(/.test(M._prSection_()));
}

console.log('\n' + Y + '=== the onclick survives the attribute it is written into ===' + X);
{
  ok('a position goes in bare', M.rideRefAttr_(3) === '3');
  ok('a handle goes in single-quoted', M.rideRefAttr_('s900') === "'s900'");
  const html = M._prSection_();
  ok('no onclick was emitted with an unquoted handle',
     !/_runOpenRef_\((?!'|[0-9-])/.test(html));
  ok('...and every onclick closes its own paren', (html.match(/_runOpenRef_\(/g) || []).length === (html.match(/_runOpenRef_\([^)]*\)/g) || []).length);
}

console.log('\n' + Y + '=== OPTION B: the board ranks the LIVE LIBRARY, so every row links ===' + X);
{
  // Deliberate product change, 2026-08-19, replacing the previous contract on this section.
  // The board used to rank the store_v2 snapshot, where 0 of 2,201 runs carry a stravaId - so a
  // snapshot-only best could be RANKED but never RESOLVED, and rendered as plain text that no
  // amount of tombstone recovery could ever fix, because those runs were never Strava's to restore.
  // Ranking st.rides makes every row linkable BY CONSTRUCTION: pool and link target are now the same
  // dataset, so the failure cannot recur. The 2015 career best is exactly the accepted cost -
  // present in the projection, absent from the library.
  const board = M._prCompute_();
  const row = board.rows.filter((r) => r.ev.id === '10k')[0];
  ok('the 10k event still has a row', !!row);
  ok('the 2015 snapshot-only best is NO LONGER shown', !!row && row.career.date.slice(0, 4) !== '2015');
  ok('...the career best is now the fastest run in the LIBRARY', !!row && row.career.date === '2023-05-05');
  ok('EVERY picked entry carries a usable reference',
     board.rows.every((r) => ['career', 'band', 'season'].every((k) => !r[k] || M.rideRefOk_(r[k].ref))));
  ok('a deleted library record is still never ranked',
     board.rows.every((r) => ['career', 'band', 'season'].every((k) => !r[k] || r[k].date !== '2026-07-07')));
  const html = M._prSection_();
  ok('the board renders links', /_runOpenRef_\(/.test(html));
  ok('...and no row falls back to the not-linked tooltip', !/Not linked:/.test(html));
}

console.log('\n' + Y + '=== the trade is DISCLOSED, not silent ===' + X);
{
  // A best that vanishes with no explanation is worse than one shown as plain text. _prSnapshotOnly_
  // prices the trade on every render - computed, never remembered, so it cannot go stale the way a
  // one-off count taken today would the moment the library changes.
  const lost = M._prSnapshotOnly_();
  const tenk = lost.filter((x) => /10K/i.test(x.name))[0];
  ok('the dropped 2015 10k is reported', !!tenk);
  ok('...naming its date', !!tenk && tenk.date === '2015-04-04');
  ok('...and its actual figure, not a vague note', !!tenk && /\d+:\d\d/.test(tenk.val));
  ok('the board prints it under "Not shown"', /Not shown/.test(M._prSection_()));
  ok('...and says why there is nothing to open', /no run to open/.test(M._prSection_()));
  // Silence has to mean "cost nothing", so a best the library DOES hold is never listed as lost.
  ok('a best present in the library is not reported as dropped',
     !lost.some((x) => x.date === '2023-05-05' || x.date === '2026-03-01'));
}

console.log('\n' + Y + '=== current form links, and says what it opens ===' + X);
{
  const pl = M._run10kPlan_();
  ok('current form resolved a reference', M.rideRefOk_(pl.current.ref));
  // _runAll_ is newest-first, so the most recent qualifying run is the one opened.
  ok('...to the MOST RECENT of the runs averaged', M.rideRefOk_(pl.current.ref) &&
     st.rides[typeof pl.current.ref === 'number' ? pl.current.ref : 0].stravaId === 900);
  const html = M._run10kCardHTML_();
  ok('the row is clickable', /_runOpenRef_\(/.test(html));
  ok('...and says the number is an average', /average of your last \d+ runs/.test(html));
  // The WORDING was shortened to fit a 682px viewport ("opens the most recent of the 6" -> "opens
  // the newest"). The PROPERTY is what this pins and it is unchanged: the row must still say that
  // the click opens one of the averaged runs, so it cannot be read as opening the run that set the
  // number - there is no such run, because the number is an average.
  ok('...and says the click opens ONE of them, not the source of the number',
     /opens the (most recent of the \d+|newest)/.test(html));
}

console.log('\n' + Y + '=== one opener, correct on both surfaces ===' + X);
{
  DESK = false; opened = null; M._runOpenRef_(1);
  ok('mobile opens the overlay', opened && opened.surface === 'mobile' && opened.ref === 1);
  DESK = true; opened = null; M._runOpenRef_('s901');
  ok('desktop opens the panel', opened && opened.surface === 'desktop' && opened.ref === 's901');
  DESK = false; opened = null; M._runOpenRef_('');
  ok('an unresolvable reference opens nothing at all', opened === null);
  opened = null; M._runOpenRef_(-1);
  ok('...as does a -1', opened === null);
}

console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'run PB links: all checks passed' + X));
process.exit(fails ? 1 : 0);
