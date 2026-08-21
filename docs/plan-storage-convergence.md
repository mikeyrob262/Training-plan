# Plan storage convergence — scope after the narrow fix

> **Status (2026-08-21): Stage 2 is DONE (`96c7132`). Stages 1, 3 and 4 remain.** If you arrived here
> because Today's Plan disagreed with another surface, that class of bug is fixed — read the Stage 2
> section below before assuming otherwise. **There is no outstanding row-duplication cleanup**: that
> work shipped 2026-08-17 as `87c14e4` and is guarded by `scripts/plan-dupe-test.mjs`. This document
> being a *scope* rather than a *task* has caused it to be mistaken for a deferred backlog item.

Written 2026-08-16, after the audit that preceded commit `878a1b3`. This replaces the
premise in the original "Kill the 17-week plan" spec, which was written before the audit
and got the mechanism wrong in three places. Nothing here contradicts the *goal* of that
spec — one source of truth for "what is prescribed on a day" — only the route to it.

## The corrected model: three stores, not one template

| Store | Keyed by | Holds | Persistent? |
|---|---|---|---|
| `st.plan[YYYY-MM-DD].sessions[]` | **date** | real session records: type, intent, name, targets, status, completedRideKey, `_edited` mask | yes, synced |
| `st.plans[id].weeks['w'+N]` (via `ws(w)`) | **week-number × day-index** | `wo` `nu` `fi` `str` `swaps` `ci` — checkboxes, notes, lifted weights, check-ins | **yes, synced** |
| `_trainingBlock_()` → `blockPlanFor_(dk)` | **date** (derived) | the block template: phases, weekly slots, dated amendments | no — pure function of `worker.js`, version-controlled |

Three corrections to the original spec:

1. **`ws()` is not ephemeral and not a DOM template.** It reads `st.plans[activePlanId].weeks`
   (`worker.js:8041`) — persistent, synced state containing real user data. "Remove the ephemeral
   generator" does not apply as written. The DOM ids `wc{w}_{d}` / `ck{w}_{d}` are the *legacy
   17-week markup*, which is already inert.
2. **`getPlannedWorkoutForDate` already reads `st.plan` exclusively** (`worker.js:~46520`). The
   Dashboard "Today's Plan" card was migrated in Phase 0 and is not a contaminated surface.
3. **The block is a legitimate third source, not fake data.** It is deterministic, reviewable and
   dated-amendable. The Aug 16 "Easy Run" came from `P1.week[6]` and was real. Any convergence
   plan must treat the block as an *input* to the resolver, not something to eliminate.

## What the narrow fix already did (`878a1b3`)

- `_promptPlannedFor_(dateKey)` — one resolver for prompt builders: `st.plan` → block → `null`.
- All five `ws()` prescription reads removed from the three AI Coach prompt builders. Two of those
  built their entire "upcoming this week" list from the week store with no `st.plan` consulted.
- The `TOMORROW on the plan` line is always stated (three states) instead of vanishing on `null`.
- Debrief rule: never name a session type the facts did not name; frame proposals as suggestions.
- Guard: `scripts/plan-source-test.mjs`, preflight step 60.

## Stage 2 — DONE (2026-08-21, `96c7132`)

Shipped, and the mechanism differs from what this doc anticipated below. The plan was to promote
`_promptPlannedFor_` to return session objects and have the renderers read that. What the audit
actually found was that the resolver already existed under a different name and the *fallback* was the
thing that had been copied:

- the block fallback was **open-coded in the desktop month grid**, **again in the mobile week strip**,
  and a **third, guard-less variant** lived inside `_promptPlannedFor_`;
- `getPlannedWorkoutForDate` — which Today's Plan, the fuelling resolver, the missed-day scan and the
  day editor all call — read `st.plan` **exclusively**, so those four had no fallback at all.

So "what is scheduled today" depended on which surface asked. That is the Sunday in the acceptance
criteria: Easy Run on the Calendar, "No workout scheduled" on the Dashboard, same morning.

**`_plannedFromBlock_` is now the only place a surface asks the block**, called only by
`getPlannedWorkoutForDate`. Both inline copies are deleted and the prompt branch with them; the two
`blockPlannedForDate_` references left in `worker.js` are its definition and that single call. The
eight `getPlannedWorkoutForDate` call sites are now the complete list of surfaces that answer this
question, and they cannot disagree by construction rather than by vigilance.

**Two bugs fell out that nothing had reported:**

1. **The mobile week strip's guards never fired.** It built its key unpadded
   (`y+'-'+(m+1)+'-'+d`), so `st.plan['2026-8-16']` was `undefined`, raw came back empty, and *both*
   the swap and tombstone checks silently no-opped — mobile showed block sessions on days the athlete
   had explicitly swapped or deleted, while desktop correctly hid them. A guard that cannot see its
   input is not a guard. The shared helper normalises the date.
2. **The prompt path had no guards at all**, so the coach could name a session the athlete had moved
   or removed.

**The missed-session detector deliberately opts out** via `if(plan && plan.fromBlock) plan=null;` —
the constraint recorded under "what must NOT have changed" in `cal-block-fallback-test.mjs`. Worth
noting how nearly that was lost: it had been protected by grepping the detector for
`blockPlannedForDate_`, and once the fallback moved inside the resolver that grep **stayed green while
the guarantee broke**. A grep for an absent symbol is not a behavioural guard.

Guards: `scripts/plan-source-test.mjs` (its harness now composes the whole real chain
`_promptPlannedFor_` → `getPlannedWorkoutForDate` → `_plannedFromBlock_` → `blockPlannedForDate_`
instead of stubbing half of it) and `scripts/cal-block-fallback-test.mjs` (rewritten to assert **one
implementation**, not "two copies currently agree" — which is what it checked before, and why it
passed while mobile was broken). Both mutation-tested.

## What remains

### Stage 1 — find the Mon–Sat surface (still blocked on the same on-device answer)

**Not resolved by Stage 2, and worth being exact about why.** Stage 2 makes the surfaces agree; it does
not put Sunday rows in `st.plan`. If the week table's six rows came from `st.plan` holding no Sunday,
that table now answers from the block wherever it reads `getPlannedWorkoutForDate` — but whether it
does was never established, and the decisive check below has still not been run.

The reported week table shows 6 rows / 482 TSS / 8 activities. No renderer hardcodes six days —
verified, there is no 6-length day array or `i<6` loop in the file. `_tbWeekStrip_` (`~32437`)
correctly walks all seven. So the Mon–Sat table is **data-driven**, and the likely cause is that
`st.plan` holds no Sunday row while the block does.

That fits the arithmetic: block sessions Mon–Sat excluding `mobility` = 8, which matches the
reported activity count exactly, and Mon–Sun would be 9.

**Decisive check, on device:**

```js
planDump_('2026-08-16')                     // stored rows for that Sunday
blockPlanFor_('2026-08-16').sessions        // what the block derives
```

If `planDump_` is empty and `blockPlanFor_` returns `easyRun`, the generator never wrote Sunday
rows and the week table is honestly reporting an incomplete `st.plan`. The fix is then either to
backfill Sunday rows, or to have the week table read the same resolver every other surface uses.

### Stage 3 — backfill missing `st.plan` rows

Only after Stage 1 says which days are missing. Constraints already established elsewhere and not
to be relearned:

- **Future only.** A past row is the record of what was prescribed *at the time*. `migratePlanIntentsToBlock_`
  is future-only for this reason and must stay so.
- **Generator-owned only.** `_planReplaceable_` is the ownership contract; `swap===true` is the one
  athlete decision that overrides it.
- **Stamp `editedAt`.** A correction with no clock loses the next merge — see `PLAN_LWW_FIELDS_`
  and the `mergeSession_` work of Aug 13.
- **A removal needs a tombstone**, never a splice.

### Stage 4 — `ws()` retirement (largest, lowest urgency)

26 remaining call sites, none of which are prescription reads any more. They are:

- the legacy 17-week plan UI (checkbox toggles `TW`/`TN`, notes `SF`/`SC`, strength logs, weekly
  check-ins) — `9523`–`10428`, `45005`, `46737`–`46911`
- one weight/energy history scan — `14359`, `10258`, `10264`

**This is real user data**: logged weights, check-ins, completion history. Retiring `ws()` means
migrating that into a date-keyed home, not deleting it. Until then the store is harmless — nothing
it holds reaches a coaching surface as a prescription, which was the actual defect.

Recommendation, unchanged by Stage 2 landing: do Stages 1 and 3, then reassess whether Stage 4 is
worth it. The original spec's acceptance criterion "grep returns zero hits" is achievable but buys
little once the prescription path is severed, and it risks real logged data.

## Acceptance criteria worth keeping from the original spec

- ✅ Today's Plan, Calendar and Dr. Smurkel give identical answers for "what is scheduled today",
  because they call one function. *(Stage 2, `96c7132` — `getPlannedWorkoutForDate`, eight call sites)*
- ✅ A day with no record shows an explicit empty state on every surface, never a fabricated session.
  *(prompts previously; renderers at Stage 2. A block answer is not a fabrication — the block is a
  deterministic, reviewable source — and it is flagged `fromBlock:true` so a surface that must not use
  it, like the missed-session detector, can say so explicitly.)*
- ⬜ Clicking through from a shown session lands on a real, editable calendar entry. *(Stage 3 —
  requires the shown session to be an `st.plan` record. Stage 2 makes the surfaces agree on what to
  SHOW; it does not create the row behind a block-derived one, so this is genuinely still open.)*
- ⬜ Re-verify Aug 16: every surface either shows the Sunday easy run or says nothing is scheduled —
  never three surfaces disagreeing. *(Stage 1. The disagreement is now structurally impossible for the
  eight surfaces on the shared resolver, but this was never re-checked on device and should be.)*

## Do not regress

`scripts/plan-source-test.mjs`, `scripts/cal-block-fallback-test.mjs`,
`scripts/plan-merge-lww-test.mjs`, `scripts/lww-merge-test.mjs`, `scripts/numeric-lww-test.mjs`,
`scripts/plan-block-realign-test.mjs`, and preflight step 60. This touches the same territory as
the `mergeSession_` / `_isSession_` / `PLAN_LWW_FIELDS_` work.

**Two rules earned the hard way here, both of which cost a green test suite over a broken feature:**

1. **Do not re-introduce a second block fallback.** If a new surface needs one, call
   `getPlannedWorkoutForDate`. `cal-block-fallback-test.mjs` asserts there is exactly ONE
   `blockPlannedForDate_` call site and fails on a second.
2. **Do not guard a behaviour by grepping for an absent symbol.** That is what protected the
   missed-session detector, and it stayed green while the fallback moved underneath it. Assert the
   opt-out, not the absence.
