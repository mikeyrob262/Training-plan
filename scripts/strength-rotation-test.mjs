// Strength A/B/C/D rotation.
//
// THE REPORTED BLOCKER WAS NOT REAL. strengthB was already scheduled: every phase week array
// carries S('strengthB',null,'AM') on Tuesday alongside S('strengthA') on Friday, and the live
// block derives 16 B and 13 A. Both weekly slots fired. What never happened was C and D appearing
// at all - the slots were scheduled, the INTENT never advanced.
//
// So the property under test is the sequence, not the slot count.
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
const exVar = (n) => { const m = src.match(new RegExp('^var ' + n + '[^\\n]*$', 'm')); if (!m) throw new Error('missing var ' + n); return m[0] + '\n'; };
const NL = String.fromCharCode(10);
const stripComments = (t) => t.split(NL).map((ln) => ln.replace(/\r/g, '').replace(/\/\/.*$/, '')).join(NL);

const M = new Function(asServed(
  exVar('STRENGTH_POOL_') + exVar('STRENGTH_SLOTS_') + exVar('_STR_EPOCH_') +
  exFn('_strWeekIndex_') + exFn('_strSlotIndex_') + exFn('strengthForSlot_') + NL +
  'return { STRENGTH_POOL_, strengthForSlot_, _strWeekIndex_, _strSlotIndex_ };'
))();

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };
const eq = (l, got, want) => { const g = JSON.stringify(got) === JSON.stringify(want); if (!g) fails++; console.log('  ' + (g ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l + (g ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want))); };

// Build the real Tue/Fri sequence across the block window.
const key = (d) => d.toISOString().slice(0, 10);
const seq = [];
{
  const d = new Date(Date.UTC(2026, 6, 24));          // block start, a Friday
  const end = new Date(Date.UTC(2026, 10, 15));
  for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    if (wd === 2 || wd === 5) seq.push({ date: key(d), wd: wd === 2 ? 'Tue' : 'Fri', g: M.strengthForSlot_(key(d)) });
  }
}

console.log('\n' + Y + '=== all four groups are scheduled, not just two ===' + X);
{
  const counts = {};
  seq.forEach((r) => { counts[r.g] = (counts[r.g] || 0) + 1; });
  eq('every group appears', Object.keys(counts).sort(), ['strengthA', 'strengthB', 'strengthC', 'strengthD']);
  const vals = Object.values(counts);
  ok('...in roughly equal share (' + JSON.stringify(counts) + ')', Math.max(...vals) - Math.min(...vals) <= 2);
  ok('the block has both weekly slots filled', seq.length > 30);
}

console.log('\n' + Y + '=== no group runs back-to-back ===' + X);
{
  let repeats = 0, worst = null;
  for (let i = 1; i < seq.length; i++) {
    if (seq[i].g === seq[i - 1].g) { repeats++; if (!worst) worst = seq[i - 1].date + ' then ' + seq[i].date + ' both ' + seq[i].g; }
  }
  ok('consecutive sessions always differ' + (worst ? ('   ' + worst) : ''), repeats === 0);
}

console.log('\n' + Y + '=== each group lands about every two weeks in its slot ===' + X);
{
  ['Tue', 'Fri'].forEach((slot) => {
    const inSlot = seq.filter((r) => r.wd === slot);
    const gaps = {};
    inSlot.forEach((r, i) => {
      const prev = inSlot.slice(0, i).reverse().find((x) => x.g === r.g);
      if (prev) {
        const g = Math.round((Date.parse(r.date) - Date.parse(prev.date)) / 604800000);
        gaps[g] = (gaps[g] || 0) + 1;
      }
    });
    eq(slot + ': every repeat is exactly 2 weeks apart', Object.keys(gaps), ['2']);
  });
  const firstSix = seq.slice(0, 6).map((r) => r.wd + ':' + r.g.replace('strength', ''));
  console.log('     first six: ' + firstSix.join('  '));
}

console.log('\n' + Y + '=== the sequence does not drift with the block start ===' + X);
{
  // Keyed on an absolute week number, so moving a phase boundary cannot rotate the whole schedule -
  // the same trap that once stranded a taper.
  eq('a fixed date always resolves the same group', M.strengthForSlot_('2026-08-11'), M.strengthForSlot_('2026-08-11'));
  ok('the epoch is a constant, not the block start', /_STR_EPOCH_ = Date\.UTC\(/.test(src));
  ok('...and blockPlanFor_ does not pass a block offset in', !/strengthForSlot_\([^)]*weekInPhase/.test(src));
  // Dates before the epoch must not produce a negative index.
  ['2025-01-07', '2020-06-05', '2026-07-24'].forEach((d) => {
    ok('a pre-epoch date still resolves (' + d + ' -> ' + M.strengthForSlot_(d) + ')',
       M.STRENGTH_POOL_.indexOf(M.strengthForSlot_(d)) >= 0);
  });
  eq('junk input does not throw', M.STRENGTH_POOL_.indexOf(M.strengthForSlot_('nonsense')) >= 0, true);
}

console.log('\n' + Y + '=== slots split Mon-Thu from Fri-Sun ===' + X);
{
  eq('Tuesday is the first slot', M._strSlotIndex_('2026-08-11'), 0);
  eq('Friday is the second', M._strSlotIndex_('2026-08-14'), 1);
  ok('...so a Tue/Fri week gets two DIFFERENT groups',
     M.strengthForSlot_('2026-08-11') !== M.strengthForSlot_('2026-08-14'));
}

console.log('\n' + Y + '=== the rotation is applied at the derive, and a swap beats it ===' + X);
{
  const bp = src.slice(src.indexOf('function blockPlanFor_('));
  ok('blockPlanFor_ resolves strength through the rotation', /strengthForSlot_\(dateKey\)/.test(bp));
  ok('...only for strength intents', /\/\^strength\/\.test\(String\(sl\.i/.test(bp));
  // A claimed swap has to override the rotation now that the derive chooses the group.
  ok('a claimed swap is matched LIKE WITH LIKE', /_isRide\(s\.intent\)\?_isRide:\(_isStr\(s\.intent\)\?_isStr:null\)/.test(bp));
  ok('...so a strength swap cannot displace the ride slot', /Replace LIKE WITH LIKE/.test(bp));
  const sw = exFn('swapStrength_');
  ok('the swap stamps swap:true', /swap:true/.test(sw));
  ok('...and carries it in the edited-field list', /'type','intent','name','status','swap'/.test(sw));
  ok('it cycles the strength pool, not the mobility one', /STRENGTH_POOL_/.test(sw) && !/MOBILITY_POOL_/.test(sw));
  ok('...starting from what is on screen on a derived day', /strengthForSlot_\(dateKey\)/.test(sw));
  ok('mobility keeps its own pool untouched', /var MOBILITY_POOL_=\['mobility','mobilityB','mobilityC','mobilityD'\]/.test(src));
}

console.log('\n' + Y + '=== the groups are what the spec asked for ===' + X);
{
  const lib = src.slice(src.indexOf('var EX_LIBRARY=['), src.indexOf('];', src.indexOf('var EX_LIBRARY=[')));
  const groupOf = (g) => [...lib.matchAll(new RegExp("\\{name:'([^']+)'[^}]*group:'" + g + "'", 'g'))].map((m) => m[1]);
  eq('Group A', groupOf('strengthA'),
     ['Back squat', 'Bench press', 'Bulgarian split squat', 'Standing calf raise', 'Toe raises', 'Banded dorsiflexion', 'Plank', 'Half-kneeling hip flexor stretch']);
  eq('Group B', groupOf('strengthB'),
     ['Deadlift', 'Pull-ups (or assisted)', 'Walking lunges', 'Seated calf raise', 'Deep squat hold', 'Groin/adductor stretch', 'Bird-dog']);
  eq('Group C', groupOf('strengthC'),
     ['Front squat', 'Dumbbell row', 'Single-leg RDL', 'Weighted step-ups', 'Eccentric heel drops', '90/90-to-stand', 'Side plank']);
  eq('Group D', groupOf('strengthD'),
     ['Trap-bar deadlift', 'Overhead press', 'Box jumps', 'Reverse lunge', 'Toe raises', 'Banded dorsiflexion', 'T-spine open-book rotation', 'Couch stretch']);

  // Every session must hit the weak areas, which is the whole point of the rotation.
  const SHIN = /toe raise|banded dorsiflexion|eccentric heel drop|calf raise|deep squat hold/i;
  const HIP = /hip flexor|couch stretch|groin|adductor|90\/90|deep squat hold/i;
  ['strengthA', 'strengthB', 'strengthC', 'strengthD'].forEach((g) => {
    const names = groupOf(g).join(' | ');
    ok(g + ' includes calf/shin work', SHIN.test(names));
    ok(g + ' includes a hip/quad opener', HIP.test(names));
  });

  // Loaded lifts price off 1RM; everything else must stay blank rather than invent a load.
  const loaded = [...lib.matchAll(/\{name:'([^']+)'[^}]*pct1RM:70[^}]*group:'strength/g)].map((m) => m[1]);
  ok('the loaded lifts carry 70% 1RM (' + loaded.length + ' of them)', loaded.length >= 10);
  ok('...and bodyweight/stretch work carries no %1RM', /\{name:'Plank'[^}]*pct1RM:''/.test(lib));
  ok('toe yoga is NOT a session line item', !/toe yoga/i.test(lib));
  ok('towel scrunches are NOT either', !/towel scrunch/i.test(lib));
}

console.log('\n' + Y + '=== Watch reuses the shared row, no new data ===' + X);
{
  const w = exFn('watchExercise_');
  ok('Watch opens a YouTube search for the movement name', /youtube\.com\/results\?search_query/.test(w));
  ok('...built from the name, with no stored link', /encodeURIComponent\(name\)/.test(w));
  const row = exFn('exerciseRowHTML_');
  // The row builds its chips through shared builders (anatChipHTML_ / watchChipHTML_) so neither
  // can be dropped on one surface - the Watch button has been lost three times to per-surface copies.
  ok('the shared row renders the Watch control', /watchChipHTML_\(e\.name\)/.test(row));
  ok('...and that chip calls watchExercise_', /watchExercise_/.test(exFn('watchChipHTML_')));
  ok('...so the new movements need no data entry', !/videoUrl|youtubeId|videoLink/.test(stripComments(src)));
}

console.log('\n' + Y + '=== calendar quick-add: a new entry point, not a new editor ===' + X);
{
  // openDayEditor already supports ADD mode via targetId '__new__' (sess=null, so the save mints a
  // new session). The "+" is therefore purely an entry point - no editor change - and it works
  // repeatedly on a day that already holds sessions.
  ok('the editor still owns ADD mode', src.indexOf("_forceNew=(targetId==='__new__')") > 0);

  const ds = src.slice(src.indexOf('function dsShowCalendar('), src.indexOf('function showCalendarTab('));
  const mob = src.slice(src.indexOf('function showCalendarTab('));
  ok('desktop renders a + in the day cell', ds.indexOf('data-cal="addsess"') > 0);
  ok('...as the last child, under the chips',
     ds.indexOf('data-cal="addsess"') < ds.indexOf("H+='</div>';", ds.indexOf('data-cal="addsess"')));
  ok('...handled by the delegated action', ds.indexOf("a==='addsess'") > 0);
  ok("...opening the editor in ADD mode", ds.indexOf("openDayEditor(ad, '__new__')") > 0);

  ok('mobile renders one too', mob.indexOf('__new__') > 0);
  // The mobile cell already carries its own openDayEditor onclick, so without stopPropagation a
  // tap would fire both.
  ok('...and stops propagation', mob.indexOf('event.stopPropagation();openDayEditor') > 0);

  ok('BOTH surfaces got it, not just one', ds.indexOf('addsess') > 0 && mob.indexOf('__new__') > 0);
  ok('the control is unobtrusive on already-dense days',
     ds.indexOf('opacity:.45') > 0 && mob.indexOf('opacity:.45') > 0);
  ok('no second editor was built', !/function openAddSessionEditor|function newSessionEditor/.test(src));
}

console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'strength rotation + quick-add: all checks passed' + X));
process.exit(fails ? 1 : 0);
