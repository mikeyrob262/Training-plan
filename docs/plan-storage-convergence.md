# Plan storage convergence — scope after the narrow fix

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

## What remains

### Stage 1 — find the Mon–Sat surface (blocked on one on-device answer)

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

### Stage 2 — extend the resolver to rendering surfaces

`_promptPlannedFor_` returns a display string, which is right for prompts and wrong for renderers.
Promote it to return the **session objects** and have the week table, Calendar and Today's Plan
read that. This is spec item 3, and it is the item with the most value per unit of risk: it makes
the surfaces incapable of disagreeing without touching any stored data.

Keep the string form as a thin wrapper so the prompt builders do not churn.

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

Recommendation: do Stages 1–3, then reassess whether Stage 4 is worth it. The original spec's
acceptance criterion "grep returns zero hits" is achievable but buys little once the prescription
path is severed, and it risks real logged data.

## Acceptance criteria worth keeping from the original spec

- Today's Plan, Calendar and Dr. Smurkel give identical answers for "what is scheduled today",
  because they call one function. *(Stage 2)*
- A day with no record shows an explicit empty state on every surface, never a fabricated session.
  *(done for prompts; Stage 2 for renderers)*
- Clicking through from a shown session lands on a real, editable calendar entry. *(Stage 2–3 —
  requires the shown session to be an `st.plan` record, which is why Stage 3 follows Stage 2)*
- Re-verify Aug 16: every surface either shows the Sunday easy run or says nothing is scheduled —
  never three surfaces disagreeing. *(Stage 1)*

## Do not regress

`scripts/plan-merge-lww-test.mjs`, `scripts/lww-merge-test.mjs`, `scripts/numeric-lww-test.mjs`,
`scripts/plan-block-realign-test.mjs`, and preflight step 60. This touches the same territory as
the `mergeSession_` / `_isSession_` / `PLAN_LWW_FIELDS_` work.
