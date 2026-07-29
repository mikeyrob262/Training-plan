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
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const R='\x1b[31m', G='\x1b[32m', D='\x1b[2m', X='\x1b[0m';
const out = mkdtempSync(join(tmpdir(), 'preflight-'));
const fail = (m) => { console.error(`${R}✗ preflight FAILED: ${m}${X}`); cleanup(); process.exit(1); };
const cleanup = () => { try { rmSync(out, { recursive: true, force: true }); } catch {} };

try {
  // ---- 1. Real build (esbuild via wrangler) -> catches template-literal breaks
  console.log(`${D}· building (wrangler deploy --dry-run)…${X}`);
  try {
    execSync(`npx --yes wrangler deploy --dry-run --outdir "${out}"`, { stdio: ['ignore', 'ignore', 'pipe'] });
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

  console.log(`${G}preflight passed — safe to push.${X}`);
  cleanup();
} catch (e) {
  fail('unexpected error: ' + (e && e.message));
}
