// The frozen-snapshot overlay. /store_v2 is hand-uploaded and schema-slim, so a ride it carries is
// served WITHOUT any field a later backfill computed - dpr 392 stored / 13 visible, powerCurve
// 325 stored / 0 visible. The overlay fills those from st.rides without letting st.rides decide
// which rides exist, because reading it raw double-counts (7,050 miles against Strava's 5,484).
//
// The rule that actually needs pinning is the DIRECTION: a live blank must never clear a snapshot
// value. Get that backwards and the fold quietly erases data instead of restoring it.
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

const M = new Function(asServed(
  'function normDate(d){ return String(d||"").slice(0,10); }' + NL +
  exFn('rideKey') + exVar('STORE_V2_ENRICH_') + exFn('storeV2Enrich_') +
  ';return { storeV2Enrich_, rideKey, STORE_V2_ENRICH_ };'
))();

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };
const eq = (l, got, want) => { const g = JSON.stringify(got) === JSON.stringify(want); if (!g) fails++; console.log('  ' + (g ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l + (g ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want))); };

console.log('\n' + Y + '=== a backfilled field reaches the accessor ===' + X);
{
  const snap = [{ stravaId: '1', date: '2025-06-01', distance: 40, name: 'Lunch Ride' }];
  const live = [{ stravaId: '1', date: '2025-06-01', distance: 40, dpr: { 5: 900 }, gearId: 'b1', powerCurve: { 60: 300 }, zoneTime: { z2: 1200 } }];
  const r = M.storeV2Enrich_(snap, live);
  eq('the row is matched', r.stats.matched, 1);
  eq('...and enriched once, not once per field', r.stats.enriched, 1);
  eq('dpr lands', r.rides[0].dpr, { 5: 900 });
  eq('gearId lands', r.rides[0].gearId, 'b1');
  eq('powerCurve lands', r.rides[0].powerCurve, { 60: 300 });
  eq('zoneTime lands', r.rides[0].zoneTime, { z2: 1200 });
  eq('every field is counted', r.stats.fields, { dpr: 1, gearId: 1, powerCurve: 1, zoneTime: 1 });
  ok('the snapshot record itself was NOT mutated', snap[0].dpr === undefined);
  ok('...so the row served is a copy', r.rides[0] !== snap[0]);
  eq('...carrying the snapshot fields forward', r.rides[0].name, 'Lunch Ride');
}

console.log('\n' + Y + '=== a live blank NEVER clears a snapshot value ===' + X);
{
  // The direction that matters. st.rides is the authority on what a ride CARRIES, but "I have
  // nothing" is not a value - the snapshot row keeps what it had.
  const snap = [{ stravaId: '1', date: '2025-06-01', gearId: 'snapshot-bike', zoneTime: { z2: 60 } }];
  const live = [{ stravaId: '1', date: '2025-06-01', gearId: undefined, zoneTime: null, dpr: { 5: 900 } }];
  const r = M.storeV2Enrich_(snap, live);
  eq('undefined does not overwrite', r.rides[0].gearId, 'snapshot-bike');
  eq('null does not overwrite either', r.rides[0].zoneTime, { z2: 60 });
  eq('...while a real value on the same row still lands', r.rides[0].dpr, { 5: 900 });
  eq('only the field that moved is counted', r.stats.fields, { dpr: 1 });
}

console.log('\n' + Y + '=== nothing to add means nothing is allocated ===' + X);
{
  const snap = [{ stravaId: '1', date: '2025-06-01', gearId: 'b1' }];
  const live = [{ stravaId: '1', date: '2025-06-01', gearId: 'b1' }];
  const r = M.storeV2Enrich_(snap, live);
  eq('the row is still matched', r.stats.matched, 1);
  eq('...but not enriched', r.stats.enriched, 0);
  ok('...and its identity is preserved', r.rides[0] === snap[0]);
}
{
  const snap = [{ stravaId: '9', date: '2025-06-01' }];
  const r = M.storeV2Enrich_(snap, [{ stravaId: '1', date: '2025-06-01' }]);
  eq('a snapshot row with no live twin is left alone', r.stats.matched, 0);
  ok('...and passes through untouched', r.rides[0] === snap[0]);
}

console.log('\n' + Y + '=== the overlay cannot change WHICH rides exist ===' + X);
{
  // This is the whole reason the fix is an overlay and not a repoint. st.rides carries duplicates
  // the snapshot correctly suppresses; enrichment must never let one back in.
  const snap = [{ stravaId: '1', date: '2025-06-01', distance: 40 }];
  const live = [
    { stravaId: '1', date: '2025-06-01', distance: 40, dpr: { 5: 900 } },
    { date: '2025-06-01', distance: 40, source: 'fit' },          // the FIT twin
    { stravaId: '2', date: '2025-06-02', distance: 30, dpr: { 5: 800 } }
  ];
  const r = M.storeV2Enrich_(snap, live);
  eq('one snapshot row in, one row out', r.rides.length, 1);
  ok('...the FIT twin did not appear', r.rides.length === snap.length);
  ok('...and the unmatched live ride did not either', !r.rides.some((x) => x.stravaId === '2'));
}
{
  const deleted = M.storeV2Enrich_([{ stravaId: '1', date: '2025-06-01' }],
    [{ stravaId: '1', date: '2025-06-01', deleted: true, gearId: 'b1' }]);
  eq('a tombstoned live record is not a source', deleted.stats.matched, 0);
  ok('...so its fields never land', deleted.rides[0].gearId === undefined);
}

console.log('\n' + Y + '=== id-less records match on the same key the rest of the app uses ===' + X);
{
  const snap = [{ date: '2025-06-01', distance: 40.4, duration: 3600 }];
  const live = [{ date: '2025-06-01', distance: 40.4, duration: 3600, powerCurve: { 60: 300 } }];
  const r = M.storeV2Enrich_(snap, live);
  eq('a no-stravaId pair still matches', r.stats.matched, 1);
  eq('...and enriches', r.rides[0].powerCurve, { 60: 300 });
  ok('the key is rideKey, not a private one', M.rideKey(snap[0]) === M.rideKey(live[0]));
}
{
  // stravaId is stored as a string on some records and a number on others.
  const r = M.storeV2Enrich_([{ stravaId: 12345, date: '2025-06-01' }],
    [{ stravaId: '12345', date: '2025-06-01', gearId: 'b1' }]);
  eq('a numeric id matches its string twin', r.rides[0].gearId, 'b1');
}

console.log('\n' + Y + '=== the field list is the one that was measured ===' + X);
{
  eq('exactly the four backfilled fields', M.STORE_V2_ENRICH_.slice().sort(),
     ['dpr', 'gearId', 'powerCurve', 'zoneTime']);
  const arm = src.slice(src.indexOf('function storeV2Arm_('));
  ok('the fold enriches the snapshot bucket, not the tail',
     /storeV2Enrich_\(s\.rides, pool\)/.test(arm));
  ok('...and the tail is appended to the ENRICHED rows',
     /en\.rides\.concat\(tr\.add\)\s*:\s*en\.rides/.test(arm));
  // The count MUST be reported from the re-arm, not from prime. /store_v2 primes on the _idbReady
  // chain while the library arrives on the Firebase one, so at prime st.rides is empty (measured:
  // "st.rides live was 0") and prime always enriches nothing. Logging only there printed
  // "enriched 0" forever - the same looks-broken-but-is-fine reading the overlay exists to end.
  ok('the enrichment count is reported', /enriched \' \+ en\.stats\.enriched/.test(arm));
  ok('...from the re-arm, where the library actually exists', arm.indexOf('_storeV2EnrichLast') > 0);
  ok('...and only when the number moves', /enriched!==_storeV2EnrichLast/.test(arm));
}

console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'store_v2 enrichment: all checks passed' + X));
process.exit(fails ? 1 : 0);
