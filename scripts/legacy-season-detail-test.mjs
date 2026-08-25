// A SEASON CARD OPENS THE SEASON, AND WHAT IT OPENS CANNOT DISAGREE WITH THE CARD.
//
// The season detail is not a lookup - it re-reads the SAME row array _lgByYear_ aggregated. That is
// the whole reason activity-level drill-down is possible here and was not on the Athletic Life
// month strip. This test holds that property, and the four traps that could quietly break it:
//
//   1 THE COERCION TRAP, already documented on _lgByYear_. Cycling rows come from _msCycling_ and
//     carry .mi with NO .distance; runs carry .distance. `+r.distance != null` coerces BEFORE the
//     null test, NaN != null is true, and every cycling season silently read 0 miles. The detail
//     view has its own accessor and must not re-introduce it.
//   2 THE FORMATTED-DURATION TRAP. A cycling record's .duration is the STRING "1:11:16". Read as a
//     number by digit-stripping it becomes 11116 - the same species of bug that once inflated a
//     calorie target to 34,356.
//   3 THE FUTURE-MONTH TRAP. Padding an in-progress year to December prints real zeros for months
//     that have not happened, which reads as a collapse in form.
//   4 THE SILENT-LINK TRAP. A row that cannot open must render as PLAIN TEXT, not as a dead click.
//
// Every assertion carries a negative control: the broken behaviour is asserted ABSENT. Without it a
// harness that extracted nothing would report a clean pass.
//
// Run: node scripts/legacy-season-detail-test.mjs
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

// Extraction is itself a failure mode - prove each function came back whole.
const FNS = ['_lgEsc_','_lgSportCfg_','_lgRowMi_','_lgRowSec_','_lgRowsInYear_','_lgByYear_',
             '_lgMonthTable_','_lgActivityTable_','_lgRefFor_','_lgNum_','_lgCardUp_',
             'actSecs_','parseDurToMin','fmtHM_','_lgMonthlyPts_'];
let bundle = '';
for (const n of FNS) { const s = exFn(n); ok('extracted ' + n, s.indexOf('function ' + n) === 0 && s.trim().endsWith('}')); bundle += s; }

const MON = (src.match(/var _LG_MON=(\[[^\]]*\])/) || [])[1];
ok('_LG_MON literal found', !!MON);

// A fixed "today" so the in-progress-year rule is testable. Everything else is pure.
const NOW_Y = 2026, NOW_M0 = 7;   // August 2026
const harness = `
  var _LG_MON=${MON};
  var _LG_RUN_FROM=2016, _LG_RUN_TO=2024, _LG_CYC_FROM=2024;
  var __opened=[];
  // The real Date arrives as a PARAMETER. Capturing it locally with var Date_ = Date inside this
  // scope captures the hoisted shim instead, and the constructor recurses until the stack blows.
  // (No backticks in here either - this whole block is itself a template literal.)
  function Date(){ return new RealDate(${NOW_Y}, ${NOW_M0}, 15); }
  Date.now=RealDate.now;
  var st={ rides:[] };
  var _runRefFor_=function(r){ return (r && r.__ref!==undefined) ? r.__ref : ''; };
  var rideRefOk_=function(ref){ return (typeof ref==='number') ? (ref>=0) : !!ref; };
  var rideRefAttr_=function(ref){ return (typeof ref==='number') ? String(ref) : ("'"+String(ref).replace(/[^A-Za-z0-9:_.-]/g,'')+"'"); };
  var rideHandle_=function(r){ return r && r.__handle ? r.__handle : ''; };
  var rideResolveIdx_=function(h){ for(var i=0;i<st.rides.length;i++) if(st.rides[i].__handle===h) return i; return -1; };
  var actNameInfo_=function(r){ var n=String((r&&r.name)||''); return n ? {text:n,isFallback:false} : {text:'Ride',isFallback:true}; };
  var _durTextSec_=function(){ return 0; };
  var _gcSpark_=function(){ return '<svg></svg>'; };
  var lgOpenSeason_=function(sport,year){ __opened.push(sport+':'+year); };
  ${bundle}
  return { _lgEsc_:_lgEsc_, _lgSportCfg_:_lgSportCfg_, _lgRowMi_:_lgRowMi_, _lgRowSec_:_lgRowSec_,
           _lgRowsInYear_:_lgRowsInYear_, _lgByYear_:_lgByYear_, _lgMonthTable_:_lgMonthTable_,
           _lgActivityTable_:_lgActivityTable_, _lgRefFor_:_lgRefFor_, _lgCardUp_:_lgCardUp_,
           _lgMonthlyPts_:_lgMonthlyPts_, actSecs_:actSecs_, st:st, opened:function(){ return __opened; } };
`;
const F = new Function('RealDate', harness)(Date);

console.log('\n' + Y + '=== 1. the coercion trap: a cycling row carries .mi and no .distance ===' + X);
{
  const cyc = { date:'2025-06-01', mi:42.5, sec:5400 };
  const run = { date:'2019-06-01', distance:6.2, movingSecs:3300 };
  eq('cycling row reads .mi', F._lgRowMi_(cyc), 42.5);
  eq('running row reads .distance', F._lgRowMi_(run), 6.2);
  // NEGATIVE CONTROL: the coerce-then-test form is what silently zeroed every cycling season.
  const naive = (r) => ((+r.distance != null ? +r.distance : +r.mi) || 0);
  ok('NEG: the coerce-first form really does zero the cycling row', naive(cyc) === 0);
  ok('NEG: and _lgRowMi_ is not that form', F._lgRowMi_(cyc) !== naive(cyc));
  // A row carrying NEITHER must be 0, never NaN - NaN would poison every sum it touches.
  eq('a row with neither field is 0, not NaN', F._lgRowMi_({date:'2025-01-01'}), 0);
}

console.log('\n' + Y + '=== 2. the formatted-duration trap: "1:11:16" is 4276s, never 11116 ===' + X);
{
  eq('formatted cycling duration parses as time', F._lgRowSec_({ date:'2026-08-23', duration:'1:11:16' }), 4276);
  eq('movingSecs wins when present', F._lgRowSec_({ date:'2026-08-23', duration:'1:11:16', movingSecs:4000 }), 4000);
  eq('a precomputed .sec is taken as-is', F._lgRowSec_({ date:'2025-01-01', sec:900 }), 900);
  // NEGATIVE CONTROL: digit-stripping is the bug, and it must not be what ships.
  const stripped = +String('1:11:16').replace(/[^0-9]/g, '');
  eq('NEG: digit-stripping would give 11116', stripped, 11116);
  ok('NEG: _lgRowSec_ is not digit-stripping', F._lgRowSec_({ date:'x', duration:'1:11:16' }) !== stripped);
}

console.log('\n' + Y + '=== 3. the month table cannot disagree with the card ===' + X);
{
  // Two years of cycling rows. 2026 is the in-progress year under the pinned clock.
  const rows = [];
  const add = (d, mi, sec) => rows.push({ date:d, mi, sec });
  add('2025-01-10', 10, 3600); add('2025-01-20', 30, 7200);
  add('2025-03-05', 25, 5400);                                  // Feb 2025 deliberately EMPTY
  add('2025-11-02', 60, 12000);
  add('2026-02-14', 18, 3000); add('2026-05-09', 44, 8000);
  const cfg = F._lgSportCfg_('cyc');
  const seasons = F._lgByYear_(rows, 2024, null);
  const s25 = seasons.filter(s => s.year === 2025)[0];
  const t25 = F._lgMonthTable_(rows, 2025, cfg);

  const nums = (t) => (t.match(/<tfoot>[\s\S]*?<\/tfoot>/) || [''])[0].replace(/<[^>]+>/g, '|').split('|').filter(Boolean);
  const foot = nums(t25);
  ok('2025 footer carries the year', foot[0] === '2025');
  eq('footer activity count equals the card', foot[1], String(s25.n));
  eq('footer miles equal the card', foot[2], String(Math.round(s25.mi * 10) / 10));
  eq('footer hours equal the card', foot[3], String(Math.round(s25.sec / 3600 * 10) / 10));
  eq('footer longest equals the card', foot[4], (Math.round(s25.max * 10) / 10) + ' mi');

  const bodyRows = (t) => (t.match(/<tbody>([\s\S]*?)<\/tbody>/) || ['', ''])[1].match(/<tr>/g) || [];
  eq('a COMPLETE year prints all twelve months', bodyRows(t25).length, 12);
  ok('an elapsed empty month is a real row', /Feb<\/td><td class="lg-dim">&mdash;/.test(t25));

  const t26 = F._lgMonthTable_(rows, 2026, cfg);
  eq('the IN-PROGRESS year stops at the current month', bodyRows(t26).length, NOW_M0 + 1);
  ok('and says so', t26.indexOf('still running') > 0);
  // NEGATIVE CONTROL: December must not appear for a year that has not reached it.
  ok('NEG: no Dec row in the in-progress year', t26.indexOf('>Dec<') < 0);
  ok('NEG: no Sep row either', t26.indexOf('>Sep<') < 0);
  ok('the completed year DOES reach Dec', t25.indexOf('>Dec<') > 0);

  // The running table must not offer hours - the season card does not, and the two share cfg.
  const rcfg = F._lgSportCfg_('run');
  const rrows = [{ date:'2019-04-01', distance:6, movingSecs:3600 }];
  const rt = F._lgMonthTable_(rrows, 2019, rcfg);
  ok('NEG: no Hours column on a running month table', rt.indexOf('>Hours<') < 0);
  ok('cycling month table DOES have Hours', t25.indexOf('>Hours<') > 0);
}

console.log('\n' + Y + '=== 4. the activity list: whole season, and a link only when it resolves ===' + X);
{
  const cfg = F._lgSportCfg_('run');
  const list = [];
  for (let i = 1; i <= 37; i++) list.push({ date:'2019-06-' + (i<10?'0':'') + (i%28+1), distance:5, movingSecs:3000, name:'Run ' + i, avgHR:140 });
  list[0].__ref = 'k:2019-06-02_5_3000';                       // one resolvable
  list[1].__ref = 3;                                           // one resolvable by position
  const html = F._lgActivityTable_(list, cfg);
  eq('every activity is listed - nothing trimmed', (html.match(/<tr[ >]/g) || []).length, 37 + 1);  // +1 header
  eq('exactly the resolvable rows are clickable', (html.match(/class="lg-arow"/g) || []).length, 2);
  eq('and each of those carries an opener', (html.match(/_runOpenRef_\(/g) || []).length, 2);
  const plain = html.replace(/<[^>]+>/g, '');
  ok('the link rate is stated in words', /2 of 37 \(5%\) open in full/.test(plain));
  ok('and so is WHY the rest do not', /no record in the\s+live activity library/.test(plain.replace(/\s+/g, ' ')) || plain.indexOf('live activity library') > 0);
  // NEGATIVE CONTROL: an unresolvable row must be plain text, never a dead click.
  ok('NEG: unresolvable rows carry no onclick', (html.match(/onclick=/g) || []).length === 2);

  // Position 0 is a VALID reference. A truthiness test would silently drop it.
  const l0 = [{ date:'2019-06-01', distance:5, movingSecs:3000, name:'Zeroth', __ref:0 }];
  ok('ref 0 links (rideRefOk_, not truthiness)', F._lgActivityTable_(l0, cfg).indexOf('lg-arow') > 0);
  const lneg = [{ date:'2019-06-01', distance:5, movingSecs:3000, name:'Missing', __ref:-1 }];
  ok('NEG: ref -1 does not link', F._lgActivityTable_(lneg, cfg).indexOf('lg-arow') < 0);

  // Running shows no elevation. This page refuses to state run elevation anywhere.
  const withElev = [{ date:'2019-06-01', distance:5, movingSecs:3000, name:'Hilly', elev:940, avgHR:150 }];
  const rh = F._lgActivityTable_(withElev, cfg);
  ok('NEG: no elevation column on a running list', rh.indexOf('Ft climbed') < 0);
  ok('NEG: and the value is not printed either', rh.indexOf('940') < 0);
  ok('running shows pace and HR instead', rh.indexOf('>Pace<') > 0 && rh.indexOf('>Avg HR<') > 0);

  // Pace is derived from the two numbers in the same row, so it can never contradict them.
  ok('10:00/mi from 5 mi in 3000s', rh.indexOf('>10:00<') > 0);

  const ccfg = F._lgSportCfg_('cyc');
  const ch = F._lgActivityTable_([{ date:'2025-06-01', mi:20, sec:3600, name:'Ride', elev:1200 }], ccfg);
  ok('cycling DOES show ft climbed', ch.indexOf('Ft climbed') > 0 && ch.indexOf('1,200') > 0);
  ok('cycling shows avg mph', ch.indexOf('>Avg mph<') > 0 && ch.indexOf('>20<') > 0);
}

console.log('\n' + Y + '=== 5. names are escaped, and never read raw ===' + X);
{
  eq('angle brackets and quotes escape', F._lgEsc_('<b>"x"&\'y\'</b>'), '&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;');
  const cfg = F._lgSportCfg_('run');
  const html = F._lgActivityTable_([{ date:'2019-06-01', distance:5, movingSecs:3000, name:'<img src=x onerror=alert(1)>' }], cfg);
  ok('NEG: no raw tag survives into the list', html.indexOf('<img') < 0);
  ok('the escaped form is what renders', html.indexOf('&lt;img') > 0);
  // The standing rule: actName_ owns the fallback, the list never prints r.name itself.
  const anon = F._lgActivityTable_([{ date:'2019-06-01', distance:5, movingSecs:3000 }], cfg);
  ok('a nameless activity gets the accessor fallback, not a blank', anon.indexOf('Ride') > 0);
}

console.log('\n' + Y + '=== 6. a drag across the rail is not a click ===' + X);
{
  const src2 = exFn('_lgCardDown_') + exFn('_lgCardUp_');
  const G2 = new Function(`var __o=[]; var _lgDown=null; var lgOpenSeason_=function(s,y){ __o.push(s+':'+y); };
    ${src2} return { down:_lgCardDown_, up:_lgCardUp_, o:function(){return __o;} };`)();
  G2.down({ clientX:100, clientY:100 }); G2.up({ clientX:102, clientY:101 }, 'cyc', 2025);
  eq('a 2px wobble still opens', G2.o(), ['cyc:2025']);
  G2.down({ clientX:100, clientY:100 }); G2.up({ clientX:260, clientY:104 }, 'cyc', 2024);
  eq('NEG: a 160px drag does NOT open', G2.o(), ['cyc:2025']);
  // A keyboard activation arrives with no pointerdown at all and must still work.
  G2.up({ clientX:0, clientY:0 }, 'run', 2019);
  eq('a click with no preceding pointerdown opens', G2.o(), ['cyc:2025', 'run:2019']);
}

console.log('\n' + Y + '=== 7. the ride ref never resolves to a tombstone ===' + X);
{
  F.st.rides.length = 0;
  F.st.rides.push({ __handle:'s111', deleted:true, stravaId:111 });
  eq('NEG: a deleted-only handle does not resolve', F._lgRefFor_({ __handle:'s111' }, 'cyc'), '');
  F.st.rides.push({ __handle:'s222', deleted:false, stravaId:222 });
  eq('a live handle resolves', F._lgRefFor_({ __handle:'s222' }, 'cyc'), 's222');
  // stravaId fallback, String()-coerced on both sides (it is a string on some records, a number on others).
  eq('stravaId fallback finds the live record', F._lgRefFor_({ stravaId:'222' }, 'cyc'), 1);
  eq('NEG: stravaId fallback skips the tombstone', F._lgRefFor_({ stravaId:111 }, 'cyc'), '');
  // A ride must NOT be sent down the run-only content-match tier, which could match a run of the
  // same date and distance. Opening the wrong activity is worse than not linking.
  eq('NEG: an unmatchable ride returns no ref', F._lgRefFor_({ date:'2025-01-01', mi:20 }, 'cyc'), '');
}

console.log('\n' + Y + '=== 8. the cycling projection carries its identity ===' + X);
{
  // _msCycling_ used to emit six numbers and nothing else. That is fine for milestonesCompute_,
  // which wants aggregates - but the season list RENDERS these rows, and a row with no name shows
  // the "Ride - 18.9 mi" fallback while a row with no stravaId resolves to nothing. Measured
  // against the live library before the fix: 340 of 340 cycling activities unnamed and unclickable.
  const ms = exFn('_msCycling_');
  ok('the projection carries the name', /name:r\.name/.test(ms));
  ok('...the sport, so the name rule can resolve its own fallback', /sportType:\(r\.sportType\|\|r\.type\)/.test(ms));
  ok('...and the stravaId, so the row can open', /stravaId:r\.stravaId/.test(ms));
  // NEGATIVE CONTROL: the measurements it always carried must still be there - this is an addition,
  // not a reshaping, and milestonesCompute_ reads every one of them.
  ['d:d', 'mi:mi', 'sec:sec', 'mph:mph', 'elev:', 'date:'].forEach(f =>
    ok('NEG: still carries ' + f.replace(':', ''), ms.indexOf(f) > 0));
}

console.log('\n' + Y + '=== 9. rows in a season, newest first ===' + X);
{
  const rows = [{date:'2019-03-01'},{date:'2019-11-04'},{date:'2020-01-01'},{date:'2019-07-09'}];
  eq('year filter + desc sort', F._lgRowsInYear_(rows, 2019).map(r => r.date), ['2019-11-04','2019-07-09','2019-03-01']);
  eq('NEG: a year with nothing returns empty', F._lgRowsInYear_(rows, 2018), []);
}

console.log('');
console.log(fails ? (R + fails + ' FAILED' + X) : (G + 'all assertions passed' + X));
process.exit(fails ? 1 : 0);
