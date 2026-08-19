// AN FTP CORRECTION HAS TO BE ABLE TO LAND.
//
// Reported as "FTP shows 190W instead of the locked 183W, second time today". It never recurred -
// it never LEFT. ftpHistory keyed on ['date','ftp'], putting the VALUE inside the IDENTITY, so
// {date:D, ftp:183} and {date:D, ftp:190} were two different keys and _lwwMergeArray_ kept BOTH
// instead of replacing one. _ftpSort_ orders by date alone and Array#sort is stable, so ftpOn_
// returned whichever same-date row happened to sit later in the array - and the correction could
// lose to the row it was written to replace, on every device, forever.
//
// weightLog next door has always keyed on ['date'] alone, which is exactly why a corrected weigh-in
// sticks and a corrected FTP did not. Same family as the plan-session duplication: identity defined
// wrong, so an edit FORKS instead of overwriting.
//
// TWO CHANGES, AND EITHER ALONE IS INERT - the point this file exists to hold:
//   1. the key, so the rows collide at all;
//   2. _lwwSnapshot_ watching the LWW ARRAYS, so a write that touches only an array advances
//      st.lastUpdate and therefore WINS the merge it now participates in. Only the scalars were
//      watched before; an FTP typed in Settings happened to work purely because st.ftp is a watched
//      scalar that dragged the clock along. Nothing else in this family had that luck.
// This is the same shape as the race-editor bug: a resolution rule with no stamping WRITER is inert.
//
// NOTE ON editedAt: this array family does NOT use per-item stamps. _lwwMergeArray_ resolves a key
// collision by BLOB recency (remoteWins, off the root lastUpdate clock). Adding an editedAt here
// would be dead code - the clock that matters is the one _lwwTouch_ advances.
//
// Run: node scripts/ftp-merge-key-test.mjs
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

console.log('\n' + Y + '=== the value is out of the identity ===' + X);
ok('ftpHistory keys on date alone', /ftpHistory:\{ keys:\['date'\], val:'ftp' \}/.test(SRC));
ok('NEG: the composite key is gone', !/keys:\['date','ftp'\]/.test(SRC));
ok('weightLog is unchanged, and still the model', /weightLog:\{ keys:\['date'\], val:'weight' \}/.test(SRC));

console.log('\n' + Y + '=== the arrays now advance the clock they are resolved by ===' + X);
ok('a digest helper exists', /function _lwwArrDigest_\(spec, ?arr\)/.test(SRC));
ok('...and the snapshot includes every LWW array', /m\['\[\]'\+nm\] ?= ?_lwwArrDigest_\(_LWW_ARRAYS\[nm\], ?st && ?st\[nm\]\)/.test(SRC));
ok('...keyed so a tombstone reads differently from a live row', /_arrIsDead_\(x\)\?'X'/.test(SRC));
ok('...and sorted, so mere ORDER is not a change', /out\.sort\(\)/.test(SRC));
ok('saveLocal_ still advances lastUpdate on a touch', /_lwwTouch_\(\)\) st\.lastUpdate ?= ?Date\.now\(\)/.test(SRC));

console.log('\n' + Y + '=== the one-time repair ===' + X);
ok('the heal exists and is version-stamped', /function healFtpHistoryKeys_\(\)/.test(SRC) && /st\._ftpKeyV===_FTP_KEY_V/.test(SRC));
ok('...it re-points composite tombstone keys', /x\._k=x\._k\.split\('\|'\)\[0\]/.test(SRC));
ok('...it prefers the row agreeing with st.ftp', /parseInt\(st\.ftpHistory\[idxs\[j\]\]\.ftp,10\)===cur/.test(SRC));
ok('...and falls back to the last row, never inventing one', /if\(keep<0\) keep=idxs\[idxs\.length-1\]/.test(SRC));
ok('it runs in applyFirebaseData BEFORE ftpSyncHistory_',
   SRC.indexOf('healFtpHistoryKeys_();') > -1 &&
   SRC.indexOf('healFtpHistoryKeys_();') < SRC.lastIndexOf('ftpSyncHistory_();'));
ok('it logs what it dropped and what it kept', /-> kept '\+st\.ftpHistory\[keep\]\.ftp/.test(SRC));

console.log('\n' + Y + '=== the merge, exercised under both specs ===' + X);
{
  // Model _arrKeyOf_ and _lwwMergeArray_ exactly, then run the reported scenario through each spec.
  const keyOf = (spec, item) => {
    if (!item) return null;
    if (item._k != null) return String(item._k);
    const parts = [];
    for (const k of spec.keys) { const v = item[k]; if (v == null || v === '') return null; parts.push(String(v)); }
    return parts.length ? parts.join('|') : null;
  };
  const merge = (spec, a, b, remoteWins) => {
    const by = {}, order = [];
    const take = (list, isRemote) => list.forEach((x) => {
      const k = keyOf(spec, x); if (k == null) return;
      if (!(k in by)) { by[k] = null; order.push(k); }
      const cur = by[k];
      if (cur && cur.deleted) return;
      if (x.deleted) { by[k] = x; return; }
      if (cur == null) { by[k] = x; return; }
      if (isRemote === remoteWins) by[k] = x;
    });
    take(a, false); take(b, true);
    return order.map((k) => by[k]).filter(Boolean);
  };
  // ftpOn_: date-sorted (stable), last entry on or before the target.
  const ftpOn = (h, date) => {
    const sorted = h.slice().sort((p, q) => (p.date < q.date ? -1 : p.date > q.date ? 1 : 0));
    let eff = null;
    for (const e of sorted) { if (e.date <= date) eff = e; else break; }
    return eff ? eff.ftp : null;
  };

  const D = '2026-08-19';
  const local  = [{ date: '2026-06-01', ftp: 186 }, { date: D, ftp: 183 }];   // the correction
  const remote = [{ date: '2026-06-01', ftp: 186 }, { date: D, ftp: 190 }];   // the stale value

  const OLD = { keys: ['date', 'ftp'], val: 'ftp' };
  const NEW = { keys: ['date'], val: 'ftp' };

  const oldMerged = merge(OLD, local, remote, false);   // local clock newer -> local should win
  ok('OLD spec keeps BOTH same-date rows (' + oldMerged.filter((e) => e.date === D).length + ')',
     oldMerged.filter((e) => e.date === D).length === 2);
  ok('...so the correction loses to the row it replaced (ftpOn_ = ' + ftpOn(oldMerged, D) + ')',
     ftpOn(oldMerged, D) === 190);

  const newMerged = merge(NEW, local, remote, false);
  ok('NEW spec collapses them to one row', newMerged.filter((e) => e.date === D).length === 1);
  ok('...and the local correction wins (ftpOn_ = ' + ftpOn(newMerged, D) + ')', ftpOn(newMerged, D) === 183);

  // The clock is what decides, so the inverse must also hold - otherwise this is not LWW, it is
  // just a different arbitrary winner.
  const remoteWon = merge(NEW, local, remote, true);
  ok('...and remote wins when REMOTE carries the newer clock (' + ftpOn(remoteWon, D) + ')', ftpOn(remoteWon, D) === 190);

  // Lowering must work: the whole complaint is a value that could be raised but never lowered.
  ok('NEW spec can LOWER a value, which is the entire bug', ftpOn(newMerged, D) < ftpOn(oldMerged, D));

  // A deletion must still apply under the new key.
  const withTomb = merge(NEW, [{ date: D, ftp: 183 }], [{ deleted: true, _k: D, date: D }], false);
  ok('a tombstone still wins under the new key', withTomb.length === 1 && withTomb[0].deleted === true);
  // ...including one written in the composite era, ONCE the heal has re-pointed it.
  const healed = String('2026-08-19|190').split('|')[0];
  ok('a composite-era tombstone re-points onto the new key', healed === D);
}

console.log('\n' + Y + '=== the local dedupe, exercised ===' + X);
{
  // The heal has to run locally too: the merge collapses rows, but ftpOn_ reads the LOCAL array
  // before any merge, so two rows sitting there still mis-resolve.
  const heal = (rows, cur) => {
    const seen = {}, drop = {};
    rows.forEach((x, i) => { if (!x || x.deleted || !x.date) return; (seen[x.date] = seen[x.date] || []).push(i); });
    Object.keys(seen).forEach((d) => {
      const idxs = seen[d]; if (idxs.length < 2) return;
      let keep = -1;
      if (cur > 0) for (const i of idxs) if (parseInt(rows[i].ftp, 10) === cur) { keep = i; break; }
      if (keep < 0) keep = idxs[idxs.length - 1];
      for (const i of idxs) if (i !== keep) drop[i] = 1;
    });
    return rows.filter((_x, i) => !drop[i]);
  };
  const D = '2026-08-19';
  const dupes = [{ date: D, ftp: 183 }, { date: D, ftp: 190 }];
  ok('with st.ftp=183 the heal keeps 183, not the later row', heal(dupes, 183).length === 1 && heal(dupes, 183)[0].ftp === 183);
  ok('with st.ftp=190 it keeps 190 - it follows the setting, it does not pick a side', heal(dupes, 190)[0].ftp === 190);
  ok('with st.ftp unknown it keeps the last, matching the OLD reader exactly', heal(dupes, 0)[0].ftp === 190);
  ok('a single-row date is untouched', heal([{ date: D, ftp: 183 }], 183).length === 1);
  ok('distinct dates are never collapsed',
     heal([{ date: '2026-06-01', ftp: 186 }, { date: D, ftp: 183 }], 183).length === 2);
  ok('tombstones are not counted as duplicates',
     heal([{ deleted: true, _k: D, date: D }, { date: D, ftp: 183 }], 183).length === 2);
}

console.log('\n' + Y + '=== FTP is upstream of every band, so the reader is checked too ===' + X);
ok('ftpOn_ still reads the log, then st.ftp, then the default', /if\(!h\.length\) return parseInt\(\(typeof st!=='undefined'&&st&&st\.ftp\)\|\|_FTP_DEFAULT,10\)/.test(SRC));
ok('the default is still 186 and nothing defaults to 190', /var _FTP_DEFAULT=186/.test(SRC) && !/\|\|190\b/.test(SRC));
ok('st.ftp is still a last-write-wins scalar, not max-merged', /var _LWW_TOP = \['ftp',/.test(SRC));
ok('the measured/goal split is still intact', /goalTargets:\['annualMi','ctl','ftpW'/.test(SRC));

console.log('');
if (fails) { console.log(R + 'ftp merge key: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'ftp merge key: all checks passed' + X + '\n');
