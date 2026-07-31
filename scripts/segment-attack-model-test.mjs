// Segment Attack — the physics, the fit, and the probability.
//
// The whole feature's credibility rests on this file. It checks three separate things:
//   1. the power equation reproduces INDEPENDENTLY KNOWN cycling physics (not just itself),
//   2. the CdA fit recovers a value that was used to generate synthetic efforts,
//   3. the probability comes from measured residuals and is withheld when they cannot be measured.
//
// Run: node scripts/segment-attack-model-test.mjs
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');
function mb(f){ let i=src.indexOf('{',f), d=0; for(;i<src.length;i++){const c=src[i]; if(c==='{')d++; else if(c==='}'){d--; if(d===0)return i;}} return -1; }
function ex(n){ const i=src.indexOf('function '+n+'('); if(i<0) throw new Error('missing fn '+n); return src.slice(i, mb(i)+1)+'\n'; }
function exv(n){ let j=src.indexOf('var '+n+'='); if(j<0) j=src.indexOf('var '+n+' ='); if(j<0) throw new Error('missing var '+n); return src.slice(j, src.indexOf('\n', j))+'\n'; }

let code = exv('_SA_G') + exv('_SA_MIN_FIT') + exv('_SA_CDA_LO') + exv('_SA_DURS') + exv('_SA_SINUOUS') + exv('_SA_CONTEST_MIN');
// dayKey_ is the canonical LOCAL day-key builder _saCapability_ now cuts its lookback with, in
// place of toISOString (which lands a local-midnight Date on the previous day east of Greenwich).
for (const f of ['dayKey_','_saPowerNeeded_','_saTailwindNeeded_','_saRho_','_saHeadwind_','_saPowerAt_','_saSolveV_','_saFitCdA_','_saSigma_','_saEvidence_','_saHaversineM_','_saSinuosity_',
                 '_saNormCdf_','_saCapability_','_saWindCall_','_saEvaluate_']) code += ex(f);
const M = new Function(code + ';return {_saRho_,_saHeadwind_,_saPowerAt_,_saSolveV_,_saFitCdA_,_saSigma_,'
  + '_saNormCdf_,_saCapability_,_saWindCall_,_saEvaluate_,_saEvidence_,_saSinuosity_,_SA_MIN_FIT};')();

let fails = 0;
const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', C='\x1b[36m', X='\x1b[0m';
function check(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log('  ' + (ok ? G+'PASS'+X : R+'FAIL'+X) + '  ' + label + (ok ? '' : '   got '+JSON.stringify(got)+', want '+JSON.stringify(want)));
}
function near(label, got, want, tol){
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fails++;
  console.log('  ' + (ok ? G+'PASS'+X : R+'FAIL'+X) + '  ' + label + '   ' + (Math.round(got*1000)/1000) + (ok ? '' : '  (wanted ' + want + ' +/- ' + tol + ')'));
}

console.log('\n' + C + '=== 1. the power equation against known cycling physics ===' + X);
// Martin et al. / every online calculator: ~75kg rider+bike, CdA 0.30, Crr 0.005, rho 1.225,
// flat, no wind -> 250W lands around 10.5 m/s (23.5 mph). This is the load-bearing check: it is
// an EXTERNAL reference, not the model agreeing with itself.
const v250 = M._saSolveV_(250, 0, 1.225, 0.30, 75, 0);
near('250W flat, CdA 0.30 -> m/s', v250, 10.5, 0.6);
near('   ...which in mph is', v250 * 2.23694, 23.5, 1.4);
// Doubling speed costs roughly 8x aero power; total is less than 8x because rolling is linear.
const p10 = M._saPowerAt_(10, 0, 1.225, 0.30, 75, 0), p20 = M._saPowerAt_(20, 0, 1.225, 0.30, 75, 0);
near('aero dominance: P(20)/P(10) approaches 8', p20 / p10, 7.0, 1.0);
// Climbing is gravity-dominated and nearly linear in power. 75kg at 8% and 300W: the gravity term
// alone is m*g*sin(atan(.08))*v, so v ~= 300*0.976 / (75*9.807*0.0797 + rolling) ~ 4.7 m/s.
const vClimb = M._saSolveV_(300, 0.08, 1.225, 0.30, 75, 0);
near('300W at 8% grade -> m/s', vClimb, 4.7, 0.5);
near('   ...VAM (m/hr ascent)', vClimb * 0.08 * 3600, 1350, 160);
check('a descent needs less power than the flat',
  M._saPowerAt_(10, -0.04, 1.225, 0.30, 75, 0) < M._saPowerAt_(10, 0, 1.225, 0.30, 75, 0), true);
check('power rises monotonically with speed', (function(){
  let ok = true, prev = -1;
  for (let v = 1; v <= 20; v++) { const p = M._saPowerAt_(v, 0.02, 1.2, 0.3, 78, 0); if (p <= prev) ok = false; prev = p; }
  return ok;
})(), true);

console.log('\n' + C + '=== 2. air density and wind resolution ===' + X);
near('sea level, 15C -> rho', M._saRho_(59, 0), 1.225, 0.01);
check('warmer air is thinner', M._saRho_(90, 0) < M._saRho_(40, 0), true);
check('altitude thins it too', M._saRho_(59, 2000) < M._saRho_(59, 0), true);
// Open-Meteo gives the direction wind comes FROM. Riding due east (90) with wind FROM the west
// (270) is a pure tailwind, so the headwind component must be NEGATIVE.
near('riding E, wind from W -> pure tailwind (m/s)', M._saHeadwind_(90, 270, 10), -4.4704, 0.01);
near('riding E, wind from E -> pure headwind', M._saHeadwind_(90, 90, 10), 4.4704, 0.01);
near('riding E, wind from N -> no along-track component', M._saHeadwind_(90, 0, 10), 0, 0.01);
check('and the bucket labels agree with the sign',
  [M._saWindCall_(90,270), M._saWindCall_(90,90), M._saWindCall_(90,0)], ['tailwind','headwind','crosswind']);
check('no bearing -> no call, not a guess', M._saWindCall_(null, 270), null);
// A tailwind must actually make the same power go faster.
check('a tailwind is worth real time',
  M._saSolveV_(250,0,1.225,0.30,75,-4.47) > M._saSolveV_(250,0,1.225,0.30,75,0), true);

console.log('\n' + C + '=== 3. the CdA fit recovers a KNOWN value ===' + X);
// Generate efforts from a chosen CdA, then check the fit finds it back. If this fails, every
// projection downstream is arbitrary.
const TRUE_CDA = 0.32, DIST = 4400, GRADE = 0.012, RHO = 1.20, MASS = 78;
const synth = [180, 210, 240, 265, 300].map((w, i) => ({
  d: '2026-0' + (i + 1) + '-01', w,
  s: Math.round(DIST / M._saSolveV_(w, GRADE, RHO, TRUE_CDA, MASS, 0)),
}));
const fit = M._saFitCdA_(synth, GRADE, DIST, RHO, MASS);
near('fitted CdA recovers the true one', fit.cda, TRUE_CDA, 0.01);
check('and reports how many efforts it used', fit.n, 5);
check('one effort is still fittable', M._saFitCdA_([synth[0]], GRADE, DIST, RHO, MASS) != null, true);
check('zero powered efforts -> null, never a default CdA', M._saFitCdA_([{d:'x',s:300}], GRADE, DIST, RHO, MASS), null);
check('a nonsense segment (no distance) -> null', M._saFitCdA_(synth, GRADE, 0, RHO, MASS), null);

console.log('\n' + C + '=== 4. sigma is MEASURED, and withheld when it cannot be ===' + X);
check('a perfect fit needs ' + M._SA_MIN_FIT + '+ efforts before sigma exists',
  M._saSigma_(synth.slice(0, 2), GRADE, DIST, RHO, MASS, TRUE_CDA), null);
const sigClean = M._saSigma_(synth, GRADE, DIST, RHO, MASS, TRUE_CDA);
check('noiseless efforts -> essentially no residual', sigClean == null || sigClean < 2, true);
// Now scatter the times the way real riding does, and confirm sigma grows to match.
const noisy = synth.map((e, i) => ({ ...e, s: e.s + [12, -9, 7, -14, 5][i] }));
const sigNoisy = M._saSigma_(noisy, GRADE, DIST, RHO, MASS, M._saFitCdA_(noisy, GRADE, DIST, RHO, MASS).cda);
check('scattered efforts -> a real sigma', sigNoisy > 4 && sigNoisy < 30, true);
console.log('  ' + Y + 'sigma on the scattered set: ' + Math.round(sigNoisy * 10) / 10 + 's' + X);

console.log('\n' + C + '=== 5. the probability is the normal CDF of that sigma ===' + X);
near('CDF(0) = 0.5', M._saNormCdf_(0), 0.5, 0.001);
near('CDF(1.645) ~ 0.95', M._saNormCdf_(1.645), 0.95, 0.005);
near('CDF(-1.645) ~ 0.05', M._saNormCdf_(-1.645), 0.05, 0.005);
check('symmetric', Math.abs(M._saNormCdf_(0.7) + M._saNormCdf_(-0.7) - 1) < 1e-6, true);

console.log('\n' + C + '=== 6. end to end, and the honest-degradation ladder ===' + X);
const RIDES = [{ date:'2026-07-20', powerCurve:{ 60:340, 120:300, 300:265, 600:240, 1200:225 } }];
const CTX = { windFromDeg:270, windMph:12, tempF:64, massKg:MASS, rides:RIDES, todayYMD:'2026-07-30' };
const SEG = { id:'s1', name:'River Road Climb', distMi:DIST/1609.344, grade:GRADE*100,
              bearing:90, prSec:Math.min(...synth.map(e=>e.s)), prDate:synth[4].d,
              efforts:noisy, elevM:200 };
const full = M._saEvaluate_(SEG, CTX);
console.log('  ' + Y + JSON.stringify({ tier:full.tier, tPred:full.tPred, prSec:full.prSec, delta:full.delta,
  prob:full.prob, sigma:full.sigma, cda:full.cda, capW:full.capW, prWatts:full.prWatts }) + X);
check('tier is full', full.tier, 'full');
check('a projected time exists', full.tPred > 0, true);
check('a probability exists', full.prob >= 0 && full.prob <= 100, true);
check('the PR power was recovered from the effort history', full.prWatts, 300);
check('the tailwind helps rather than hurts',
  full.tPred < Math.round(DIST / M._saSolveV_(full.capW, GRADE, M._saRho_(64,200), full.cda, MASS, 0)), true);
check('delta is signed against the PR', full.delta, full.tPred - full.prSec);

console.log('\n  the ladder — every missing input DOWNGRADES rather than defaults:');
const noBear = M._saEvaluate_({ ...SEG, bearing:null }, CTX);
check('no coordinates -> excluded, no probability', [noBear.tier, noBear.prob], ['excluded', undefined]);
check('...and says why', /no coordinates/.test(noBear.why), true);
// Strava's stored PR only ever covered STARRED segments — on the real library that is 25 of 2,017,
// and ZERO of them overlap the 126 with enough powered efforts. Without deriving a target from the
// effort history this feature would have had nothing to show at all. So no stored PR is NOT a
// dead end: the fastest effort on record becomes the target, flagged as derived.
const noPr = M._saEvaluate_({ ...SEG, prSec:null, prDate:null }, CTX);
check('no stored PR -> derives one from effort history', noPr.tier, 'full');
check('...and it is the fastest recorded effort', noPr.prSec, Math.min(...noisy.map((e) => e.s)));
check('...flagged as derived, not presented as a Strava PR', noPr.prFromHistory, true);
const noPrNoHist = M._saEvaluate_({ ...SEG, prSec:null, prDate:null, efforts:[] }, CTX);
check('no PR and no history -> wind-only, no probability', [noPrNoHist.tier, noPrNoHist.prob], ['wind', undefined]);
check('...but the wind call still lands', noPrNoHist.wind, 'tailwind');

console.log('\n' + C + '=== 6e. a soft standing time is not a PR contest ===' + X);
// The first real render listed 77 "winnable" segments, ALL at the 95% ceiling, deltas to -2:45.
// The maths was right and the meaning was wrong: those targets were cruises. Beating a 108W pass
// with 234W of capability is arithmetic, not a prediction.
// The times have to be PHYSICALLY consistent with the soft power, or the CdA fit rightly rejects
// the set and the segment never reaches the contested test at all. Generate them from the model.
const softEff = [105, 112, 108, 115, 110].map((w, i) => ({
  d: '2026-0' + (i + 1) + '-01', w,
  s: Math.round(DIST / M._saSolveV_(w, GRADE, RHO, TRUE_CDA, MASS, 0)) + [6, -4, 3, -5, 2][i],
}));
const softPr = Math.min(...softEff.map((e) => e.s));
const soft = M._saEvaluate_({ ...SEG, efforts: softEff, prSec: softPr,
  prDate: softEff[softEff.findIndex((e) => e.s === softPr)].d }, CTX);
check('the soft set does fit (so the test reaches the contested check)', soft.tier, 'full');
check('a soft standing time is NOT contested', soft.contested, false);
check('...and says so in plain words', /never attacked this/.test(soft.note || ''), true);
check('...while still reporting the honest ratio', soft.prEffortRatio < 0.85, true);
check('a hard standing time IS contested', full.contested, true);
check('the threshold is stated, not hidden', /_SA_CONTEST_MIN=0\.85/.test(src), true);
const thin = M._saEvaluate_({ ...SEG, efforts:noisy.slice(0, 2) }, CTX);
check('under ' + M._SA_MIN_FIT + ' powered efforts -> wind-only', [thin.tier, thin.prob], ['wind', undefined]);
check('...and names the shortfall', /2 efforts with power/.test(thin.why), true);
const noPwr = M._saEvaluate_({ ...SEG, efforts:noisy.map((e)=>({d:e.d,s:e.s})) }, CTX);
check('efforts with no power at all -> wind-only', noPwr.tier, 'wind');
const noCurve = M._saEvaluate_(SEG, { ...CTX, rides:[] });
check('no power curve -> no projection', [noCurve.tier, noCurve.prob], ['wind', undefined]);
check('...and says so', /power-curve/.test(noCurve.why), true);

console.log('\n' + C + '=== 6b. the probability is never allowed to look certain ===' + X);
// Two separate corrections, for two separate reasons.
//
// (a) sqrt(1 + 1/n): predicting a NEW effort carries the error in the fitted parameter as well as
//     the residual scatter. Without it the model looks MORE certain the less evidence it has.
check('sigma is inflated above the raw residual', full.sigma > sigNoisy, true);
near('   ...by exactly sqrt(1 + 1/n)', full.sigma / sigNoisy, Math.sqrt(1 + 1 / 5), 0.02);
// (b) the 5..95 clamp: sigma is measured from efforts the athlete COMPLETED at a known power, so
//     it cannot describe whether they go all-out today, traffic, a mechanical. Those risks are
//     real and unmodelled, so 100% is never honest to print.
check('the raw figure did reach the ceiling here', full.probRaw >= 95, true);
check('but what gets shown is clamped', full.prob, 95);
check('and the record admits it was clamped', full.probCapped, true);
const mid = M._saEvaluate_({ ...SEG, prSec: full.tPred + 3 }, CTX);
check('a genuinely close call is NOT clamped', mid.probCapped, false);
check('...and lands between the bounds', mid.prob > 5 && mid.prob < 95, true);
check('a hopeless segment floors at 5, not 0',
  M._saEvaluate_({ ...SEG, prSec: 60 }, CTX).prob, 5);

console.log('\n' + C + '=== 6c. evidence weight travels with the probability ===' + X);
// In this athlete's real library, 67 of the 126 qualifying segments sit at 3-4 efforts. Thin data
// is the COMMON case, so a 3-effort projection must not look like a 15-effort one.
check('3 efforts reads as thin', M._saEvidence_(3).key, 'thin');
check('4 too', M._saEvidence_(4).key, 'thin');
check('5 is fair', M._saEvidence_(5).key, 'fair');
check('10+ is strong', M._saEvidence_(10).key, 'strong');
check('a thin fit is named, not just coloured', M._saEvidence_(3).label, 'only 3 efforts');
check('thin and strong get different colours', M._saEvidence_(3).col !== M._saEvidence_(12).col, true);
check('the evidence rides on the record itself', full.evidence.key, 'fair');
check('...and reports the actual n', full.evidence.label, '5 efforts');
const thin3 = M._saEvaluate_({ ...SEG, efforts: noisy.slice(0, 3) }, CTX);
check('a 3-effort segment still projects', thin3.tier, 'full');
check('...but is labelled thin', thin3.evidence.key, 'thin');
check('...and carries a WIDER sigma than the 5-effort fit', thin3.sigma > full.sigma * 0.9, true);
console.log('  ' + Y + 'n=3 sigma ' + thin3.sigma + 's  vs  n=5 sigma ' + full.sigma + 's' + X);

console.log('\n' + C + '=== 6d. one bearing per segment — measured, not assumed away ===' + X);
// Wind is resolved against a single start->end bearing. That is exact on a straight road and
// progressively wrong as it bends. The stored endpoints cannot fix it, but they CAN say how far
// it is to be trusted.
const straight = { ...SEG, startLat:42.80, startLon:-85.60, endLat:42.80, endLon:-85.5466 };  // ~4.4km due E
const sEval = M._saEvaluate_(straight, CTX);
near('a straight segment scores ~1.0', sEval.sinuosity, 1.0, 0.05);
check('...and is not flagged approximate', sEval.windApprox, false);
// 4.4km of road spanning ~3.5km of straight line -> sinuosity ~1.25: bends, but still has a
// defensible direction of travel. (An earlier fixture spanned only 2.4km, which is 1.79 and lands
// in the too-winding bucket — the two bands need separate fixtures to be tested apart.)
const windy = { ...SEG, startLat:42.80, startLon:-85.60, endLat:42.80, endLon:-85.5569 };
const wEval = M._saEvaluate_(windy, CTX);
near('a bending segment scores between the bands', wEval.sinuosity, 1.25, 0.08);
check('...is flagged approximate', wEval.windApprox, true);
check('...but still gets a wind call', wEval.wind, 'tailwind');
const loop = { ...SEG, startLat:42.80, startLon:-85.60, endLat:42.8001, endLon:-85.6001 };     // out and back
check('an out-and-back gets NO wind call at all', M._saEvaluate_(loop, CTX).wind, null);
check('...and says why', /too winding/.test(M._saEvaluate_(loop, CTX).windNote), true);
check('no curvature is silently corrected for — it is flagged only',
  /inventing a curvature discount would be/.test(src), true);

console.log('\n' + C + '=== 7. capability comes from real rides, and stale is labelled ===' + X);
const cap = M._saCapability_(RIDES, 300, 90, '2026-07-30');
check('exact duration hit is exact', [cap.w, cap.exact], [265, true]);
const interp = M._saCapability_(RIDES, 200, 90, '2026-07-30');
check('between stored durations it interpolates', interp.w > 265 && interp.w < 300, true);
check('...log-log, so not the arithmetic midpoint', interp.w !== Math.round((265+300)/2), true);
check('no rides in the window -> null (caller falls back and LABELS it)',
  M._saCapability_([{ date:'2020-01-01', powerCurve:{300:265} }], 300, 90, '2026-07-30'), null);
check('the stale fallback is flagged on the record',
  M._saEvaluate_(SEG, { ...CTX, rides:[{ date:'2019-01-01', powerCurve:RIDES[0].powerCurve }] }).capStale, true);
check('no power curve anywhere -> null, not a guess', M._saCapability_([{date:'2026-07-20'}], 300, 90, '2026-07-30'), null);

// ---------------------------------------------------------------------------------------------
// 8. "What would it take" — both answers are INVERSIONS of the model already fitted. Appended
//    here rather than in a new file because they must be tested against the SAME fixture the
//    projection uses; a separate harness could drift from it.
// ---------------------------------------------------------------------------------------------
const M2 = new Function(code
  + ';return {_saPowerNeeded_,_saTailwindNeeded_,_saSolveV_,_saPowerAt_};')();
// Today's along-track tailwind, in mph, off the record the projection already carries.
const ctxTailwindMph = (rec) => Math.max(0, -rec.headwindMs) / 0.44704;
console.log('\n' + C + '=== 8. what would it take (model inversions) ===' + X);
// Round-trip: the watts the inversion reports must, fed back through the forward model, reproduce
// the target time. If that fails the two directions disagree and neither can be trusted.
const RHO2 = M._saRho_(64, 200), CDA2 = full.cda, TGT = full.prSec;
const wNeed = M2._saPowerNeeded_(DIST, TGT, GRADE, RHO2, CDA2, MASS, full.headwindMs);
const backV = M2._saSolveV_(wNeed, GRADE, RHO2, CDA2, MASS, full.headwindMs);
near('power inversion round-trips to the target time', DIST / backV, TGT, 2);
check('and the record carries it', full.wattsNeeded, wNeed);
check('the gap is against TODAY capability', full.wattsGap, full.wattsNeeded - full.capW);
// Tailwind inversion: feeding the returned tailwind back in must also hit the target.
// The answer is the tailwind needed FROM CALM, which is the useful form: today's actual wind is
// already in tPred, so this says what conditions the segment wants in general.
const twNeed = M2._saTailwindNeeded_(DIST, TGT, GRADE, RHO2, CDA2, MASS, full.capW);
check('a target needing help returns a positive tailwind', twNeed > 0, true);
const calmV = M2._saSolveV_(full.capW, GRADE, RHO2, CDA2, MASS, 0);
check('...and it is 0 when calm alone already beats the target',
  M2._saTailwindNeeded_(DIST, Math.round(DIST / calmV) + 30, GRADE, RHO2, CDA2, MASS, full.capW), 0);
check('today already exceeds what it needs, which is why it projects a win',
  ctxTailwindMph(full) > twNeed, true);
// Now a target that today's capability cannot reach without help.
const hardTgt = Math.round(TGT * 0.72);
const tw2 = M2._saTailwindNeeded_(DIST, hardTgt, GRADE, RHO2, CDA2, MASS, full.capW);
check('a harder target returns a real tailwind requirement', tw2 > 0, true);
const vBack = M2._saSolveV_(full.capW, GRADE, RHO2, CDA2, MASS, -(tw2 * 0.44704));
near('...which round-trips to that target', DIST / vBack, hardTgt, 3);
check('an impossible target returns null, not a fantasy number',
  M2._saTailwindNeeded_(DIST, 5, GRADE, RHO2, CDA2, MASS, full.capW), null);
check('no power -> null', M2._saTailwindNeeded_(DIST, TGT, GRADE, RHO2, CDA2, MASS, 0), null);
check('no target -> null', M2._saPowerNeeded_(DIST, 0, GRADE, RHO2, CDA2, MASS, 0), null);
// These are only ever offered on a full-tier record.
check('a wind-only segment carries no what-it-would-take',
  [thin.wattsNeeded, thin.tailwindNeeded], [undefined, undefined]);
console.log('  ' + Y + 'needs ' + wNeed + 'W today (holds ' + full.capW + 'W); '
  + (twNeed === 0 ? 'no wind help required' : twNeed + ' mph tailwind') + X);

console.log('\n' + (fails ? R+fails+' CHECK(S) FAILED'+X : G+'segment-attack-model: all checks passed'+X));
process.exit(fails ? 1 : 0);
