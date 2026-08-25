// A FULL-SCREEN SHEET REACHABLE FROM THE DESKTOP MUST CLEAR THE DESKTOP SHELL.
//
// #desktop-shell is position:absolute z-index:999. A position:fixed overlay with a LOWER z-index
// opens completely behind the app on desktop: present in the DOM, invisible, unclickable. It still
// works on mobile, where no shell exists, so it reads as "that button does nothing" on one surface
// only - which is exactly how it has been reported both times it has happened.
//
// FOUND TWICE. openRaceEditor carries a comment recording the first: "at 300 it opened behind the
// desktop shell - invisible/unclickable - which is why + Add and race rows appeared to do nothing on
// desktop". Three Run-page sheets written afterwards repeated it at 320 and 330 and were reported
// the same way. A comment next to the fix did not stop the next one.
//
// WHY THIS IS REACHABILITY-GATED, NOT A FLAT GREP. The flat version flags 19 overlays, of which most
// are mobile-only screens that are never on screen while the shell is - RUN-SCREEN and its siblings
// are supposed to be at 200. A guard that reports 19 findings where 3 are real gets muted, which is
// how every previous convention here died. So this only flags overlays created inside functions
// actually reachable from a desktop entry point.
//
// Run: node scripts/stacking-guard.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8').replace(/\r\n/g, '\n');
const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';

const shell = src.match(/#desktop-shell\{[^}]*z-index:(\d+)/);
if (!shell) { console.log(R+'FAIL'+X+'  cannot read #desktop-shell z-index'); process.exit(1); }
const FLOOR = parseInt(shell[1], 10);

// ---- top-level functions, by brace matching ----
const fns = new Map();                                  // name -> {body, startLine}
const re = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
let m;
while ((m = re.exec(src))) {
  const open = src.indexOf('{', re.lastIndex);
  if (open < 0) continue;
  let d = 0, end = -1;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (!d) { end = j; break; } }
  }
  if (end < 0) continue;
  const body = src.slice(open, end + 1);
  if (!fns.has(m[1])) fns.set(m[1], { body, startLine: src.slice(0, m.index).split('\n').length });
}

// ---- call graph, closed over desktop entry points ----
const names = [...fns.keys()];
const calls = new Map();
for (const [n, f] of fns) {
  const out = new Set();
  for (const c of names) if (c !== n && f.body.includes(c + '(')) out.add(c);
  calls.set(n, out);
}
// Seeds: everything the desktop shell can start from.
const seeds = names.filter(n => /^ds[A-Z]/.test(n) || n === 'renderRunInto_');
const reach = new Set(seeds);
const stack = [...seeds];
while (stack.length) {
  const n = stack.pop();
  for (const c of calls.get(n) || []) if (!reach.has(c)) { reach.add(c); stack.push(c); }
}

// ---- the check ----
const offenders = [];
for (const n of reach) {
  const f = fns.get(n); if (!f) continue;
  f.body.split('\n').forEach((ln, i) => {
    if (!/position:fixed/.test(ln)) return;
    if (!/inset:0|top:0/.test(ln)) return;              // full-screen covers only
    if (/bottom:60px/.test(ln)) return;                 // a mobile screen inset above the mobile nav
    const z = ln.match(/z-index:(\d+)/); if (!z) return;
    const v = parseInt(z[1], 10); if (v > FLOOR) return;
    offenders.push({ fn: n, line: f.startLine + i, z: v, text: ln.trim().slice(0, 88) });
  });
}

// Findings that are REAL but outside the scope they were found in. Listed so the guard can pass on
// the current tree while a NEW one still fails - a baseline, not an excuse. Each is a sheet that
// opens behind the desktop shell and needs its owning page looked at.
const OPEN = new Set(['doSwap','showNotifications','openFoodForMeal','dsShowCalendar','calDayPick_',
                      'deleteRide','showMoreSheet']);
const fresh = offenders.filter(o => !OPEN.has(o.fn));
const known = offenders.filter(o => OPEN.has(o.fn));

console.log('');
console.log(Y + '=== desktop-reachable overlays must clear #desktop-shell (z-index:' + FLOOR + ') ===' + X);
console.log('  ' + reach.size + ' functions reachable from ' + seeds.length + ' desktop entry points');
if (!fresh.length) {
  console.log('  ' + G + 'PASS' + X + '  no NEW overlay opens below the shell');
} else {
  fresh.sort((a,b)=>a.line-b.line).forEach(o => {
  console.log('  ' + R + 'FAIL' + X + '  worker.js:' + o.line + '  in ' + o.fn + '()  z-index:' + o.z);
  console.log('        ' + o.text);
});
}
// The baseline prints every run. A finding carried silently stops being a finding.
known.sort((a,b)=>a.line-b.line).forEach(o => {
  console.log('  ' + Y + 'OPEN' + X + '  worker.js:' + o.line + '  ' + o.fn + '()  z-index:' + o.z
    + ' - opens behind the shell, outside the scope it was found in');
});
console.log('');
if (fresh.length) {
  console.log(R + fresh.length + ' NEW overlay(s) open behind the desktop shell' + X);
  process.exit(1);
}
console.log(G + 'stacking guard: clean (' + known.length + ' open, listed above)' + X);
process.exit(0);
