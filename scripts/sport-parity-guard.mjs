// A SURFACE THAT COUNTS BOTH SPORTS MUST READ BOTH SPORTS.
//
// Twice in two days, found by the athlete rather than by anything here: Milestones cited "2,210
// runs" in its header and scored only cycling, and the Athlete Intelligence Overview did the same -
// _storeV2Runs is read exactly once on that page, to print the number in the header, and nowhere
// else. Neither was a decision. Both were simply never built, and nothing was watching.
//
// This is not the same failure as the identity and value-log guards. Nothing DISAGREES here; a whole
// sport is absent. So the signature is different: a render surface that reads the ride library and
// never touches the run library, or the reverse.
//
// WHY IT IS DECLARATION-BASED. Plenty of surfaces are single-sport on purpose - the Run Training page
// is runs-only by design, a ride detail page is about one ride. There is no way to tell "correctly
// single-sport" from "never finished" by reading the code, because the difference is intent. So the
// rule is: every single-sport surface must be DECLARED, with a reason. A new one fails the push until
// someone writes down which it is.
//
// That declaration is the whole mechanism. An audit produces a list that goes stale the day after it
// is written; this produces a question that has to be answered before the next push lands.
//
// Run: node scripts/sport-parity-guard.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8').replace(/\r\n/g, '\n');
const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';

// Surfaces that are single-sport ON PURPOSE. name -> why. Adding a line here is a decision, on the
// record, and is the only way past this guard.
const DECLARED = {
  // SINGLE-SPORT ON PURPOSE.
  renderRunInto_: 'the Run Training page - runs only by design, with cycling served by its own surfaces',
  dsShowCalendar: 'covers every sport through st.rides; the ride-typed accessor is only for deduped totals',
  renderCalendar: 'same - the all-sport library is st.rides, which this reads',
  renderBlockPlan_: 'the training block prescribes both and is sport-agnostic; the single ride read is a completion lookup',

  // DELEGATES. The run coverage is real but one level down, and following calls made this guard
  // WORSE rather than better (see the note by the scan), so it is declared instead.
  aiRenderMilestones_: 'scores running through _msCatalog_, which reads _msRunning_ - added 2026-08-26',

  // OPEN, NOT EXCUSED. These are genuinely cycling-only and should not be. Written down so the guard
  // can pass on the current tree while a NEW one still fails, and so the list is read out every run
  // rather than living in someone memory.
  aiRenderOverview_: 'OPEN: every card is cycling. The run library is read once, for the header count, '
    + 'and nowhere else - reported by the athlete 2026-08-26. A running summary card is being added.',
  aiRenderRacing_: 'OPEN: You vs. You is cycling-scoped. Unreviewed.',
  aiRenderTrends_: 'OPEN: Trends is cycling-scoped. Unreviewed.'
};

// What counts as reading each library.
//
// st.rides is DELIBERATELY NOT on the ride list. It mixes every sport - runs, walks, strength, the
// lot - so reading it is not evidence of being cycling-only, and treating it as such flagged the
// Calendar and the Dashboard, both of which cover all sports through it. Only the RIDE-TYPED
// accessors count. Getting this wrong is how a guard ends up with 22 findings and gets muted.
const READS_RIDE = /allRidesDeduped_\(|allRidesLegacy_\(|_msCycling_\(/;
const READS_RUN  = /getRuns\(|_runAll_\(|_msRunning_\(|_storeV2Runs\b|getRunsLegacy_\(/;

// Only RENDER SURFACES. A helper that aggregates one library is not a page and is not the subject
// here - the claim is about what a page shows, not about what a function computes.
const IS_SURFACE = /^(aiRender[A-Z]|dsShow[A-Z]|render[A-Z]|showHome|showAI)/;

function bodies() {
  const out = new Map();
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
    if (!out.has(m[1])) out.set(m[1], src.slice(open, end + 1));
  }
  return out;
}

// Comments describe bugs and intentions and routinely name both libraries. Strip them, or the guard
// reads a comment about runs as evidence that runs are handled.
const noCmt = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const fns = bodies();
const findings = [];
const open = [];
// NO CALL-FOLLOWING. Tried it: pulling in the helpers a surface names directly took the findings
// from 8 to 13 and added renderNutr and renderFoodRows, which have nothing to do with either
// library - a shared formatter drags in whatever IT touches. The direct body is the precise
// signal; delegation is handled by DECLARED, which is the point of the declaration.

for (const [name, raw] of fns) {
  if (!IS_SURFACE.test(name)) continue;
  const body = noCmt(raw);
  const nRide = (body.match(new RegExp(READS_RIDE.source, 'g')) || []).length;
  const nRun = (body.match(new RegExp(READS_RUN.source, 'g')) || []).length;
  if (!nRide && !nRun) continue;
  if (DECLARED[name]) { if (/^OPEN:/.test(DECLARED[name])) open.push({ name, why: DECLARED[name] }); continue; }
  if (!nRun) { findings.push({ name, kind: 'absent', has: 'rides', missing: 'runs' }); continue; }
  if (!nRide) { findings.push({ name, kind: 'absent', has: 'runs', missing: 'rides' }); continue; }
  // A TOKEN READ. The Overview reads the run library exactly once, to print "2,210 runs" in its
  // header, and never again - so every card on it is cycling and the page reads as though runs are
  // covered. One read beside several is a mention, not coverage, and it is the more dangerous of the
  // two shapes precisely because it looks handled.
  // The counts are too crude to say WHICH way round with confidence - the Overview reads the run
  // library twice (a declaration and a use) and the ride accessor once, yet every card on it is
  // cycling. So this reports the counts and does not assert a direction: a lopsided read is a
  // question for a person, not a verdict from a grep.
  if (nRun === 1 || nRide === 1) findings.push({ name, kind: 'token', nRide, nRun });
}

console.log('');
console.log(Y + '=== a surface reads both sports, or declares why it does not ===' + X);
console.log('  ' + fns.size + ' functions scanned, ' + [...fns.keys()].filter(n => IS_SURFACE.test(n)).length + ' render surfaces');
// The open list prints every run. A finding carried silently stops being a finding - the whole
// failure this guard exists for is a gap nobody was looking at.
const readOut = () => open.forEach(o => {
  console.log('  ' + Y + 'OPEN' + X + '  ' + o.name + '()  ' + o.why.replace(/^OPEN:\s*/, ''));
});
if (!findings.length) {
  console.log('  ' + G + 'PASS' + X + '  no NEW undeclared single-sport surface');
  readOut();
  console.log('');
  console.log(G + 'sport parity: clean (' + open.length + ' open, listed above)' + X);
  process.exit(0);
}
findings.forEach(f => {
  console.log('  ' + R + 'FAIL' + X + '  ' + f.name + '()  ' + (f.kind === 'token'
    ? ('reads the ride library ' + f.nRide + 'x and the run library ' + f.nRun + 'x - one of those is a '
       + 'mention rather than coverage; say which')
    : ('reads ' + f.has + ' and never ' + f.missing)));
});
readOut();
console.log('');
console.log(R + findings.length + ' undeclared single-sport surface(s)' + X);
console.log('  Either read the other library, or add the surface to DECLARED with the reason it is');
console.log('  single-sport on purpose. "Never got round to it" is a reason - write that one down too.');
process.exit(1);
