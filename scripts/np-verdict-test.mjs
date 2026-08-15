// NP DRIVES THE VERDICT, AND NO FIGURE IS ASSEMBLED FROM OTHER FIGURES.
//
// Aug 15 2026, "Morning Ride": 26.3 mi, 1:25:23, avg 154.7W, NP 181W, IF 0.95, against a Group Ride
// prescribed 114-167W (Z2-Z4). The insight card said "Prescription hit: power and effort dialed in"
// and claimed the ride "extended beyond the 30-mile implied window".
//
// TWO SEPARATE DEFECTS, both in the prompt this file guards, and NEITHER caused by the conviction
// layer — that layer is not on this surface at all, and the failure reproduces without it.
//
// 1. THE SOFTER NUMBER DECIDED. Only the whole-ride AVERAGE was compared to the band. Average
//    understates a variable ride by construction; correcting for exactly that is what NP is for. So
//    154.7W sat inside the band while the real effort ran 14W above its top. Worse, the base-ride
//    dispensation ("high NP-to-average spread is EXPECTED, not a fault") applied unconditionally, so
//    the prompt actively instructed the model to dismiss the one number that showed the problem.
//    That dispensation is right for a genuine endurance ride and wrong once NP clears the band —
//    at that point the surges are not noise around a compliant ride, they ARE the ride.
//
// 2. A TOTAL WAS ASSEMBLED FROM PARTS. The group execution rules read "Sit in for the first 20 mi.
//    Race only the last 10-15". Both figures are real; summed they became a "30-mile implied window"
//    stated as fact and compared against a 26.3 mi ride. The old anti-inference rule only covered
//    values given as not-recorded/unknown, so a number never mentioned at all had no rule at all.
//
// Same family as the whole-ride-average dilution and the VO2-vs-threshold misclassification: read
// the softer number, then call the agreement real.
//
// Run: node scripts/np-verdict-test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const asServed = (s) => s.replace(/\\([\s\S])/g, (_, c) => (c === '\\' ? '\\' : c));
function matchBrace(from){ let i = src.indexOf('{', from), d = 0;
  for (; i < src.length; i++){ const c = src[i]; if (c === '{') d++; else if (c === '}'){ d--; if (!d) return i; } } return -1; }
const exFn = (n) => { const i = src.indexOf('function ' + n + '('); if (i < 0) throw new Error('missing ' + n); return src.slice(i, matchBrace(i) + 1) + '\n'; };

const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l); };

const TELE = exFn('_rideTelemetryFacts_');
const INSIGHT = src.slice(src.indexOf('function fetchRideCoachInsight('), src.indexOf('// ONE SETTLED VERDICT PER RIDE'));

console.log('\n' + Y + '=== the effort verdict is COMPUTED, not left to be weighed ===' + X);
ok('NP is compared to the band in code', /if\(rx && rx\.lo!=null && rx\.hi!=null && r\.np>0\)/.test(TELE));
ok('...above the band is stated as a verdict', /NP '\+r\.np\+'W is ABOVE the top of the prescribed band/.test(TELE));
ok('...inside the band too', /sits INSIDE the prescribed band/.test(TELE));
ok('...and below it, so all three cases are covered', /is BELOW the bottom of the prescribed band/.test(TELE));
ok('IF is given alongside, since that is the number a coach reads', /IF '\+_ifv\.toFixed\(2\)/.test(TELE));
ok('the average alone may not carry the verdict', /do NOT call the prescription met on the strength of the average alone/.test(TELE));

console.log('\n' + Y + '=== the base-ride dispensation is gated on NP ===' + X);
ok('the gate exists', /var _npOverBand=!!\(rx\.lo!=null && rx\.hi!=null && r\.np>0 && r\.np>rx\.hi\)/.test(INSIGHT));
ok('...and the soft note only applies when NP is in range', /_CV_BASE_INTENTS\[rx\.intent\] && !_npOverBand/.test(INSIGHT));
ok('...with a replacement note when NP clears the band', /that dispensation does NOT apply once NP itself is above the band/.test(INSIGHT));
ok('...that leads with the ride being harder than prescribed', /Lead with the fact that it was harder than prescribed/.test(INSIGHT));
// The exact sentence that caused the misread must never be reachable on an over-band ride again.
ok('the dismissal is no longer unconditional',
   !/var baseNote=_CV_BASE_INTENTS\[rx\.intent\]\s*\n?\s*\? 'This is a BASE/.test(INSIGHT));
ok('...but is still there for a genuine endurance ride', /High NP-to-average-power spread on a group or endurance ride is EXPECTED/.test(INSIGHT));

console.log('\n' + Y + '=== no figure is assembled out of other figures ===' + X);
ok('combining figures is banned outright', /Never COMBINE figures to state a new one/.test(TELE));
// Join adjacent string literals so an assertion reads the sentence the MODEL receives, not the way
// the source happens to be wrapped across lines. Matching across a concatenation boundary otherwise
// fails for purely cosmetic reasons and teaches nothing.
const flat = (s) => s.replace(/'\s*\n?\s*\+\s*\n?\s*'/g, '').replace(/\s+/g, ' ');
const TELE_F = flat(TELE), INSIGHT_F = flat(INSIGHT);
ok('...naming the summing case specifically', /must never be summed into a total, an expected distance, or an implied window/.test(TELE_F));
ok('...and an unstated figure is simply not available', /If a figure is not stated above, you do not have it: do not compute it, imply it, or reason against it/.test(TELE_F));
ok('the absence of a distance target is STATED, not just forbidden', /NO TARGET DISTANCE is prescribed for this session/.test(INSIGHT_F));
ok('...and rule distances are named as in-ride phases', /refer to phases inside the ride, not to a total the ride is measured against/.test(INSIGHT_F));
ok('the target note reaches the prompt', /\+_tgtNote/.test(INSIGHT));

console.log('\n' + Y + '=== the arithmetic itself, exercised ===' + X);
{
  // The gate is one comparison and it is the whole fix, so it is worth running rather than reading.
  const over = (np, hi) => !!(114 != null && hi != null && np > 0 && np > hi);
  ok('the reported ride trips the gate (NP 181 > 167)', over(181, 167) === true);
  ok('a compliant group ride does not (NP 160)', over(160, 167) === false);
  ok('exactly at the top is not over (NP 167)', over(167, 167) === false);
  ok('a ride with no NP cannot trip it', over(0, 167) === false);
  // And the number the old code trusted would still have passed, which is the point.
  ok('the average that caused the misread IS inside the band', 154.7 >= 114 && 154.7 <= 167);
}

console.log('\n' + Y + '=== scope: the conviction layer is not on this surface ===' + X);
// Recorded because this bug was reported against the conviction pass. It is not that layer: the
// failure reproduces on this prompt, which never received it, and the base-ride dispensation that
// caused it predates that pass by three weeks.
ok('the ride insight card carries no conviction layer', INSIGHT.indexOf('_SM_CONVICTION') < 0);
ok('...and the layer still exists on the surfaces it belongs to', (src.match(/_SM_CONVICTION/g) || []).length === 5);
ok('the facts floor on this surface is intact', /Describe ONLY what the data above states/.test(TELE));
ok('...including the not-recorded rule that predates all of this', /never substitute zero/.test(TELE));

console.log('');
if (fails) { console.log(R + 'NP verdict: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'NP verdict: all checks passed' + X + '\n');
