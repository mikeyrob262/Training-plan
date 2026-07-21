// AI card render smoke-test — guards against bare undeclared-symbol ReferenceErrors
// (the "ceilCy is not defined" / "rcv is not defined" class) that _aiSafe_ swallows in
// production, silently blanking a card instead of failing loudly. Extracts each card's
// dependency closure from worker.js, renders it against a fixture, and FAILS the build if
// any card throws or returns a non-string. Run: node scripts/ai-cards-smoke.mjs
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');

function matchBrace(from){ let i=src.indexOf('{',from), depth=0; for(;i<src.length;i++){const c=src[i]; if(c==='{')depth++; else if(c==='}'){depth--; if(depth===0)return i;}} return -1; }
function extract(name){
  let idx=src.indexOf('function '+name+'(');
  if(idx<0) idx=src.indexOf('function '+name+' (');
  if(idx<0) throw new Error('closure fn not found in worker.js: '+name);
  return src.slice(idx, matchBrace(idx)+1)+'\n';
}

// Dependency closure for the two adherence cards (verified against worker.js call graph).
// Add a card + its closure fns here when you want it under the smoke test.
const CLOSURE = ['aiCard_','aiLbl_','aiEsc_','_adhLbl_','_adherenceTrend_','strengthAdherenceTrend_','rideAdherenceTrend_','_adhCardInner_','aiCardStrengthAdherence_','aiCardRideAdherence_'];
let code=''; for(const f of CLOSURE) code+=extract(f);

// ---- fixture: recent weeks of scored + unscored sessions across all three types ----
function mkPlan(){
  var plan={}, base=new Date(); base.setHours(0,0,0,0);
  var pad=function(n){ return ('0'+n).slice(-2); };
  var keyOf=function(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); };
  // 8 weeks back, 2 sessions/week each type; alternate scored/unscored to hit both branches
  for(var w=0; w<8; w++){
    var d=new Date(base); d.setDate(base.getDate()-w*7-2);
    var dk=keyOf(d);
    var scored=(w%2===0);
    plan[dk]={ sessions:[
      { type:'strength', executionScore: scored?(70+w):null },
      { type:'mobility', executionScore: scored?85:null },
      { type:'ride', executionScore: scored?(90-w):null },
      { type:'ride', synthetic:true, executionScore:50 },   // must be excluded
      { type:'strength', deleted:true, executionScore:99 }   // must be excluded
    ] };
  }
  return plan;
}
global.st = { plan: mkPlan(), rides: [], runs: [] };

let fails=[];
try{ (0,eval)(code); }catch(e){ console.error('EVAL FAIL (closure did not parse):', e.message); process.exit(1); }

// low-n fixture too: single scored session -> the "<3 scored" branch
const LOWN = { plan: (function(){ var p={}, d=new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-3); var k=d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); p[k]={sessions:[{type:'strength',executionScore:80},{type:'ride',executionScore:88}]}; return p; })(), rides:[], runs:[] };

const CARDS = [
  ['StrengthAdherence', ()=>globalThis.aiCardStrengthAdherence_()],
  ['RideAdherence', ()=>globalThis.aiCardRideAdherence_()],
];
function runAll(label){
  for(const [name, fn] of CARDS){
    try{
      const out = fn();
      if(typeof out !== 'string') fails.push(`${name} [${label}]: returned ${typeof out}, not a string`);
      else if(!out.length) fails.push(`${name} [${label}]: returned empty string (card would render blank)`);
    }catch(e){ fails.push(`${name} [${label}]: threw "${e && e.message}"`); }
  }
}
runAll('full');
global.st = LOWN; runAll('low-n');

if(fails.length){
  console.error('\x1b[31m✗ AI card smoke-test FAILED:\x1b[0m');
  fails.forEach(f=>console.error('  - '+f));
  process.exit(1);
}
console.log('\x1b[32m✓ AI cards render clean ('+CARDS.length+' cards × 2 fixtures, no throw/blank)\x1b[0m');
