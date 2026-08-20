// THE BASELINE TODAY IS JUDGED AGAINST.
//
// The previous fix made the card SHOW today's Garmin reading; the baseline it is compared against
// still read st.recoveryLog only. But the source was one of FOUR faults, and two of the others
// explain the reported symptom better than the source does:
//
//   1. WRONG SOURCE - manual entries are sparse by design; not logging is the point of the sync.
//   2. IT INCLUDED TODAY. With a single manual entry - today's - the mean WAS today's value, the
//      deviation was exactly zero, and the score pinned to precisely the neutral 65 whatever the
//      reading. That is the reported "neutral-anchored regardless", and fixing only the source would
//      have left it in place.
//   3. NO WINDOW - every entry ever, so a reading from months ago weighed the same as last week's.
//   4. MEAN, NOT MEDIAN - HRV is outlier-prone and one bad night skews a mean. The Overview layer
//      already medians this same data for the same reason.
//
// PER-DAY PRECEDENCE IS GARMIN-FIRST, deliberately the OPPOSITE of _hrvToday_, because they answer
// different questions. _hrvToday_ asks "what is today's reading" and a number typed today is the
// athlete's considered answer. A baseline asks "what is NORMAL for this measurement" - and today's
// reading is overwhelmingly a Garmin rMSSD, so a history part-built from hand-typed numbers from a
// possibly different app would compare a value against a distribution it does not belong to.
// Same-source comparison beats source precedence here. Manual days still count where they are the
// only entry for that date.
//
// Run: node scripts/hrv-baseline-test.mjs
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

console.log('\n' + Y + '=== the baseline reads both stores, not just the manual log ===' + X);
ok('_hrvBaseline_ exists', /function _hrvBaseline_\(days\)/.test(SRC));
ok('it reads the Garmin store', /var h=\(st && st\.hrvDaily\)\?st\.hrvDaily:\{\}/.test(SRC));
ok('...and the manual log', /Array\.isArray\(st\.recoveryLog\)\?st\.recoveryLog:\[\]/.test(SRC));
ok('the card uses it', /var _bl=\(typeof _hrvBaseline_==='function'\)\?_hrvBaseline_\(\)/.test(SRC));
ok('NEG: the card no longer builds a baseline from recoveryLog alone', !/var hist=\(st\.recoveryLog\|\|\[\]\)\.filter/.test(SRC));
ok('NEG: and the old unbounded mean is gone', !/hist\.reduce/.test(SRC));

console.log('\n' + Y + '=== the three faults that were not the source ===' + X);
ok('TODAY is excluded from its own baseline', /k>=from && k<tk/.test(SRC));
ok('...for the manual side too', /e\.date>=from && e\.date<tk/.test(SRC));
ok('a trailing window exists', /var _HRV_BASE_DAYS = 28/.test(SRC));
ok('the statistic is a MEDIAN', /function _hrvMedian_\(a\)/.test(SRC) && /out\.hrv=_hrvMedian_\(hs\)/.test(SRC));
ok('...including the even-length case', /\(s\.length%2\) \? s\[m\] : \(s\[m-1\]\+s\[m\]\)\/2/.test(SRC));

console.log('\n' + Y + '=== Garmin takes the day where both exist ===' + X);
ok('Garmin is loaded first', SRC.indexOf('byDay[k]={ hrv:+hv, rhr:+rv, src:\'garmin\' }') < SRC.indexOf('byDay[e.date]={ hrv:+e.hrv'));
ok('...and manual does not displace it', /if\(byDay\[e\.date\]\) return;/.test(SRC));
ok('a day needs BOTH hrv and rhr', /hv==null \|\| !isFinite\(hv\) \|\| rv==null \|\| !isFinite\(rv\)/.test(SRC));
ok('the mix is counted, so the composition is knowable', /if\(d\.src==='garmin'\) out\.garmin\+\+; else out\.manual\+\+;/.test(SRC));

console.log('\n' + Y + '=== the card states how much baseline there is ===' + X);
ok('the sub-line names the day count', /'vs your '\+_bl\.n\+'-day baseline'/.test(SRC));
ok('...and still says when it is building', /:'building baseline'/.test(SRC));
ok('the reading source is still named alongside it', /\+\(hrvSrc\?\(' &middot; '\+hrvSrc\):''\)/.test(SRC));

console.log('\n' + Y + '=== the baseline, exercised ===' + X);
{
  const TK = '2026-08-20', DAYS = 28;
  const dayBefore = (n) => { const d = new Date('2026-08-20T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  const from = dayBefore(DAYS);
  const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const m = Math.floor(s.length / 2);
    return (s.length % 2) ? s[m] : (s[m - 1] + s[m]) / 2; };
  const base = (st) => {
    const byDay = {};
    Object.keys(st.hrvDaily || {}).forEach((k) => {
      if (!(k >= from && k < TK)) return;
      const r = st.hrvDaily[k];
      const hv = (r && typeof r === 'object') ? r.hrv : r;
      const rv = (r && typeof r === 'object') ? r.rhr : null;
      if (hv == null || !isFinite(hv) || rv == null || !isFinite(rv)) return;
      byDay[k] = { hrv: +hv, rhr: +rv, src: 'garmin' };
    });
    (st.recoveryLog || []).forEach((e) => {
      if (!e || !e.date) return;
      if (!(e.date >= from && e.date < TK)) return;
      if (byDay[e.date]) return;
      if (e.hrv == null || e.rhr == null) return;
      byDay[e.date] = { hrv: +e.hrv, rhr: +e.rhr, src: 'manual' };
    });
    const keys = Object.keys(byDay);
    let g = 0, m = 0; const hs = [], rs = [];
    keys.forEach((k) => { const d = byDay[k]; hs.push(d.hrv); rs.push(d.rhr); d.src === 'garmin' ? g++ : m++; });
    return { hrv: median(hs), rhr: median(rs), n: keys.length, garmin: g, manual: m };
  };

  // THE REPORTED CASE: weeks of Garmin, no manual entries.
  const garminOnly = { hrvDaily: {} };
  for (let i = 1; i <= 20; i++) garminOnly.hrvDaily[dayBefore(i)] = { hrv: 28 + (i % 5), rhr: 50 };
  ok('20 days of Garmin produce a 20-day baseline', base(garminOnly).n === 20);
  ok('...all counted as Garmin', base(garminOnly).garmin === 20 && base(garminOnly).manual === 0);
  ok('...with a real median, not a neutral placeholder', base(garminOnly).hrv === 30);

  // THE FAULT THAT WOULD HAVE SURVIVED A SOURCE-ONLY FIX.
  const todayOnly = { hrvDaily: { [TK]: { hrv: 37, rhr: 48 } } };
  ok('a reading for TODAY alone yields NO baseline, rather than a baseline equal to itself',
     base(todayOnly).n === 0 && base(todayOnly).hrv === null);

  // Precedence.
  const both = { hrvDaily: { [dayBefore(2)]: { hrv: 30, rhr: 50 } },
                 recoveryLog: [{ date: dayBefore(2), hrv: 99, rhr: 40 }] };
  ok('Garmin takes the day when both exist', base(both).hrv === 30 && base(both).garmin === 1 && base(both).manual === 0);
  const gap = { hrvDaily: { [dayBefore(2)]: { hrv: 30, rhr: 50 } },
                recoveryLog: [{ date: dayBefore(3), hrv: 26, rhr: 54 }] };
  ok('manual fills a day Garmin never covered', base(gap).n === 2 && base(gap).manual === 1);

  // Window and shape.
  const old = { hrvDaily: { [dayBefore(60)]: { hrv: 99, rhr: 40 }, [dayBefore(2)]: { hrv: 30, rhr: 50 } } };
  ok('a reading outside the window is excluded', base(old).n === 1 && base(old).hrv === 30);
  ok('a half row (hrv, no rhr) is skipped', base({ hrvDaily: { [dayBefore(2)]: { hrv: 30 } } }).n === 0);
  ok('a legacy bare number has no rhr, so it is skipped too', base({ hrvDaily: { [dayBefore(2)]: 30 } }).n === 0);
  ok('nothing anywhere yields a null baseline, not a zero', base({}).hrv === null);

  // Median beats mean on the data this actually sees.
  const spiky = { hrvDaily: {} };
  [28, 29, 30, 31, 120].forEach((v, i) => { spiky.hrvDaily[dayBefore(i + 1)] = { hrv: v, rhr: 50 }; });
  const mean = [28, 29, 30, 31, 120].reduce((a, b) => a + b, 0) / 5;
  ok('one outlier night moves the median to 30, where a mean would read ' + mean, base(spiky).hrv === 30);
}

console.log('');
if (fails) { console.log(R + 'hrv baseline: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'hrv baseline: all checks passed' + X + '\n');
