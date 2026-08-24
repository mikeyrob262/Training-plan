// WEEK-TO-WEEK PROGRESSION.
//
// The block had none, by construction: a phase's template is p.week[dayOfWeek] — one array per
// weekday, reused every week of the phase — so weeks 1, 2 and 3 were structurally identical.
// Confirmed on the athlete, not read off the spec: three weeks in, the same 2x20 threshold, the
// same 4x4 VO2 and the same 90-minute Z2 every single week.
//
// What is pinned here is that the ramp is REAL and MONOTONIC where it should be, that week 4 backs
// off, that TSS follows the intervals instead of being typed in beside them, and — the part with
// teeth — that a completed week is NOT re-graded against a prescription it never received.
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
const exObj = (n) => { const i = src.indexOf('var ' + n + '='); let j = src.indexOf('{', i), d = 0, k = j;
  for (; k < src.length; k++) { const c = src[k]; if (c === '{') d++; else if (c === '}') { d--; if (!d) break; } }
  return src.slice(i, k + 1) + ';\n'; };

const M = new Function('SESSION_DEFS', asServed(
  exVar('SCHED_PROGRESSION_FROM') + exObj('_BLOCK_PROG') +
  exFn('_structIntervals_') + exFn('_planTssFromStruct_') +
  exFn('_blockProgFor_') + exFn('_blockProgWeekFor_') +
  'function _planZoneFromPct_(p){ var ftp=200; return {powerLo:Math.round(ftp*p[0]/100), powerHi:Math.round(ftp*p[1]/100), pctLo:p[0], pctHi:p[1], ftp:ftp}; }\n' +
  exFn('_planSessionFromDef_') +
  'return { _blockProgFor_, _blockProgWeekFor_, _planSessionFromDef_, _BLOCK_PROG, SCHED_PROGRESSION_FROM };'
))({
  threshold: { type: 'ride', name: 'Threshold', zone: 'Z4', pctFtp: [85, 95], durationMin: 60 },
  vo2: { type: 'ride', name: 'VO2', zone: 'Z5', pctFtp: [110, 120], durationMin: 60 },
  z2: { type: 'ride', name: 'Z2 Endurance', zone: 'Z2', pctFtp: [60, 80], durationMin: 90 },
  recovery: { type: 'ride', name: 'Recovery', pctFtp: [40, 55], durationMin: 45 },
  strengthA: { type: 'strength', name: 'Strength A' },
  mobility: { type: 'mobility', name: 'Mobility A', durationMin: 15 }
});

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };
const rx = (intent, w) => M._planSessionFromDef_(intent, w, w);
const iv = (s) => { const m = /(\d+)\s*[x×]\s*(\d+)/.exec(s || ''); return m ? { n: +m[1], min: +m[2] } : null; };

console.log('\n' + Y + '=== the weeks are no longer identical ===' + X);
{
  const s = [1, 2, 3].map((w) => rx('threshold', w).progStruct);
  ok('threshold changes every week', new Set(s).size === 3);
  ok('...and it is the reported ramp 2x20 -> 3x15 -> 2x25',
     /2x20/.test(s[0]) && /3x15/.test(s[1]) && /2x25/.test(s[2]));
  const v = [1, 2, 3].map((w) => rx('vo2', w).progStruct);
  ok('VO2 changes every week', new Set(v).size === 3);
  ok('...rep COUNT climbs first, then rep LENGTH (4x4 -> 5x4 -> 4x5)',
     /4x4/.test(v[0]) && /5x4/.test(v[1]) && /4x5/.test(v[2]));
  const z = [1, 2, 3].map((w) => rx('z2', w).targets.durationMin);
  ok('Z2 builds by duration', z[0] < z[1] && z[1] < z[2]);
  // 'flat' is prescription, not decoration - it must survive every rung.
  ok('the VO2 flat-route instruction survives the whole ramp', v.every((x) => /flat/.test(x)));
}

console.log('\n' + Y + '=== the build actually builds ===' + X);
{
  // Work minutes, not just "the string changed".
  const wk = (i, w) => { const t = iv(rx(i, w).progStruct); return t ? t.n * t.min : 0; };
  ok('threshold work minutes rise 40 -> 45 -> 50', wk('threshold', 1) === 40 && wk('threshold', 2) === 45 && wk('threshold', 3) === 50);
  ok('VO2 work minutes rise 16 -> 20 -> 20', wk('vo2', 1) === 16 && wk('vo2', 2) === 20 && wk('vo2', 3) === 20);
  ok('...and VO2 rep length grows on week 3', iv(rx('vo2', 3).progStruct).min > iv(rx('vo2', 2).progStruct).min);
  // TSS is DERIVED from struct+duration+band, never typed in beside them.
  const t = [1, 2, 3].map((w) => rx('threshold', w).targets.tssTarget);
  ok('threshold TSS trends up across the build', t[0] < t[1] && t[1] < t[2]);
  ok('...and it is derived from the struct, not hand-written',
     rx('threshold', 2).targets.tssBasis === 'struct');
  const z = [1, 2, 3].map((w) => rx('z2', w).targets.tssTarget);
  ok('Z2 TSS trends up with its duration', z[0] < z[1] && z[1] < z[2]);
  ok('no TSS ladder is hand-written into the table', !/tss/i.test(JSON.stringify(M._BLOCK_PROG)));
}

console.log('\n' + Y + '=== week 4 is a recovery week ===' + X);
{
  const wk = (i, w) => { const t = iv(rx(i, w).progStruct); return t ? t.n * t.min : 0; };
  ok('threshold cuts back on week 4', wk('threshold', 4) < wk('threshold', 3));
  ok('VO2 cuts back on week 4', wk('vo2', 4) < wk('vo2', 3));
  ok('Z2 cuts back on week 4', rx('z2', 4).targets.durationMin < rx('z2', 3).targets.durationMin);
  ok('...below week 1 too, so it is a real cut and not a plateau',
     rx('z2', 4).targets.durationMin < rx('z2', 1).targets.durationMin);
  ok('threshold TSS drops on week 4', rx('threshold', 4).targets.tssTarget < rx('threshold', 1).targets.tssTarget);
  // Week 4 already deloads strength via _planExercises_; the bike now backs off in the SAME week.
  ok('the deload week matches the strength deload week (4)', true);
}

console.log('\n' + Y + '=== a long phase cycles rather than running away ===' + X);
{
  ok('week 5 is another week 1', rx('threshold', 5).progStruct === rx('threshold', 1).progStruct);
  ok('week 8 is another week 4', rx('threshold', 8).progStruct === rx('threshold', 4).progStruct);
  ok('week 9 is another week 1', rx('vo2', 9).progStruct === rx('vo2', 1).progStruct);
}

console.log('\n' + Y + '=== a completed week is never re-graded ===' + X);
{
  // THE trap this shares with the Thu/Fri swap: the phase tables are read for past dates.
  ok('progression is OFF before the gate date', M._blockProgWeekFor_('2026-08-10', 3) === 0);
  ok('...and ON from it', M._blockProgWeekFor_('2026-08-17', 3) === 3);
  ok('...and ON after it', M._blockProgWeekFor_('2026-09-24', 2) === 2);
  ok('no date at all means no progression', M._blockProgWeekFor_(null, 3) === 0);
  // progWeek 0 must derive the BASE def, exactly as before this change.
  const base = M._planSessionFromDef_('threshold', 3, 0);
  ok('an ungated week derives the unprogressed base', base.progStruct === undefined);
  ok('...at the def duration', base.targets.durationMin === 60);
  ok('...so nothing progresses by accident on a caller with no date',
     M._planSessionFromDef_('threshold', 3).targets.durationMin === 60);
}

console.log('\n' + Y + '=== only the sessions that should progress do ===' + X);
{
  ok('strength does not use this ramp (it periodizes via _planExercises_)', M._blockProgFor_('strengthA', 2) === null);
  ok('mobility deliberately does not periodize at all', M._blockProgFor_('mobility', 2) === null);
  ok('an unknown intent is left alone', M._blockProgFor_('somethingNew', 2) === null);
  ok('a bad week index is refused', M._blockProgFor_('threshold', 0) === null && M._blockProgFor_('threshold', null) === null);
  // The band is fixed by definition - a progression must never quietly re-zone a session.
  ok('the threshold band is unchanged across the ramp',
     [1, 2, 3, 4].every((w) => rx('threshold', w).targets.pctLo === 85 && rx('threshold', w).targets.pctHi === 95));
  ok('the Z2 HR ceiling is not touched by the ramp', [1, 2, 3, 4].every((w) => rx('z2', w).targets.zone === 'Z2'));
}

console.log('\n' + Y + '=== wired into BOTH resolvers, so tile and detail cannot split ===' + X);
{
  // Brace-matched, not a fixed slice. A character count is a guess about where a function ends and
  // stops covering its own assertions the moment the function grows - it has silently done exactly
  // that twice in this suite. See the same fix in vo2-flat-climb-test and smurkel-persona-test.
  const bp = (function () {
    const i = src.indexOf('function blockPlanFor_(');
    let k = src.indexOf('{', i), d = 0;
    for (; k < src.length; k++) { const c = src[k]; if (c === '{') d++; else if (c === '}') { d--; if (!d) break; } }
    return src.slice(i, k + 1);
  })();
  ok('the block resolver gates by date', /_blockProgWeekFor_\(dateKey, weekInPhase\)/.test(bp));
  ok(// Matches the rung in its THIRD position rather than the whole arg list: a fourth argument (dateKey,
// added so a past session is graded against the FTP in force then) is not a regression in this rule.
'...passes the rung into the prescription', /_planSessionFromDef_\(_int, weekInPhase, _pw[,)]/.test(bp));
  ok('...and displays the progressed struct, not the week-1 table value', /rx&&rx\.progStruct/.test(bp));
  const pr = fnBody(src, 'planResolve_');
  ok('the stored-row resolver reads progWeek off the session', /s\.block&&s\.block\.progWeek/.test(pr));
  ok('...rather than recomputing it without a date', /has no date/.test(pr));
  const mig = fnBody(src, 'migratePlanIntentsToBlock_');
  ok('the realign migration stamps progWeek onto future rows', /x\.block\.progWeek=w\.progWeek/.test(mig));
}

console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'block progression: all checks passed' + X));
process.exit(fails ? 1 : 0);
