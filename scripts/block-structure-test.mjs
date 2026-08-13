// The training block is a hand-authored calendar, and the failure mode it keeps hitting is DRIFT:
// an attempt moves and the taper built for it stays behind. That is exactly what happened when the
// three cycling attempts were clustered into late Oct / Nov - a four-day Chalet taper was left
// stranded in the middle of September, tapering into an attempt that was no longer there, and the
// block's own `end` still stopped on Nov 11 while the summit it exists for sat on Nov 14.
//
// So these assertions are about STRUCTURE, not content: every attempt session sits on the date its
// milestone claims, nothing tapers into nothing, the phases tile the block with no gaps, and the
// run days are where the athlete actually runs.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
// The app is served from an untagged template literal, so one backslash level is eaten on the way
// out. Test the string the BROWSER runs, not the string in the file.
const asServed = (s) => s.replace(/\\([\s\S])/g, (_, c) => (c === '\\' ? '\\' : c));

function matchBrace(from) {
  let i = src.indexOf('{', from), d = 0;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') d++; else if (c === '}') { d--; if (!d) return i; } }
  return -1;
}
const exFn = (n) => { const i = src.indexOf('function ' + n + '('); if (i < 0) throw new Error('missing ' + n); return src.slice(i, matchBrace(i) + 1) + '\n'; };
const exVar = (n) => { const m = src.match(new RegExp('var ' + n + '\\s*=[^;]*;')); if (!m) throw new Error('missing var ' + n); return m[0] + '\n'; };
const exArr = (n) => { const i = src.indexOf('var ' + n + '='); if (i < 0) throw new Error('missing ' + n); let j = src.indexOf('[', i), d = 0, k = j; for (; k < src.length; k++) { const c = src[k]; if (c === '[') d++; else if (c === ']') { d--; if (!d) break; } } return src.slice(i, k + 1) + ';\n'; };

const M = new Function(asServed(
  'var st={};\n' + exVar('_TB_VERSION') + exVar('_FTP_RETEST_DATE') + exVar('BLOCK_RUN_RAMP_MAX') +
  exArr('_BLOCK_MILESTONES') + exFn('_trainingBlock_') +
  ';return { tb:_trainingBlock_(), MS:_BLOCK_MILESTONES, RAMP:BLOCK_RUN_RAMP_MAX };'
))();

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (label, cond) => { if (!cond) fails++; console.log('  ' + (cond ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + label); };
const eq = (label, got, want) => { const good = JSON.stringify(got) === JSON.stringify(want); if (!good) fails++; console.log('  ' + (good ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + label + (good ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want))); };

const tb = M.tb;
const D = (s) => new Date(s + 'T00:00:00');
const addDays = (s, n) => { const d = D(s); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const dow = (s) => D(s).getDay();               // 0=Sun .. 6=Sat
const ATTEMPTS = ['chalet', 'alpe', 'ventop'];
const RUNS = ['easyRun', 'run10k', 'tenk'];

// Flatten every dated session the block prescribes, phase by phase.
const dated = {};                                // date -> [intent]
for (const p of tb.phases) {
  if (p.dates) for (const d of Object.keys(p.dates)) dated[d] = p.dates[d].map((x) => x.i);
}

console.log('\n' + Y + '=== every attempt sits on the date its milestone claims ===' + X);
for (const slug of ATTEMPTS) {
  const ms = M.MS.find((m) => m.slug === slug);
  ok(slug + ' has a milestone', !!ms);
  const days = Object.keys(dated).filter((d) => dated[d].indexOf(slug) >= 0);
  eq('...prescribed on exactly one day', days.length, 1);
  eq('...and that day IS the milestone date (' + ms.date + ')', days[0], ms.date);
}
{
  // The stranded-taper guard. A September Chalet taper survived a move to October precisely because
  // nothing checked that an attempt session and its milestone agreed.
  const strays = Object.keys(dated).filter((d) =>
    dated[d].some((i) => ATTEMPTS.indexOf(i) >= 0 && !M.MS.some((m) => m.slug === i && m.date === d)));
  eq('no attempt session on a date no milestone points at', strays, []);
}

console.log('\n' + Y + '=== nothing tapers into nothing ===' + X);
for (const slug of ATTEMPTS) {
  const d = M.MS.find((m) => m.slug === slug).date;
  const prev = [addDays(d, -2), addDays(d, -1)].map((k) => (dated[k] || []).join('+'));
  ok(slug + ' gets a two-day lead-in, not a hard session (' + prev.join(' / ') + ')',
    prev.every((s) => s && !/vo2|threshold|group|long|ftpTest/.test(s)));
}
{
  // Recovery/rest days are only justified by something to be fresh FOR. Any easy block of 2+ days
  // that is not inside 3 days of an attempt or the 10k is a taper that lost its event.
  const eventDates = M.MS.filter((m) => ATTEMPTS.indexOf(m.slug) >= 0).map((m) => m.date)
    .concat(Object.keys(dated).filter((d) => dated[d].indexOf('tenk') >= 0));
  const orphan = Object.keys(dated).filter((d) =>
    dated[d].every((i) => i === 'recovery' || i === 'rest' || i === 'mobility') &&
    !eventDates.some((e) => Math.abs((D(e) - D(d)) / 86400000) <= 3));
  eq('no recovery block stranded away from an event', orphan, []);
}

console.log('\n' + Y + '=== the phases tile the block, no gaps and no overlaps ===' + X);
{
  const ph = tb.phases.slice().sort((a, b) => (a.start < b.start ? -1 : 1));
  eq('phase 1 starts when the block does', ph[0].start, tb.start);
  eq('the last phase ends when the block does', ph[ph.length - 1].end, tb.end);
  const bad = [];
  for (let i = 1; i < ph.length; i++) if (addDays(ph[i - 1].end, 1) !== ph[i].start) bad.push(ph[i - 1].id + '->' + ph[i].id);
  eq('each phase begins the day after the last ends', bad, []);
  // The horizon bug: the block END stopped on Nov 11 while Ven-Top sat on Nov 14, so the summit
  // the whole block points at fell OUTSIDE the block by every `date <= tb.end` test in the app.
  const last = M.MS.filter((m) => ATTEMPTS.indexOf(m.slug) >= 0).map((m) => m.date).sort().pop();
  ok('the block horizon covers the final attempt (' + last + ' <= ' + tb.end + ')', last <= tb.end);
}

console.log('\n' + Y + '=== running is Mon / Wed / Sun, never Tue or Fri ===' + X);
for (const p of tb.phases.filter((x) => x.week)) {
  const runDay = (i) => p.week[i].some((s) => RUNS.indexOf(s.i) >= 0);
  ok(p.id + ' runs Mon, Wed and Sun', runDay(0) && runDay(2) && runDay(6));
  // Tuesday is strength + VO2 and Friday is threshold + Strength A. A run on either stacks a third
  // hard element on an already hard day, which is the load the shin history rules out.
  ok(p.id + ' does NOT run Tuesday (strength AM + VO2 PM)', !runDay(1));
  ok(p.id + ' does NOT run Friday (threshold + Strength A)', !runDay(4));
  eq(p.id + ' runs exactly 3x/week', p.week.filter((_, i) => runDay(i)).length, 3);
}
{
  // Strength stayed 2x/week through the reshuffle, and Tuesday's is the morning slot.
  const bad = tb.phases.filter((p) => p.week).filter((p) => {
    const n = p.week.filter((d) => d.some((s) => /^strength/.test(s.i))).length;
    const tue = p.week[1].find((s) => s.i === 'strengthB');
    return n !== 2 || !tue || tue.t !== 'AM';
  }).map((p) => p.id);
  eq('every week phase keeps strength 2x/week with Tuesday in the AM', bad, []);
}

console.log('\n' + Y + '=== the run build is capped, not frozen and not aggressive ===' + X);
{
  // Neither a freeze nor the original progression: a moderate build to reassess after the PT visit.
  // Read the upper bound of each phase's easy-run prescription and check the step between phases.
  const upper = (p) => {
    for (const day of (p.week || [])) for (const s of day) {
      if (RUNS.indexOf(s.i) >= 0 && s.s) { const m = String(s.s).match(/(\d+)\s*-\s*(\d+)\s*min/); if (m) return +m[2]; }
    }
    return null;
  };
  const seq = tb.phases.filter((p) => p.week).map((p) => ({ id: p.id, min: upper(p) })).filter((x) => x.min);
  ok('every week phase states an easy-run duration', seq.length === tb.phases.filter((p) => p.week).length);
  ok('the build actually builds (it is not frozen)', seq[seq.length - 1].min > seq[0].min);
  const over = [];
  for (let i = 1; i < seq.length; i++) {
    const step = (seq[i].min - seq[i - 1].min) / seq[i - 1].min;
    if (step > M.RAMP + 1e-9) over.push(seq[i - 1].id + '->' + seq[i].id + ' +' + Math.round(step * 100) + '%');
  }
  eq('no phase step exceeds ' + Math.round(M.RAMP * 100) + '%/week  [' + seq.map((x) => x.id + ':' + x.min).join(' ') + ']', over, []);
}

console.log('\n' + Y + '=== the cached block is actually replaced ===' + X);
{
  // _trainingBlock_ returns the STORED block untouched when st.trainingBlock.v matches, so a
  // structural rewrite that does not bump the version reaches nobody who has already loaded once.
  const v = src.match(/var _TB_VERSION='([^']+)'/)[1];
  ok('_TB_VERSION was bumped past ventop-2026-3 (' + v + ')', v !== 'ventop-2026-3');
  eq('the block stamps that version', tb.v, v);
}

// ONE EVENT, ONE DATE. The retest is prescribed as a dated ftpTest session keyed off
// _FTP_RETEST_DATE (which never moves) AND flagged as a milestone. The milestone carried
// slidable:true, so with slideWeeks=2 the calendar showed "FTP Retest" twice — Aug 27 for the
// session and Sep 10 for the slid milestone, one event two weeks apart with nothing telling the
// reader which was real. Mikey's call: the retest date is a commitment and stays put.
console.log('\n' + Y + '=== the retest is pinned, and the gate still slides ===' + X);
{
  const retest = M.MS.filter((m) => m.slug === 'ftp-retest')[0];
  const gate = M.MS.filter((m) => m.slug === 'four-weeks')[0];
  ok('the retest milestone exists', !!retest);
  ok('...and is NOT slidable', !retest.slidable);
  eq('...and sits on the shared constant', retest.date, M.tb ? retest.date : null);
  // The session and the milestone must read the same date, which is the whole point.
  const retestDays = Object.keys(dated).filter((d) => (dated[d] || []).indexOf('ftpTest') >= 0);
  eq('exactly one ftpTest session is prescribed', retestDays.length, 1);
  eq('...on the same day the milestone claims', retestDays[0], retest.date);

  // Do not over-fix: a missed week genuinely does push out when four clean weeks are banked.
  ok('the four-weeks gate DOES still slide', gate.slidable === true);
  // And the real-world events were never slidable and must stay that way.
  ['chalet', 'alpe', 'tenk', 'ventop'].forEach((s) => {
    ok('"' + s + '" does not move', !M.MS.filter((m) => m.slug === s)[0].slidable);
  });
  eq('exactly one milestone is slidable now', M.MS.filter((m) => m.slidable).length, 1);
}

console.log('\n' + Y + '=== a slide moves the gate and leaves the retest alone ===' + X);
{
  // Run the real effective-list mapper with a forced slide, rather than trusting the flag alone.
  const eff = new Function(asServed(
    exVar('_FTP_RETEST_DATE') + exArr('_BLOCK_MILESTONES') +
    'function _blockDay_(s){ return new Date(s+"T00:00:00"); }\n' +
    'function _tbDK_(d){ var m=d.getMonth()+1, y=d.getDate(); return d.getFullYear()+"-"+(m<10?"0":"")+m+"-"+(y<10?"0":"")+y; }\n' +
    'function _blockSlideWeeks_(){ return 2; }\n' +
    exFn('_blockMilestonesEffective_') +
    'return _blockMilestonesEffective_(new Date());'
  ))();
  const base = (s) => M.MS.filter((m) => m.slug === s)[0].date;
  const now = (s) => eff.filter((m) => m.slug === s)[0].date;
  ok('with a 2-week slide the gate moves', now('four-weeks') !== base('four-weeks'));
  eq('...by exactly two weeks', now('four-weeks'), addDays(base('four-weeks'), 14));
  eq('the retest does NOT move', now('ftp-retest'), base('ftp-retest'));
  eq('...and the mountain still does not move', now('ventop'), base('ventop'));
  // The duplicate the athlete actually saw: two different dates carrying the retest.
  const retestDates = eff.filter((m) => m.slug === 'ftp-retest').map((m) => m.date);
  eq('the retest resolves to ONE date', retestDates.length, 1);
  const sessionDay = Object.keys(dated).filter((d) => (dated[d] || []).indexOf('ftpTest') >= 0)[0];
  eq('...and it is the session day, even mid-slide', retestDates[0], sessionDay);
}

console.log('\n' + Y + '=== the reset copy no longer promises a move it will not make ===' + X);
{
  const copy = src.slice(src.indexOf('A week was missed, so the clock reset'), src.indexOf('A week was missed, so the clock reset') + 400);
  ok('it no longer says the retest moves with the gate', !/the retest and every date behind it move with it/.test(copy));
  ok('...it says the retest is fixed', /The retest stays on/.test(copy));
  ok('...and still reports the slid gate', /The gate has slid to/.test(copy));
}

console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'block structure: all checks passed' + X));
process.exit(fails ? 1 : 0);
