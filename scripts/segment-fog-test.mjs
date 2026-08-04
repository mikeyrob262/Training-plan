// Fog-of-war segment coverage map — tiering, geometry and the honesty rules.
//
// Three things here are easy to get wrong in a way that still renders:
//   1. tiering off prRank. pr_rank ranks an effort against the athlete's OWN efforts, so a personal
//      second-best would be promoted into a leaderboard tier and the map would claim placements
//      that do not exist. Only kom_rank is a leaderboard fact.
//   2. reading the store through segmentRecordsCompute_, which skips every segment with no PR time
//      — 1,875 of 2,017 live. The map would silently lose 93% of its coverage and look plausible.
//   3. absorbing geometry destructively. Endpoints do not move; re-deriving them per effort churns
//      the store and, worse, a later partial payload could null a good coordinate.
//
// Everything runs in SERVED form (the template literal eats a backslash level).
//
// Run: node scripts/segment-fog-test.mjs
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');

const asServed = (s) => s.replace(/\\([\s\S])/g, (_, c) => (c === '\\' ? '\\' : c));
function matchBrace(from){ let i=src.indexOf('{',from), d=0; for(;i<src.length;i++){const c=src[i]; if(c==='{')d++; else if(c==='}'){d--; if(!d)return i;}} return -1; }
function ex(name){ const i=src.indexOf('function '+name+'('); if(i<0) throw new Error('fn not found: '+name); return src.slice(i, matchBrace(i)+1)+'\n'; }

let fails=0;
const R='\x1b[31m', G='\x1b[32m', C='\x1b[36m', X='\x1b[0m';
const check=(label,got,want)=>{ const ok=JSON.stringify(got)===JSON.stringify(want); if(!ok)fails++;
  console.log('  '+(ok?G+'PASS'+X:R+'FAIL'+X)+'  '+label+(ok?'':'   got '+JSON.stringify(got)+', want '+JSON.stringify(want))); };
const ok=(label,cond)=>{ if(!cond)fails++; console.log('  '+(cond?G+'PASS'+X:R+'FAIL'+X)+'  '+label); };

const F = new Function(asServed(
  'var _SA_SINUOUS=1.15, _SA_SINUOUS_BAD=1.6;\n'
  + ex('isPlainObj_') + ex('_saHaversineM_') + ex('_segBearingDeg_') + ex('_saSinuosity_')
  + ex('_segAbsorb_') + ex('_saFogTierOf_') + ex('_saFogList_') + ex('_saFogHome_') + ex('_saOrdinal_')
) + '\nreturn {tier:_saFogTierOf_, list:_saFogList_, home:_saFogHome_, ord:_saOrdinal_, bear:_segBearingDeg_, absorb:_segAbsorb_};')();

console.log('\n'+C+'=== 1. tier precedence uses only facts that exist ==='+X);
check('kom_rank present -> top-10 tier', F.tier({komRank:7, prSec:300}).t, 3);
check('kom_rank 1 is still tier 3, not a 4th state', F.tier({komRank:1}).t, 3);
check('PR time, no kom -> personal PR tier', F.tier({prSec:300}).t, 2);
check('no PR time -> attempted tier', F.tier({effortCount:9}).t, 1);
check('kom outranks PR', F.tier({komRank:3, prSec:300}).key, 'kom');
console.log('  '+C+'-- prRank must NEVER promote a tier --'+X);
check('prRank 1 alone is not placement', F.tier({prRank:1}).t, 1);
check('prRank 1 + PR time is still just a PR', F.tier({prRank:1, prSec:300}).t, 2);
check('prRank 2 does not become 2nd on a leaderboard', F.tier({prRank:2, prSec:300}).key, 'pr');
ok('every tier has a distinct colour',
  new Set([F.tier({komRank:1}).col, F.tier({prSec:1}).col, F.tier({}).col]).size===3);

console.log('\n'+C+'=== 2. the map reads EVERY attempted segment, not just PR ones ==='+X);
// This is the segmentRecordsCompute_ trap: it returns only segments with prSec>0.
const store={
  a:{id:'sa', name:'PR one',   startLat:42.9, startLon:-85.6, endLat:42.91, endLon:-85.6, prSec:300, distMi:1},
  b:{id:'sb', name:'No PR',    startLat:42.9, startLon:-85.7, endLat:42.92, endLon:-85.7, distMi:1},
  c:{id:'sc', name:'KOM',      startLat:42.8, startLon:-85.6, endLat:42.81, endLon:-85.6, komRank:4, prSec:250, distMi:1},
  d:{id:'sd', name:'No coords',prSec:100, distMi:1}
};
const L=F.list(store);
check('all four counted as attempted', L.total, 4);
check('three are drawable', L.segs.length, 3);
check('the no-PR segment IS on the map', L.segs.filter(s=>s.id==='sb').length, 1);
check('the coordinate-less one is reported, not dropped silently', L.noGeom, 1);
check('tier counts', L.byTier, {1:1,2:1,3:1});
check('empty store is empty, not an error', F.list({}).segs.length, 0);
check('null store is handled', F.list(null).segs.length, 0);

console.log('\n'+C+'=== 3. the chord is labelled honestly ==='+X);
// distMi vs the straight-line distance decides solid (chord ~ road) vs dashed (road bends).
const straight={s:{id:'ss', startLat:42.0, startLon:-85.0, endLat:42.0180, endLon:-85.0, distMi:1.25}};
const windy  ={w:{id:'sw', startLat:42.0, startLon:-85.0, endLat:42.0180, endLon:-85.0, distMi:3.5}};
check('a straight segment draws solid', F.list(straight).segs[0].bends, false);
check('a wandering segment draws dashed', F.list(windy).segs[0].bends, true);
check('unknown distance is treated as bending, not as straight',
  F.list({x:{id:'sx', startLat:42, startLon:-85, endLat:42.01, endLon:-85}}).segs[0].bends, true);

console.log('\n'+C+'=== 4. the map opens where the riding is ==='+X);
// Four real clusters exist in the live store; a global fit renders them as specks.
const spread=[];
for(let i=0;i<40;i++) spread.push({lat:42.9+i*0.001, lon:-85.6+i*0.001});   // dense home cluster
for(let i=0;i<3;i++)  spread.push({lat:-22.2+i*0.01, lon:166.4+i*0.01});    // South Pacific outlier
const home=F.home(spread);
ok('home bounds sit on the dense cluster', home.south>42 && home.north<44 && home.west<-85 && home.east>-86);
ok('the far outlier is excluded from the default view', home.n===40);
check('no segments -> no home', F.home([]), null);

console.log('\n'+C+'=== 5. bearing is computed, not assumed ==='+X);
check('due north', F.bear(42, -85, 43, -85), 0);
check('due east',  F.bear(0, 0, 0, 1), 90);
check('due south', F.bear(43, -85, 42, -85), 180);
check('missing input -> null, never 0', F.bear(42, -85, null, -85), null);
ok('0 degrees and null are distinguishable', F.bear(42,-85,43,-85)===0 && F.bear(42,-85,null,null)===null);

console.log('\n'+C+'=== 6. absorbing never destroys what is already stored ==='+X);
const seg={id:'s1', startLat:42.5, startLon:-85.5, endLat:42.6, endLon:-85.5, bearing:12.3, komRank:2, komRankDate:'2025-01-01'};
F.absorb(seg, {startLat:1, startLon:1, endLat:2, endLon:2, komRank:9}, '2026-08-04');
check('existing coordinates are not overwritten', [seg.startLat, seg.startLon], [42.5,-85.5]);
check('existing bearing is not recomputed', seg.bearing, 12.3);
check('a WORSE later rank does not replace a better one', seg.komRank, 2);
check('...and keeps the date of the rank it describes', seg.komRankDate, '2025-01-01');

const fresh={id:'s2'};
const wrote=F.absorb(fresh, {startLat:42.1, startLon:-85.1, endLat:42.2, endLon:-85.2, komRank:5, prRank:1}, '2026-08-04');
ok('a bare record absorbs geometry', fresh.startLat===42.1 && fresh.endLon===-85.2);
ok('...and gets a derived bearing', typeof fresh.bearing==='number');
check('...and the placement, dated', [fresh.komRank, fresh.komRankDate], [5,'2026-08-04']);
check('...and prRank is stored but separate from placement', fresh.prRank, 1);
check('absorb reports that it changed something', wrote, true);
check('a second identical absorb is a no-op', F.absorb(fresh, {startLat:42.1, startLon:-85.1, komRank:5, prRank:1}, '2026-08-04'), false);

const better={id:'s3', komRank:8, komRankDate:'2024-01-01'};
F.absorb(better, {komRank:2}, '2026-03-03');
check('a BETTER later rank does replace', [better.komRank, better.komRankDate], [2,'2026-03-03']);
check('rank 0 / null is ignored', (F.absorb({id:'s4'}, {komRank:0}, '2026-01-01')), false);

console.log('\n'+C+'=== 7. ordinals read as English ==='+X);
check('1st', F.ord(1), '1st'); check('2nd', F.ord(2), '2nd'); check('3rd', F.ord(3), '3rd');
check('4th', F.ord(4), '4th'); check('11th not 11st', F.ord(11), '11th'); check('13th', F.ord(13), '13th');

console.log('\n'+C+'=== 8. invariants in the source ==='+X);
const codeLines = src.split('\n').filter(L => !/^\s*\/\//.test(L));
const has = (s) => codeLines.some(L => L.indexOf(s)>=0);
ok('the map does not read segmentRecordsCompute_ for coverage',
  !/segmentRecordsCompute_/.test(src.slice(src.indexOf('function _saFogList_('), matchBrace(src.indexOf('function _saFogList_(')))));
ok('placement is always written with a date', has('seg.komRankDate=d'));
ok('the limitation banner names roads with no segment', has('no Strava segment on it'));
ok('placement is never labelled as current', has('placement as of that effort, not today'));

console.log(fails ? '\n'+R+'segment fog: '+fails+' FAILED'+X+'\n' : '\n'+G+'segment fog: all checks passed'+X+'\n');
process.exit(fails?1:0);
