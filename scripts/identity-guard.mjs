// A RECORD'S IDENTITY MUST NOT CONTAIN A VALUE THE RECORD CAN CHANGE.
//
// When a mutable field is concatenated into an id, correcting that field does not UPDATE the record -
// it MINTS A NEW ONE. Both survive the merge, and whichever the reader happens to resolve wins. The
// correction can never take, because the thing being corrected is the thing being keyed on.
//
// This is the ftpHistory bug: the composite key carried the ftp VALUE, so lowering 190 to 183 forked
// instead of superseding and 190 could never be removed. It was fixed by keying on date alone.
//
// It recurred the next day. runSetWeekdayTarget_ was written as
//     var rec={ id:'rr-'+from+'-'+top, from:from, top:top, ... };
// with top - the value being set - inside the identity. Accepting 36 and then correcting down to 30
// on the same day produces two records with the same from and different ids; st.runRungs is not in
// _LWW_ARRAYS so mergeState_ unions rather than resolving them, and _runRungStruct_ breaks the tie on
// array order rather than editedAt.
//
// The rule: an id may be built from IMMUTABLE key fields and from values that are not fields of the
// record at all (Date.now, a counter). It may never carry a field whose purpose is to be edited.
//
// TWO THINGS THIS FILE HAD TO LEARN THE HARD WAY, both of which are why it looks like this:
//
//   THE POSITIVE CONTROL IS NOT OPTIONAL. The first version passed clean against a file containing
//   the exact bug it was written for. An offset error meant it never read the object literal at all.
//   A guard that cannot demonstrate a catch is evidence of nothing, so the known-bad fixture below
//   runs on every invocation and the guard fails if it ever stops being caught.
//
//   NO ESCAPES INSIDE BUILT PATTERNS. The second version still missed it: written through a heredoc,
//   a doubled backslash arrives on disk halved, so "\\s" inside a JS string became "\s" and then the
//   literal letter s. Valid, silent, wrong - the same hazard the served template has, in a different
//   pipeline. The field check below is therefore a plain string scan with no regex at all.
//
// Run: node scripts/identity-guard.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';

// Reviewed constructions: snippet -> why it is safe. A line here is a decision, on the record.
const REVIEWED = {
  // An in-memory cache key on window._dsAttnNarr, not a stored record. It is content-addressed ON
  // PURPOSE: the key changing is what invalidates the cache when the signals change. Nothing merges
  // it and nothing corrects it, so there is no fork to create.
  "key:'ctxonly|'+only.bullets.join('~')": 'in-memory cache key, content-addressed by design'
};

// A field MAY appear in an id when it is a DECLARED MERGE KEY - that is what an identity is made of.
// The allowed set is read from _LWW_ARRAYS rather than hardcoded, so the way to make an id legitimate
// is to declare how its store merges, which is exactly what was missing in both the ftpHistory and
// the runRungs case. An id built from an UNDECLARED field is the finding.
function declaredKeyFields(src) {
  const out = new Set();
  const at = src.indexOf('var _LWW_ARRAYS');
  if (at < 0) return out;
  const end = src.indexOf('};', at);
  const block = src.slice(at, end < 0 ? at + 4000 : end);
  const re = /keys\s*:\s*\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(block))) {
    for (const raw of m[1].split(',')) {
      const k = raw.trim().replace(/^['"]/, '').replace(/['"]$/, '');
      if (k) out.add(k);
    }
  }
  return out;
}

// Sources that are not fields of the record: a clock, a counter, a cast.
const NOT_A_FIELD = new Set(['id', 'key', '_k', 'Date', 'now', 'Math', 'round', 'floor', 'String',
  'Number', 'JSON', 'slice', 'toString', 'length', 'random', 'parseInt', 'parseFloat', 'stringify']);

const IDENT = /[A-Za-z_$][\w$]*/g;
const ID_DECL = /\b(id|key|_k)\s*:\s*('[^']*'|"[^"]*")?\s*\+/;

// Is `token` stored as the VALUE of some property in this object literal - i.e. does the literal
// contain `something: token` as a whole property? Done by splitting rather than by pattern, so no
// escape can be eaten on the way to disk.
function isStoredAsField(lit, token) {
  const inner = lit.replace(/^\{/, '').replace(/\}$/, '');
  for (const part of inner.split(',')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    const key = part.slice(0, colon).trim();
    const val = part.slice(colon + 1).trim();
    if (val !== token) continue;
    if (!key.length) continue;
    // The key must be a bare identifier or a quoted name, not an expression.
    const bare = key.replace(/^['"]/, '').replace(/['"]$/, '');
    if (/^[A-Za-z_$][\w$]*$/.test(bare)) return true;
  }
  return false;
}

function scan(src) {
  src = src.replace(/\r\n/g, '\n');
  const lines = src.split('\n');
  // Real offsets, computed once. The first version derived these by re-joining the prefix and lost a
  // newline per line, so lastIndexOf walked into an unrelated literal thousands of characters away.
  const KEYS = declaredKeyFields(src);
  const lineStart = [];
  let acc = 0;
  for (const ln of lines) { lineStart.push(acc); acc += ln.length + 1; }

  const out = [];
  lines.forEach((ln, i) => {
    const idm = ln.match(ID_DECL);
    if (!idm) return;
    const at = lineStart[i] + ln.indexOf(idm[0]);
    const open = src.lastIndexOf('{', at);
    if (open < 0) return;
    let d = 0, close = -1;
    for (let j = open; j < src.length && j < open + 6000; j++) {
      if (src[j] === '{') d++;
      else if (src[j] === '}') { d--; if (!d) { close = j; break; } }
    }
    if (close < 0 || close < at) return;
    const lit = src.slice(open, close + 1);

    const idStart = lit.indexOf(idm[0]);
    if (idStart < 0) return;
    let dd = 0, idEnd = lit.length;
    for (let j = idStart; j < lit.length; j++) {
      const c = lit[j];
      if (c === '(' || c === '[') dd++;
      else if (c === ')' || c === ']') dd--;
      else if ((c === ',' || c === '\n') && dd === 0) { idEnd = j; break; }
    }
    const idExpr = lit.slice(idStart, idEnd);
    const bare = idExpr.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
    const used = new Set((bare.match(IDENT) || []).filter(t => !NOT_A_FIELD.has(t)));

    const carried = [...used].filter(t => !KEYS.has(t) && isStoredAsField(lit, t));
    if (!carried.length) return;

    const snippet = idExpr.replace(/\s+/g, ' ').trim().slice(0, 74);
    if (REVIEWED[snippet]) return;
    out.push({ line: i + 1, carried, snippet });
  });
  return out;
}

let fails = 0;

// ---- POSITIVE CONTROL ----
const FIXTURE = [
  // The fixture needs the same declared-key context worker.js has, or every field looks undeclared.
  "var _LWW_ARRAYS = { runRungs:{ keys:['from'], val:'top' } };",
  'function writeIt_(from, top){',
  "  var rec={ id:'rr-'+from+'-'+top, from:from, top:top, editedAt:Date.now() };",
  '  return rec;',
  '}',
  'function safeOne_(name){',
  "  var r={ id:'race-'+Date.now(), name:name, date:'2026-10-18' };",
  '  return r;',
  '}'
].join('\n');
const ctl = scan(FIXTURE);
const caughtBad = ctl.some(f => f.carried.includes('top'));
const flaggedGood = ctl.some(f => f.snippet.indexOf('race-') >= 0);
console.log('');
console.log(Y + '=== positive control ===' + X);
console.log('  ' + (caughtBad ? G + 'PASS' + X : R + 'FAIL' + X) + '  catches a value carried into its own id');
console.log('  ' + (!flaggedGood ? G + 'PASS' + X : R + 'FAIL' + X) + '  NEG: does not flag an id built from Date.now()');
if (!caughtBad || flaggedGood) fails++;

// ---- THE REAL FILE ----
const findings = scan(fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8'));
console.log('');
console.log(Y + '=== a record id must not carry a field the record can change ===' + X);
if (!findings.length) {
  console.log('  ' + G + 'PASS' + X + '  no identity carries one of its own fields');
} else {
  findings.forEach(f => {
    console.log('  ' + R + 'FAIL' + X + '  worker.js:' + f.line + '  id carries its own field(s): ' + f.carried.join(', '));
    console.log('        ' + f.snippet);
  });
  console.log('  Key on immutable fields only, so a correction supersedes instead of forking.');
  fails += findings.length;
}
console.log('');
console.log(fails ? (R + fails + ' FAILED' + X) : (G + 'identity guard: clean' + X));
process.exit(fails ? 1 : 0);
