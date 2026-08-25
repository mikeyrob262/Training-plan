// MAX HR IS READ FROM THE HISTORY, AND THE HISTORY CONTAINS LIES.
//
// The field held 172 - _MAXHR_DEFAULT exactly - so the number every heart-rate zone in this app is
// built from was one nobody had chosen, and it fell further behind every hard effort: 540 activities
// have gone at or above it.
//
// But "use the highest value ever recorded" is WRONG on this athlete's data, and that is the claim
// this file exists to keep true. The highest heart rate in the library is 251 bpm, from a run in
// November 2014, with 245, 241, 240, 238 and 230 behind it - every one a lone chest-strap reading
// from 2012-2014. Deriving the ceiling from those would put the Z2 top at 188 and make every run on
// the page read as recovery: worse than the stale 172, and just as silent.
//
// So three guards, and a test for each, plus the negative controls that prove they are not inert:
//   the CEILING removes an artefact,
//   the WINDOW removes an old max that is no longer this athlete's,
//   the STEP-DOWN removes a single uncorroborated reading inside the window.
//
// And one more claim, because it is the one that recurred: there must be exactly ONE max HR. This
// used to be two functions with two different fallbacks, 172 and 180, reading the same field.
//
// Run: node scripts/maxhr-derive-test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8').replace(/\r\n/g, '\n');
const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };
const eq = (l, got, want) => {
  const c = JSON.stringify(got) === JSON.stringify(want);
  if (!c) fails++;
  console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l +
    (c ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)));
};
function body(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return null;
  let d = 0;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (!d) return src.slice(i, j + 1); }
  }
  return null;
}
const constOf = n => {
  const m = src.match(new RegExp('var ' + n + '\\s*=\\s*(\\d+)'));
  return m ? parseInt(m[1], 10) : null;
};

// ---- build a sandbox with the real functions and a synthetic library --------------------------
const CONSTS = ['_MAXHR_DEFAULT', '_MAXHR_CEILING', '_MAXHR_WINDOW_M', '_MAXHR_WIDEN_M',
  '_MAXHR_MIN_N', '_MAXHR_SPIKE_GAP'].map(n => 'var ' + n + '=' + constOf(n) + ';').join('\n');

function makeEnv(rides, override, legacy) {
  const pre = CONSTS + '\nvar _mxObsCache=null;\n'
    + 'var st={ rides:' + JSON.stringify(rides) + ', maxHR:' + JSON.stringify(legacy ?? 0)
    + ', maxHROverride:' + JSON.stringify(override ?? 0) + ' };\n'
    + 'var getRuns=function(){ return []; };\n';
  const fns = [body('_maxHRRows_'), body('_maxHRPick_'), body('maxHRObserved_'),
               body('_maxHROverride_'), body('maxHR_'), body('maxHRSrc_')].join('\n');
  return new Function(pre + fns +
    '\nreturn { rows:_maxHRRows_, observed:maxHRObserved_, maxHR:maxHR_, src:maxHRSrc_, st:st };')();
}
// Dates relative to today, so the window test does not rot.
const day = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const recent = v => ({ date: day(30), maxHR: v });
const old = v => ({ date: day(365 * 4), maxHR: v });     // inside the widen window, outside the main one
const ancient = v => ({ date: day(365 * 11), maxHR: v }); // outside both

console.log('\n' + Y + '=== the ceiling refuses a strap artefact ===' + X);
{
  // The six real readings from this athlete's 2012-2014 library, dated recently so ONLY the ceiling
  // can save it. If the ceiling regressed, the derived max would be 251.
  const E = makeEnv([251, 245, 241, 240, 238, 230, 188, 186, 182, 179, 178].map(recent));
  eq('251, 245, 241, 240, 238 and 230 are not heart rates', E.rows().filter(r => r.v > 220).length, 0);
  eq('...so the ceiling comes from the plausible readings', E.observed().bpm, 188);
  ok('NEG: the plausible ones were NOT thrown out too', E.rows().length === 5);
  eq('and maxHR_ reports it', E.maxHR(), 188);
  eq('...as observed, not as a setting', E.src(), 'observed');
}

console.log('\n' + Y + '=== the window refuses a max that is no longer his ===' + X);
{
  // 206 is perfectly plausible and really happened - years ago. A max HR from back then is not an
  // answer to "what is my max HR", and this athlete's own decline is visible in his library: 240s in
  // 2012-14, 191-199 through 2016-2022, 188 in 2024, 186 in 2025, 177 so far in 2026.
  const E = makeEnv([old(206), old(205), old(204), old(202), old(201)]
    .concat([188, 186, 182, 179, 178].map(recent)));
  eq('the recent window wins over an older, higher, genuine reading', E.observed().bpm, 188);
  eq('...and reports how far back it looked', E.observed().months, constOf('_MAXHR_WINDOW_M'));
  // NEGATIVE CONTROL: with nothing recent, it must WIDEN rather than fall to the default.
  const O = makeEnv([old(206), old(205), old(204), old(202), old(201)]);
  eq('NEG: with no recent data it widens instead of giving up', O.observed().bpm, 206);
  ok('...and says it widened', O.observed().months === constOf('_MAXHR_WIDEN_M'));
  // Beyond even the widened window it stops rather than dressing an eleven-year-old reading as
  // current. An assumed number that SAYS it is assumed beats a real one presented as today's.
  const A = makeEnv([206, 205, 204, 202, 201].map(ancient));
  eq('NEG: past the widened window it reports nothing rather than a stale maximum', A.observed(), null);
  eq('...and the number is labelled assumed', A.src(), 'default');
}

console.log('\n' + Y + '=== the step-down refuses one uncorroborated reading ===' + X);
{
  const E = makeEnv([recent(205)].concat([182, 179, 178, 177, 176].map(recent)));
  eq('a lone reading well clear of the field is not the ceiling', E.observed().bpm, 182);
  eq('...and it says one was ignored', E.observed().dropped, 1);
  // NEGATIVE CONTROL: a top reading CLOSE to the runner-up is corroborated and must stand.
  const C = makeEnv([188, 186, 182, 179, 178].map(recent));
  eq('NEG: a corroborated top reading stands', C.observed().bpm, 188);
  eq('...with nothing dropped', C.observed().dropped, 0);
}

console.log('\n' + Y + '=== too little to read is said, not guessed ===' + X);
{
  const E = makeEnv([recent(180), recent(179)]);
  eq('under the minimum sample there is no observation', E.observed(), null);
  eq('...so it falls back to the default', E.maxHR(), constOf('_MAXHR_DEFAULT'));
  eq('...and says the number is assumed', E.src(), 'default');
}

console.log('\n' + Y + '=== a manual override is still possible, and still a decision ===' + X);
{
  const base = [188, 186, 182, 179, 178].map(recent);
  const O = makeEnv(base, 195);
  eq('an override wins over the history', O.maxHR(), 195);
  eq('...and says so', O.src(), 'override');
  const C = makeEnv(base, 0);
  eq('clearing it returns to the derived figure', C.maxHR(), 188);
  eq('...reported as observed again', C.src(), 'observed');
  const A = makeEnv(base, 260);
  eq('NEG: an impossible override is refused, not obeyed', A.maxHR(), 188);
  // THE MIGRATION RULE. A legacy value equal to the default cannot be distinguished from never
  // having been set - which is exactly what it was here - so it must not suppress the derivation.
  const L = makeEnv(base, 0, constOf('_MAXHR_DEFAULT'));
  eq('a legacy value equal to the default does NOT count as a choice', L.maxHR(), 188);
  const L2 = makeEnv(base, 0, 201);
  eq('NEG: a legacy value that is NOT the default is honoured as one', L2.maxHR(), 201);
}

console.log('\n' + Y + '=== there is ONE max HR, not two ===' + X);
{
  // This is the bug that recurred: runHrMax_ read st.maxHR and fell back to 180 while maxHR_ read
  // the same field and fell back to 172, so with nothing on file the run zones and the hrTSS behind
  // every CTL number were built 8 bpm apart.
  const rh = body('runHrMax_');
  ok('runHrMax_ delegates to maxHR_ rather than reading the field itself',
     !!rh && rh.indexOf('maxHR_()') > 0);
  ok('...and its own default is reachable only as a fallback',
     !!rh && rh.indexOf('maxHR_()') < rh.indexOf('RUN_HR_MAX_DEFAULT'));
  ok('the zone bands are a percentage of it, not a fixed ladder',
     /RUN_HR_PCTS\s*=\s*\[/.test(src) && (body('runHrBands_') || '').indexOf('RUN_HR_PCTS') > 0);
  // The stale hardcoded table is still DECLARED but must stay unread. Counting mentions outside
  // comments is the check - an earlier version of this assertion matched the comment describing the
  // bug and passed for the wrong reason, which is the same false green the guards were built for.
  ok('NEG: the stale RUN_ZONES ladder has no readers',
     src.split('\n').filter(l => l.indexOf('RUN_ZONES') >= 0 && l.trim().indexOf('//') !== 0
       && l.indexOf('var RUN_ZONES') < 0).length === 0);
  ok('the card no longer claims the number comes from Settings',
     src.indexOf('From your max HR in Settings.') < 0);
  ok('...it names the history it was read from instead',
     src.indexOf('Your highest recorded heart rate since ') > 0);
}

console.log('');
console.log(fails ? (R + fails + ' FAILED' + X) : (G + 'max HR derivation: all checks passed' + X));
process.exit(fails ? 1 : 0);
