// SESSION IDENTITY: did it happen, and was it ridden at the prescribed intensity? Two facts, and
// collapsing them cost real weeks.
//
// Measured across the whole block before this change: all three prescribed VO2 sessions (Jul 28,
// Aug 4, Aug 11) were ridden with the structure verbatim — the lap reader finds exactly four work
// intervals on each — but at 173-195W against a 201W floor. Because the only interval path required
// the WATTS, each fell through to the whole-ride ratio and was relabelled THRESHOLD. A session that
// was not a threshold session filled the threshold slot, VO2 read as never done, and the week was
// reported as missed to an athlete who had ridden it.
//
// The fix is an ordering one: structure BEFORE ratio. The whole-ride fallback is for a ride nothing
// could read, and must not overrule a reading that succeeded.
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

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };

// The real Aug 11 laps, verbatim from the live store.
const VO2_LAPS = [
  { time: 601, avgPwr: 102 }, { time: 240, avgPwr: 195 }, { time: 180, avgPwr: 95 },
  { time: 240, avgPwr: 191 }, { time: 180, avgPwr: 91 }, { time: 240, avgPwr: 173 },
  { time: 180, avgPwr: 83 }, { time: 300, avgPwr: 179 }, { time: 180, avgPwr: 86 },
  { time: 900, avgPwr: 88 }, { time: 62, avgPwr: 32 }
];
// NP 147 against FTP 183 is 0.803 — the ratio the live ride actually carries, and the reason the
// old fallback filed it as threshold (>=0.80) rather than z2. Worth pinning the exact number: at
// 146 it would have crossed into z2 and the test would have "passed" for the wrong reason.
const VO2_NP = 147;
const TARGETS = { powerLo: 201, powerHi: 220, ftp: 183 };
const STRUCT = '4x4 min, 3 min recovery, flat';

function build(plan) {
  return new Function('blockPlanFor_', '_cvStreamIntervals_', '_blockPwr_', asServed(
    'var _BLOCK_IV_MIN_HIT=0.5;\n' +
    exFn('_structIntervals_') + exFn('_blockLapPowers_') + exFn('_blockLapsHit_') +
    exFn('_blockIntervalIntent_') + exFn('_blockIntentByStructure_') + exFn('_blockSessionOf_') +
    'return { _blockSessionOf_, _blockIntervalIntent_, _blockIntentByStructure_, _blockLapPowers_, _blockLapsHit_ };'
  ))(plan, () => null, (r) => (r && r.np) || null);
}
const planVO2 = () => ({ sessions: [{ intent: 'vo2', struct: STRUCT, rx: { targets: TARGETS } }] });
const M = build(planVO2);

console.log('\n' + Y + '=== the real Aug 11 session: structure verbatim, watts short ===' + X);
{
  const ride = { laps: VO2_LAPS, np: VO2_NP };   // 0.803 of FTP -> the old fallback filed this as threshold
  const lp = M._blockLapPowers_(ride, STRUCT, TARGETS);
  ok('the lap reader finds the four work intervals', lp && lp.vals.length === 4);
  ok('...at the watts actually ridden', JSON.stringify(lp.vals) === JSON.stringify([195, 191, 173, 179]));
  ok('...and none of them reach the 201W floor', lp.vals.every((v) => v < 201));
  ok('the INTENSITY path correctly declines to confirm', M._blockIntervalIntent_(ride, '2026-08-11') === null);
  ok('the STRUCTURE path recognises the session', M._blockIntentByStructure_(ride, '2026-08-11') === 'vo2');
  ok('so identity is vo2, not threshold', M._blockSessionOf_(ride, 183, '2026-08-11') === 'vo2');
  // The whole point: the ratio would have said threshold.
  ok('...where the whole-ride ratio alone would have said threshold', (VO2_NP / 183) >= 0.80 && (VO2_NP / 183) < 1.06);
}

console.log('\n' + Y + '=== a session ridden AT intensity still confirms the same way ===' + X);
{
  const strong = { laps: VO2_LAPS.map((l) => (l.time >= 240 ? { time: l.time, avgPwr: 210 } : l)), np: 170 };
  ok('the intensity path confirms it', M._blockIntervalIntent_(strong, '2026-08-11') === 'vo2');
  ok('...and identity is unchanged', M._blockSessionOf_(strong, 183, '2026-08-11') === 'vo2');
  ok('the laps-hit gate passes when the watts are there', M._blockLapsHit_(strong, STRUCT, TARGETS) === true);
  ok('...and fails when they are not', M._blockLapsHit_({ laps: VO2_LAPS }, STRUCT, TARGETS) === false);
}

console.log('\n' + Y + '=== the ratio fallback still handles a genuinely unreadable ride ===' + X);
{
  // No laps at all, no stream: nothing to read, so the whole-ride guess is all there is. Unchanged.
  ok('a no-lap ride still falls back to the ratio', M._blockSessionOf_({ np: 220 }, 183, '2026-08-11') === 'vo2');
  ok('...and lands in threshold when the ratio says so', M._blockSessionOf_({ np: 160 }, 183, '2026-08-11') === 'threshold');
  ok('...and z2 when it is easy', M._blockSessionOf_({ np: 120 }, 183, '2026-08-11') === 'z2');
  ok('no power at all yields NO identity rather than a guess', M._blockSessionOf_({}, 183, '2026-08-11') === null);
  // Two laps is the floor for calling it a structure; one lap is a whole-ride lap, not intervals.
  ok('a single whole-ride lap is not a structure',
     M._blockIntentByStructure_({ laps: [{ time: 3600, avgPwr: 150 }] }, '2026-08-11') === null);
}

console.log('\n' + Y + '=== it can only ever name the session the block prescribed ===' + X);
{
  // A hard group ride on a day the block asked for Z2 must not be promoted into a VO2 session.
  const z2day = build(() => ({ sessions: [{ intent: 'z2', struct: '90 min', rx: { targets: { powerLo: 110, powerHi: 146, ftp: 183 } } }] }));
  ok('a continuous prescription has no structure to match',
     z2day._blockIntentByStructure_({ laps: VO2_LAPS }, '2026-08-12') === null);
  const noPlan = build(() => null);
  ok('no plan for the date means no structural identity',
     noPlan._blockIntentByStructure_({ laps: VO2_LAPS }, '1999-01-01') === null);
  ok('...and it falls through to the ratio as before',
     noPlan._blockSessionOf_({ np: 160 }, 183, '1999-01-01') === 'threshold');
}

console.log('\n' + Y + '=== the ordering is the fix, and it is asserted ===' + X);
{
  const fn = src.slice(src.indexOf('function _blockSessionOf_('), src.indexOf('function _blockSessionOf_(') + 2000);
  ok('intensity is tried first', fn.indexOf('_blockIntervalIntent_') < fn.indexOf('_blockIntentByStructure_'));
  ok('...then structure', fn.indexOf('_blockIntentByStructure_') < fn.indexOf('_blockPwr_'));
  ok('...and the ratio only last', /var pw=_blockPwr_\(r\)/.test(fn));
  ok('the reason is recorded next to it', /must not\s*\n?\s*\/\/ overrule a reading that succeeded|overrule a reading that succeeded/.test(fn));
}

console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'block classify: all checks passed' + X));
process.exit(fails ? 1 : 0);
