// The run session editor. The reported symptom was one line:
//
//     if(!/^(ride|strength|mobility)$/.test(curType)) curType='ride';
//
// A run session's type is 'run', which failed that allowlist and was rewritten to 'ride', so the
// editor drew Intent / Power lo W-hi W / HR cap with the watts fields permanently blank.
//
// Measuring the plan turned up three more, and the editor fix alone would not have been visible:
// 173 sessions with intent easyRun/run10k are STORED as type 'ride' (stale rows, written before
// the library gained run types), the Session dropdown could not offer Run at all, and
// sessionTypeFromName_ had no run branch so every run name fell through to 'ride'.
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
const NL = String.fromCharCode(10);

const st = { plan: {} };
const SESSION_DEFS = {
  easyRun: { type: 'run', name: 'Easy Run', durationMin: 25 },
  run10k: { type: 'run', name: '10k-pace Run', durationMin: 35 },
  z2: { type: 'ride', name: 'Z2 Endurance' },
  strengthA: { type: 'strength', name: 'Strength A' },
  rest: { type: 'rest', name: 'Rest' }
};
const M = new Function('st', 'SESSION_DEFS', 'Date', asServed(
  exFn('_paceStr_') + exFn('_paceSec_') + exFn('sessionTypeFromName_') + exFn('migrateSessionTypes_') +
  'function sv(){}' + NL +
  ';return { _paceStr_, _paceSec_, sessionTypeFromName_, migrateSessionTypes_ };'
))(st, SESSION_DEFS, Date);

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };
const eq = (l, got, want) => { const g = JSON.stringify(got) === JSON.stringify(want); if (!g) fails++; console.log('  ' + (g ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l + (g ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want))); };

console.log('\n' + Y + '=== a run session is no longer rewritten into a ride ===' + X);
{
  const m = src.match(/if\(!\/\^\(([a-z|]+)\)\$\/\.test\(curType\)\) curType='ride';/);
  ok('the editor allowlist exists', !!m);
  ok('...and admits run', !!m && m[1].split('|').includes('run'));
  ok('...alongside the other three', !!m && ['ride', 'strength', 'mobility'].every((t) => m[1].split('|').includes(t)));
  ok('the Session TYPE dropdown can offer Run', /\['run','Run'\]/.test(src));
  // SESSION_PRESETS - the named-session picker - is built from SESSION_DEF_ORDER. easyRun and
  // run10k were defined in SESSION_DEFS but absent from that list, so the two run sessions the
  // block actually prescribes could not be picked by name on any day.
  const order = src.match(/var SESSION_DEF_ORDER=\[([^\]]+)\]/);
  ok('the preset order list exists', !!order);
  ok('...and offers the easy run', !!order && order[1].includes("'easyRun'"));
  ok('...and the 10k-pace run', !!order && order[1].includes("'run10k'"));
  ok('...with rest still last', !!order && /'rest'\s*$/.test(order[1].trim()));
}

console.log('\n' + Y + '=== a DERIVED block session resolves by intent, not by guessing ===' + X);
{
  // blockPlanFor_ builds its sessions from the block table and returns them carrying an intent and
  // nothing else - measured live: {date, intent} with type and name both undefined. The old chain
  // ended at sessionTypeFromName_(undefined) -> 'ride', so every derived run day in the block drew
  // the bike editor even once the allowlist admitted runs.
  const i = src.indexOf('var _tSrc=sess||plan||null;');
  ok('the resolver exists', i > 0);
  const chain = src.slice(i - 700, i + 700);
  ok('a stored type still wins', /var curType=\(sess&&sess\.type\)\|\|\(\(plan&&plan\.type\)\|\|''\)/.test(chain));
  ok('...then intent decides via the library', /SESSION_DEFS\[_tSrc\.intent\]/.test(chain));
  ok('...and only then does it fall back to the name', chain.indexOf('SESSION_DEFS[_tSrc.intent]') < chain.indexOf('sessionTypeFromName_(plan.name)'));
  ok('...with the reason recorded', /returns them carrying an intent and nothing else/.test(chain));
}

console.log('\n' + Y + '=== the editor draws run fields, not watts ===' + X);
{
  const i = src.indexOf("} else if(type==='run'){");
  ok('a run branch exists', i > 0);
  const branch = src.slice(i, src.indexOf("} else if(type==='strength'){", i));
  ok('it asks for a pace band', /_fr\('Pace \/mi'/.test(branch));
  ok('...in mm:ss, not watts', /'mm:ss'/.test(branch));
  ok('it asks for an HR cap', /_fr\('HR cap'/.test(branch));
  ok('it has NO power field', !/lo W|hi W|powerLo|powerHi/.test(branch));
  // Comments stripped first: the branch EXPLAINS why it avoids avgSpeed, so a naive substring
  // test finds the word in the very comment that documents not using it.
  const code = branch.replace(/\/\/[^\n]*/g, '');
  ok('completed pace reads r.pace, not the mph speed field', /o&&o\.pace/.test(code) && !/avgSpeed/.test(code));
  ok('...and it says why', /would print 2\.4 for an 11-min mile/.test(branch));
  ok('the run intents are runs', /'easyRun'|'run10k'/.test(branch) && !/'threshold'|'vo2'/.test(branch));
  // The zone model is known-broken; a zone picker here would ship a prescription built on it.
  ok('it does NOT offer an HR zone picker', !/zone/i.test(branch.replace(/\/\/[^\n]*/g, '')));
  ok('...and the reason is recorded', /78% of all running/.test(branch) && /Z4\+ across 1,181 runs/.test(branch));
}

console.log('\n' + Y + '=== pace survives the round trip ===' + X);
{
  eq('mm:ss parses to seconds', M._paceSec_('10:30'), 630);
  eq('...and formats back', M._paceStr_(630), '10:30');
  eq('a sub-10 pace keeps its zero', M._paceStr_(545), '9:05');
  eq('a bare number is minutes', M._paceSec_('10.5'), 630);
  eq('blank is null, not zero', M._paceSec_(''), null);
  eq('junk is null', M._paceSec_('fast'), null);
  eq('nothing formats to empty, not 0:00', M._paceStr_(null), '');
  eq('zero is not a pace', M._paceStr_(0), '');
  eq('59 seconds does not round to :60', M._paceStr_(599.7), '10:00');
  eq('seconds out of range are refused', M._paceSec_('10:75'), null);
}

console.log('\n' + Y + '=== a run name resolves to a run ===' + X);
{
  eq('"Easy Run"', M.sessionTypeFromName_('Easy Run'), 'run');
  eq('"10k-pace Run"', M.sessionTypeFromName_('10k-pace Run'), 'run');
  eq('"Half Marathon"', M.sessionTypeFromName_('Half Marathon'), 'run');
  eq('a ride is still a ride', M.sessionTypeFromName_('Z2 Endurance'), 'ride');
  eq('strength still wins', M.sessionTypeFromName_('Strength A'), 'strength');
  // "Running" inside a bike session name must not flip it - the strength/mobility tests run first
  // and the run test is a word boundary, not a substring match.
  eq('"Errands" is not a run', M.sessionTypeFromName_('Errands'), 'ride');
}

console.log('\n' + Y + '=== the 173 stale sessions are repaired, and only those ===' + X);
{
  st.plan = {
    '2026-08-05': { sessions: [
      { intent: 'easyRun', type: 'ride', name: 'Easy Run' },
      { intent: 'z2', type: 'ride', name: 'Z2 Endurance' }
    ] },
    '2026-11-11': { sessions: [
      { intent: 'run10k', type: 'ride', name: '10k-pace Run' },
      // swap:true is the ONLY thing that means the athlete chose this. The _edited mask was tried
      // as the gate and it skipped a real defect: it carries 'type' on any session an ordinary
      // save touched, so it records that a field was WRITTEN, never that it was chosen.
      { intent: 'easyRun', type: 'ride', name: 'Easy Run', swap: true },              // athlete's choice
      { intent: 'easyRun', type: 'ride', name: 'Easy Run', _edited: { type: 1 } },    // mere residue
      { intent: 'easyRun', type: 'ride', deleted: true },
      { intent: 'unknownIntent', type: 'ride' }
    ] }
  };
  const n = M.migrateSessionTypes_();
  eq('three stale rows corrected', n, 3);
  eq('...the easy run is now a run', st.plan['2026-08-05'].sessions[0].type, 'run');
  eq('...so is the 10k session', st.plan['2026-11-11'].sessions[0].type, 'run');
  eq('a genuine ride is untouched', st.plan['2026-08-05'].sessions[1].type, 'ride');
  eq('an explicitly SWAPPED session is left alone', st.plan['2026-11-11'].sessions[1].type, 'ride');
  eq('...but a row carrying only _edited residue IS corrected', st.plan['2026-11-11'].sessions[2].type, 'run');
  eq('a tombstone is left alone', st.plan['2026-11-11'].sessions[3].type, 'ride');
  eq('an intent with no library entry is left alone', st.plan['2026-11-11'].sessions[4].type, 'ride');
  ok('the correction is stamped so it travels cross-device', st.plan['2026-08-05'].sessions[0].editedAt > 0);
  eq('re-running it is a no-op', M.migrateSessionTypes_(), 0);
  // Targets are deliberately NOT backfilled: sessions store identity and the prescription derives
  // from SESSION_DEFS at read.
  ok('targets are not invented', st.plan['2026-08-05'].sessions[0].targets === undefined);
}

console.log('\n' + Y + '=== a formatted duration is not read as a number ===' + X);
{
  // The Completed Duration field is prefilled from o.duration, a FORMATTED "H:MM:SS" string, and
  // was read back through _num, which strips every non-digit. "0:44:13" came back as 4413 and
  // "44:33" as exactly 4433 - the value found on one live session, which drove its calorie target
  // to 34,356 against a real 2,360. Opening the editor and pressing Save was enough to write it.
  const i = src.indexOf('function _durMin(');
  ok('a duration parser exists', i > 0);
  const D = new Function(asServed(src.slice(i, matchBrace(i) + 1) + NL + 'return _durMin;'))();
  eq('h:mm:ss becomes minutes', D('0:44:13'), 44);
  eq('...and a long one', D('1:13:53'), 74);
  eq('mm:ss becomes minutes', D('44:33'), 45);
  ok('...NOT 4433', D('44:33') !== 4433);
  eq('a bare number is already minutes', D('25'), 25);
  eq('a decimal survives', D('12.5'), 12.5);
  eq('blank is null', D(''), null);
  eq('null is null', D(null), null);
  ok('no duration field is read with _num any more', !/duration:_num\(|durationMin:_num\(/.test(src));
}

console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'run session editor: all checks passed' + X));
process.exit(fails ? 1 : 0);
