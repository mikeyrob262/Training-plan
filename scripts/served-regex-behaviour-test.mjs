// The 18 regex literals whose escapes the served template literal was eating: what they now DO.
//
// served-escape-test.mjs proves they are spelled right. This proves they BEHAVE right, by
// extracting each one from worker.js, applying the template literal's own transformation to get
// the copy the browser runs, and asserting on results. The two are complementary: spelling alone
// was never the point, and a test that read the source instead of the served form would have
// passed against the original bug.
//
// Run: node scripts/served-regex-behaviour-test.mjs
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');
const lines = src.split(/\r?\n/);

const BS = String.fromCharCode(92);
// untagged template literal: \\ -> \ , and any other \X -> X
const asServed = (s) => s.replace(/\\([\s\S])/g, (_, c) => (c === '\\' ? '\\' : c));

// Pull a regex literal out of worker.js and build the SERVED RegExp.
//
// Located by CONTENT, not line number. An earlier version pinned line numbers and broke the moment
// an unrelated card above these sites grew by a few lines — a test that fails for a reason having
// nothing to do with what it tests is worse than no test.
const reLit = new RegExp('/(?![/*])((?:[^/\\\\\\n]|\\\\.)+)/([gimsuy]*)');
function findLines(anchor) {
  const out = [];
  lines.forEach((L, i) => { if (!/^\s*\/\//.test(L) && L.indexOf(anchor) >= 0) out.push(i); });
  if (!out.length) throw new Error('anchor no longer present in worker.js: ' + anchor);
  return out;
}
// anchor: a distinctive substring of the line, positioned at or before the regex literal.
function servedRe(anchor, nth) {
  const idxs = findLines(anchor);
  const i = idxs[nth || 0];
  if (i == null) throw new Error('no occurrence #' + (nth || 0) + ' of ' + anchor);
  const L = lines[i];
  const m = reLit.exec(L.slice(L.indexOf(anchor)));
  if (!m) throw new Error('no regex literal after "' + anchor + '" on line ' + (i + 1));
  return { re: new RegExp(asServed(m[1]), m[2]), line: i + 1 };
}

let fails = 0;
const R = '\x1b[31m', G = '\x1b[32m', X = '\x1b[0m';
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log('  ' + (ok ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + label + (ok ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)));
}

console.log('\n=== Intervals.icu ride handles: /^i' + BS + 'd+$/ (4 sites) ===');
// Was served /^id+$/ — matched the literal string "id", never a real handle like i544205. 25 live
// rides carry one; 22 of them have no stravaId, so they were invisible to the backfill entirely.
const ICU = '/^i' + BS + BS + 'd+$/';
check('all four handle sites still present', findLines(ICU).length, 4);
findLines(ICU).forEach((_, k) => {
  const h = servedRe(ICU, k);
  check('line ' + h.line + ' matches a real handle', h.re.test('i544205'), true);
  check('line ' + h.line + ' rejects the literal "id"', h.re.test('id'), false);
  check('line ' + h.line + ' rejects a bare Strava id', h.re.test('9353779'), false);
  check('line ' + h.line + ' rejects an alphanumeric id', h.re.test('mrgukk4klcg3yxp'), false);
});

console.log('\n=== Firebase sparse-array detection: /^' + BS + 'd+$/ ===');
const sparse = servedRe('return keys.every(function(k){').re;
check('a numeric key is recognised', ['0', '1', '2'].every((k) => sparse.test(k)), true);
check('a real dictionary is NOT an array', ['breakfast', 'lunch'].every((k) => sparse.test(k)), false);
check('the literal "d" no longer counts', sparse.test('d'), false);

console.log('\n=== food search tokenizer: /' + BS + 's+/ ===');
const ws = servedRe('var qWords = ql.split(').re;
check('splits on whitespace', 'chicken breast'.split(ws).filter(Boolean), ['chicken', 'breast']);
check('no longer splits on the letter s', 'sweet potato'.split(ws).filter(Boolean), ['sweet', 'potato']);
check('a trailing s survives', 'oats'.split(ws).filter(Boolean), ['oats']);

console.log('\n=== date parsers: the timezone guard that never fired ===');
// Served /^(d{4})-(d{1,2})-(d{1,2})/ needed the literal text "dddd-dd-dd", so every date fell to
// the new Date(s) fallback — UTC midnight, which rolls back a day in a behind-UTC timezone. That
// is the exact bug the branch exists to prevent.
function weekKey(re, ds) {
  const s = String(ds), m = s.match(re);
  let d;
  if (m) d = new Date(+m[1], (+m[2]) - 1, +m[3]);
  else { d = new Date(s); if (isNaN(d.getTime())) return null; d = new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  const dw = d.getDay();
  d.setDate(d.getDate() - (dw === 0 ? 6 : dw - 1));
  const p = (n) => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
for (const anc of ['var s=String(ds), m=s.match(', 'var m=s.match(']) {
  const h = servedRe(anc), re = h.re, ln = h.line;
  check('line ' + ln + ' matches an ISO date', re.test('2026-07-27'), true);
  check('line ' + ln + ' captures the parts', '2026-07-27'.match(re).slice(1, 4), ['2026', '07', '27']);
  // A Monday must key to ITSELF, not to the Monday before it.
  check('line ' + ln + ': a Monday keys to its own week', weekKey(re, '2026-07-27'), '2026-07-27');
  check('line ' + ln + ': and a Sunday keys back to Monday', weekKey(re, '2026-07-26'), '2026-07-20');
}
const hrd = servedRe('var m=/^(').re;
check('the HR-drift card can read a date at all', hrd.exec('2026-07-23') !== null, true);
check('...and gets the right month/day', hrd.exec('2026-07-23').slice(2, 4), ['07', '23']);
check('a non-normalized date is still rejected', hrd.exec('2026-7-23'), null);

console.log('\n=== Coach V text parsing ===');
const rec1 = servedRe('recommendation=line.replace(').re;
check('strips the label AND the space after it', 'Recommendation: Keep it in zone 2.'.replace(rec1, ''), 'Keep it in zone 2.');
check('no longer eats a leading s', 'Recommendation:stay in zone'.replace(rec1, ''), 'stay in zone');
for (const anc of ['bullets.push(line.replace(', 'row.textContent=line.replace(']) {
  const b = servedRe(anc);
  check('line ' + b.line + ' strips the bullet cleanly', '- Held 182 W.'.replace(b.re, ''), 'Held 182 W.');
}
// The one that corrupted words: served /[,;s]+$/ stripped a trailing LETTER s.
const tail = servedRe('out.push(m[1].replace(').re;
check('a plural survives', 'You held good watts'.replace(tail, '') + '.', 'You held good watts.');
check('and trailing whitespace is actually stripped now', 'Trailing space  '.replace(tail, '') + '.', 'Trailing space.');
check('punctuation still stripped', 'Nice work,'.replace(tail, '') + '.', 'Nice work.');
const rec2 = servedRe('var isRec=').re;
check('an indented Recommendation line is seen', rec2.test('  Recommendation: ride easy'), true);
check('a tab-indented one too', rec2.test('\tRecommendation: ride easy'), true);
check('a plain one still matches', rec2.test('Recommendation: ride easy'), true);

console.log('\n=== duration -> minutes (weather window) ===');
const rh = servedRe('var hMatch=String(dur).match(').re, rm = servedRe('var mMatch=String(dur).match(').re;
function dur(s) {
  const parts = String(s).split(':');
  if (parts.length >= 2) return (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
  const h = String(s).match(rh), m = String(s).match(rm);
  return ((h ? parseInt(h[1]) * 60 : 0) + (m ? parseInt(m[1]) : 0)) || 90;
}
check('2h is 120, not the 90-minute default', dur('2h'), 120);
check('45m is 45', dur('45m'), 45);
check('3h 05m is 185', dur('3h 05m'), 185);
check('the colon form is unaffected', dur('1:30:07'), 90);

console.log('\n=== deploy build-stamp verification ===');
// Served /window\.__BUILD__s*=s*'([^']+)'/ could not match, because the emitted assignment has
// SPACES around the "=". Both outgoing and read-back read "(no stamp)", so the equality check that
// is supposed to prove the deploy landed passed vacuously every time.
const stampLine = lines.find((l) => /^window\.__BUILD__ = '/.test(l));
check('the app really does emit spaces around the =', /^window\.__BUILD__ = '/.test(stampLine || ''), true);
for (const anc of ['var m=src.match(', 'var bm=back.match(']) {
  const d = servedRe(anc);
  const m = (stampLine || '').match(d.re);
  check('line ' + d.line + ' now reads the stamp', m ? m[1] : '(no stamp)', stampLine.match(/'([^']+)'/)[1]);
}
// The check is only meaningful if a DIFFERENT stamp compares unequal.
const dre = servedRe('var m=src.match(').re;
const a = "window.__BUILD__ = '2026-07-28-alpha';".match(dre);
const b = "window.__BUILD__ = '2026-07-29-beta';".match(dre);
check('two different builds no longer compare equal', (a ? a[1] : 'x') === (b ? b[1] : 'x'), false);

console.log('\n=== the baseline is empty and must stay that way ===');
const guard = fs.readFileSync(path.join(root, 'scripts', 'served-escape-test.mjs'), 'utf8');
check('BASELINE holds no frozen offenders', /const BASELINE = new Set\(\[\]\);/.test(guard), true);

console.log('\n' + (fails ? R + fails + ' CHECK(S) FAILED' + X : G + 'served-regex-behaviour: all checks passed' + X));
process.exit(fails ? 1 : 0);
