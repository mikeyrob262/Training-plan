// ADHERENCE: completion and execution are DIFFERENT QUESTIONS.
//
// The card has always labelled its bars "Completion" (did you show up) against a separate "Mean
// execution" line (how well) — that split is in the card's own header comment. Both were computed
// off `scored`, so a session that was genuinely DONE and simply could not be SCORED counted as a
// no-show.
//
// That is most of the strength series. Strength is deliberately outside _sessActivityMatch_ (it is
// scored off logged sets, not off whatever was recorded that morning), so it only scores when a set
// log exists. Measured on the live plan: of 22 past strength/mobility sessions, 9 are marked
// completed, 3 carry a score, and exactly 1 carries a log. The card read 3/20 for work that was
// 9/20 done, and reported the athlete as absent.
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

const TODAY = '2026-08-13';
function run(plan, types, opts) {
  opts = opts || {};
  const st = { plan };
  const M = new Function('st', '_sessSport_', '_sessActivityMatch_', 'computeRideExecutionScore_', 'parseDayKey',
    asServed(exFn('_adhKind_') + exFn('_adherenceTrend_') + 'return _adherenceTrend_;'))(
    st,
    (x) => x.sport || x.type,
    opts.match || (() => null),
    opts.score || (() => null),
    (k) => new Date(k + 'T00:00:00'));
  return M(st, 8, types, TODAY);
}
const sum = (wk, f) => wk.reduce((a, w) => a + f(w), 0);
// Aug 10 2026 is the Monday of the current week.
const day = (sessions) => ({ '2026-08-10': { sessions } });

console.log('\n' + Y + '=== a completed session counts as completed ===' + X);
{
  const wk = run(day([
    { type: 'strength', status: 'completed' },
    { type: 'strength', status: 'completed' },
    { type: 'strength', status: 'planned' }
  ]), ['strength', 'mobility']);
  ok('all three are planned', sum(wk, (w) => w.planned) === 3);
  ok('two are done', sum(wk, (w) => w.done) === 2);
  ok('...even though NONE could be scored', sum(wk, (w) => w.scored) === 0);
  ok('...so execution stays honest and reports no mean', wk[wk.length - 1].mean === null);
}

console.log('\n' + Y + '=== execution is still scored-only — quality is never inferred from attendance ===' + X);
{
  const wk = run(day([
    { type: 'strength', status: 'completed', executionScore: 80 },
    { type: 'strength', status: 'completed' },                      // done, unscorable
    { type: 'strength', status: 'planned' }
  ]), ['strength', 'mobility']);
  ok('two done', sum(wk, (w) => w.done) === 2);
  ok('one scored', sum(wk, (w) => w.scored) === 1);
  ok('the mean is the scored one alone, not diluted by the unscored', wk[wk.length - 1].mean === 80);
}

console.log('\n' + Y + '=== a logged strength session counts even with no status ===' + X);
{
  const wk = run(day([
    { type: 'strength', strengthLog: { Squat: [{ weight: 100, reps: 5 }] } },
    { type: 'strength' }
  ]), ['strength', 'mobility']);
  ok('the logged one is done', sum(wk, (w) => w.done) === 1);
  ok('...and the empty one is not', sum(wk, (w) => w.planned) === 2 && sum(wk, (w) => w.done) === 1);
}

console.log('\n' + Y + '=== rides: a matched activity is completion evidence on its own ===' + X);
{
  const acts = { '2026-08-10': { id: 'r1' } };
  const wk = run(day([{ type: 'ride', status: 'planned' }]), ['ride'],
    { match: (dk) => acts[dk] || null, score: () => null });     // matched but unscorable
  ok('a matched ride counts as done', sum(wk, (w) => w.done) === 1);
  ok('...without inventing a score', sum(wk, (w) => w.scored) === 0);
  // And an unmatched, unscored, un-completed ride is a genuine miss.
  const miss = run(day([{ type: 'ride', status: 'planned' }]), ['ride']);
  ok('an unanswered ride is still a miss', sum(miss, (w) => w.done) === 0);
  ok('...and is still counted as planned', sum(miss, (w) => w.planned) === 1);
}

console.log('\n' + Y + '=== the old failure: scored-as-completion ===' + X);
{
  // The live shape: 9 done of 20 planned, only 3 scorable.
  const rows = [];
  for (let i = 0; i < 9; i++) rows.push({ type: 'strength', status: 'completed', executionScore: i < 3 ? 70 : undefined });
  for (let i = 0; i < 11; i++) rows.push({ type: 'strength', status: 'planned' });
  const wk = run(day(rows), ['strength', 'mobility']);
  ok('completion reports 9, not 3', sum(wk, (w) => w.done) === 9);
  ok('...of 20 planned', sum(wk, (w) => w.planned) === 20);
  ok('...while execution still reports 3', sum(wk, (w) => w.scored) === 3);
  ok('...and the mean comes from those 3', wk[wk.length - 1].mean === 70);
}

console.log('\n' + Y + '=== the card reads done for completion and scored for execution ===' + X);
{
  const card = src.slice(src.indexOf('function _adhCardInner_('), src.indexOf('function _adhCardInner_(') + 5000);
  ok('the Completion headline uses done', /_adhDone_\(cur\)\+'\/'\+cur\.planned/.test(card));
  ok('the bars use done', /var rate=_d\/w\.planned/.test(card));
  ok('...and the faint-bar test uses it too', /_d>0\?'0\.9':'0\.28'/.test(card));
  ok('the execution line still comes from mean (scored only)', /w\.mean==null/.test(card));
  ok('a pre-done series still renders rather than emptying',
     /w\.done!=null\) \? w\.done : \(\(w&&w\.scored\)\|\|0\)/.test(src));
  ok('the low-n line says both numbers when they disagree', /completed, '\+totalScored\+' with a score/.test(card));
  // The series must actually carry the field.
  const trend = src.slice(src.indexOf('function _adherenceTrend_('), src.indexOf('function _adherenceTrend_(') + 4000);
  ok('the series exposes done', /done:b\.done/.test(trend));
  ok('...and still exposes scored separately', /scored:b\.scored/.test(trend));
}

console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'adherence completion: all checks passed' + X));
process.exit(fails ? 1 : 0);
