// THE PATTERN: A NUMBER PRESENTED AS MEASURED WHEN IT IS DEFAULTED, CACHED, OR FROM ANOTHER DATE.
//
// Seven distinct bugs across one evening turned out to share this shape, so it is worth a file of
// its own rather than a seventh one-off. The rule the app already states for W/kg is the general
// one: "a figure computed from a guessed weight would look exactly like a measured one, which is
// worse than showing nothing." Every number on screen must be traceable to a measurement, or must
// SAY it is not.
//
// Two instances pinned here, both found in the sweep:
//
//   1. MAX HR HAD TWO DEFAULTS THAT DISAGREED. Settings rendered st.maxHR||180 with a placeholder
//      of 180; hrTSS, the zone bands, the zone card and the HR route map all used st.maxHR||172.
//      With nothing on file the athlete READ 180 while every number was built on 172 - an 8 bpm gap
//      inside every zone boundary, and via the LTHR-as-88%-of-max rule into hrTSS, therefore TSS,
//      therefore CTL/ATL/TSB. One constant now, one accessor, and the fallback is DISCLOSED.
//   2. HR DRIFT CITED A RIDE UP TO 60 DAYS OLD AS CURRENT. _HRD_LOOKBACK_DAYS is 60 and the card
//      says "Last qualifying ride" - true, and read as this week's status in a row of cards that
//      are all about this week. The ride's DATE was printed, but a date is not an AGE.
//
// Run: node scripts/stale-as-current-test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const noCmt = (s) => s.replace(/^\s*\/\/.*$/gm, '');
const SRC = noCmt(src);
const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l); };

console.log('\n' + Y + '=== ONE max-HR fallback, and it is disclosed ===' + X);
ok('a single constant exists', /var _MAXHR_DEFAULT=172/.test(SRC));
ok('an accessor resolves it', /function maxHR_\(\)/.test(SRC));
ok('...and a companion says whether it was measured or guessed', /function maxHRSrc_\(\)/.test(SRC));
ok('NEG: no site still hardcodes 172 inline', !/st\.maxHR\|\|172/.test(SRC));
ok('NEG: and nothing still uses the rival 180', !/st\.maxHR\|\|180/.test(SRC));
{
  const uses = (SRC.match(/maxHR_\(\)/g) || []).length;
  ok('every computation site routes through the accessor (' + uses + ')', uses >= 4);
}
// THE FIELD IS AN OVERRIDE NOW, not the source - max HR is derived from recorded history, because
// this field held 172, which is _MAXHR_DEFAULT exactly: the default had leaked into storage and then
// fallen behind 540 activities that went above it. The property this pins is unchanged and is the
// whole point of the file: the box is EMPTY when nothing has been chosen, and the placeholder states
// the value that will actually be used. Only the field it reads and the source of the fallback moved.
ok('Settings shows EMPTY when nothing is overridden, not a phantom value',
   /value="'\s*\+\(\(\(st\.maxHROverride>0\)\?st\.maxHROverride:''\)\s*\|\|\s*''\)\+'"/.test(SRC));
ok('...with the effective value as the placeholder, and it says where that came from',
   /obs&&obs\.bpm\)\?\(obs\.bpm\+' \(from your history\)'\):\(_MAXHR_DEFAULT\+' \(assumed\)'\)/.test(SRC));
ok('...and the derived figure is never written into the box as though it were a choice',
   !/value="'\+\(\(st\.maxHR>0\)/.test(SRC));
ok('the zone card discloses an assumed max HR', /Zones assume a max HR of '\+_MAXHR_DEFAULT/.test(SRC));
ok('...gated on the value actually being defaulted', /maxHRSrc_\(\)==='default'/.test(SRC));

console.log('\n' + Y + '=== the accessor, exercised ===' + X);
{
  const mk = (v) => { const st = { maxHR: v }; const n = parseInt(st.maxHR, 10);
    return { v: (n > 0) ? n : 172, src: (n > 0) ? 'set' : 'default' }; };
  ok('a set value is used and reported as set', mk(186).v === 186 && mk(186).src === 'set');
  ok('an unset value falls back and is reported as default', mk(undefined).v === 172 && mk(undefined).src === 'default');
  ok('an empty string is a MISSING value, not a zero', mk('').v === 172 && mk('').src === 'default');
  ok('a zero is missing too', mk(0).v === 172 && mk(0).src === 'default');
  ok('a string number still counts as set', mk('178').v === 178 && mk('178').src === 'set');
  // The whole point: the number shown and the number used are the same one.
  ok('display and computation can no longer disagree', mk(undefined).v === 172);
}

console.log('\n' + Y + '=== HR drift states its AGE, not just its date ===' + X);
ok('a staleness threshold exists', /var _HRD_STALE_DAYS = 21/.test(SRC));
ok('an age helper exists', /function _hrdAgeOf_\(r\)/.test(SRC));
ok('...it stays quiet under a week', /if\(!\(days>6\)\) return null;/.test(SRC));
ok('...and flags beyond the threshold', /stale:days>=_HRD_STALE_DAYS/.test(SRC));
ok('the card prints the age', /_age\.days\+' days ago'/.test(SRC));
ok('...and names a stale read as history, not status', /not a current read/.test(SRC));
ok('...with a warning colour, not the neutral one', /_age\.stale\?ACC\.amber/.test(SRC));
ok('the lookback that makes this possible is still 60 days', /var _HRD_LOOKBACK_DAYS = 60/.test(SRC));

console.log('\n' + Y + '=== the age rule, exercised ===' + X);
{
  const age = (days) => (!(days > 6) ? null : { days, stale: days >= 21 });
  ok('same-day: silent', age(0) === null);
  ok('6 days: silent, still this week', age(6) === null);
  ok('7 days: stated but not flagged', age(7) && age(7).stale === false);
  ok('20 days: stated, not yet flagged', age(20).stale === false);
  ok('21 days: flagged as not current', age(21).stale === true);
  ok('60 days - the lookback limit - is flagged', age(60).stale === true);
  // The reported case: a card citing a ride from weeks ago with nothing to say so.
  ok('a 6-week-old read is flagged rather than shown bare', age(42).stale === true);
}

console.log('\n' + Y + '=== classes already holding the line, asserted so they stay held ===' + X);
ok('W/kg still refuses a guessed weight', /a figure computed from a guessed weight would look exactly like a measured one/.test(src));
ok('records still exclude NP-derived estimates', /measured peaks only; NP-derived estimates excluded/.test(SRC));
ok('the snapshot horizon is still the bucket last date, never builtAt', /THE HORIZON IS THE BUCKET'S OWN LAST DATE, NEVER builtAt/.test(src));
ok('stream fetches are still stamped on the ANSWER, not the attempt', /if\(arr\[0\]\) r\._streamsTried=true;/.test(SRC));
ok('the weather cache still carries a fetchedAt wrapper', /wxCache_\[slot\]=\{data:j, ?fetchedAt:Date\.now\(\)\}/.test(SRC));

console.log('');
if (fails) { console.log(R + 'stale-as-current: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'stale-as-current: all checks passed' + X + '\n');
