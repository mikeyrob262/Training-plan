// Athlete Intelligence — no progress-shaped pills, and the numbers say what they are.
//
// The Trends question cards each carried a filled confidence pill. On the aerobic-efficiency card
// that pill sat directly under a trend percentage, so "-8%" (the trend) and "99%" (how sure we are
// of it) read as one comparison and the card showed two competing graphics for one story. The
// consistency card drew thirteen weekly rectangles — a time series in exactly the shape the
// standing rule forbids. Milestone confidence was a pill, which reads as "43% of the way there"
// for a figure that is a probability, not an accumulation.
//
// DNA traits gained the history behind them, but ONLY where a history exists: a single maximum
// (longest streak), a categorical share (day of week) and a two-group median (pace after rest)
// have no trajectory, and inventing one would be worse than the bar was.
//
// Run: node scripts/ai-cards-nobar-test.mjs
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');

function matchBrace(from){ let i=src.indexOf('{',from), depth=0; for(;i<src.length;i++){const c=src[i]; if(c==='{')depth++; else if(c==='}'){depth--; if(depth===0)return i;}} return -1; }
function extract(name){ const i=src.indexOf('function '+name+'('); if(i<0) throw new Error('fn not found: '+name); return src.slice(i, matchBrace(i)+1)+'\n'; }

let code='';
for(const f of ['_trConf_','_trConfWord_','_trConfNote_','_trTrendLine_','_trValueLine_',
                '_gcScale_','_gcSpark_','_gcSparkFoot_','_gcTrend_',
                '_dnaWeekKey_','_dnaMedian_','_dnaDaysBetween_','_dnaTrait_','_dnaLock_','_dnaTraits_']) code+=extract(f);
const M=new Function(code+'\n;return {_trConf_,_trConfWord_,_trConfNote_,_trTrendLine_,_trValueLine_,_gcScale_,_gcTrend_,_dnaTraits_};')();

const txt = h => String(h).replace(/<[^>]+>/g,' ').replace(/&mdash;/g,'—').replace(/&middot;/g,'·')
  .replace(/&#9650;/g,'^').replace(/&#9660;/g,'v').replace(/&#8322;/g,'2').replace(/\s+/g,' ').trim();

let fails=0;
const R='\x1b[31m', G='\x1b[32m', X='\x1b[0m';
function check(label, got, want){
  const ok=JSON.stringify(got)===JSON.stringify(want);
  if(!ok) fails++;
  console.log('  '+(ok?G+'PASS'+X:R+'FAIL'+X)+'  '+label+(ok?'':'  got '+JSON.stringify(got)+', want '+JSON.stringify(want)));
}

console.log('\n=== the confidence pill is gone from the source ===');
check('_trConfBar_ is no longer defined', /function _trConfBar_\s*\(/.test(src), false);
check('nothing still calls it', /_trConfBar_\s*\(/.test(src), false);

console.log('\n=== confidence is words, not a filled bar ===');
check('a big sample reads high', M._trConfWord_(99), 'high confidence');
check('a thin sample reads very low', M._trConfWord_(20), 'very low confidence');
check('the middle bands exist', [M._trConfWord_(70), M._trConfWord_(40)], ['moderate confidence','low confidence']);
const note=M._trConfNote_(344, 'HR-paired rides', M._trConf_(344,120));
check('the note states the sample and the confidence', txt(note), 'Based on 344 HR-paired rides · high confidence');
check('and contains no bar geometry', /width:\s*\d+%/.test(note), false);
check('2 estimates are called out as very low', txt(M._trConfNote_(2,'estimates',M._trConf_(2,20))), 'Based on 2 estimates · very low confidence');

console.log('\n=== a trend percentage now says what it compared ===');
const down=M._trTrendLine_(-8, 'most recent 10 months vs the first 10 of these 30');
check('the comparison is stated, not implied', txt(down), 'v 8% most recent 10 months vs the first 10 of these 30');
check('a fall is red', down.indexOf('#ef4444')>=0, true);
check('a rise is green', M._trTrendLine_(7,'x').indexOf('#22c55e')>=0, true);
check('zero is neutral, with no arrow', txt(M._trTrendLine_(0,'x')), '0% x');
check('invert flips which direction is good', M._trTrendLine_(-8,'x',true).indexOf('#22c55e')>=0, true);

console.log('\n=== the value line explains its own unit ===');
const vl=M._trValueLine_(12.2, 'mph per 100 bpm', 'how much speed each heartbeat buys you');
check('number, unit and gloss all present', txt(vl), '12.2 mph per 100 bpm how much speed each heartbeat buys you');
check('the gloss is optional', txt(M._trValueLine_(190,'FTP W','')), '190 FTP W');

console.log('\n=== milestone confidence is a marker on a scale, not a fill ===');
const sc=M._gcScale_(43, '#f59e0b', 'unlikely', 'even', 'near certain');
check('the scale is labelled at both ends', [txt(sc).indexOf('unlikely')>=0, txt(sc).indexOf('near certain')>=0], [true,true]);
check('there is no proportional fill', /width:\s*\d+%\s*;?\s*background/.test(sc), false);
check('the marker is positioned by the value', sc.indexOf('left:43%')>=0, true);

// ---- DNA traits: a 12-year fixture with an obvious per-year shape ----
function mkActs(){
  // Runs every 2 days (so most are NOT post-rest and the pace-after-rest trait can build), volume
  // stepping up in 2019, plus one 20-day gap a year so the break-count series has something to say.
  const out=[];
  for(let y=2013;y<=2024;y++){
    const n=(y<2019)?120:170;
    for(let i=0;i<n;i++){
      let doy=1+i*2;
      if(doy>200) doy+=20;                        // the annual break
      if(doy>360) break;
      const d=new Date(Date.UTC(y,0,1)); d.setUTCDate(doy);
      out.push({date:d.toISOString().slice(0,10), sport:'run', dist:(doy>200?7:5), sec:2700});
    }
  }
  out.sort((a,b)=>a.date<b.date?-1:1);
  return out;
}
const ACTS=mkActs();
const traits=M._dnaTraits_(ACTS);
const byName=n=>traits.filter(t=>String(t.name).indexOf(n)===0)[0];

console.log('\n=== DNA traits carry their history where one exists ===');
check('Consistency has a per-year series', !!(byName('Consistency')||{}).spark, true);
check('...labelled as such', (byName('Consistency')||{}).sparkNote, 'share of weeks active, by year');
check('...with one point per activity-year, no phantom leading year', ((byName('Consistency')||{}).spark||[]).length, 12);
check('Recent run volume has a monthly series', !!(byName('Recent run volume')||{}).spark, true);
check('...capped at 60 months so a 16-year log stays readable', ((byName('Recent run volume')||{}).spark||[]).length<=60, true);
check('You always come back has a per-year break count', !!(byName('You always come back')||{}).spark, true);
// Zero-fill needs a year that HAD no break, which the main fixture (one break every year) cannot
// supply. A gap-free middle year must still appear as a 0 point, or the line would silently skip
// a year and misread as "breaks every year".
(function(){
  const g=[]; const push=(y,doy)=>{ const d=new Date(Date.UTC(y,0,1)); d.setUTCDate(doy);
    g.push({date:d.toISOString().slice(0,10), sport:'run', dist:5, sec:2700}); };
  // Walk each year to its END, so the Dec-to-Jan boundary never manufactures a gap of its own —
  // that boundary break landed in the following year and hid the zero this check is looking for.
  for(let y=2020;y<=2022;y++){
    for(let doy=1; doy<=360; doy+=2){
      // Two holes per break-year: the trait needs 3+ breaks in total before it will build.
      if(y!==2021 && ((doy>100 && doy<=125) || (doy>200 && doy<=225))) continue;
      push(y,doy);
    }
  }
  g.sort((x,y2)=>x.date<y2.date?-1:1);
  const t=M._dnaTraits_(g).filter(t=>String(t.name).indexOf('You always come back')===0)[0];
  const sp=(t||{}).spark||[];
  check('a break-free year still appears, as a zero', sp.some(p=>p.lab==='2021' && p.v===0), true);
  check('every year in the span is present', sp.map(p=>p.lab), ['2020','2021','2022']);
})();

console.log('\n=== ...and NOT where the number has no time dimension ===');
check('Longest streak is a single maximum — no series', (byName('Longest streak')||{}).spark, null);
check('Your day is <dow> is categorical — no series', (byName('Your day is')||{}).spark, null);
check('Pace after rest is built by this fixture', !!byName('Pace after rest'), true);
check('...and compares two groups, so carries no series', (byName('Pace after rest')||{}).spark, null);

console.log('\n=== a trait series actually renders as a line ===');
const cSpark=(byName('Consistency')||{}).spark;
const line=M._gcTrend_(cSpark, '#4ade80', {aria:'Consistency over time', H:34, fill:false, note:'share of weeks active, by year'});
check('an <svg> path is emitted', /<svg[\s\S]*<path/.test(line), true);
check('no rectangle fill is emitted', /<rect/.test(line), false);
check('the endpoints are labelled', [txt(line).indexOf('2013')>=0, txt(line).indexOf('2024')>=0], [true,true]);

console.log('\n=== source guard: the converted cards keep no pill geometry ===');
// aiRenderTrends_ is one large closure; these are the specific shapes that were removed from it.
const trends = src.slice(src.indexOf('function aiRenderTrends_('), matchBrace(src.indexOf('function aiRenderTrends_(')));
check('no 13-rectangle weekly strip survives', /height:44px;display:flex;align-items:flex-end/.test(trends), false);
check('no stroke-dashoffset ring for the driver count', /stroke-dashoffset/.test(trends), false);
check('the consistency card draws a trend line', /_gcTrend_\(wkPts/.test(trends), true);
check('the efficiency card draws exactly one graphic', (trends.match(/_gcTrend_\(eff\.vals/g)||[]).length, 1);
check('milestone confidence uses the scale primitive', /_gcScale_\(p\.conf/.test(trends), true);
// Presence of the scale is not absence of the pill — a reverted fill can sit right beside it.
check('and no proportional fill is driven by the confidence', /width:'\+p\.conf\+'%/.test(trends), false);
check('no card in this closure builds a percentage-width fill at all', /width:'\+[A-Za-z_.]+\+'%;background/.test(trends), false);

console.log('\n'+(fails? R+fails+' CHECK(S) FAILED'+X : G+'ai-cards-nobar: all checks passed'+X));
process.exit(fails?1:0);
