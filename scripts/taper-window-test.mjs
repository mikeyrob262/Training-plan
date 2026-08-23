// ARRIVING FRESH FOR A MEASURED EFFORT.
//
// A retest ridden at form -8 measures fatigue as much as it measures FTP, and this app then prices
// every training band off that number for weeks. So a tired test is not one bad afternoon, it is a
// wrong FTP with a long tail. The attention panel now says so while there is still time to act.
//
// Two things this guards that are easy to get wrong later:
//   THE DATE comes from the milestone list BY SLUG, through _blockMilestonesEffective_ so it reads
//   the SLID date. Eight places in this file once held these dates and a respace orphaned the ones
//   keyed on a date string; a constant retyped here would be the ninth.
//   THE BAND is named once. Copy that says "+5 to +15" while the comparison uses something else is
//   the same class of lie as a caption describing arithmetic the code never does.
//
// Run: node scripts/taper-window-test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const code = src.replace(/^\s*\/\/.*$/gm, '');
const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l); };
const eq = (l, got, want) => { const c = JSON.stringify(got) === JSON.stringify(want); if (!c) fails++;
  console.log('  ' + (c ? G+'PASS'+X : R+'FAIL'+X) + '  ' + l + (c ? '' : '   got '+JSON.stringify(got)+', want '+JSON.stringify(want))); };

console.log('\n' + Y + '=== the band is declared once, not written into prose ===' + X);
ok('the window and lead-in are named constants', /var _TAPER_TSB_LO=5, _TAPER_TSB_HI=15, _TAPER_LEAD_D=14;/.test(code));
ok('the copy interpolates them rather than repeating the numbers',
   /under the \+'\+_TAPER_TSB_LO\+' to \+'\+_TAPER_TSB_HI/.test(code));
ok('...on the over-rested branch too', /above the \+'\+_TAPER_TSB_LO\+' to \+'\+_TAPER_TSB_HI/.test(code));
ok('NEG: no hardcoded "+5 to +15" in the sentences', !/\+5 to \+15/.test(code));

console.log('\n' + Y + '=== the date is looked up, never retyped ===' + X);
ok('it reads the effective milestone list', /_blockMilestonesEffective_\(new Date\(\)\):\[\]/.test(code));
ok('...matching on SLUG', /_TAPER_BENCH_SLUGS\[m\.slug\]/.test(code));
ok('NEG: it does not read _FTP_RETEST_DATE directly', !/_TAPER[\s\S]{0,600}_FTP_RETEST_DATE/.test(code));
ok('the benchmark set is declared and excludes the consistency gate',
   /_TAPER_BENCH_SLUGS=\{'ftp-retest':1,'chalet':1,'alpe':1,'ventop':1,'tenk':1\}/.test(code)
   && !/_TAPER_BENCH_SLUGS=\{[^}]*four-weeks/.test(code));
ok('a milestone already past is skipped', /if\(!\(dd>=0\) \|\| dd>_TAPER_LEAD_D\) return;/.test(code));
ok('the SOONEST qualifying effort wins', /if\(!_tpNext \|\| dd<_tpNext\.days\)/.test(code));

console.log('\n' + Y + '=== a rule with no data skips ===' + X);
ok('it requires a loaded fitness reading', /if\(_tpNext && fit && fit\.loaded\)\{/.test(code));
ok('...from the single fitness source the ring also reads', /var fit=\(typeof getFitness_==='function'\)\?getFitness_\(\)/.test(code));

console.log('\n' + Y + '=== the decision, exercised ===' + X);
{
  // Reproduce the branch selection rather than the wording, so the thresholds are tested and the
  // copy is free to be edited.
  const LO = 5, HI = 15;
  const verdict = (tsb) => (tsb < LO ? 'under' : (tsb > HI ? 'over' : 'in'));
  eq('the reported case: form -8 before a retest is flagged', verdict(-8), 'under');
  eq('form 0 is still under the window', verdict(0), 'under');
  eq('form +4 is under by one', verdict(4), 'under');
  eq('form +5 is the bottom of the window', verdict(5), 'in');
  eq('form +10 sits in it', verdict(10), 'in');
  eq('form +15 is the top of the window', verdict(15), 'in');
  eq('form +16 is over-rested', verdict(16), 'over');
  eq('form +30 likewise', verdict(30), 'over');

  // The lead-in gate: only efforts inside the window, and never one already gone.
  const LEAD = 14;
  const near = (days) => (days >= 0 && days <= LEAD);
  eq('an effort today qualifies', near(0), true);
  eq('five days out qualifies', near(5), true);
  eq('fourteen days out is the edge, still in', near(14), true);
  eq('fifteen days out is too far to act on', near(15), false);
  eq('NEG: yesterday does not qualify', near(-1), false);

  // Day wording, which reads badly if 0 and 1 are not special-cased.
  const when = (d) => (d === 0 ? 'Today' : (d === 1 ? 'Tomorrow' : d + ' days'));
  eq('same-day reads as Today', when(0), 'Today');
  eq('one day reads as Tomorrow', when(1), 'Tomorrow');
  eq('five days reads as a count', when(5), '5 days');
  const sign = (t) => (t > 0 ? '+' : '') + t;
  eq('a positive form carries its sign', sign(12), '+12');
  eq('a negative one needs no help', sign(-8), '-8');
}

console.log('\n' + Y + '=== it advises, it does not alarm ===' + X);
{
  // Severity 1 on every branch: this is guidance with time to act on it, not an emergency. Firing
  // sev 2 would put it alongside "form is deep in the red" and read as a problem rather than a plan.
  // The end marker is searched FROM the start offset. Anchoring it at the file's first '// Goals'
  // found an earlier one elsewhere, which sits BEFORE this block - so the slice came back empty and
  // three content assertions failed while the code was correct, with the NEG passing trivially
  // because there was nothing in it to fail on. An empty haystack satisfies every negative check.
  const segStart = code.indexOf('var _tpMs=');
  const segEnd = code.indexOf('var races=', segStart);
  ok('the block is actually located, so the checks below have something to read',
     segStart > 0 && segEnd > segStart);
  const seg = code.slice(segStart, segEnd);
  ok('the under-rested branch is advisory', /push\(1,'training',_tpLead\+' — form is '\+_tpF\+', under/.test(seg));
  ok('the over-rested branch too', /push\(1,'training',_tpLead\+' — form is '\+_tpF\+', above/.test(seg));
  ok('NEG: nothing here escalates to urgent', !/push\(2,/.test(seg));
  ok('being in the window is stated as a positive, not silence', /out\.positives\.push\('Form '\+_tpF\+' is in the window/.test(seg));
}

console.log('');
if (fails) { console.log(R + 'taper window: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'taper window: all checks passed' + X + '\n');
