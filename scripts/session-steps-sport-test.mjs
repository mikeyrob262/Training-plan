// The step-by-step session card speaks the SPORT'S language.
//
// _sessionSteps_ was written for bikes and handed to runs unchanged, so a prescribed Easy Run read
// "Warm-up · easy spin" and "Cool-down · Spin down, easy" — wording from a template the session has
// nothing to do with — and its target rendered as an em dash because a run has no watts.
//
// A run is prescribed and judged on PACE and HEART RATE. Those are what the card must show.
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

const M = new Function('SESSION_DEFS', asServed(
  exFn('_structIntervals_') + exFn('_paceStr_') + exFn('_sessionSteps_') +
  'return { _sessionSteps_ };'
))({ easyRun: { type: 'run' }, run10k: { type: 'run' }, z2: { type: 'ride' }, threshold: { type: 'ride' } });

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };
const S = M._sessionSteps_;
const txt = (steps) => JSON.stringify(steps);

console.log('\n' + Y + '=== a run card never speaks bike ===' + X);
{
  // The reported case: a prescribed Easy Run, judged on an HR ceiling, no pace band, no watts.
  const run = S('easyRun', '45 min easy', { hrCap: 140, durationMin: 45 });
  const t = txt(run);
  ok('no "easy spin" anywhere on the card', !/easy spin/i.test(t));
  ok('no "Spin down"', !/spin down/i.test(t));
  ok('...it jogs down instead', /Jog down, easy\./.test(t));
  // A continuous session's warm-up line is deliberately sport-NEUTRAL ("Ease in — build to the
  // working effort"), so the check here is that no bike language leaked into it.
  ok('the warm-up line is sport-neutral, not bike', /Ease in/.test(t) && !/openers/.test(t));
  ok('"easy jog" is the easy prescription', /easy jog/.test(t));
  // An HR ceiling IS a real prescription for an easy run - better than an em dash.
  ok('the HR ceiling is shown rather than a dash', /under 140 bpm/.test(t));
  ok('...so the main effort is not an em dash', !/Main effort[^}]*—/.test(t));
}

console.log('\n' + Y + '=== a run with a pace band shows the pace ===' + X);
{
  // paceLo/paceHi are seconds per mile, as the run editor stores them.
  const run = S('run10k', '4x5 min, 2 min recovery', { paceLo: 600, paceHi: 630 });
  const t = txt(run);
  ok('the pace band renders as mm:ss', /10:00–10:30 \/mi/.test(t));
  ok('...and never as watts', !/W(?![a-z])/.test(t.replace(/Warm|Work/g, '')));
  // A structured run was being flattened into one continuous block because the interval branch
  // was gated on a POWER band, which a run can never have.
  const work = run.filter((s) => s.kind === 'work');
  ok('a structured run breaks into intervals', work.length === 4);
  ok('...numbered against the right total', /Interval 4 of 4/.test(t));
  ok('...with the run recovery wording', /recover, easy jog|min easy/.test(t));
  ok('...and still a warm-up and a cool-down', run[0].kind === 'warmup' && run[run.length - 1].kind === 'cooldown');
  // The interval branch is where the sport-specific warm-up line lives.
  ok('a structured run warms up with strides, not openers', /strides/.test(t) && !/openers/.test(t));
}

console.log('\n' + Y + '=== the bike card is unchanged ===' + X);
{
  const ride = S('threshold', '2x20 min, 5 min recovery', { powerLo: 200, powerHi: 220, ftp: 250, zone: 'Z4' });
  const t = txt(ride);
  ok('still spins, does not jog', /Easy spin/.test(t) && !/jog/i.test(t));
  ok('...and spins down', /Spin down, easy\./.test(t));
  ok('the watt band still renders', /200–220W/.test(t));
  ok('...priced off FTP for the easy steps', /125–138W/.test(t));
  ok('intervals still break out', ride.filter((s) => s.kind === 'work').length === 2);
  ok('...carrying structured targets for the debrief matcher',
     ride.filter((s) => s.kind === 'work')[0].bandLo === 200);
  ok('the zone label survives', /Z4/.test(t));
}

console.log('\n' + Y + '=== sport is detected, not guessed ===' + X);
{
  // Library type is the primary signal; a pace band is the fallback for an intent with no def.
  ok('an unknown intent carrying a pace band is treated as a run',
     /easy jog/.test(txt(S('somethingNew', '30 min', { paceLo: 540, paceHi: 570 }))));
  ok('an unknown intent with watts is treated as a ride',
     /easy spin/i.test(txt(S('somethingNew', '30 min', { powerLo: 150, powerHi: 170 }))));
  // No targets at all must not crash and must not claim a sport it cannot know.
  const bare = S('somethingNew', '30 min', {});
  ok('a target-less session still renders steps', bare.length === 3);
  ok('...without inventing a number', /—/.test(txt(bare)));
}

console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'session steps by sport: all checks passed' + X));
process.exit(fails ? 1 : 0);
