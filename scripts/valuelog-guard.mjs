// A DATED VALUE LOG MUST DECLARE HOW IT MERGES.
//
// Some stores hold ONE value per date, corrected in place: the weight log, the FTP history, the
// weekday easy-run target. Those need real merge semantics, because two devices can each write the
// same date and only one answer is right. _LWW_ARRAYS is where that is declared - keys plus the value
// field - and mergeState_ resolves registered arrays by editedAt.
//
// An array that is NOT in _LWW_ARRAYS gets UNIONED. For an event log - runs, rides, notes, injuries -
// that is correct: every record is a separate real thing and none supersedes another. For a dated
// value log it is silently wrong: the correction does not replace the original, both survive, and
// which one a reader sees depends on array order after a sync.
//
// That is how st.runRungs shipped. It is the same shape as ftpHistory, written the day after
// ftpHistory was fixed, and it was never added to the list. Nothing detected it because nothing was
// looking - the fix had been applied to a store, not to the class.
//
// THE DISCRIMINATOR IS THE ID, NOT THE FIELDS. "Has a date and a number" describes an event log too,
// and flagging st.runs or st.rides would make this noise. What separates a value log is that its
// identity is the DATE: either it carries no id at all (keyed on date by the merge), or its id is
// built from date-ish fields only. An id built from Date.now() or a source id means many records per
// day are expected, which is an event log, and those are correctly unioned.
//
// Run: node scripts/valuelog-guard.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';

// Field names that denote the day a record belongs to.
const DATEISH = new Set(['date', 'from', 'day', 'dk', 'dateKey', 'on', 'when', 'week', 'month', 'ym']);
// Things an id can be built from that are not fields at all.
const NOT_A_FIELD = new Set(['id', 'key', '_k', 'Date', 'now', 'Math', 'round', 'floor', 'String',
  'Number', 'JSON', 'slice', 'toString', 'length', 'random', 'parseInt', 'parseFloat', 'stringify']);
// A record with one of these is an EVENT, not a corrected value: it has its own external identity.
const EVENT_MARKERS = new Set(['stravaId', 'activityId', 'rideId', 'fid', 'ts', 'at']);

const IDENT = /[A-Za-z_$][\w$]*/g;

// Stores that look like this but are not: each line is a decision, on the record, with its reason.
const REVIEWED = {
  // Rides are an EVENT log with their own identity layer - rideKey plus the stravaId coercion and
  // the tombstone rules - which is deliberately not _LWW_ARRAYS. This particular push is the bulk CSV
  // import, which is why it carries no stravaId on the literal.
  rides: 'deduped by rideKey_, its own identity layer'
};

// Findings that are REAL and not yet fixed. Listed so the guard can pass on the current tree while a
// NEW one still fails - a baseline, not an excuse. Empty this list by fixing them, never by editing
// the rule. Anything here should be quoted in full when the guard is reported on.
const OPEN = {
  recoveryLog: 'REAL, UNFIXED: one hrv/rhr reading per date with no id and no merge rule, so two '
    + 'devices writing the same day both survive. Its readers already work around this by scanning '
    + 'the array BACKWARDS to take the last match. Out of the Run Training scope this was found in; '
    + 'needs the owner to decide, since it touches the HRV and readiness surfaces.'
};

function registeredStores(src) {
  const out = new Set();
  const at = src.indexOf('var _LWW_ARRAYS');
  if (at < 0) return out;
  const end = src.indexOf('};', at);
  const block = src.slice(at, end < 0 ? at + 4000 : end);
  const re = /(?:^|[{,\s])([A-Za-z_$][\w$]*)\s*:\s*\{\s*keys\s*:/gm;
  let m;
  while ((m = re.exec(block))) out.add(m[1]);
  return out;
}

// Split an object literal into { key, value } property pairs at depth 0.
function props(lit) {
  const inner = lit.replace(/^\{/, '').replace(/\}$/, '');
  const parts = [];
  let d = 0, cur = '';
  for (const c of inner) {
    if (c === '{' || c === '(' || c === '[') d++;
    else if (c === '}' || c === ')' || c === ']') d--;
    if (c === ',' && d === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  const out = [];
  for (const p of parts) {
    const colon = p.indexOf(':');
    if (colon < 0) continue;
    const k = p.slice(0, colon).trim().replace(/^['"]/, '').replace(/['"]$/, '');
    if (!/^[A-Za-z_$][\w$]*$/.test(k)) continue;
    out.push({ key: k, val: p.slice(colon + 1).trim() });
  }
  return out;
}

function scan(src) {
  src = src.replace(/\r\n/g, '\n');
  const REG = registeredStores(src);
  const lines = src.split('\n');
  const lineStart = [];
  let acc = 0;
  for (const ln of lines) { lineStart.push(acc); acc += ln.length + 1; }

  const out = [];
  const re = /\bst\.([A-Za-z_$][\w$]*)\s*\.push\s*\(\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const store = m[1];
    const open = src.indexOf('{', m.index + m[0].length - 1);
    let d = 0, close = -1;
    for (let j = open; j < src.length && j < open + 6000; j++) {
      if (src[j] === '{') d++;
      else if (src[j] === '}') { d--; if (!d) { close = j; break; } }
    }
    if (close < 0) continue;
    const lit = src.slice(open, close + 1);
    const P = props(lit);
    if (!P.length) continue;

    const hasDate = P.some(p => DATEISH.has(p.key));
    if (!hasDate) continue;
    if (P.some(p => EVENT_MARKERS.has(p.key))) continue;   // carries its own external identity

    const idProp = P.find(p => p.key === 'id' || p.key === 'key');
    let datedIdentity;
    if (!idProp) {
      datedIdentity = true;                                 // no id at all: the date IS the key
    } else {
      const bare = idProp.val.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
      const toks = (bare.match(IDENT) || []).filter(t => !NOT_A_FIELD.has(t));
      // An id built ONLY from date-ish fields means one record per day is intended.
      datedIdentity = toks.length > 0 && toks.every(t => DATEISH.has(t));
    }
    if (!datedIdentity) continue;
    if (REG.has(store)) continue;

    let line = 1;
    for (let i = 0; i < lineStart.length; i++) { if (lineStart[i] > m.index) break; line = i + 1; }
    out.push({ store, line, snippet: lit.replace(/\s+/g, ' ').slice(0, 74) });
  }
  return out;
}

let fails = 0;

// ---- POSITIVE CONTROL ----
const FIXTURE = [
  "var _LWW_ARRAYS = { weightLog:{ keys:['date'], val:'weight' } };",
  "function a(){ st.runRungs.push({ id:'rr-'+from, from:from, top:top, editedAt:Date.now() }); }",
  "function b(){ st.weightLog.push({ date:d, weight:w, editedAt:Date.now() }); }",
  "function c(){ st.runs.push({ id:'run-'+Date.now(), date:d, distance:mi, time:t }); }",
  "function e(){ st.rides.push({ date:d, stravaId:sid, distance:mi }); }"
].join('\n');
const ctl = scan(FIXTURE);
const caught = ctl.some(f => f.store === 'runRungs');
const falsePos = ctl.filter(f => f.store !== 'runRungs').map(f => f.store);
console.log('');
console.log(Y + '=== positive control ===' + X);
console.log('  ' + (caught ? G + 'PASS' + X : R + 'FAIL' + X) + '  catches an unregistered dated value log');
console.log('  ' + (!falsePos.length ? G + 'PASS' + X : R + 'FAIL' + X) +
  '  NEG: leaves registered stores and event logs alone' + (falsePos.length ? '   flagged: ' + falsePos.join(', ') : ''));
if (!caught || falsePos.length) fails++;

// ---- THE REAL FILE ----
const findings = scan(fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8'));
console.log('');
console.log(Y + '=== every dated value log declares its merge semantics ===' + X);
const fresh = findings.filter(f => !REVIEWED[f.store] && !OPEN[f.store]);
const known = findings.filter(f => OPEN[f.store]);
if (!fresh.length) {
  console.log('  ' + G + 'PASS' + X + '  no NEW unregistered dated value log');
} else {
  fresh.forEach(f => {
    console.log('  ' + R + 'FAIL' + X + '  worker.js:' + f.line + '  st.' + f.store + ' is a dated value log and is not in _LWW_ARRAYS');
    console.log('        ' + f.snippet);
  });
  console.log('  Unregistered arrays are UNIONED, so a same-day correction does not replace the original.');
  fails += fresh.length;
}
// The baseline is printed every run. A finding that is carried silently stops being a finding.
known.forEach(f => {
  console.log('  ' + Y + 'OPEN' + X + '  worker.js:' + f.line + '  st.' + f.store);
  console.log('        ' + OPEN[f.store]);
});
console.log('');
console.log(fails ? (R + fails + ' FAILED' + X) : (G + 'value-log guard: clean' + X));
process.exit(fails ? 1 : 0);
