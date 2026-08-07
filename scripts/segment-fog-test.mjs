// Fog-of-war segment coverage map — tiering, geometry and the honesty rules.
//
// Three things here are easy to get wrong in a way that still renders:
//   1. tiering off any STORED rank. Strava stamps kom_rank at UPLOAD time and it is provably stale
//      on this athlete's data - Barcroft carries kom_rank 1 while sitting 10s off the current KOM.
//      pr_rank is worse still: it ranks an effort against the athlete's OWN efforts. The top tier
//      must be reachable ONLY from a live check, and nothing about placement may be persisted.
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
// Declarations, not functions. SA_FOG_STYLE is a multi-line object literal; SA_FOG_E2 is a
// one-liner that declares SA_FOG_E3 alongside it, so extracting the first line takes both.
function exv(name){
  const i = src.indexOf('var '+name+'=');
  if (i < 0) throw new Error('var not found: '+name);
  const nl = String.fromCharCode(10);
  const firstLine = src.slice(i, src.indexOf(nl, i));
  if (firstLine.trim().endsWith('{')) return src.slice(i, matchBrace(i)+1) + ';' + nl;
  return firstLine + nl;
}

let fails=0;
const R='\x1b[31m', G='\x1b[32m', C='\x1b[36m', X='\x1b[0m';
const check=(label,got,want)=>{ const ok=JSON.stringify(got)===JSON.stringify(want); if(!ok)fails++;
  console.log('  '+(ok?G+'PASS'+X:R+'FAIL'+X)+'  '+label+(ok?'':'   got '+JSON.stringify(got)+', want '+JSON.stringify(want))); };
const ok=(label,cond)=>{ if(!cond)fails++; console.log('  '+(cond?G+'PASS'+X:R+'FAIL'+X)+'  '+label); };

const F = new Function(asServed(
  // _saPoly is the session road-shape cache the renderer reads; empty here so every assertion below
  // describes the un-fetched state, and the one test that cares injects its own shapes.
  'var _SA_SINUOUS=1.15, _SA_SINUOUS_BAD=1.6; var _saPoly={};\n'
  + ex('isPlainObj_') + ex('_saHaversineM_') + ex('_segBearingDeg_') + ex('_saSinuosity_')
  + ex('_saKomCandidate_') + ex('_saXomSec_') + ex('_saPolyDecode_')
  + exv('SA_FOG_STYLE') + exv('SA_FOG_E2') + ex('_saFogRamp_') + ex('_saFogStyleOf_')
  + ex('_segAbsorb_') + ex('_saFogTierOf_') + ex('_saFogList_') + ex('_saFogHome_') + ex('_saOrdinal_')
) + '\nreturn {tier:_saFogTierOf_, list:_saFogList_, home:_saFogHome_, ord:_saOrdinal_, bear:_segBearingDeg_, absorb:_segAbsorb_, cand:_saKomCandidate_, xom:_saXomSec_, ramp:_saFogRamp_, poly:_saPolyDecode_, STYLE:SA_FOG_STYLE};')();

console.log('\n'+C+'=== 1. the top tier is reachable ONLY from a live check ==='+X);
check('a live holding result is the top tier', F.tier({prSec:300}, {holds:true}).t, 3);
check('PR time, no live check -> personal PR tier', F.tier({prSec:300}, null).t, 2);
check('live check that came back NOT holding stays at PR', F.tier({prSec:300}, {holds:false}).t, 2);
check('live check with an unknown answer stays at PR', F.tier({prSec:300}, {holds:null}).t, 2);
check('a live error never promotes', F.tier({prSec:300}, {err:'unavailable'}).t, 2);
check('no PR time -> attempted tier', F.tier({effortCount:9}, null).t, 1);
console.log('  '+C+'-- NO stored field may reach the top tier --'+X);
check('a stored komRank does not promote', F.tier({komRank:1, prSec:300}, null).t, 2);
check('a stored komRank of 1 is ignored entirely', F.tier({komRank:1}, null).t, 1);
check('a stored prRank does not promote', F.tier({prRank:1, prSec:300}, null).t, 2);
check('stored rank cannot beat a live not-holding', F.tier({komRank:1, prSec:300}, {holds:false}).t, 2);
ok('every tier has a distinct colour',
  new Set([F.tier({prSec:1},{holds:true}).col, F.tier({prSec:1},null).col, F.tier({},null).col]).size===3);

console.log('\n'+C+'=== 1b. only plausible segments are worth a request ==='+X);
check('a segment with a PR is a candidate', F.cand({prSec:120}), true);
check('no PR -> not worth a lookup', F.cand({effortCount:40}), false);
check('prSec 0 is not a PR', F.cand({prSec:0}), false);
check('null segment', F.cand(null), false);

console.log('\n'+C+'=== 1c. leaderboard times parse in every shape Strava sends ==='+X);
// All of these appear in this athlete's own library. A naive split on colon yields NaN for '49s',
// which reads as "no KOM known" on exactly the short sprints where the gap is smallest.
check('sub-minute 49s', F.xom('49s'), 49);
check('1:17', F.xom('1:17'), 77);
check('10:56', F.xom('10:56'), 656);
check('over an hour 1:02:33', F.xom('1:02:33'), 3753);
check('null', F.xom(null), null);
check('empty', F.xom(''), null);
check('garbage is null, never NaN', F.xom('--'), null);
check('NaN is never returned', Number.isNaN(F.xom('x:y')), false);

console.log('\n'+C+'=== 2. the map reads EVERY attempted segment, not just PR ones ==='+X);
// This is the segmentRecordsCompute_ trap: it returns only segments with prSec>0.
const store={
  a:{id:'sa', name:'PR one',   startLat:42.9, startLon:-85.6, endLat:42.91, endLon:-85.6, prSec:300, distMi:1},
  b:{id:'sb', name:'No PR',    startLat:42.9, startLon:-85.7, endLat:42.92, endLon:-85.7, distMi:1},
  c:{id:'sc', name:'Fast one', startLat:42.8, startLon:-85.6, endLat:42.81, endLon:-85.6, prSec:250, distMi:1},
  d:{id:'sd', name:'No coords',prSec:100, distMi:1}
};
const L=F.list(store, {});
check('all four counted as attempted', L.total, 4);
check('three are drawable', L.segs.length, 3);
check('the no-PR segment IS on the map', L.segs.filter(s=>s.id==='sb').length, 1);
check('the coordinate-less one is reported, not dropped silently', L.noGeom, 1);
check('tier counts with nothing checked yet', L.byTier, {1:1,2:2,3:0});
check('...and the top tier appears once a live check holds',
  F.list(store, {c:{holds:true}}).byTier, {1:1,2:1,3:1});
check('candidate count is the PR-bearing set', L.candidates, 2);
check('checked count reflects the live cache', F.list(store, {c:{holds:false}}).checked, 1);
check('an errored check is not counted as checked', F.list(store, {c:{err:'x'}}).checked, 0);
check('empty store is empty, not an error', F.list({}, {}).segs.length, 0);
check('null store is handled', F.list(null, {}).segs.length, 0);
check('a missing live cache is handled', F.list(store).segs.length, 3);

console.log('\n'+C+'=== 3. the chord is labelled honestly ==='+X);
// distMi vs the straight-line distance decides solid (chord ~ road) vs dashed (road bends).
const straight={s:{id:'ss', startLat:42.0, startLon:-85.0, endLat:42.0180, endLon:-85.0, distMi:1.25}};
const windy  ={w:{id:'sw', startLat:42.0, startLon:-85.0, endLat:42.0180, endLon:-85.0, distMi:3.5}};
check('a straight segment draws solid', F.list(straight,{}).segs[0].bends, false);
check('a wandering segment draws dashed', F.list(windy,{}).segs[0].bends, true);
check('unknown distance is treated as bending, not as straight',
  F.list({x:{id:'sx', startLat:42, startLon:-85, endLat:42.01, endLon:-85}},{}).segs[0].bends, true);

console.log('\n'+C+'=== 4. the map opens where the RIDING is, not where the segments are ==='+X);
// Measured on the live store: the Chicago cell has the most SEGMENTS (692) but every effort is
// dated 2026-07-02 - one day out - and it holds 2 of 117 PRs. Grand Rapids has 508 segments,
// 1,907 efforts and 95 PRs. Ranking by segment count opens the map on the wrong city.
const oneBigDay=[]; for(let i=0;i<60;i++) oneBigDay.push({lat:41.9+i*0.001, lon:-87.8+i*0.001, effortCount:1});
const homeRoads=[]; for(let i=0;i<25;i++) homeRoads.push({lat:42.9+i*0.001, lon:-85.6+i*0.001, effortCount:12});
const picked=F.home(oneBigDay.concat(homeRoads));
ok('the bigger SEGMENT COUNT does not win', !(picked.south>41.5 && picked.north<42.5));
ok('the place actually ridden more does', picked.south>42.5 && picked.north<43.5, {south:picked.south, north:picked.north});
ok('a segment with no effort count still counts once', F.home([{lat:10,lon:10},{lat:10.001,lon:10.001}])!==null);

const spread=[];
for(let i=0;i<40;i++) spread.push({lat:42.9+i*0.001, lon:-85.6+i*0.001, effortCount:5});
for(let i=0;i<3;i++)  spread.push({lat:-22.2+i*0.01, lon:166.4+i*0.01, effortCount:5});
const home=F.home(spread);
ok('home bounds sit on the dense cluster', home.south>42 && home.north<44 && home.west<-85 && home.east>-86);
ok('the far outlier is excluded from the default view', home.n===40);
ok('percentile bounds report what they trimmed', typeof home.trimmed==='number');
check('no segments -> no home', F.home([]), null);

console.log('\n'+C+'=== 5. bearing is computed, not assumed ==='+X);
check('due north', F.bear(42, -85, 43, -85), 0);
check('due east',  F.bear(0, 0, 0, 1), 90);
check('due south', F.bear(43, -85, 42, -85), 180);
check('missing input -> null, never 0', F.bear(42, -85, null, -85), null);
ok('0 degrees and null are distinguishable', F.bear(42,-85,43,-85)===0 && F.bear(42,-85,null,null)===null);

console.log('\n'+C+'=== 6. absorbing takes GEOMETRY ONLY, and never destroys ==='+X);
const seg={id:'s1', startLat:42.5, startLon:-85.5, endLat:42.6, endLon:-85.5, bearing:12.3};
F.absorb(seg, {startLat:1, startLon:1, endLat:2, endLon:2, komRank:9, prRank:1});
check('existing coordinates are not overwritten', [seg.startLat, seg.startLon], [42.5,-85.5]);
check('existing bearing is not recomputed', seg.bearing, 12.3);
ok('NO placement field is ever written', !('komRank' in seg) && !('prRank' in seg)
  && !('komRankDate' in seg) && !('prRankDate' in seg));

const fresh={id:'s2'};
const wrote=F.absorb(fresh, {startLat:42.1, startLon:-85.1, endLat:42.2, endLon:-85.2, komRank:5, prRank:1});
ok('a bare record absorbs geometry', fresh.startLat===42.1 && fresh.endLon===-85.2);
ok('...and gets a derived bearing', typeof fresh.bearing==='number');
ok('...and STILL stores no placement, even when the payload carries it',
  !('komRank' in fresh) && !('prRank' in fresh));
check('absorb reports that it changed something', wrote, true);
check('a second absorb is a no-op', F.absorb(fresh, {startLat:42.1, startLon:-85.1}), false);
check('a payload with no coordinates changes nothing', F.absorb({id:'s5'}, {komRank:1}), false);

console.log('\n'+C+'=== 7. ordinals read as English ==='+X);
check('1st', F.ord(1), '1st'); check('2nd', F.ord(2), '2nd'); check('3rd', F.ord(3), '3rd');
check('4th', F.ord(4), '4th'); check('11th not 11st', F.ord(11), '11th'); check('13th', F.ord(13), '13th');

console.log('\n'+C+'=== 7b. the warm-to-cool ramp is driven by real effort counts ==='+X);
// The ramp is not decoration: the attempted tier splits by how many times a road was actually
// ridden, which is what makes a home cluster read as radiating rather than as one flat colour.
check('KOM takes the top step', F.ramp({t:3}, 0), 4);
check('PR takes the step below it', F.ramp({t:2}, 0), 3);
check('ridden 3+ is the warm end of the cool half', F.ramp({t:1}, 20), 2);
check('ridden once is the coldest step', F.ramp({t:1}, 1), 0);
check('ridden twice is the middle step', F.ramp({t:1}, 2), 1);
check('exactly 3 reaches the blue step', F.ramp({t:1}, 3), 2);
check('no effort count is the coldest, never warm', F.ramp({t:1}, 0), 0);
ok('the ramp runs warm to cool across five distinct colours',
  new Set([F.STYLE[0].line,F.STYLE[1].line,F.STYLE[2].line,F.STYLE[3].line,F.STYLE[4].line]).size===5);
ok('line weight increases monotonically up the ramp',
  [0,1,2,3].every(i=>F.STYLE[i].lw < F.STYLE[i+1].lw));
ok('glow strength increases monotonically up the ramp',
  [0,1,2,3].every(i=>F.STYLE[i].go < F.STYLE[i+1].go));
ok('dot size never out-grows its line', [0,1,2,3,4].every(i=>F.STYLE[i].dr*2 < F.STYLE[i].gw));
const hotTier=F.tier({prSec:1, effortCount:50}, {holds:true});
const coldTier=F.tier({effortCount:1}, null);
ok('a held KOM and a once-ridden road never share a colour', hotTier.col!==coldTier.col);
check('the attempted label names how often it was ridden', F.tier({effortCount:1}, null).label, 'Ridden once');
check('...and counts when it is more than one', F.tier({effortCount:7}, null).label, 'Ridden ×7');

console.log('\n'+C+'=== 7c. road geometry: decoded, and never faked ==='+X);
// Strava's encoded polyline. Verified against a real response: Barcroft is 102 chars / 37 points.
check('a known encoded polyline decodes to the right point count',
  F.poly('_p~iF~ps|U_ulLnnqC_mqNvxq`@').length, 3);
check('the first decoded point is right',
  F.poly('_p~iF~ps|U_ulLnnqC_mqNvxq`@')[0].map(n=>Math.round(n*100)/100), [38.5,-120.2]);
check('empty input is null, not an empty path', F.poly(''), null);
check('null input', F.poly(null), null);
check('a single-point path is null (nothing to draw)', F.poly('_p~iF~ps|U'), null);
const geoStore={g:{id:'sg', name:'Curvy', startLat:42.0, startLon:-85.0, endLat:42.02, endLon:-85.0, distMi:3.0, prSec:100}};
check('without a fetched shape the segment is not marked real', F.list(geoStore,{}).segs[0].real, false);

console.log('\n'+C+'=== 8. invariants in the source ==='+X);
const codeLines = src.split('\n').filter(L => !/^\s*\/\//.test(L));
const has = (q) => codeLines.some(L => L.indexOf(q)>=0);
const fogSrc = src.slice(src.indexOf('function _saFogList_('), matchBrace(src.indexOf('function _saFogList_(')));
ok('the map does not read segmentRecordsCompute_ for coverage', fogSrc.indexOf('segmentRecordsCompute_')<0);
const absorbSrc = src.slice(src.indexOf('function _segAbsorb_('), matchBrace(src.indexOf('function _segAbsorb_(')));
ok('_segAbsorb_ contains no placement write at all',
  absorbSrc.indexOf('komRank')<0 && absorbSrc.indexOf('prRank')<0);
ok('the live check reads /segments/{id}, not the upload-time rank endpoint',
  has("'https://www.strava.com/api/v3/segments/'+segId") && !has('segment_efforts?segment_id'));
// The coverage MAP is gone (replaced by the target list), and these two assertions used to match
// copy that lived on it. The invariants behind them did not go anywhere, so they now point at where
// the target list states the same two things — rather than being deleted along with the wording.
//   1. This list is a subset of what Strava matched, not of roads ridden. The map said "unlit ground
//      is road with no Strava segment on it"; the list says the same limit as a denominator.
//   2. Placement is never stored. This is the one the whole KOM headline rests on.
ok('the list states it covers only what Strava matched, not roads ridden',
   has('segments Strava has matched to your rides'));
ok('the UI states that placement is never stored',
   has('fetched live and thrown away') && has('nothing about it is written to your data'));
// The crown headline must NOT print a zero before anything has been checked: "0 of N" asserts the
// athlete holds none, when the truth pre-sweep is that nobody looked. Guarded on the em-dash branch
// being keyed to the CHECKED count, not to the held count.
ok('the crown headline shows an em-dash until something is actually checked',
   has("var crownStr=(d.checked>0)?String(d.held):'&mdash;'"));
ok('the crown headline reports the unchecked remainder', has('unchecked'));
// Membership cannot be a boolean: mergeState_ ORs booleans (a || b), so a `false` never beats a
// remote `true` and a removal would silently undo itself on the next sync.
// Checked on the FUNCTION BODY, not the whole file — a source-wide search for 'targetAt' passes even
// when the predicate has been rewritten to read a boolean, because the writers still mention the
// field. A mutation test caught this assertion doing exactly that.
const isTgtSrc = (function(){ const i = src.indexOf('function _saIsTarget_('); return i < 0 ? '' : src.slice(i, matchBrace(i)); })();
ok('the membership predicate exists', isTgtSrc.length > 0);
ok('membership is decided by comparing two timestamps',
   isTgtSrc.indexOf('targetAt') >= 0 && isTgtSrc.indexOf('untargetAt') >= 0 && isTgtSrc.indexOf('>') >= 0);
ok('the membership predicate reads no boolean flag',
   !/seg\s*&&\s*seg\.target\b(?!At)/.test(isTgtSrc));
ok('the target seed uses a constant stamp so a user removal always outranks it',
   has('_SA_TARGET_SEED_AT') && !has('s.targetAt=Date.now(); n++'));
ok('the sweep cap is a named constant, not a magic number', has('SA_KOM_SWEEP_CAP'));
ok('the sweep reports what it capped rather than truncating silently', has('capped at '));
ok('a deliberate tab change resets the map view',
  src.slice(src.indexOf('function aiSetTab_('), matchBrace(src.indexOf('function aiSetTab_('))).indexOf('_saFogView=null')>=0);

console.log(fails ? '\n'+R+'segment fog: '+fails+' FAILED'+X+'\n' : '\n'+G+'segment fog: all checks passed'+X+'\n');
process.exit(fails?1:0);
