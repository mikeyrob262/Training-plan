// Pre-push preflight for this Worker.
//
// The entire app is served as ONE template literal, which creates three failure
// modes that `node --check` CANNOT catch (all three have shipped and broken things):
//   1. A stray backtick / bad ${ terminates the template literal  -> the
//      esbuild BUILD fails. Caught by step 1 (wrangler --dry-run).
//   2. A regex written with single backslashes (/\s/, /\*/) has its backslash
//      stripped by the template literal, so the SERVED regex is invalid
//      (/\s/ -> /s/, /^\*\*/ -> /^**/). Build + node --check both pass; only
//      the BROWSER throws at load. Caught by step 2 (parse the served <script>).
//   3. The same stripping, but landing on output that is still VALID — so nothing
//      throws anywhere and the bug ships silently. A single-backslash \b becomes a
//      real backspace (0x08), so /\bwalk\b/ served as /<BS>walk<BS>/ and matched
//      nothing for months; \n becomes a real newline, which usually breaks the
//      string and gets caught by step 2, but only usually. Caught by step 3, which
//      looks for control characters in the served output that no source ever wants.
//
// Run manually: `node scripts/preflight.mjs`
// Runs automatically on `git push` via .githooks/pre-push (core.hooksPath).
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const R='\x1b[31m', G='\x1b[32m', D='\x1b[2m', X='\x1b[0m';
const out = mkdtempSync(join(tmpdir(), 'preflight-'));
const fail = (m) => { console.error(`${R}✗ preflight FAILED: ${m}${X}`); cleanup(); process.exit(1); };
const cleanup = () => { try { rmSync(out, { recursive: true, force: true }); } catch {} };

try {
  // ---- 0. Stray backtick check. The wrangler build DOES catch this, but it reports it as
  // "Expected ) but found <token>" pointing at wherever the served template literal then ends,
  // which reads like a syntax error somewhere else entirely. A backtick written inside a COMMENT
  // — quoting a snippet of code, the natural thing to do — has now cost two build cycles.
  //
  // The app HTML is ONE untagged template literal, so exactly two backticks are legitimate in
  // hand-written code: the one that opens it and the one that closes it. The bundled vendor blob
  // is a single ~169 KB minified line carrying ~30 backticks of its own; those are inside separate
  // worker code, not the template, and are not ours to police. Skipping by line length rather than
  // by a hardcoded total means the count does not drift every time the bundle is rebuilt.
  const _wlines = readFileSync('worker.js', 'utf8').split(/\r?\n/);
  const _hand = _wlines.map((L, i) => ({ L, n: i + 1 })).filter(x => x.L.length < 50000);
  const _ticks = _hand.reduce((a, x) => a + (x.L.match(/`/g) || []).length, 0);
  if (_ticks !== 2) {
    console.error(_hand.filter(x => x.L.includes('`'))
      .map(x => `    worker.js:${x.n}: ${x.L.trim().slice(0, 110)}`).join('\n'));
    fail(`${_ticks} backticks in hand-written worker.js, expected 2 (the template's own open/close) — `
       + `any other backtick closes the served template literal early. Rewrite it in prose.`);
  }
  console.log(`${G}✓ no stray backticks${X}`);

  // ---- 1. Real build (esbuild via wrangler) -> catches template-literal breaks
  console.log(`${D}· building (wrangler deploy --dry-run)…${X}`);
  try {
    // PINNED. Floating on whatever npx resolves means an upstream publish can block every push:
    // wrangler 4.121.0 depends on miniflare@5.20260804.1-alpha, which is not on the registry, so
    // "npx wrangler" started failing with ETARGET on a repo whose own code built fine. Bump this
    // deliberately, not by accident of when a push happens to run.
    execSync(`npx --yes wrangler@4.120.1 deploy --dry-run --outdir "${out}"`, { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    console.error((e.stderr || e.stdout || '').toString());
    fail('wrangler build failed (see above) — the served template literal is malformed.');
  }
  console.log(`${G}✓ wrangler build clean${X}`);

  // ---- 2. Browser-equivalent parse: run the worker, fetch the served HTML,
  //         and parse each inline <script> the way the browser does.
  let html;
  try {
    const mod = await import(pathToFileURL(join(out, 'worker.js')).href);
    const res = await mod.default.fetch(new Request('http://localhost/'), {}, { waitUntil() {}, passThroughOnException() {} });
    html = await res.text();
  } catch (e) {
    fail('could not run the built worker to get served HTML: ' + e.message);
  }
  const scripts = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  if (!scripts.length) fail('no inline <script> found in served HTML (unexpected).');
  let bad = 0;
  scripts.forEach((s, i) => {
    try { new Function(s); } // same parse the browser does; throws on invalid regex literals
    catch (e) { bad++; console.error(`${R}  <script #${i}> would throw at load: ${e.message}${X}`); }
  });
  if (bad) fail(`${bad} served script block(s) fail to parse — the app would break at load.`);
  console.log(`${G}✓ served scripts parse (browser-equivalent, ${scripts.length} block${scripts.length > 1 ? 's' : ''})${X}`);

  // ---- 3. Stray control characters in the SERVED output -> catches escapes the template
  //         literal consumed into valid-but-wrong text, which step 2 cannot see because the
  //         result still parses. Checked on the emitted artifact rather than by scanning
  //         worker.js for escapes: the source scan needs backtick-parity bookkeeping to know
  //         which lines are inside the template, and that bookkeeping is exactly the thing
  //         that goes wrong here. The output is the ground truth.
  //
  //         Tab, LF and CR are legitimate; nothing else below 0x20 is, nor DEL, nor the two
  //         Unicode line separators (which terminate a JS line and would break the served
  //         script). ESCAPE names the source spelling to fix, since the character itself is
  //         invisible in an editor and that is why it survives review.
  //         CTRL_RE is built from an escaped string rather than written as a literal class, so
  //         this file cannot itself acquire the invisible characters it is here to find.
  const CTRL_RE = new RegExp('[\\u0000-\\u001f\\u007f]', 'g');
  const CTRL_NAME = { 0x00:'a backslash-0', 0x07:'a backslash-a', 0x08:'a backslash-b', 0x0b:'a backslash-v',
                      0x0c:'a backslash-f', 0x1b:'an escape char', 0x7f:'a DEL', 0x2028:'a U+2028', 0x2029:'a U+2029' };
  const strays = [];
  html.split('\n').forEach((L, i) => {
    for (let c = 0; c < L.length; c++) {
      const cp = L.charCodeAt(c);
      const bad = (cp < 0x20 && cp !== 0x09 && cp !== 0x0d) || cp === 0x7f || cp === 0x2028 || cp === 0x2029;
      if (bad) strays.push({ line: i + 1, col: c + 1, cp, ctx: L.slice(Math.max(0, c - 45), c + 45) });
    }
  });
  if (strays.length) {
    const kinds = [...new Set(strays.map((s) => s.cp))];
    strays.slice(0, 6).forEach((s) => {
      const hex = '0x' + s.cp.toString(16).padStart(2, '0');
      console.error(`${R}  served ${s.line}:${s.col} — control char ${hex}, almost certainly ${CTRL_NAME[s.cp] || 'an escape'} the template literal ate${X}`);
      console.error(`${D}    ${s.ctx.replace(CTRL_RE, String.fromCharCode(183))}${X}`);
    });
    if (strays.length > 6) console.error(`${D}    …and ${strays.length - 6} more${X}`);
    fail(`${strays.length} stray control character(s) in the served output (${kinds.length} kind(s)). `
       + 'Double the backslash in worker.js, or build the character with String.fromCharCode.');
  }
  console.log(`${G}✓ served output free of stray control characters${X}`);

  // ---- 4. AI card render smoke-test -> catches bare undeclared-symbol ReferenceErrors
  //         (ceilCy / rcv class) that _aiSafe_ swallows in production, blanking a card.
  console.log(`${D}· rendering AI cards (smoke-test)…${X}`);
  try {
    const so = execSync('node scripts/ai-cards-smoke.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('an AI card throws or renders blank (see above).');
  }

  // ---- 5. Nutrition fold semantics -> the st.nl dialect fold must merge meal buckets by
  //         MULTISET MAX. A set-rebuild collapses a food legitimately logged twice in one meal
  //         (real case: Hamburger - Five Guys x2, 2026-07-21) and a naive concat doubles a
  //         cross-dialect twin. Both are silent; the fixture blocks the push.
  console.log(`${D}· checking nutrition fold semantics…${X}`);
  try {
    const so = execSync('node scripts/nl-merge-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('nutrition fold semantics regressed (see above).');
  }

  // ---- 6. /store_v2 live-tail fold -> the snapshot is hand-uploaded and goes stale the moment
  //         the next ride syncs, so every reader downstream of allRidesDeduped_ depends on the
  //         tail being folded back on. Both directions are silent failures: not folding
  //         undercounts the current month (117 mi on 2026-07-29), and folding too loosely
  //         double-counts history.
  console.log(`${D}· checking /store_v2 live-tail fold…${X}`);
  try {
    const so = execSync('node scripts/store-v2-tail-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('the /store_v2 live-tail fold regressed (see above).');
  }

  // ---- 7. Month Race cumulative chart -> the failures here are all silent. A line drawn outside
  //         the plot box still renders, a Best Month curve truncated to today still looks like a
  //         chart, and a crosshair whose geometry disagrees with the drawn path reads the wrong
  //         day. Fixture-based, so it runs offline and does not move when the athlete rides.
  console.log(`${D}· checking Month Race chart geometry…${X}`);
  try {
    const so = execSync('node scripts/month-race-chart-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('the Month Race chart regressed (see above).');
  }

  // ---- 8. Growth-chart primitives -> the app-wide rule is that progress is drawn as a line, and
  //         the ways a line lies are all silent: a gap drawn as zero, a flat series pinned to the
  //         floor, a peak ring on the wrong point, a leap-year off-by-one shifting a whole curve.
  console.log(`${D}· checking growth-chart primitives…${X}`);
  try {
    const so = execSync('node scripts/growth-charts-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('a growth-chart primitive regressed (see above).');
  }

  // ---- 9. AI Coach Insight prompt -> the model can only be as truthful as its inputs. A missing
  //         field emitted as "0ft" reads to the model as fact and comes back as "flat terrain,
  //         zero elevation gain"; a hardcoded "ride" noun calls a trail run a ride. Both ship
  //         silently — the card renders, it is just wrong about the activity on screen.
  console.log(`${D}· checking AI Coach Insight prompt inputs…${X}`);
  try {
    const so = execSync('node scripts/coach-insight-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('the coach-insight prompt regressed (see above).');
  }

  // ---- 10. Calendar week per-sport breakdown -> every failure mode here renders fine and is
  //          simply wrong: a sport in the wrong line, a per-sport total that no longer adds up
  //          to the combined total printed beside it, or a "0 ft" asserted for a sport that
  //          carries no elevation data at all.
  console.log(`${D}· checking calendar week sport breakdown…${X}`);
  try {
    const so = execSync('node scripts/cal-week-sport-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('the calendar week breakdown regressed (see above).');
  }

  // ---- 11. You vs. You run path -> the run library reaches the page (2,201 snapshot + tail), and
  //          the coverage sentence states the RIGHT number for the RIGHT reason. Quoting the dense
  //          window's count as the coverage made a 2,202-run history read as one run.
  console.log(`${D}· checking You vs. You run path + coverage copy…${X}`);
  try {
    const so = execSync('node scripts/yvy-run-path-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('the You vs. You run path regressed (see above).');
  }

  // ---- 12. Athlete Intelligence cards -> no progress-shaped pill survives, every number on a
  //          card says what it is, and a DNA trait draws a line only where a history exists.
  console.log(`${D}· checking Athlete Intelligence cards (no pills)…${X}`);
  try {
    const so = execSync('node scripts/ai-cards-nobar-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('an Athlete Intelligence card regressed (see above).');
  }

  // ---- 13. Activity calories -> kJ is not kcal. rideKj_ is mechanical work; printing it with a
  //          "Cal" label overstated a run's burn by 40%, and the missing real field is also why
  //          Nutrition saw nothing burned. Both directions are silent.
  console.log(`${D}· checking activity calorie source…${X}`);
  try {
    const so = execSync('node scripts/calorie-source-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('the activity calorie source regressed (see above).');
  }

  // ---- 14. Regex escapes eaten by the served template literal -> /\d+/ in source is served as
  //          /d+/, a VALID regex that matches the wrong thing. Step 2's parse and step 3's control
  //          -char sweep both pass it. This shipped: _structIntervals_ never matched, so a
  //          "4x4 min" VO2 exported to Zwift as ONE 45-minute block at FTP.
  console.log(`${D}· checking regex escapes survive the template literal…${X}`);
  try {
    const so = execSync('node scripts/served-escape-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('a regex literal will lose its escapes when served (see above).');
  }

  // ---- 15. .zwo export -> the file has to reproduce the PRESCRIPTION. A rider loads it and rides
  //          whatever it says, so an interval session flattened to one steady block at FTP is not a
  //          cosmetic failure.
  console.log(`${D}· checking .zwo export…${X}`);
  try {
    const so = execSync('node scripts/zwo-export-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('the .zwo export regressed (see above).');
  }

  // ---- 16. Analytics Power-to-Weight -> the 0-4.0 gradient pill is gone, the target rule is only
  //          drawn when the target is actually inside the plotted range, and the caption names
  //          which of the two W/kg series is on screen.
  console.log(`${D}· checking the Power-to-Weight card…${X}`);
  try {
    const so = execSync('node scripts/wkg-card-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('the Power-to-Weight card regressed (see above).');
  }

  // ---- 17. Settings-style scalars merge last-write-wins, not max. Guards the direction that
  //          was structurally impossible before: a value going DOWN (FTP, any goal, resting HR),
  //          and a stale device re-pushing an old value over a legitimately lower one.
  console.log(`${D}· checking the settings merge rule…${X}`);
  try {
    const so = execSync('node scripts/lww-merge-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('the settings merge rule regressed — a numeric setting may be one-way again (see above).');
  }

  // ---- 18. The regexes whose escapes the served template literal used to eat: assert what they
  //          DO, against the served form. Step 14 proves they are spelled right; this proves they
  //          behave right, which is the half a source-reading test would have missed.
  console.log(`${D}· checking served regex behaviour…${X}`);
  try {
    const so = execSync('node scripts/served-regex-behaviour-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('a served regex regressed (see above).');
  }

  // ---- 19. Trajectory section 8 layout. Presentation-only rebuild, so the first thing it guards
  //          is that the rendered numbers are still the ones _trjRxDays_ computed — and that the
  //          per-week visual did not come back as a pill bar.
  console.log(`${D}· checking Prescribed vs actual…${X}`);
  try {
    const so = execSync('node scripts/trj-section8-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('the Prescribed vs actual card regressed (see above).');
  }

  // ---- 20. Deleting from a settings array must survive a merge, and the force-push escape hatch
  //          must stay gated. These are the two halves of the "my correction keeps coming back"
  //          failure that cost four rounds of hand-cleaning.
  console.log(`${D}· checking settings-array deletion…${X}`);
  try {
    const so = execSync('node scripts/settings-array-tombstone-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('settings-array deletion or the force-push gate regressed (see above).');
  }

  // ---- 21. The five Analytics goal cards are trends with a dashed goal, not pill bars. Guards
  //          both halves: the fills stay gone, and the rule is only drawn when it is real.
  console.log(`${D}· checking the goal cards…${X}`);
  try {
    const so = execSync('node scripts/goal-cards-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('the Analytics goal cards regressed (see above).');
  }

  // ---- 22. Coach V's yesterday recap must account for EVERY activity on the prior day, including
  //          the 'other' bucket (strength) that the old ride|run filter excluded outright.
  console.log(`${D}· checking the yesterday recap…${X}`);
  try {
    const so = execSync('node scripts/cv-yesterday-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {

    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('the Coach V yesterday recap regressed (see above).');
  }

  // ---- 23. Form (TSB) must equal Fitness (CTL) minus Fatigue (ATL) on every surface. The local
  //          series stored today's CTL/ATL beside YESTERDAY's differential, so the Athlete IQ Score
  //          card showed 59 / 65 / -14 when 59-65 is -6. Reported twice on the same card.
  console.log(`${D}· checking Form = Fitness - Fatigue…${X}`);
  try {
    const so = execSync('node scripts/form-tsb-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('Form (TSB) no longer agrees with Fitness and Fatigue (see above).');
  }


  // ---- 23b. Distance PRs: the in-ride split must be the BEST window in the ride, a marker the
  //           ride never reached must record nothing rather than an estimate, and dpr must survive
  //           storage slimming - losing it costs a 30-minute rate-limited Strava backfill to rebuild.
  console.log(`${D}· checking distance-PR layer…${X}`);
  try {
    const so = execSync('node scripts/dpr-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('the distance-PR layer no longer holds (see above).');
  }


  // ---- 23c. Food search must prefer a generic ingredient over a branded/restaurant row when the
  //           match is comparable - but never over an exact branded name - and a fractional portion
  //           must be enterable, visible on BOTH renderers, and scale every macro both ways.
  console.log(`${D}· checking food ranking + fractional portions…${X}`);
  try {
    const so = execSync('node scripts/nutrition-rank-qty-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('food ranking / fractional portions no longer hold (see above).');
  }


  // ---- 23d. The Overview decision hierarchy. Order is the whole design: a lower tier must never
  //           outrank a higher one, a rule with no data must SKIP rather than fire or block, and
  //           novelty suppression must push DOWN the ladder rather than blank the page.
  console.log(`${D}· checking the Overview decision hierarchy…${X}`);
  try {
    const so = execSync('node scripts/overview-hierarchy-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('the Overview decision hierarchy no longer holds (see above).');
  }


  // ---- 23e. Overview v3 layout. Fitness IS CTL - the strip showed 'Fitness (CTL) 181' beside
  //           'CTL 57' as two metrics, 181 being the FTP. One fitness cell, real goal types only.
  console.log(`${D}· checking the Overview v3 layout…${X}`);
  try {
    const so = execSync('node scripts/overview-layout-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('the Overview v3 layout no longer holds (see above).');
  }

  // ---- 24. Every wxCache_ consumer must UNWRAP the {data, fetchedAt} slot. Reading a payload
  //          field straight off it yields undefined silently, which is how Segment Attack showed
  //          "Weather unavailable" on every visit while the Weather page worked fine.
  console.log(D + String.fromCharCode(183) + " checking weather cache shape…" + X);
  try {
    const so = execSync("node scripts/wx-cache-shape-test.mjs", { stdio: ["ignore", "pipe", "pipe"] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || "").toString());
    console.error((e.stderr || "").toString());
    fail("a weather-cache consumer reads the wrapper without unwrapping (see above).");
  }

  // ---- 23. Segment Attack: the physics against external references, the CdA fit recovering a
  //          known value, and the probability being measured rather than felt.
  console.log(`${D}· checking the Segment Attack model…${X}`);
  try {
    const so = execSync('node scripts/segment-attack-model-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('the Segment Attack model regressed (see above).');
  }

  // ---- 25. Cross-surface agreement (Phase 0). Every bug that audit found was ONE fact computed
  //          two ways and disagreeing on screen, with nothing to indicate anything was wrong: a
  //          month total of 1,593,772 TSS, today's session showing tomorrow's after 8pm, three
  //          different W/kg from three different invented bodyweights. None threw. This guards the
  //          five categories — date identity, FTP/weight/goal sources, plan-vs-calendar, totals,
  //          and honest failure — and is mutation-tested: reintroducing any of the eight original
  //          bugs makes it fail.
  console.log(`${D}· checking cross-surface agreement…${X}`);
  try {
    const so = execSync('node scripts/cross-surface-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('two surfaces disagree about the same fact again (see above).');
  }

  // STEP 26 — the training block is a hand-authored calendar and its failure mode is DRIFT: an
  //           attempt moves and the taper built for it stays behind. A four-day Chalet taper really
  //           did survive in September after Chalet moved to October, and the block's own `end`
  //           really did stop three days before the summit it exists for. This asserts structure -
  //           attempts sit on their milestone dates, nothing tapers into nothing, the phases tile
  //           the block, running stays off the two hard days - and is mutation-tested.
  console.log(`${D}· checking training-block structure…${X}`);
  try {
    const so = execSync('node scripts/block-structure-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('the training block drifted from its own milestones (see above).');
  }

  // STEP 27 — the DNA trait sparklines read as manufactured smoothness, and they were: a year with
  //           no reading was ABSENT rather than null, and _gcSpark_ spaces by array index, so the
  //           gap closed up instead of opening; and only the last point and the peak were marked,
  //           so four annual readings drew as one continuous line. Four readings used to produce
  //           ONE dot. Nothing here may smooth - the path must stay straight M/L segments.
  console.log(`${D}· checking DNA sparse-series honesty…${X}`);
  try {
    const so = execSync('node scripts/dna-sparse-series-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('a sparse chart is implying continuity the data does not have (see above).');
  }

  // STEP 28 — the two searches reported wrong ("Beef Tenderloin" returning only the local Pork
  //           Tenderloin, a chain name returning an unrelated item from that chain). Neither was a
  //           retrieval problem: a local-first short circuit meant ANY local hit stopped the USDA
  //           call, and local rows were never scored at all.
  console.log(`${D}· checking food search matching…${X}`);
  try {
    const so = execSync('node scripts/food-search-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('food search matching regressed (see above).');
  }

  // STEP 29 — nutrActualBurn_ reads the fields a ride ACTUALLY carries. It shipped reading r.kj /
  //           r.work, which exist on ZERO rides in the library (calories 693, workKj 397), so that
  //           tier was dead and rides fell silently to the TSS estimate. Pins the FIELD NAMES, not
  //           just the arithmetic — a tier reading a field nothing writes is invisible.
  console.log(`${D}· checking nutrition burn sources…${X}`);
  try {
    const so = execSync('node scripts/nutr-burn-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('the burn is reading a field the library does not write (see above).');
  }

  // STEP 30 — voice notes. The assertions that matter are the NEGATIVE ones: no Blob, no
  //           MediaRecorder, no base64, nothing audio-shaped written to a ride. st is ~13.5 MB
  //           against a ~5 MB localStorage quota that has silently failed saves before, so
  //           "transcript only" is a storage constraint, not a preference.
  console.log(`${D}· checking voice notes…${X}`);
  try {
    const so = execSync('node scripts/voice-note-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('voice notes regressed — check nothing started storing audio (see above).');
  }

  // STEP 31 — the Almost Board. Its promise is that everything listed is genuinely within reach,
  //           so most of these assert what must NOT appear. Also pins the effort-shape fix: efforts
  //           are stored as {d,s,w} (4,855) AND {date,sec} (207), and reading only the latter drew
  //           every progression line in the app from four percent of the library.
  console.log(`${D}· checking the Almost Board…${X}`);
  try {
    const so = execSync('node scripts/almost-board-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('the Almost Board is listing things that are not almost (see above).');
  }

  // STEP 32 — the audio debrief. Almost every assertion here is about the speech FORMATTER,
  //           because a verdict written to be read is gibberish when spoken: "TSB -4" as
  //           "tee ess bee four", an all-caps heading shouted letter by letter. The escapes in it
  //           are doubled deliberately — served singly they become bare letters and [✓]
  //           turns into a class matching digits.
  console.log(`${D}· checking the audio debrief…${X}`);
  try {
    const so = execSync('node scripts/audio-debrief-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('the spoken debrief would not read correctly aloud (see above).');
  }

  // STEP 33 — Ghost Rival. The assertions that matter are the two REFUSALS: no FTP axis (the log
  //           is seven entries inside one ten-day window, data entry rather than a trajectory) and
  //           no opponent from a year that was not a cycling season (2019 was 132 cycling miles
  //           against 220 runs - a runner, not a rival).
  console.log(`${D}· checking Ghost Rival…${X}`);
  try {
    const so = execSync('node scripts/ghost-rival-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('Ghost Rival is racing something it should not (see above).');
  }

  // STEP 34 - the frozen-snapshot overlay. /store_v2 is hand-uploaded and schema-slim, so every
  //           field a later backfill computed was invisible through allRidesDeduped_ (dpr 392
  //           stored / 13 visible, powerCurve 325 / 0). The overlay fills them from st.rides.
  //           The rule under test is the DIRECTION: a live blank must never clear a snapshot
  //           value, and enrichment must never change WHICH rides exist.
  console.log(`${D}. checking the store_v2 enrichment overlay...${X}`);
  try {
    const so = execSync('node scripts/store-v2-enrich-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('the snapshot overlay is dropping or inventing ride data (see above).');
  }

  // STEP 35 - the readiness ring. It is drawn as a fraction and read as a percentage, so it has
  //           to behave like one. fill was a per-band constant, which rendered every TSB from
  //           -10 to +10 as exactly 75 - a twenty-point range shown as one exact figure. The
  //           test pins continuity, monotonicity, and that the four anchors are unchanged.
  console.log(`${D}. checking the readiness ring...${X}`);
  try {
    const so = execSync('node scripts/readiness-fill-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('the readiness ring is misreporting form (see above).');
  }

  // STEP 36 - Dr. Smurkel's voice, asserted on the SERVED text. Two failure modes: the clinical
  //           register coming back (the old prompt told him the athlete 'is Type A' and to name
  //           the tendency, and he wrote 'you are a person who reads a ceiling as a target...'(),
  //           and formatting leaking back into the voice core, which is what had four call sites
  //           banning the section headings the persona was demanding.
  console.log(`${D}. checking Dr. Smurkel's voice...${X}`);
  try {
    const so = execSync('node scripts/smurkel-persona-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('Dr. Smurkel is off-voice (see above).');
  }

  // STEP 37 - the run session editor. A run session's type is 'run', which failed a three-name
  //           allowlist and was rewritten to 'ride', so the editor drew the bike template with
  //           the watts fields permanently blank. Also pins the pace round-trip, the run-name
  //           branch (whose word boundary must survive the served template), and the migration
  //           that repairs the 173 sessions stored with the wrong type.
  console.log(`${D}. checking the run session editor...${X}`);
  try {
    const so = execSync('node scripts/run-session-editor-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('runs are being prescribed as rides (see above).');
  }

  // STEP 38 - My Foods / My Meals. The property is that a saved meal stores a REFERENCE and a
  //           QUANTITY, never macros. It used to store both - {n:'Egg Whole x2', cal:140} - so
  //           correcting a food fixed nothing that used it. Also pins the required fields and
  //           the legacy migration that turns the old copies into references.
  console.log(`${D}. checking My Foods / My Meals...${X}`);
  try {
    const so = execSync('node scripts/my-foods-meals-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('saved meals are copying food data again (see above).');
  }

  // STEP 39 - run HR zones + the power-curve monotonicity invariant. The zone bands were
  //           hardcoded in two places while st.maxHR sat wired to nothing, so correcting the
  //           setting changed nothing. The power curve cannot rise with duration; the parser
  //           already guarantees that, and this keeps it guaranteed.
  console.log(`${D}. checking run HR zones + power-curve monotonicity...${X}`);
  try {
    const so = execSync('node scripts/hr-zones-power-curve-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('run zones or the power curve are misreporting (see above).');
  }

  // STEP 40 - strength A/B/C/D rotation + the calendar quick-add. The rotation property is the
  //           SEQUENCE: both weekly slots were already scheduled (16 strengthB, 13 strengthA)
  //           but the intent never advanced, so C and D never appeared. Also pins that a claimed
  //           swap still beats the rotation, and that the '+' is an entry point rather than a
  //           second editor.
  console.log(`${D}. checking the strength rotation + calendar quick-add...${X}`);
  try {
    const so = execSync('node scripts/strength-rotation-test.mjs', { stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(so.toString());
  } catch (e) {
    console.error((e.stdout || '').toString());
    console.error((e.stderr || '').toString());
    fail('the strength rotation or the calendar quick-add is broken (see above).');
  }

  console.log(`${G}preflight passed — safe to push.${X}`);
  cleanup();
} catch (e) {
  fail('unexpected error: ' + (e && e.message));
}
