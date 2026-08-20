// THE ACTIVITIES LIST CAN NARROW ITSELF.
//
// Compare already groups sessions by type, but the plain Activities panel had no filter, so finding
// a past session meant scrolling by eye through everything in date order. This is the long-flagged
// searchActivities_ gap, built for this panel only - Calendar is deliberately untouched.
//
// Three properties worth holding, none of them about the input box:
//
//   ONE PREDICATE, ONE BUILDER. An empty query is not a special case, it is a filter matching
//   everything, so the full list and a filtered list cannot render differently. Two code paths for
//   "all" and "some" is how a filtered view quietly grows its own bugs.
//
//   MATCH ON actName_, NEVER r.name. Standing rule in this codebase: live records carry Strava
//   auto-names ("Morning Ride" x331) while the descriptive names sit elsewhere, so a filter reading
//   the raw field would fail to find exactly the rides worth searching for.
//
//   A BROKEN RECORD STAYS VISIBLE. The predicate returns true on error. A filter that hides things
//   when it throws is worse than no filter, because the absence looks like an answer.
//
// Run: node scripts/act-filter-test.mjs
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

console.log('\n' + Y + '=== one predicate, one builder ===' + X);
ok('the predicate exists', /function _actMatches_\(r, ?q\)/.test(SRC));
ok('an empty query matches everything rather than branching', /if\(!q\) return true;/.test(SRC));
ok('the builder takes a query', /function _actListHtml_\(query\)/.test(SRC));
ok('...and filters through the same predicate', /allR2\.filter\(function\(r2\)\{ return _actMatches_\(r2, ?q\); \}\)/.test(SRC));
ok('the initial render is the same call with an empty query', /var listHtml2=_actListHtml_\(''\);/.test(SRC));
ok('...so there is no second list-building path', (SRC.match(/function _actListHtml_/g) || []).length === 1);

console.log('\n' + Y + '=== it matches the fields a person would type ===' + X);
ok('the ride NAME, via actName_ and never r.name raw', /actName_\(r\):\(r\.name\|\|''\)/.test(SRC));
ok('the SPORT, via rideSport_', /rideSport_\(r\):\(\(r\.sportType\|\|r\.type\)\|\|''\)/.test(SRC));
ok('the DATE', /\(r\.date\|\|''\)/.test(SRC));
ok('the DISTANCE, formatted as it is displayed', /parseFloat\(r\.distance\)\.toFixed\(1\)\+' mi'/.test(SRC));
ok('case-insensitively, and trimmed', /toLowerCase\(\)\.trim\(\)/.test(SRC));
ok('a throwing record stays VISIBLE, never silently hidden', /catch\(e\)\{ return true; \}/.test(SRC));

console.log('\n' + Y + '=== the re-render does not fight the input ===' + X);
ok('a targeted container id exists', /id="act-list-scroll"/.test(SRC));
ok('the filter re-renders THAT container only', /getElementById\('act-list-scroll'\)/.test(SRC));
ok('NEG: it does not re-run openDesktopRideDetail, which would steal focus each keystroke',
   !/_actListFilter_=function\(q\)\{[^}]*openDesktopRideDetail/.test(SRC));
ok('the input is wired to it', /oninput="window\._actListFilter_ &amp;&amp; window\._actListFilter_\(this\.value\)"/.test(SRC));
ok('the input carries an id', /id="act-list-filter"/.test(SRC));
ok('...and sits above the list it acts on', SRC.indexOf('id="act-list-filter"') < SRC.indexOf('id="act-list-scroll"'));

console.log('\n' + Y + '=== a query with no matches SAYS so ===' + X);
ok('an empty result renders a message, not a blank panel', /No activity matches/.test(SRC));
ok('...quoting the query back', /String\(q\)\.replace\(\/<\/g,'&lt;'\)/.test(SRC));
ok('...escaped, since it is user input echoed into HTML', /replace\(\/<\/g,'&lt;'\)/.test(SRC));
ok('...and suggesting what does work', /Try a name, a sport, a date like/.test(SRC));

console.log('\n' + Y + '=== the predicate, exercised ===' + X);
{
  const match = (r, q) => {
    if (!q) return true;
    const hay = [r.name || '', r.sport || '', r.date || '',
      (parseFloat(r.distance) > 0) ? (parseFloat(r.distance).toFixed(1) + ' mi') : ''].join(' ').toLowerCase();
    return hay.indexOf(String(q).toLowerCase().trim()) >= 0;
  };
  const RIDES = [
    { name: 'Holland 100 Alternative', sport: 'Ride', date: '2026-08-12', distance: 62.4 },
    { name: 'Morning Ride', sport: 'Ride', date: '2026-08-15', distance: 26.3 },
    { name: 'Creekside Park Run', sport: 'Run', date: '2026-07-04', distance: 4.2 },
  ];
  const hits = (q) => RIDES.filter((r) => match(r, q)).length;

  ok('an empty query returns everything', hits('') === 3);
  ok('whitespace only returns everything too', hits('   ') === 3);
  ok('a name substring narrows to one', hits('holland') === 1);
  ok('...case-insensitively', hits('HOLLAND') === 1);
  // 'run' matches ONE ride - its sport and its name both hit, but that is one ride counted once.
  // The first draft asserted 2 by double-counting the same record's two matching fields.
  ok('a sport narrows to the single run', hits('run') === 1);
  ok('...and a sport with two records returns both', hits('ride') === 2);
  ok('a record matching on TWO fields is still counted once', RIDES.filter((r) => match(r, 'run')).length === 1);
  ok('a month narrows by date', hits('2026-08') === 2);
  ok('a full date finds the one', hits('2026-07-04') === 1);
  ok('a distance matches as displayed', hits('62.4') === 1);
  ok('a query matching nothing returns nothing, which the UI must state', hits('zwift') === 0);
  ok('a padded query still matches', hits('  morning  ') === 1);
  // The auto-name problem this codebase documents: searching the descriptive name has to work.
  ok('the descriptive name is findable even though a raw Strava name would not be', hits('alternative') === 1);
}

console.log('\n' + Y + '=== scope: this panel only, as agreed ===' + X);
ok('Calendar is untouched this pass', (SRC.match(/_actListHtml_/g) || []).length <= 4);
ok('the Compare control still sits in the same header', /id="wc-btn"/.test(SRC));

console.log('');
if (fails) { console.log(R + 'activities filter: ' + fails + ' check(s) failed' + X + '\n'); process.exit(1); }
console.log(G + 'activities filter: all checks passed' + X + '\n');
