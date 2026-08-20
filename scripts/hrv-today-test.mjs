// THE READINESS CARD SEES THE AUTO-SYNCED HRV.
//
// fetchLiveIntervalsWellness has written real Garmin HRV/RHR into st.hrvDaily every ~10 minutes
// since the integration went live. The readiness card - the one place readiness is actually used -
// read st.hrv / st.restingHR only, the MANUAL fields set by its own Edit button. So the store
// accumulated correctly and nothing consumed it: the card showed a dash on days the data arrived
// fine. Manual entry still worked, which is why it went unnoticed.
//
// THE ORDER IS NOT "MANUAL WINS", and that is the part worth pinning. st.hrv is an UNDATED scalar -
// only recoveryLog carries a date - so blind manual precedence would let a value typed weeks ago
// mask every subsequent Garmin reading, permanently, while the card presented it as TODAY's
// readiness. That is the stale-value-shown-as-current failure this codebase keeps paying for.
//
//   1. a manual entry made TODAY  - a deliberate reading beats an automatic one
//   2. today's Garmin reading     - what the sync exists for
//   3. an older manual value, DISCLOSED with the date it was logged, so nothing the athlete can
//      currently see disappears but nothing is passed off as today either
//
// Run: node scripts/hrv-today-test.mjs
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

console.log('\n' + Y + '=== one resolver, and the card uses it ===' + X);
ok('_hrvToday_ exists', /function _hrvToday_\(\)/.test(SRC));
ok('the card resolves through it', /var _w=\(typeof _hrvToday_==='function'\)\?_hrvToday_\(\)/.test(SRC));
ok('NEG: the card no longer reads st.hrv directly', !/var hrv=\(st\.hrv!=null\)\?st\.hrv:null/.test(SRC));
ok('it reads the Garmin store the sync writes', /st\.hrvDaily/.test(SRC) && /h\[tk\]/.test(SRC));
ok('...handling both object rows and bare legacy numbers', /\(r && typeof r==='object'\)\?r\.hrv:r/.test(SRC));
ok('the sync still writes that store', /st\.hrvDaily\[todayStr\]=\{hrv:hrv, ?rhr:rhr, ?at:Date\.now\(\)\}/.test(SRC));

console.log('\n' + Y + '=== the order, and why it is not "manual wins" ===' + X);
ok('a manual entry made today is checked first, via the DATED recoveryLog', /e\.date===tk && e\.hrv!=null && e\.rhr!=null/.test(SRC));
ok('...returning src manual', /src:'manual', ?on:tk/.test(SRC));
ok('then the Garmin reading for today', /src:'garmin', ?on:tk/.test(SRC));
ok('an older manual value is kept but marked stale', /src:'manual-stale'/.test(SRC));
ok('...and carries the date it was logged', /on=e2\.date; break;/.test(SRC));
ok('a reading needs BOTH hrv and rhr, never half a composite', /hv!=null && isFinite\(hv\) && rv!=null && isFinite\(rv\)/.test(SRC));

console.log('\n' + Y + '=== the source is named on the card ===' + X);
ok('a label helper exists', /function _hrvSrcLabel_\(w\)/.test(SRC));
ok('Garmin is named', /return 'from Garmin';/.test(SRC));
ok('a manual entry is named', /return 'logged manually';/.test(SRC));
ok('a stale manual value carries its date', /'logged manually '\+w\.on/.test(SRC));
ok('the card appends it to the sub-line', /\+\(hrvSrc\?\(' &middot; '\+hrvSrc\):''\)/.test(SRC));

console.log('\n' + Y + '=== the resolution, exercised ===' + X);
{
  const TK = '2026-08-20';
  const resolve = (st) => {
    if (Array.isArray(st.recoveryLog)) {
      for (let i = st.recoveryLog.length - 1; i >= 0; i--) {
        const e = st.recoveryLog[i];
        if (e && e.date === TK && e.hrv != null && e.rhr != null) return { hrv: +e.hrv, rhr: +e.rhr, src: 'manual', on: TK };
      }
    }
    const h = st.hrvDaily || null;
    if (h && h[TK]) {
      const r = h[TK];
      const hv = (r && typeof r === 'object') ? r.hrv : r;
      const rv = (r && typeof r === 'object') ? r.rhr : null;
      if (hv != null && isFinite(hv) && rv != null && isFinite(rv)) return { hrv: +hv, rhr: +rv, src: 'garmin', on: TK };
    }
    if (st.hrv != null && st.restingHR != null) {
      let on = null;
      if (Array.isArray(st.recoveryLog)) {
        for (let j = st.recoveryLog.length - 1; j >= 0; j--) {
          const e2 = st.recoveryLog[j];
          if (e2 && e2.hrv != null && +e2.hrv === +st.hrv) { on = e2.date; break; }
        }
      }
      return { hrv: +st.hrv, rhr: +st.restingHR, src: 'manual-stale', on };
    }
    return { hrv: null, rhr: null, src: null, on: null };
  };

  // THE REPORTED BUG: Garmin data present, no manual entry at all.
  ok('Garmin today with no manual entry resolves to Garmin',
     resolve({ hrvDaily: { [TK]: { hrv: 37, rhr: 48 } } }).src === 'garmin');
  ok('...with the actual value, not a placeholder',
     resolve({ hrvDaily: { [TK]: { hrv: 37, rhr: 48 } } }).hrv === 37);

  // THE TRAP: an undated manual value from weeks ago must NOT mask today's Garmin reading.
  const stale = { hrv: 29, restingHR: 52, recoveryLog: [{ date: '2026-08-01', hrv: 29, rhr: 52 }],
                  hrvDaily: { [TK]: { hrv: 37, rhr: 48 } } };
  ok('a weeks-old manual value does not mask the Garmin reading for today', resolve(stale).src === 'garmin');
  ok('...and the Garmin value is the one used', resolve(stale).hrv === 37);

  // But a deliberate entry made today does outrank the automatic one.
  const todayManual = { hrv: 31, restingHR: 50, recoveryLog: [{ date: TK, hrv: 31, rhr: 50 }],
                        hrvDaily: { [TK]: { hrv: 37, rhr: 48 } } };
  ok('a manual entry made TODAY beats the Garmin reading', resolve(todayManual).src === 'manual');
  ok('...using the typed value', resolve(todayManual).hrv === 31);

  // Tier 3: nothing today from either source, but an old manual value exists.
  const onlyOld = { hrv: 29, restingHR: 52, recoveryLog: [{ date: '2026-08-01', hrv: 29, rhr: 52 }] };
  ok('with nothing today, the old manual value is still shown', resolve(onlyOld).hrv === 29);
  ok('...marked stale rather than passed off as today', resolve(onlyOld).src === 'manual-stale');
  ok('...and dated from the log', resolve(onlyOld).on === '2026-08-01');

  // Half a composite is not a composite.
  ok('an hrv with no rhr does not resolve', resolve({ hrvDaily: { [TK]: { hrv: 37 } } }).src === null);
  ok('a legacy bare-number row has no rhr, so it does not resolve either',
     resolve({ hrvDaily: { [TK]: 37 } }).src === null);
  ok('a Garmin reading from yesterday is not one for today',
     resolve({ hrvDaily: { '2026-08-19': { hrv: 37, rhr: 48 } } }).src === null);
  ok('nothing anywhere resolves to nothing', resolve({}).src === null);
}

console.log('\n' + Y + '=== scope: st.hrv has one display consumer ===' + X);
{
  // The sweep the report asked for: everything else touching st.hrv is the manual Edit form itself,
  // so there was no repeated pattern to lift - one call site, one fix.
  // Assert WHICH lines, not how many - a count is an arbitrary threshold that fails on the next
  // legitimate edit while proving nothing. Every remaining st.hrv read must be either the resolver
  // itself or the manual save path; a new one anywhere else is a surface that would go stale again.
  const reads = noCmt(src).split('\n').filter((L) => /st\.hrv[^D]/.test(L) && !/hrvDaily/.test(L));
  const allowed = (L) =>
    /src:'manual-stale'/.test(L) ||                       // the resolver's tier 3
    /if\(st\.hrv!=null && st\.restingHR!=null\)\{/.test(L) ||
    /\+e2\.hrv===\+st\.hrv/.test(L) ||
    /st\.hrv=isNaN\(h\)/.test(L) ||                       // the edit form writing
    /recoveryLog\.push\(\{date:tk, hrv:st\.hrv/.test(L) ||
    /id="rec-hrv"/.test(L);                               // the input itself
  const stray = reads.filter((L) => !allowed(L));
  ok('every st.hrv read is the resolver or the manual save path (' + reads.length + ' lines, ' + stray.length + ' stray)',
     stray.length === 0);
  ok('the Overview wellness accessors still read hrvDaily as before', /function _ovwWellnessSeries_\(field, days\)/.test(SRC));
}

console.log('');
if (fails) { console.log(R + 'hrv today: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'hrv today: all checks passed' + X + '\n');
