// Regex escapes eaten by the served template literal.
//
// worker.js is emitted inside ONE backtick template literal, which consumes a backslash level:
// /\d+/ written in source is SERVED as /d+/. That is still a valid regex, so preflight's
// browser-equivalent parse passes and its control-character sweep sees nothing — the pattern just
// matches the wrong thing, silently, forever. The correct spelling in source is /\\d+/.
//
// This shipped and cost real behaviour: _structIntervals_ was served as /(d+)s*[x×]s*(d+)/, which
// never matched a struct like "4x4 min, 3 min recovery". Every interval session therefore fell
// through to the continuous branch, and a 4x4 VO2 exported to Zwift as ONE 45-minute block at
// 100% FTP. The session-detail step list lost its per-interval breakdown the same way.
//
// The baseline is now EMPTY. All 18 pre-existing offenders were fixed in one pass; what each was
// matching wrong, and what changed, is asserted in scripts/served-regex-behaviour-test.mjs. Any
// hit here is therefore a NEW bug — do not add to the baseline to make the build pass.
//
// Run: node scripts/served-escape-test.mjs
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');
const lines = src.split('\n');

// Everything before the template literal opens is ordinary server-side code; its escapes are fine.
const TPL = lines.findIndex((l) => l.indexOf('return new Response(`') >= 0) + 1;

const reLit = new RegExp('/(?![/*])((?:[^/\\\\\\n]|\\\\.)+)/[gimsuy]*', 'g');
const dbl = new RegExp('\\\\\\\\[dswDSWb]', 'g');          // \\d — correct, survives as \d
const single = new RegExp('(^|[^\\\\])\\\\[dswDSWb]');      // \d  — eaten, served as bare d

const BASELINE = new Set([]);

const found = [];
lines.forEach((L, i) => {
  if (i + 1 < TPL) return;
  if (/^\s*\/\//.test(L)) return;
  reLit.lastIndex = 0;
  let m;
  while ((m = reLit.exec(L))) {
    const body = m[1];
    if (!single.test(body.replace(dbl, ''))) continue;
    found.push({ line: i + 1, body });
  }
});

const R = '\x1b[31m', G = '\x1b[32m', X = '\x1b[0m';
const fresh = found.filter((f) => !BASELINE.has(f.body));
const servedAs = (b) => b.replace(new RegExp('\\\\([dswDSWb])', 'g'), '$1');

if (fresh.length) {
  console.error(`${R}${fresh.length} regex literal(s) will lose their escapes when served:${X}`);
  fresh.slice(0, 10).forEach((f) => {
    console.error(`${R}  worker.js:${f.line}${X}`);
    console.error(`     source: /${f.body}/`);
    console.error(`     served: /${servedAs(f.body)}/   <- what the browser actually runs`);
  });
  console.error(`\n  Fix: double the backslash in worker.js (\\\\d, \\\\s, \\\\w, \\\\b).`);
  process.exit(1);
}

const stale = [...BASELINE].filter((b) => !found.some((f) => f.body === b));
if (stale.length) {
  console.log(`${G}served escapes: ${found.length} known offender(s); ${stale.length} baseline entr(y/ies) now fixed — remove from BASELINE:${X}`);
  stale.forEach((b) => console.log('     /' + b + '/'));
} else {
  console.log(`${G}served escapes: no new offenders (${found.length} known, frozen)${X}`);
}
