// A PB ROW LINKS TO THE RUN THAT SET IT, OR IT IS NOT A FEATURE.
//
// The Aug 13 linking commit (74c219d) DID deploy - _runOpenRef_ and _runRefFor_ were verified live on
// the served page - and not one link rendered anywhere: not the 5K/10K/Half/Longest Run board, not
// the 10K Race Pace card. One shared cause, because both surfaces gate identically on
// rideRefOk_(_runRefFor_(run)) and fall back to plain text when it fails.
//
// MEASURED ON THE LIVE LIBRARY: 0 of 2201 snapshot runs carry a stravaId. getRuns() serves the
// store_v2 snapshot once primed, so that is every run. Without an id, rideKey builds its CONTENT
// form 'k:<date>_<miles>_<secs>' while the matching st.rides record - which DOES have an id - keys as
// 's<id>'. The two sides key differently and can never resolve to each other. So the handle path
// failed structurally and the stravaId path had nothing to scan for, and every row fell back to
// plain text - the DESIGNED behaviour for an untrustworthy reference, and exactly why this read as
// "never shipped" rather than as a bug.
//
// rideKey is NOT touched: it is load-bearing for ride dedup and carries its own standing warning.
// The mismatch is fixed by adding a way to resolve, never by re-keying the library.
//
// Run: node scripts/run-ref-test.mjs
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
const eq = (l, g, w) => { const c = JSON.stringify(g) === JSON.stringify(w); if (!c) fails++;
  console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l + (c ? '' : '   got ' + JSON.stringify(g) + ', want ' + JSON.stringify(w))); };

// The REAL resolver, with the library it scans supplied as a fixture. The first two paths are
// stubbed to fail exactly as they do for a snapshot run, so this exercises the new third path.
function build(rides){
  const stub = {
    st: { rides },
    normDate: (d) => String(d || '').slice(0, 10),
    rideSport_: (r) => String((r && (r.sportType || r.type)) || ''),
    _durSec_: (r) => (r && (r.movingSecs || r.secs)) || 0,
    rideHandle_: () => '',
    rideResolveIdx_: () => -1
  };
  const names = Object.keys(stub);
  return new Function(...names, exFn('_runRefFor_') + 'return _runRefFor_;')(...names.map((n) => stub[n]));
}

const LIB = [
  { date:'2026-05-04', sportType:'Run',      distance:6.22,  movingSecs:2900, stravaId:111 },
  { date:'2026-05-04', sportType:'Run',      distance:3.11,  movingSecs:1500, stravaId:112 },
  { date:'2026-06-01', sportType:'Ride',     distance:6.20,  movingSecs:2900, stravaId:113 },
  { date:'2026-07-09', sportType:'Run',      distance:13.12, movingSecs:7000, stravaId:114, deleted:true },
  { date:'2026-08-02', sportType:'TrailRun', distance:5.00,  movingSecs:2600, stravaId:115 }
];

console.log('\n' + Y + '=== a snapshot run with no stravaId still resolves ===' + X);
{
  const f = build(LIB);
  // Exactly the shape the snapshot serves: date + distance + movingSecs, and NO stravaId.
  eq('the 10k best resolves to its library record', f({ date:'2026-05-04', distance:6.22, movingSecs:2900 }), 0);
  eq('the 5k on the SAME DAY resolves to the other one', f({ date:'2026-05-04', distance:3.11, movingSecs:1500 }), 1);
  eq('a trail run counts as a run', f({ date:'2026-08-02', distance:5.00, movingSecs:2600 }), 4);
  // Metres -> miles conversion means the same run can differ in the second decimal.
  eq('a small distance difference still matches', f({ date:'2026-05-04', distance:6.24, movingSecs:2900 }), 0);
}

console.log('\n' + Y + '=== and it refuses rather than guessing ===' + X);
{
  const f = build(LIB);
  eq('a RIDE of the same distance is never matched', f({ date:'2026-06-01', distance:6.20, movingSecs:2900 }), '');
  eq('a tombstoned run does not win a click', f({ date:'2026-07-09', distance:13.12, movingSecs:7000 }), '');
  eq('nothing on that date', f({ date:'2026-01-01', distance:6.22, movingSecs:2900 }), '');
  eq('a distance too far off', f({ date:'2026-05-04', distance:9.00, movingSecs:2900 }), '');
  eq('no distance to match on', f({ date:'2026-05-04' }), '');
  eq('no date to match on', f({ distance:6.22 }), '');
  eq('nothing at all', f(null), '');

  // AMBIGUITY: two runs, same day, same distance. Duration breaks the tie; without one, refuse -
  // opening the wrong run is worse than not linking, which is the callers' own rule.
  const AMB = [
    { date:'2026-09-01', sportType:'Run', distance:4.00, movingSecs:2000, stravaId:1 },
    { date:'2026-09-01', sportType:'Run', distance:4.00, movingSecs:2600, stravaId:2 }
  ];
  eq('duration breaks a same-day same-distance tie', build(AMB)({ date:'2026-09-01', distance:4.00, movingSecs:2590 }), 1);
  eq('...and with no duration it refuses rather than opening the wrong run',
     build(AMB)({ date:'2026-09-01', distance:4.00 }), '');
}

console.log('\n' + Y + '=== the existing paths are untouched ===' + X);
ok('the stravaId scan still runs, and still skips tombstones', /if\(x && !x\.deleted && String\(x\.stravaId\)===want\) return i;/.test(src));
ok('the handle path still runs before both', /var hi=rideResolveIdx_\(h\);/.test(src));
ok('NEG: rideKey is NOT modified', /if\(r\.stravaId\) return 's'\+r\.stravaId;/.test(src));
ok('...and still carries its content form', /return 'k:'\+normDate\(r\.date\|\|''\)/.test(src));
ok('both link surfaces still gate on rideRefOk_', (src.match(/rideRefOk_\(/g) || []).length >= 3);
// Position 0 is a valid reference: a truthiness test would silently drop the newest run.
ok('rideRefOk_ still accepts position 0', /function rideRefOk_\(ref\)\{ return \(typeof ref==='number'\) \? \(ref>=0\)/.test(src));

console.log('\n' + Y + '=== the SECOND resolver, on the Legacy pace curve, uses it too ===' + X);
{
  // Legacy needed no NEW linking - its pace-curve points already carried a click and an "Opens this
  // run" tooltip. None of them were reachable, through a DIFFERENT resolver: rideRefOf_ returns
  // rideKey's content form for a snapshot run while the library record keys by id, and its indexOf
  // fallback returns -1 because the snapshot object is not the library object. _recRefUsable_ then
  // rejected it and the clickable circle was never emitted at all - the same silent failure as the
  // PB board, reached a second way.
  ok('the pace curve resolves through _runRefFor_ first',
     /var rr=\(typeof _runRefFor_==='function'\)\?_runRefFor_\(best\.run\):'';/.test(src));
  ok('...falling back to rideRefOf_ for anything already in st.rides',
     /&& typeof rideRefOf_==='function'\) rr=rideRefOf_\(best\.run\);/.test(src));
  ok('...and still gated by _recRefUsable_, so a dead ref draws no circle',
     /ref=\(typeof _recRefUsable_==='function' && !_recRefUsable_\(rr\)\)\?null:rr;/.test(src));
  ok('the click target is still gated on a usable ref', /if\(b\.ref!=null && b\.run\)\{/.test(src));
  // Legacy is otherwise aggregates only - asserted so "add linking to Legacy" is not re-opened.
  ok('NEG: the Legacy tiles are lifetime aggregates, not activities', /\{ k:'Runs', v:_lgNum_/.test(src));
  ok('NEG: its seasons panel ranks YEARS, not activities', /Greatest Seasons/.test(src));
}

console.log('');
if (fails) { console.log(R + 'run ref: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'run ref: all checks passed' + X + '\n');
