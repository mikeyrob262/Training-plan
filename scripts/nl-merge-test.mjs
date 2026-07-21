// Nutrition fold semantics guard.
//
// The fold that reconciles the two st.nl date-key dialects merges meal buckets by MULTISET
// MAX. It must collapse a cross-dialect copy of the SAME entry, while preserving a food the
// athlete genuinely logged twice in one meal. Those two requirements pull in opposite
// directions, and the naive implementation (set union by fingerprint) satisfies the first by
// silently DELETING the second -- turning invisible duplication into real data loss in a log
// that has no external source to rebuild from.
//
// Fixture 1 is the real case from the live log: Hamburger - Five Guys x2 on 2026-07-21 dinner.
// If a refactor reintroduces set semantics, that fixture fails and the push is blocked.
//
// Run: node scripts/nl-merge-test.mjs
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');

function matchBrace(from){ let i=src.indexOf('{',from), depth=0; for(;i<src.length;i++){const c=src[i]; if(c==='{')depth++; else if(c==='}'){depth--; if(depth===0)return i;}} return -1; }
function extract(name){
  const idx = src.indexOf('function '+name+'(');
  if (idx < 0) throw new Error('fn not found in worker.js: '+name);
  return src.slice(idx, matchBrace(idx)+1)+'\n';
}

const code = extract('_nlFp_') + extract('_nlMergeBucket_');
(0, eval)(code);

const R='\x1b[31m', G='\x1b[32m', X='\x1b[0m';
let failed = 0;
function check(name, got, want){
  const ok = got === want;
  if (!ok) { failed++; console.error(`${R}  ✗ ${name}: got ${got}, want ${want}${X}`); }
  return ok;
}
const live = (a) => a.filter((i) => i && !i.deleted).length;

// 1. THE FIVE GUYS FIXTURE -- real data. Same meal, same day, two identical burgers, and the
//    unpadded twin bucket holds the same two. Result must stay 2: not 4 (sum), not 1 (set).
const burger = () => ({ n:'Hamburger - Five Guys', cal:700, p:42, c:40, f:43 });
check('five-guys legit repeat survives, twin collapses',
  live(_nlMergeBucket_([burger(), burger()], [burger(), burger()])), 2);

// 2. same pair, but the source has a third genuine copy -> multiset max keeps 3
check('multiset max grows to the larger side',
  live(_nlMergeBucket_([burger(), burger()], [burger(), burger(), burger()])), 3);

// 3. cross-dialect twins matched by id collapse to one
check('id twin collapses',
  live(_nlMergeBucket_([{id:'a1', n:'Banana', cal:105}], [{id:'a1', n:'Banana', cal:105}])), 1);

// 4. id-less twins collapse on the content fingerprint (the 31 pairs in the live log)
check('id-less twin collapses on fingerprint',
  live(_nlMergeBucket_([{n:'Banana', cal:105, p:1, c:27, f:0}], [{n:'Banana', cal:105, p:1, c:27, f:0}])), 1);

// 5. genuinely different foods both survive
check('distinct entries both kept',
  live(_nlMergeBucket_([{n:'Banana', cal:105}], [{n:'Apple', cal:95}])), 2);

// 6. a moved day: empty target takes everything
check('empty target takes all source entries',
  live(_nlMergeBucket_([], [burger(), {n:'Fries', cal:500}])), 2);

// 7. deletion wins -- a stale live copy must not resurrect a deleted entry
check('deleted target entry is not resurrected',
  live(_nlMergeBucket_([{id:'d1', n:'Coke', cal:140, deleted:true}], [{id:'d1', n:'Coke', cal:140}])), 0);

// 8. deleted source entries are never imported
check('deleted source entry is not imported',
  live(_nlMergeBucket_([], [{id:'d2', n:'Coke', cal:140, deleted:true}])), 0);

// 9. a set-union implementation would return 1 here; assert we are NOT that
const setSemantics = live(_nlMergeBucket_([burger(), burger()], [burger(), burger()])) === 1;
if (setSemantics) { failed++; console.error(`${R}  ✗ SET SEMANTICS DETECTED -- the legit-repeat case is being deleted${X}`); }

if (failed) { console.error(`${R}✗ nutrition fold semantics: ${failed} check(s) failed${X}`); process.exit(1); }
console.log(`${G}✓ nutrition fold semantics (9 checks, incl. the Five Guys legit-repeat fixture)${X}`);
