// Form (TSB) must equal Fitness (CTL) minus Fatigue (ATL) - on the card, in the series, everywhere.
//
// THE BUG THIS EXISTS FOR: pmcSeries_ stored today's CTL and ATL beside YESTERDAY's differential
// (a saved pc-pa from before the day's decay was applied). So the Athlete IQ Score card showed
// Fitness 59, Fatigue 65, Form -14 - three numbers about one fact that did not agree. Reported
// twice on the same card, Aug 8 and again after.
//
// Same-day is also what every other path already used: the Intervals import computes w.ctl-w.atl
// and _trStory_ falls back to p.ctl-p.atl, so the lagged local series was the odd one out.
// intervals.icu agrees too - its Fitness 61 / Fatigue 65 / Form -4 is exactly 61-65.
//
// Run: node scripts/form-tsb-test.mjs
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');
const asServed = (s) => s.replace(/\\([\s\S])/g, (_, c) => (c === '\\' ? '\\' : c));
function matchBrace(from){ let i=src.indexOf('{',from), d=0; for(;i<src.length;i++){const c=src[i]; if(c==='{')d++; else if(c==='}'){d--; if(!d)return i;}} return -1; }
function ex(name){ const i=src.indexOf('function '+name+'('); if(i<0) throw new Error('fn not found: '+name); return src.slice(i, matchBrace(i)+1)+'\n'; }
const nl = String.fromCharCode(10);
function bodyOf(name){
  const i = src.indexOf('function ' + name + '(');
  return asServed(src.slice(i, matchBrace(i) + 1))
    .split(nl).map(l => l.replace(/\r$/, '').replace(/^\s*\/\/.*$/, '')).join(nl);
}

let fails = 0;
const R='\x1b[31m', G='\x1b[32m', C='\x1b[36m', X='\x1b[0m';
const ok=(l,c,d)=>{ if(!c)fails++; console.log('  '+(c?G+'PASS'+X:R+'FAIL'+X)+'  '+l+(c||!d?'':'   -> '+d)); };
const check=(l,g,w)=>{ const c=JSON.stringify(g)===JSON.stringify(w); if(!c)fails++;
  console.log('  '+(c?G+'PASS'+X:R+'FAIL'+X)+'  '+l+(c?'':'   got '+JSON.stringify(g)+', want '+JSON.stringify(w))); };

// Drive the REAL functions over a synthetic library.
// _pmcDailyTss_ reads the ride library; stub it so the series is deterministic.
const harness = new Function('DAILY', 'LIVE', 'SERIES', asServed(
  'var _PMC_CTL_D=42, _PMC_ATL_D=7; var _pmcCache={};\n'
  + 'var window={__liveWellness:LIVE};\n'
  + 'var st={rides:[],lthr:0,ftp:0,lastUpdate:0,fitSeries:SERIES,fitSeriesAt:Date.now()};\n'
  + 'function saveLocal_(){}\n'
  + 'function _pmcDailyTss_(){ return DAILY; }\n'
  + 'function dayKey_(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }\n'
  + ex('_fitDedupe_') + ex('_fitNewestDate_') + ex('_fitAgeLabel_')
  + ex('pmcSeries_') + ex('getFitness_')
) + '\nreturn {series:pmcSeries_, fit:getFitness_, dedupe:_fitDedupe_};');

console.log('\n'+C+'=== 1. the series: Form is same-day CTL - ATL, on every point ==='+X);
// 60 days of varied load ending today, so the last point is "now".
const daily = {};
const today = new Date(); today.setHours(0,0,0,0);
for (let i = 59; i >= 0; i--) {
  const d = new Date(today); d.setDate(d.getDate() - i);
  const k = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  daily[k] = (i % 3 === 0) ? 120 : (i % 7 === 0 ? 0 : 55);
}
const H = harness(daily, { ctl: 61.4, atl: 65.2, ramp: 0.4, fetchedAt: Date.now() }, []);
const s = H.series();
ok('the series built', s.length >= 30, String(s.length));
const bad = s.filter(p => Math.abs(p.tsb - Math.round((p.ctl - p.atl) * 10) / 10) > 0.051);
ok('every point has tsb === ctl - atl', bad.length === 0,
   bad.length ? (bad.length + ' points differ, e.g. ' + JSON.stringify(bad[0])) : '');
// The specific regression: a lagged series stores the PREVIOUS day's differential.
const lagged = s.filter((p, i) => i > 0 &&
  Math.abs(p.tsb - (s[i-1].ctl - s[i-1].atl)) < 0.051 &&
  Math.abs(p.tsb - (p.ctl - p.atl)) > 0.051);
ok('no point carries YESTERDAY\'s differential', lagged.length === 0, String(lagged.length));

console.log('\n'+C+'=== 2. the headline: the three numbers on the card agree ==='+X);
const f = H.fit();
console.log('     Fitness ' + f.ctl + '   Fatigue ' + f.atl + '   Form ' + f.tsb);
check('Form === Fitness - Fatigue, exactly', f.tsb, f.ctl - f.atl);
ok('all three are integers, so the card cannot round them apart',
   Number.isInteger(f.ctl) && Number.isInteger(f.atl) && Number.isInteger(f.tsb));
// Rounding trap: derive from the ROUNDED pair, never round tsb independently.
ok('getFitness_ derives tsb rather than rounding it separately',
   /tsb=ctl-atl/.test(bodyOf('getFitness_')) && !/tsb=Math\.round\(last\.tsb/.test(bodyOf('getFitness_')));

console.log('\n'+C+'=== 3. one convention across every producer ==='+X);
ok('the local series uses same-day ctl-atl', /tsb:Math\.round\(\(rc-ra\)\*10\)\/10/.test(bodyOf('pmcSeries_')));
ok('...derived from the ROUNDED pair, so the stored triple cannot split', /var rc=Math\.round/.test(bodyOf('pmcSeries_')));
ok('...and no longer keeps a previous-day pair to subtract',
   !/pc=ctl, ?pa=atl/.test(bodyOf('pmcSeries_')) && !/pc-pa/.test(bodyOf('pmcSeries_')));
// The Intervals import path already used same-day; it must stay that way.
ok('the Intervals import path is same-day too', /tsb:Math\.round\(\(w\.ctl-w\.atl\)\*10\)\/10/.test(asServed(src)));


console.log('\n'+C+'=== 4. Intervals is the source, and there is no silent fallback ==='+X);
check('the headline comes from Intervals, not the local curve', f.source, 'intervals-live');
check("...and is Intervals' numbers, rounded", [f.ctl, f.atl], [61, 65]);
// With NOTHING from Intervals it must report not-loaded - never quietly serve the local PMC, which
// is the two-computations-of-one-fact defect this change exists to remove.
const noSrc = harness(daily, null, []).fit();
check('with no Intervals data at all, it reports not-loaded', noSrc.loaded, false);
check('...and does NOT fall back to the local calculation', noSrc.source, 'none');
ok('...so a surface renders an em-dash rather than an invented number',
   noSrc.loaded === false && noSrc.ctl === 0);
ok('getFitness_ never reads the local curve for the triple',
   !/pmcSeries_\(/.test(bodyOf('getFitness_')));

console.log('\n'+C+'=== 5. last known good, served with a visible age ==='+X);
const cached = harness(daily, null, [{ date:'2026-08-04', ctl:58.5, atl:56.9, ramp:0.2 }]).fit();
check('a cached Intervals row is served when the live poll is missing', cached.source, 'intervals-series');
check('...still with Form = Fitness - Fatigue', cached.tsb, cached.ctl - cached.atl);
ok('...marked stale, with a human-readable age',
   cached.stale === true && typeof cached.ageLabel === 'string',
   JSON.stringify({ stale: cached.stale, age: cached.ageLabel }));

console.log('\n'+C+'=== 6. the cached curve holds one row per date ==='+X);
// mergeArrays_ dedupes these rows by JSON.stringify, so two devices holding different ctl for the
// same day both survive. Measured live: 357 entries across 166 calendar days.
const dd = H.dedupe([{ date:'2026-08-03', ctl:57, atl:60 },
                     { date:'2026-08-03', ctl:57.4, atl:61.2 },
                     { date:'2026-08-04', ctl:58.5, atl:56.9 }]);
check('duplicate dates collapse to one row', dd.length, 2);
check('...keeping the later fetch', dd[0].ctl, 57.4);
ok('the fetch path dedupes before storing', /out=_fitDedupe_\(out\)/.test(bodyOf('fetchIntervalsFitnessSeries_')));
ok('freshness is judged on the DATA, not only the max-merged clock',
   /_fitNewestDate_/.test(bodyOf('ensureFitnessSeries_')));

console.log(fails ? '\n'+R+'form/tsb: '+fails+' FAILED'+X+'\n' : '\n'+G+'form/tsb: all checks passed'+X+'\n');
process.exit(fails?1:0);
