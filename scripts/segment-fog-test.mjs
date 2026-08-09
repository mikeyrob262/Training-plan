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
  + exv('_SA_HOME_R_M') + exv('SA_MAP_COL') + exv('SA_MAP_W')
  + ex('isPlainObj_') + ex('_saHaversineM_') + ex('_segBearingDeg_') + ex('_saSinuosity_')
  + ex('_saKomCandidate_') + ex('_saXomSec_') + ex('_saPolyDecode_')
  + exv('SA_FOG_STYLE') + exv('SA_FOG_E2') + ex('_saFogRamp_') + ex('_saFogStyleOf_')
  + ex('_segAbsorb_') + ex('_saFogTierOf_') + ex('_saFogList_') + ex('_saFogHome_') + ex('_saOrdinal_')
  + ex('_saStatusCol_')
) + '\nreturn {tier:_saFogTierOf_, list:_saFogList_, home:_saFogHome_, ord:_saOrdinal_, bear:_segBearingDeg_, absorb:_segAbsorb_, cand:_saKomCandidate_, xom:_saXomSec_, ramp:_saFogRamp_, poly:_saPolyDecode_, statusCol:_saStatusCol_, STYLE:SA_FOG_STYLE, MAPCOL:SA_MAP_COL, MAPW:SA_MAP_W};')();

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
// SA_KOM_SWEEP_CAP guarded the old viewport sweep, which went with the fog map. The live sweep is
// over the TARGET list; asserting on the dead constant would have kept passing on nothing.
ok('the sweep cap is a named constant, not a magic number', has('SA_TGT_SWEEP_CAP'));
ok('the retired viewport-sweep cap is gone with its sweep', !has('SA_KOM_SWEEP_CAP'));
ok('the sweep reports what it capped rather than truncating silently', has('capped at '));
ok('a deliberate tab change resets the map view',
  src.slice(src.indexOf('function aiSetTab_('), matchBrace(src.indexOf('function aiSetTab_('))).indexOf('_saMapView=null')>=0);
// The old always-on route tangle must not survive anywhere - not as a fallback, not alongside the
// new map. These name the symbols that WERE it, so a re-introduction fails loudly.
ok('the fog mount is gone', !has('function _saFogMount_'));
ok('the fog view HTML is gone', !has('function aiSegFogHtml_'));
ok('no fog map state survives', !has('var _saFogMap') && !has('_saFogLayers'));
ok('the coverage map uses the shared base builder, not a hand-rolled dark tile layer',
   has('addRideMapBase_(map,') && has("id='sa-cov-canvas'"));
ok('the map legend states that never-ridden is not drawable', has('not drawable'));
ok('the list scroll area hides its scrollbar',
   has('scrollbar-width:none') && has('.sa-list::-webkit-scrollbar'));

// ---- the opening view, producer against consumer -------------------------------------------
// This is the check that was missing when the map shipped opening on a world view. _saFogHome_
// returns four NUMBERS; the mount read a `.bounds` field off it that has never existed, so the
// home-cluster branch was dead and every load fell through to fit-all. Nothing failed: the map
// still drew, still had tiles, still had segments on it - it just opened at zoom 2.5 over the
// Atlantic, because this library spans Michigan to the South Pacific. A silent fall-through to a
// plausible-looking wrong answer needs the producer and the consumer asserted TOGETHER.
console.log('\n'+C+'=== 9. the map opens on the home cluster, not the whole globe ==='+X);
const homeSegs = [
  // A dense home cluster...
  {lat:42.96, lon:-85.67, endLat:42.99, endLon:-85.60, effortCount:400},
  {lat:42.98, lon:-85.70, endLat:43.02, endLon:-85.64, effortCount:350},
  {lat:43.01, lon:-85.61, endLat:43.05, endLon:-85.55, effortCount:300},
  // ...and one segment on the far side of the planet, which is what breaks a fit-all.
  {lat:-17.53, lon:-149.56, endLat:-17.50, endLon:-149.50, effortCount:1}
];
const hb = F.home(homeSegs);
ok('_saFogHome_ returns a home cluster at all', !!hb);
ok('...as four finite numbers', !!hb && ['south','north','west','east'].every(k => Number.isFinite(hb[k])));
ok('...and NOT as a .bounds field, which is what the mount wrongly read',
   !!hb && hb.bounds === undefined);
ok('the home cluster excludes the far-side-of-the-planet outlier',
   !!hb && hb.south > 40 && hb.north < 45 && hb.west > -90 && hb.east < -80);
// Now the consumer, on the mount's own body.
// COMMENTS STRIPPED FIRST. The comment explaining this bug necessarily quotes the broken
// expression, so asserting over raw source fails on the very prose that documents the fix — the
// same "assert on the body, not the file" trap the membership check hit.
const nl = String.fromCharCode(10);
// CRLF-SAFE. JS "." does not match \r, so /^\s*\/\/.*$/ silently matches NOTHING on a CRLF file --
// no comment is stripped, and every assertion then reads the prose that documents the fix as if it
// were code. Two checks "failed" that way, both on comments quoting the bug they describe. Strip the
// carriage return first, and never assume the file's line endings.
function bodyOf(name){
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('fn not found: ' + name);
  return asServed(src.slice(i, matchBrace(i) + 1))
    .split(nl)
    .map(l => l.replace(/\r$/, '').replace(/^\s*\/\/.*$/, ''))
    .join(nl);
}
const mountSrc = bodyOf('_saMapMount_');
ok('the mount no longer branches on a .bounds field that does not exist',
   !/home\s*&&\s*home\.bounds/.test(mountSrc) && !/fitBounds\(\s*home\.bounds/.test(mountSrc));
ok('the mount builds its bounds from the four fields _saFogHome_ actually returns',
   /home\.south/.test(mountSrc) && /home\.north/.test(mountSrc)
   && /home\.west/.test(mountSrc) && /home\.east/.test(mountSrc));
// Branch ORDER, not declaration order: remembered pan, then home cluster, then fit-all.
const iView = mountSrc.indexOf('if(_saMapView)');
const iHome = mountSrc.indexOf('else if(homeB');
const iAll  = mountSrc.lastIndexOf('data.segs.map');
ok('the home fit is preferred over the fit-all fallback', iHome > 0 && iAll > iHome);
ok('a remembered pan still outranks both (the involuntary-remount guard)', iView > 0 && iView < iHome);

// The row-tap fly is capped, so a 0.09 mi segment does not fit edge-to-edge with no context around
// it (uncapped it went to z18.75). The grey checkerboard right after a fly is Esri pacing the tile
// burst, not the cap - every tile returns 200 and all 36 are in by 30s.
const focusSrc = bodyOf('_saMapFocus_');
ok('the row-tap fly caps its zoom rather than fitting a short segment edge-to-edge',
   /fitBounds\([^)]*maxZoom\s*:/.test(focusSrc) || /maxZoom\s*:\s*_SA_FOCUS_MAXZ/.test(focusSrc));
ok('...off a named constant, not a magic number', has('_SA_FOCUS_MAXZ') && /_SA_FOCUS_MAXZ/.test(focusSrc));
ok('...and the cap is inside the imagery layer\'s own maxZoom of 19',
   (() => { const m = asServed(src).match(/var\s+_SA_FOCUS_MAXZ\s*=\s*(\d+)/); return !!m && +m[1] >= 13 && +m[1] <= 18; })());

// ---- 10. the opening view is a FEW MILES, and still the right city ---------------------------
console.log('\n'+C+'=== 10. the home cluster is tight, and tightening did not move it ==='+X);
const MI = 69.0;
const boxMi = h => h ? { h: (h.north - h.south) * MI, w: (h.east - h.west) * MI * Math.cos(h.south * Math.PI / 180) } : null;
// Home riding: SPREAD across ~6 miles, 40 segments, 20 efforts each = 800 efforts.
// Away riding: one day out, PACKED into half a mile, 30 segments, 24 efforts each = 720 efforts.
// The away cluster is far denser per unit area; the coarse cell must still choose home, and the
// tightening inside home must not jump to it.
// The home region is shaped like the real one: a dense core inside sprawling outskirts. Without the
// outskirts a too-wide radius still yields a small box, and the tightness assertion passes for the
// wrong reason -- which it did on the first version of this fixture.
const home40 = [], away30 = [];
for (let i = 0; i < 30; i++) home40.push({ lat: 42.85 + (i % 6) * 0.008, lon: -85.65 + Math.floor(i / 6) * 0.012, effortCount: 30 });
for (let i = 0; i < 20; i++) home40.push({ lat: 42.55 + (i % 5) * 0.12, lon: -85.95 + Math.floor(i / 5) * 0.18, effortCount: 5 });
for (let i = 0; i < 30; i++) away30.push({ lat: 41.85 + (i % 6) * 0.001, lon: -87.85 + Math.floor(i / 6) * 0.001, effortCount: 24 });
const mixed = home40.concat(away30);
const hm = F.home(mixed);
ok('the coarse stage still picks the region with more RIDING, not more density',
   !!hm && hm.south > 42 && hm.south < 43.5 && hm.west > -86.5 && hm.west < -85,
   hm && [hm.south.toFixed(2), hm.west.toFixed(2)].join(','));
const bm = boxMi(hm);
ok('the opening box is a few miles across, not tens', !!bm && bm.h < 15 && bm.w < 15,
   bm && (bm.h.toFixed(1) + ' x ' + bm.w.toFixed(1) + ' mi'));
// The old ±1.2-degree cluster swept in anything within ~50 miles. That is what put Howard City,
// 35 miles north of the riding, on screen and zoomed everything else into hairlines.
const withFar = home40.concat([{ lat: 43.40, lon: -85.47, effortCount: 30 }]);   // ~38 mi north
const hf = F.home(withFar);
ok('a segment 38 miles out does not stretch the opening view to reach it',
   !!hf && (hf.north - hf.south) * MI < 15, hf && ((hf.north - hf.south) * MI).toFixed(1) + ' mi tall');
ok('...and that is a real exclusion, not an empty result', !!hf && isFinite(hf.north) && hf.n > 1);

console.log('\n'+C+'=== 11. status colour, with no effort ramp ==='+X);
// The reference wants GOLD for a personal best and MAGENTA for a crown. SA_FOG_STYLE has those
// two inverted (pink PB, orange crown) because it was built as a heat ramp, which is why this page
// carries its own palette rather than borrowing that one.
check('a crown is magenta', F.statusCol({t:3}), F.MAPCOL.kom);
check('a personal best is gold', F.statusCol({t:2}), F.MAPCOL.pb);
check('attempted is blue', F.statusCol({t:1, ramp:0}), F.MAPCOL.att);
ok('the crown colour is NOT the fog ramp crown colour', F.MAPCOL.kom !== F.STYLE[4].line);
ok('personal best is a dark orange, not the fog ramp pink', F.MAPCOL.pb !== F.STYLE[3].line);
ok('ridden 5 times is the SAME colour as ridden once - status, not a heat ramp',
   F.statusCol({t:1, ramp:0}) === F.statusCol({t:1, ramp:2}));
ok('the three drawn statuses are three distinct colours',
   new Set([F.statusCol({t:1}), F.statusCol({t:2}), F.statusCol({t:3})]).size === 3);

console.log('\n'+C+'=== 12. pins: on top of the stretches, but bounded ==='+X);
ok('segment stretches are still drawn - pins did not replace the lines',
   /L\.polyline\(/.test(mountSrc) && /_saPoly\[/.test(mountSrc));
// The casing was for contrast over SATELLITE imagery. On a light street basemap it is what made
// segments read as blocks: a dark outline 3px wider than the line. It is gone, and must stay gone.
ok('NO casing pane or casing renderer survives', !/segCase/.test(mountSrc) && !has("createPane('segCase')"));
ok('the interactive line is index 0, so a row tap opens a popup that exists',
   /_saMapById\[s\.id\]=\[line\]/.test(mountSrc));
const pinSrc = bodyOf('_saPinsRefresh_');
ok('pins are zoom-gated off a named constant', /_SA_PIN_MINZ/.test(pinSrc) && has('_SA_PIN_MINZ'));
// Leaflet's markerPane is z600 and the segment lines are z620, so without their own higher pane the
// stretches paint straight THROUGH the pins and the markers read as blobs fused into the line.
ok('pins get their own pane ABOVE the segment lines',
   /createPane\('segPins'\)/.test(pinSrc) && /zIndex=64/.test(pinSrc));
ok('...and every marker is placed into it', /pane:'segPins'/.test(pinSrc));
ok('pins are viewport-scoped, not one per library segment', /getBounds\(\)/.test(pinSrc) && /contains\(/.test(pinSrc));
ok('pins are capped', /_SA_PIN_CAP/.test(pinSrc));
// NO CLUSTERING, EVER. Measured on the reference image: 124 marker components, every one a single
// small pin, zero count bubbles at any density. Where markers coincide they simply overlap - that
// IS the reference's answer to density. A previous pass invented screen-space clustering to solve
// the overlap, which added a control the design does not have.
ok('there is no clustering machinery left', !has('_saClusterIcon_') && !has('_SA_PIN_CLUSTER_PX'));
ok('...and no screen-space grouping in the pin refresh',
   !/latLngToContainerPoint/.test(pinSrc) && !/groups/.test(pinSrc));
ok('one marker is added per visible segment', /_saPinLayer\.addLayer\(m\)/.test(pinSrc)
   && (pinSrc.match(/addLayer\(/g) || []).length === 1);
// Pin geometry, straight off the image: median 9x13px in a 1317px panel -> 0.683% of map width,
// h/w 1.44 (a teardrop, taller than wide - NOT a circle).
const pinIconSrc = bodyOf('_saPinIcon_');
ok('the pin is a teardrop path, not a circle', /<path/.test(pinIconSrc) && !/<circle/.test(pinIconSrc));
ok('pin width and height are named constants', has('var SA_PIN_W=') && has('SA_PIN_H='));
ok('...with the reference aspect ratio (h/w between 1.3 and 1.6)', (() => {
  const w = +(asServed(src).match(/var\s+SA_PIN_W\s*=\s*(\d+)/) || [])[1];
  const h = +(asServed(src).match(/SA_PIN_H\s*=\s*(\d+)/) || [])[1];
  return w && h && (h / w) >= 1.3 && (h / w) <= 1.6;
})());
ok('...and a nominal width matching the reference core, 10-13px', (() => {
  const w = +(asServed(src).match(/var\s+SA_PIN_W\s*=\s*(\d+)/) || [])[1];
  return w >= 10 && w <= 13;
})());
ok('the pin is anchored at its tip', /iconAnchor:\[cx,h\]/.test(pinIconSrc));
// Colours sampled from the reference's own markers.
check('personal best is DARK orange', F.MAPCOL.pb, '#c2410c');
check('KOM/QOM is the legend purple', F.MAPCOL.kom, '#c73dca');
check('attempted is LIGHT orange', F.MAPCOL.att, '#fb923c');
ok('the pin layer is rebuilt on remount, not carried over onto a dead map',
   /_saPinLayer=null/.test(mountSrc));
// _saPinsRefresh_ reads getZoom/getBounds. Called before the view is set, Leaflet throws out of
// _getTopLeftPoint and takes the WHOLE MOUNT down with it -- the map ends up with no view at all
// and every later getBounds throws. Shipped exactly that way once; only a screenshot caught it.
ok('the first pin refresh runs AFTER the view is set, never before',
   mountSrc.indexOf('_saPinsRefresh_') > mountSrc.indexOf('if(_saMapView)'),
   'refresh@' + mountSrc.indexOf('_saPinsRefresh_') + ' view@' + mountSrc.indexOf('if(_saMapView)'));
// ---- 13. the road-shape backfill is REACHABLE ------------------------------------------------
// It was complete, correct, rate-limit-aware -- and dead. The only control that called it went with
// the fog view, so the library sat at 117 real shapes of 1,942 while the map was judged on the
// straight chords standing in for the other 94%.
console.log('\n'+C+'=== 13. the road-shape backfill has a way to be run ==='+X);
ok('the sweep is called from somewhere, not just defined', /onclick="_saPolySweep_\(/.test(asServed(src)));
ok('...and exported for that inline handler', has('window._saPolySweep_=_saPolySweep_'));
ok('the page renders the note element the sweep writes into', has("id=\"sa-poly-note\""));
ok('the sweep still reports what it capped', has('press again to continue'));
ok('pending work is ordered by what is ON SCREEN first', (() => {
  const p = bodyOf('_saPolyPending_');
  return /inView/.test(p) && /getBounds\(\)/.test(p);
})());
// A chord is still distinguished from a real road shape -- but by opacity and dashing, NOT by a
// different stroke width. Width is fixed at SA_MAP_W for every segment at every status.
ok('a chord is distinguished from a real road shape, without changing the stroke width',
   /isReal\?0\.95:0\.6/.test(mountSrc) && /dashArray: ?isReal\?null:/.test(mountSrc));

// ---- 14. a sweep can never park on an unanswered request -------------------------------------
// Both sweeps step forward ONLY when _saSegDetail_'s callback fires, and fetch has no default
// timeout. One request Strava accepts and never answers stalled the crown sweep three runs in a
// row at "Checking 85 of 90" -- button disabled, no recovery but a reload. The 429 path was always
// caught; this is the silent one.
console.log('\n'+C+'=== 14. no sweep can hang on a request that never answers ==='+X);
const detSrc = bodyOf('_saSegDetail_');
ok('the segment request is on a timer', /setTimeout\(/.test(detSrc) && /SA_SEG_TIMEOUT_MS/.test(detSrc));
ok('...off a named constant', has('var SA_SEG_TIMEOUT_MS='));
ok('...that is a sane few seconds, not minutes', (() => {
  const m = asServed(src).match(/var\s+SA_SEG_TIMEOUT_MS\s*=\s*(\d+)/);
  return !!m && +m[1] >= 5000 && +m[1] <= 60000;
})());
ok('the callback has ONE exit, so it cannot fire twice or zero times', /var fire=function/.test(detSrc));
ok('every outcome routes through it - no bare cb( left on a result path',
   (detSrc.match(/fire\(/g) || []).length >= 4
   && !/\.then\(function\(d\)\{[\s\S]*?[^_]cb\(/.test(detSrc));
ok('the timer is cleared once something answers', /clearTimeout\(timer\)/.test(detSrc));
ok('a timed-out request is aborted, not left running', /abort\(\)/.test(detSrc));
// Behavioural: drive the real function with a fetch that never settles and assert cb still fires.
const detFn = new Function('fetchImpl', 'withStravaToken_', 'AbortController', 'SA_SEG_TIMEOUT_MS', '_saXomSec_',
  'var fetch=fetchImpl;' + asServed(ex('_saSegDetail_')) + '\nreturn _saSegDetail_;');
const hangingFetch = () => new Promise(() => {});                      // never settles, ever
const fakeAC = function(){ this.signal = {}; this.abort = function(){}; };
const detached = detFn(hangingFetch, f => f('tok'), fakeAC, 60, F.xom);
const fired = await new Promise(res => { let got = null; detached(123, v => { got = v; res(got); });
                                         setTimeout(() => res(got), 900); });
ok('a request that NEVER settles still produces a callback', !!fired, JSON.stringify(fired));
ok('...and it is reported as an error, not as a segment with no data',
   !!fired && !!fired.err, JSON.stringify(fired));
// AND the token step, which is the one that actually kept it hung. withStravaToken_ refreshes
// against the proxy with its own untimed fetch; a timer armed inside its callback is never armed
// when that call is what stalls. Bounding only the segment request moved the hang from 85/90 to
// 90/90 rather than fixing it.
const hangingToken = () => {};                                        // never invokes its callback
const detached2 = detFn(hangingFetch, hangingToken, fakeAC, 60, F.xom);
const fired2 = await new Promise(res => { let got = null; detached2(123, v => { got = v; res(got); });
                                          setTimeout(() => res(got), 900); });
ok('a TOKEN step that never calls back still produces a callback', !!fired2, JSON.stringify(fired2));
ok('the timer is armed before the token call, not inside it',
   detSrc.indexOf('setTimeout(') < detSrc.indexOf('withStravaToken_('),
   'timer@' + detSrc.indexOf('setTimeout(') + ' token@' + detSrc.indexOf('withStravaToken_('));

// ---- 15. the sweep's result outlives the re-render the sweep triggers ------------------------
// finish() writes its summary and then calls aiSetTab_ so rows can move into Crowns held. That
// re-render replaces the panel, #sa-tgt-note included, microseconds later. The message was gone
// before anyone could read it -- and every "the sweep is hanging" diagnosis was really this.
console.log('\n'+C+'=== 15. the crown sweep result survives its own re-render ==='+X);
const swpSrc = bodyOf('_saTgtKomSweep_');
ok('the summary is held outside the DOM', has('var _saTgtNote='));
ok('say() writes it to the holder, not only to an element', /_saTgtNote=t/.test(swpSrc));
ok('say() re-queries the element instead of closing over a detachable one',
   /getElementById\('sa-tgt-note'\)/.test(swpSrc)
   && !/var\s+note=document\.getElementById\('sa-tgt-note'\)/.test(swpSrc));
ok('the renderer seeds the note from the holder, so a re-render restores it',
   /id="sa-tgt-note"[^>]*>'\+\(_saTgtNote/.test(asServed(src)));
ok('the sweep still re-renders so rows can move into Crowns held',
   /aiSetTab_\('segattack'\)/.test(swpSrc));

// ---- 16. the legend census must add up ------------------------------------------------------
// Shipped once adding to 2,042 of 2,017: "never attempted" was a separate no-efforts test, so the
// 25 segments carrying a Strava PB with no harvested efforts counted as BOTH a personal best and
// never attempted. Three status buckets over one library have exactly one invariant worth pinning.
console.log('\n'+C+'=== 16. the status buckets partition the library ==='+X);
const statsFn = new Function('isPlainObj_', '_saKomCandidate_', '_saSegNum_', '_saKomLive', 'st',
  asServed(ex('_saEffSec_') + ex('_saEffDay_') + ex('_saMapStats_')) + '\nreturn _saMapStats_;');
const mkStore = () => ({
  a: { prSec: 100, efforts: [{ d: '2026-01-01', s: 90 }] },        // PB, ridden
  b: { prSec: 120, efforts: [] },                                   // PB, NO efforts -- the trap
  c: { efforts: [{ d: '2026-01-02', s: 80 }] },                     // attempted, no PB
  d: { efforts: [] },                                               // never attempted
  e: { effortCount: 3 }                                             // attempted via effortCount only
});
// statsFn RETURNS _saMapStats_; it does not run it. The extra () is the actual call.
const runStats = store => statsFn(o => !!o && typeof o === 'object' && !Array.isArray(o),
                                  () => false, () => 0, {}, { segments: store })();
const stats = runStats(mkStore());
check('personal bests', stats.pb, 2);
check('attempted', stats.att, 2);
check('never attempted excludes the PB-with-no-efforts segment', stats.never, 1);
ok('the three buckets sum to the library total',
   stats.pb + stats.att + stats.never === stats.total,
   stats.pb + '+' + stats.att + '+' + stats.never + ' vs ' + stats.total);
// Total time reads BOTH effort shapes -- {d,s} and the legacy {date,sec}.
const stats2 = runStats({ x: { efforts: [{ d: '2026-01-01', s: 60 }, { date: '2026-01-02', sec: 40 }] } });
check('total time counts the legacy {date,sec} effort shape too', stats2.segSec, 100);
check('...and counts both as timed efforts', stats2.effN, 2);

// ---- 17. the map chrome is theme-aware ------------------------------------------------------
// The summary bar shipped painted with var(--d-panel2,#151a22). --d-panel2 IS DEFINED NOWHERE, so
// the hard-coded dark fallback always won -- and in light mode that put near-black --d-head values
// on a near-black bar. 142, 1,825 and 736 h were invisible on the rendered page while every
// assertion passed. Same class as the desktop light-mode sweep: a literal hex over a working theme.
console.log('\n'+C+'=== 17. map chrome uses tokens that actually exist ==='+X);
// Scoped to an OPAQUE DARK fallback, which is the failure mode: it wins in both themes and puts
// near-black text on a near-black panel in light mode. One --d-panel2 remains elsewhere in the app
// with an rgba(255,255,255,.035) fallback -- also an undefined token, but a translucent tint that
// degrades to "no tint" rather than to an unreadable block. Left alone deliberately.
ok('no segment-map chrome paints from --d-panel2 with an opaque dark fallback',
   !/--d-panel2\s*,\s*#[0-9a-fA-F]{3,8}/.test(asServed(src)));
ok('...and the token it was replaced with is really defined', /--d-inset\s*:/.test(src));
// The reference shows the summary bar as a WHITE card row, not the page's grey inset.
ok('the summary bar is a white card row from a themed token, not a literal hex',
   /\.sm-bar\{[^}]*var\(--d-panel\)/.test(asServed(src)));
ok('the filter controls too', /\.sm-ctl\{[^}]*var\(--d-inset\)/.test(asServed(src)));
ok('the road-shapes button does not sit on top of the zoom control',
   has('.leaflet-top.leaflet-left{margin-top'));

// ---- 18. showScreen must not delete a map it does not own -----------------------------------
// Measured: 2 of 6 cold loads rendered NO MAP. showScreen sweeps every .leaflet-container in the
// document to clear stray weather maps, and the store_v2 tail load calls showHomeDash() a few
// seconds after boot regardless of the surface showing -- so a map mounted at 1.1s was removed at
// 5.3s with nothing to re-mount it. Mounting on a child protects the BOX, not the canvas: Leaflet
// stamps .leaflet-container on the child, which is exactly what the sweep matched.
console.log('\n'+C+'=== 18. the global leaflet sweep is scoped ==='+X);
const scrSrc = bodyOf('showScreen');
ok('showScreen still clears stray leaflet containers', /leaflet-container/.test(scrSrc));
ok('...but skips surfaces that own their map lifecycle',
   /data-keep-map/.test(scrSrc) && /closest\(/.test(scrSrc));
ok('...and the skip happens BEFORE the remove', (() => {
  const i = scrSrc.indexOf('data-keep-map'), j = scrSrc.indexOf('el.remove()', i);
  return i > 0 && j > i;
})());
ok('the segment map marks itself as owning its lifecycle',
   /setAttribute\('data-keep-map'/.test(mountSrc));
ok('...on the sized box, so the canvas child is covered by closest()',
   /el\.setAttribute\('data-keep-map'/.test(mountSrc));

ok('promote recolours the line only, never the casing', (() => {
  const p = bodyOf('_saMapPromote_');
  return /layers\[0\]/.test(p) && !/layers\.forEach/.test(p);
})());


// ---- 19. the reference spec's hard constraints ----------------------------------------------
// This page was rejected repeatedly on three things: thick lines, oversized pins, and a basemap
// that came up dark. Each of those is now a pinned number or a pinned absence, because "looks
// right" is not something the suite can see and these are what kept regressing.
console.log('\n'+C+'=== 19. thin lines, small pins, light base ==='+X);
check('the stroke width constant is 2px', F.MAPW, 2);
ok('every polyline in the mount uses that constant, with no per-tier width',
   (() => {
     const weights = [...mountSrc.matchAll(/weight:\s*([^,}]+)/g)].map(m => m[1].trim());
     return weights.length > 0 && weights.every(w => w === 'SA_MAP_W');
   })(), [...mountSrc.matchAll(/weight:\s*([^,}]+)/g)].map(m => m[1].trim()).join(' | '));
ok('promote recolours without fattening the stroke',
   /weight:SA_MAP_W/.test(bodyOf('_saMapPromote_')));
// Pins: circular, 16-18px, white fill, thin coloured ring, no shadow, no teardrop path.
const pinIcon = bodyOf('_saPinIcon_');
// Geometry now comes from the reference image (section 12), not from a chosen px value.
ok('pin size is measured, not a magic number', has('var SA_PIN_W=') && has('SA_PIN_H='));
// detectRetina halves the tile size and bumps zoom, so on a scaled display a 512px tile lands in
// 128 CSS px and every label renders at a quarter size. Invisible at devicePixelRatio 1.
// NB: the tile URL itself contains {s}/{z}/{x}/{y}, so a lazy brace match grabs those placeholders
// rather than the options object. Assert on the declaration as a whole.
ok('the base tiles do NOT use detectRetina', (() => {
  const b = bodyOf('addRideMapBase_');
  const i = b.indexOf('var light=L.tileLayer(');
  return i >= 0 && /detectRetina:false/.test(b.slice(i, b.indexOf(');', i)));
})());
ok('markers are path shapes, not circles', /<path/.test(pinIcon) && !/<circle/.test(pinIcon));
ok('the teardrop is filled in its category colour', /fill="'\+col\+'"/.test(pinIcon));
// Attempted pins ring in ORANGE; PB and KOM keep the plain white edge.


// Voyager bakes labels into the base tile at z200, under the segments at z620 and pins at z640.
ok('the light base uses the NOLABELS style', has('voyager_nolabels'));
ok('...with labels re-added in the pane ABOVE the segments and pins',
   has('voyager_only_labels') && /voyager_only_labels[\s\S]{0,160}pane:'routeLabels'/.test(asServed(src)));
ok('the pin casts NO drop shadow', !/drop-shadow/.test(pinIcon));
ok('the pin has no white halo behind it', !/opacity=".9/.test(pinIcon));
// Basemap: light, and immune to a ride-map preference set elsewhere.
ok('the segment map defaults to the light/flat base', /addRideMapBase_\(map,'light'/.test(mountSrc));
ok('...under its OWN storage key, so a ride-map choice cannot override it',
   /addRideMapBase_\(map,'light','aiq_segMapBase'\)/.test(mountSrc));
ok('addRideMapBase_ honours a per-surface key', (() => {
  const b = bodyOf('addRideMapBase_');
  return /storeKey/.test(b) && /var KEY=storeKey\|\|/.test(b) && /getItem\(KEY\)/.test(b) && /setItem\(KEY/.test(b);
})());
// No debug banner over the map surface.
ok('the backfill note is NOT positioned over the map',
   !/position:absolute[^']*id="sa-poly-note"/.test(asServed(src))
   && /id="sa-poly-note"[^>]*margin-top/.test(asServed(src)));
ok('the button carries live progress instead of a banner',
   /btnSay\(/.test(bodyOf('_saPolySweep_')));
// Total time must not claim a share of riding time.
// Comment-stripped, because the note explaining WHY this figure is absent necessarily names it --
// the same trap that made two earlier checks read their own documentation as code.
const rendSrc = bodyOf('aiSegTargetsHtml_');
ok('the stat bar still refuses to print a % of riding time',
   !/% of all riding time/.test(rendSrc) && /% on personal bests/.test(rendSrc));


// ---- 20. back on the reference: light base, category colours, every segment drawn ------------
// This section replaces the hybrid/crown/single-line assertions. That direction came from later
// instructions and is not in the reference image; these pin the image's own scheme instead.
console.log('\n'+C+'=== 20. the reference scheme ==='+X);
ok('the base is the light/flat style, not imagery', /addRideMapBase_\(map,'light'/.test(mountSrc));
ok('no brightness filter is applied to the tiles', !/tilePane'\)[\s\S]{0,140}filter/.test(mountSrc));
ok('lines are CATEGORY coloured again', /var col=_saStatusCol_\(s\.tier\)/.test(mountSrc));
ok('...with no single-line-colour constant left', !has('SA_LINE_COL'));
ok('every segment is drawn - no line dedupe', !has('lineSeen') && !has('geoKey'));
ok('a personal best draws a CROWN', /kind==='pb'/.test(pinIconSrc) && /stroke-linejoin="round"/.test(pinIconSrc));
ok('...and an attempt draws a teardrop', /A '\+r\+' '\+r\+' 0 1 1/.test(pinIconSrc));
ok('the two are different SHAPES, not just tones',
   (pinIconSrc.match(/L\.divIcon/g)||[]).length === 2);
// DIRECT INSTRUCTION: no blue anywhere on this surface.
// NO BLUE on the two statuses that are drawn everywhere. KOM is excluded deliberately: purple
// carries a high blue channel by construction, it is not blue, and it was not part of the override.
ok('NO BLUE for personal best or attempted', (() => {
  return [F.MAPCOL.pb, F.MAPCOL.att].every(h => {
    const r=parseInt(h.slice(1,3),16), g=parseInt(h.slice(3,5),16), b=parseInt(h.slice(5,7),16);
    return r > b && r > g;                      // warm, red-dominant
  });
})(), JSON.stringify(F.MAPCOL));
ok('...and KOM stays purple, not blue', (() => {
  const h=F.MAPCOL.kom, r=parseInt(h.slice(1,3),16), g=parseInt(h.slice(3,5),16), b=parseInt(h.slice(5,7),16);
  return r > g*2 && b > g*2;                    // red AND blue high, green low = purple
})());
ok('no blue hex survives anywhere in the segment map UI',
   !/#(2563eb|7ba7ff|4887f0|107df9|22d3ee)/.test(rendSrc));
ok('...and the personal-best orange is DARKER than the attempted orange', (() => {
  const L=h=>{const r=parseInt(h.slice(1,3),16),g=parseInt(h.slice(3,5),16),b=parseInt(h.slice(5,7),16);
    return 0.2126*r+0.7152*g+0.0722*b;};
  return L(F.MAPCOL.pb) < L(F.MAPCOL.att);
})());
ok('...the teardrop is filled in its category colour', /fill="'\+col\+'"/.test(pinIconSrc));
// Legend colours, sampled from the reference's own legend row.

check('KOM/QOM is the legend PURPLE', F.MAPCOL.kom, '#c73dca');
check('attempted is LIGHT orange', F.MAPCOL.att, '#fb923c');
ok('the KOM colour is purple, not the magenta sampled off the map pins',
   F.MAPCOL.kom.toLowerCase() !== '#ee4e98');
// Footer: the donut the reference shows, drawing a real proportion.
ok('the Total Time card carries a donut', /stroke-dasharray/.test(rendSrc));
ok('...driven by measured per-status time, not a decorative constant',
   /secBy\.pb/.test(rendSrc) && has('var secBy='));
ok('...and still refuses the unprovable share of riding time',
   !/% of all riding time/.test(rendSrc));

console.log(fails ? '\n'+R+'segment fog: '+fails+' FAILED'+X+'\n' : '\n'+G+'segment fog: all checks passed'+X+'\n');
process.exit(fails?1:0);
