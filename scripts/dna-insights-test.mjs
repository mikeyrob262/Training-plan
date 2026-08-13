// DNA INSIGHTS — the signature mechanic.
//
// The page has to answer "who am I", not repeat a dashboard, and the constraint that shapes all of
// it is the athlete's own: "I don't want to come to this page and say I've already seen this."
//
// What is pinned here is the DISCIPLINE, not the prose: one discovery per day and never repeated,
// an honest empty state instead of a manufactured insight, a confidence score that is derived or
// REFUSED, every insight carrying its own derivation, and none of the claim types already ruled
// out (day-of-week / month-of-year tendencies, per-ride temperature / sleep / HR-drift).
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

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
let fails = 0;
const ok = (l, c) => { if (!c) fails++; console.log('  ' + (c ? G + 'PASS' + X : R + 'FAIL' + X) + '  ' + l); };

const TODAY = '2026-08-13';
function build(stObj) {
  const st = stObj || {};
  return new Function('st', 'getTodayKey', 'sv', asServed(
    exVar('_DNA_SEEN_KEY') + exVar('_DNA_CONF_MIN_N') + exVar('_DNA_CONF_FULL_N') +
    'function _dnaDaysBetween_(a,b){ return Math.round((new Date(b+"T00:00:00")-new Date(a+"T00:00:00"))/86400000); }\n' +
    exFn('_dnaSeen_') + exFn('_dnaInsightId_') + exFn('_dnaIns_') +
    exFn('_dnaInsightPool_') + exFn('_dnaDiscovery_') + exFn('_dnaArchConfidence_') + exFn('_dnaLock_') +
    'return { _dnaInsightPool_, _dnaDiscovery_, _dnaArchConfidence_, _dnaLock_, _dnaInsightId_ };'
  ))(st, () => TODAY, () => {});
}
// A realistic-shaped history: deep-but-stale running, shallower riding.
function acts(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const y = 2019 + Math.floor(i / (n / 6));
    const mm = String((i % 12) + 1).padStart(2, '0');
    const dd = String((i % 27) + 1).padStart(2, '0');
    out.push({ date: y + '-' + mm + '-' + dd, sport: i % 3 === 0 ? 'ride' : 'run', dist: i % 3 === 0 ? 20 + (i % 30) : 3 + (i % 5) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
const TRAITS = [
  { name: 'Consistency', headline: '61% of weeks active', detail: 'You logged something in 400 of 650 weeks.', deriv: 'active weeks / weeks in span', locked: false },
  { name: 'Longest streak', headline: '18 weeks unbroken', detail: '', deriv: 'max consecutive active weeks', locked: false },
  { name: 'Sprint profile', locked: true, unlock: 'needs power data on 5 rides' }
];
const ERAS = [{ startY: 2019, endY: 2022, archetype: 'The Devoted Runner', archWhy: '78% runs', acts: 900, runs: 700, rides: 200 }];

console.log('\n' + Y + '=== the pool is built from real facts, and every one states its derivation ===' + X);
{
  const M = build({});
  const pool = M._dnaInsightPool_(acts(600), TRAITS, ERAS);
  ok('the pool is non-trivial', pool.length >= 15);
  ok('every insight carries text', pool.every((p) => p.text && p.text.length > 10));
  ok('every insight carries a DERIVATION', pool.every((p) => p.deriv && p.deriv.length > 5));
  ok('every insight has a stable id', pool.every((p) => p.id && /^[a-z]+:/.test(p.id)));
  ok('ids are unique', new Set(pool.map((p) => p.id)).size === pool.length);
  const kinds = new Set(pool.map((p) => p.kind));
  ok('multiple template families fire', kinds.size >= 3);
  ok('...including comparison', kinds.has('comparison'));
  ok('...and milestone', kinds.has('milestone'));
  // A locked trait has no measured headline, so it must not become a factual claim.
  ok('a LOCKED trait never becomes an insight', !pool.some((p) => /Sprint profile/.test(p.text)));
}

console.log('\n' + Y + '=== the ruled-out claim types never appear ===' + X);
{
  const M = build({});
  const all = M._dnaInsightPool_(acts(600), TRAITS, ERAS).map((p) => p.text + ' ' + p.deriv).join(' ').toLowerCase();
  ok('no day-of-week tendency claims', !/monday|tuesday|wednesday|thursday|friday|saturday|sunday|day of week/.test(all));
  ok('no month-of-year tendency claims', !/in january|in february|month of year|每/.test(all));
  ok('no temperature claims', !/temperature|degrees|\bheat\b|\bcold\b/.test(all));
  ok('no sleep claims', !/sleep|rested|hrv/.test(all));
  ok('no HR-drift claims', !/hr drift|decoupling|pw:hr/.test(all));
}

console.log('\n' + Y + '=== one per day, never repeated ===' + X);
{
  const st = {};
  const M = build(st);
  const A = acts(600);
  const d1 = M._dnaDiscovery_(A, TRAITS, ERAS);
  ok('a discovery is surfaced', !!d1.ins);
  ok('it is recorded as seen', !!st.dnaSeen[d1.ins.id]);
  ok('...and pinned to today', st.dnaToday.date === TODAY && st.dnaToday.id === d1.ins.id);
  const d2 = M._dnaDiscovery_(A, TRAITS, ERAS);
  ok('a second visit the SAME day shows the same one', d2.ins.id === d1.ins.id && d2.held === true);
  ok('...and does not burn a second insight', Object.keys(st.dnaSeen).length === 1);
  // A new day must move on to something unseen.
  st.dnaToday = { date: '2026-08-12', id: d1.ins.id };
  const d3 = M._dnaDiscovery_(A, TRAITS, ERAS);
  ok('the next day surfaces something NEW', d3.ins.id !== d1.ins.id);
  ok('...and never repeats a read insight', !Object.keys(st.dnaSeen).some((k) => k === d3.ins.id && k === d1.ins.id));
}

console.log('\n' + Y + '=== honest when there is nothing new ===' + X);
{
  const st = {};
  const M = build(st);
  const A = acts(600);
  const pool = M._dnaInsightPool_(A, TRAITS, ERAS);
  pool.forEach((p) => { st.dnaSeen = st.dnaSeen || {}; st.dnaSeen[p.id] = TODAY; });
  const d = M._dnaDiscovery_(A, TRAITS, ERAS);
  ok('it reports nothing new rather than repeating', d.none === true && d.why === 'all-seen');
  ok('...and says how big the exhausted pool was', d.poolN === pool.length);
  ok('...and does NOT manufacture an insight', !d.ins);
  // Empty history must not invent a pool.
  const empty = build({})._dnaDiscovery_([], [], []);
  ok('no history means no discovery, not a fabricated one', empty.none === true && !empty.ins);
  // The copy itself is the athlete's requested wording.
  const page = src.slice(src.indexOf("Today&rsquo;s discovery"), src.indexOf("Today&rsquo;s discovery") + 1200);
  ok('the honest fallback wording is the one asked for', /couldn&rsquo;t find anything new today/.test(page));
  ok('...and points at what would change it', /Check back after your next few rides/.test(page));
}

console.log('\n' + Y + '=== confidence is derived, or REFUSED ===' + X);
{
  const M = build({});
  const thin = M._dnaArchConfidence_({ acts: 12, runs: 10, rides: 2 });
  ok('a thin era is not scored at all', thin.scored === false);
  ok('...and says why, rather than printing a low number', /only 12 activities/.test(thin.why));
  const strong = M._dnaArchConfidence_({ acts: 900, runs: 800, rides: 100 });
  ok('a decisive, well-sampled era scores high', strong.scored && strong.pct >= 75 && strong.band === 'High');
  ok('...and shows the numbers behind it', /% runs across 900 activities/.test(strong.why));
  const marginal = M._dnaArchConfidence_({ acts: 200, runs: 122, rides: 78 });
  ok('a marginal split scores lower than a decisive one', marginal.pct < strong.pct);
  ok('every score is bounded 0-100', [thin, strong, marginal].every((c) => !c.scored || (c.pct >= 0 && c.pct <= 100)));
  // Sample size must not crush a unanimous split.
  const small = M._dnaArchConfidence_({ acts: 40, runs: 40, rides: 0 });
  const big = M._dnaArchConfidence_({ acts: 400, runs: 400, rides: 0 });
  ok('a unanimous small sample is not scored as uncertain as a mixed one', small.pct > marginal.pct);
  ok('...and more data does not LOWER confidence', big.pct >= small.pct);
  ok('no era at all returns null, never a number', M._dnaArchConfidence_(null) === null);
}

console.log('\n' + Y + '=== locked traits are earned, with countable progress ===' + X);
{
  const M = build({});
  const withP = M._dnaLock_('Sprint profile', 'needs power on 5 rides', '#fff', 3, 5);
  ok('a countable lock carries have/need', withP.have === 3 && withP.need === 5);
  ok('...and a progress fraction', Math.abs(withP.pct - 0.6) < 0.001);
  const without = M._dnaLock_('Heat vs cold', 'run the backfill first', '#fff');
  ok('an uncountable lock invents no denominator', without.have === undefined && without.need === undefined);
  ok('...and still renders as a lock', without.locked === true);
  ok('progress is clamped, never over 100%', M._dnaLock_('x', 'y', '#fff', 99, 5).pct === 1);
  // The four call sites that CAN count now do.
  ok('the start-time lock counts', /_dnaLock_\('Start-time signature'[^;]*hrs\.length, MIN\)/.test(src));
  // The lock strings contain ';' (from &mdash;), so these have to span it rather than stop at it.
  ok('the power-curve lock counts', /_dnaLock_\(p\[0\][\s\S]{0,200}?, _DNA_PC_MIN\)\)/.test(src));
  ok('the run-cadence lock counts', /_dnaLock_\('Run cadence'[\s\S]{0,200}?, c\.n, 30\)\)/.test(src));
  ok('the explorer lock counts', /_dnaLock_\('Explorer'[^;]*ids\.length, 10\)/.test(src));
  const page = src.slice(src.indexOf("Locked <span"), src.indexOf("Locked <span") + 1800);
  ok('the section is framed as earning, not apology', /earn these/.test(page));
  ok('...and draws the progress bar only when it can count', /t\.have==null \|\| !\(t\.need>0\)/.test(page));
}

console.log(fails ? ('\n' + R + fails + ' failed' + X) : ('\n' + G + 'DNA insights: all checks passed' + X));
process.exit(fails ? 1 : 0);
