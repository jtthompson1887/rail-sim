# Milestone 2A final-review fix report

## Status and scope

The two Important schema findings against candidate `c51c521` are fixed in one
TDD wave. The evidence attribution is corrected to `c51c521`. The exact final
reviewed SHA and independent review disposition remain pending controller
re-review.

This wave deliberately adds no migration or compatibility behavior. There is
no existing player data, and schema 6 remains a clean break.

## Root-cause analysis

### Duplicate facility definitions

`isEconomyState` validated every facility and tracked `facility.id` uniqueness,
but it had no collection-level set for `facility.definitionId`. Consequently,
two separately identified instances of `managed-forest` each passed their
individual definition/inventory checks and the economy was accepted.

The minimal correction tracks both identities independently and rejects a
duplicate in either set.

### Unsafe paid build costs

`isTrack` required a finite, non-negative integer for `paidBuildCost`, but
`Number.isInteger` accepts integers above `Number.MAX_SAFE_INTEGER`.
`demolitionRefund` correctly rejects such a value with
`Number.isSafeInteger`, so the schema admitted state that the downstream
construction economy could not represent.

The minimal correction makes the persistence boundary require
`Number.isSafeInteger(value.paidBuildCost)` and retain the non-negative check.

## TDD evidence

### RED

After adding only the schema regression tests:

```powershell
npx jest tests/unit/WorldSchemaValidation.test.ts --runInBand --coverage=false
```

Exact result: exit 1; 1 suite failed; 84 tests ran; 82 passed and exactly 2
failed:

- `rejects schema 6 with duplicate facility definition IDs` received a
  compatible world;
- `rejects a track with unsafe paid cost` received `compatible: true`.

The simultaneously added negative-cost rejection and exact
`Number.MAX_SAFE_INTEGER` acceptance cases passed in RED, confirming that the
missing behavior was specifically definition uniqueness and the unsafe upper
boundary.

### GREEN

After the minimal schema changes:

```powershell
npx jest tests/unit/WorldSchemaValidation.test.ts --runInBand --coverage=false
```

Exact result: 1/1 suite and 84/84 tests passed.

The focused schema/construction regression gate was:

```powershell
npx jest tests/unit/WorldSchemaValidation.test.ts tests/unit/ConstructionEconomy.test.ts tests/unit/CommandStack.test.ts --runInBand --coverage=false
```

Exact result: 3/3 suites and 143/143 tests passed, with 0 snapshots.

## Fresh verification

### Full Jest and coverage

```powershell
npm test -- --runInBand
```

Exact result:

- 84/84 suites passed;
- 1,262/1,262 tests passed;
- 0 snapshots;
- 96.05% statements;
- 88.60% branches;
- 90.50% functions;
- 96.05% lines;
- 111.515 seconds;
- embedded 500-proposal construction-preview p95 1.014 ms against the 8 ms
  local target.

The existing intentional failed-localStorage-write test emitted
`SaveService: failed to save world to localStorage` through `console.warn`.

### Production build

```powershell
npm run build
```

Exact result: exit 0; Webpack 5.88.1 compiled in 9.064 seconds. The three
existing performance warnings remain for the 1.4 MiB entrypoint and oversized
legacy assets.

### Directly affected browser flows

```powershell
npx playwright test tests/e2e/generated-economy-presentation.test.ts tests/e2e/construction-loop.test.ts --retries=0
```

Exact result: 7/7 passed with one worker and zero retries in 1.7 minutes:

- 3/3 construction-loop tests, including exact construction reload, failed-save
  retry, and low-cash reload behavior;
- 4/4 fixed-seed generated-economy presentation tests, covering three seeds,
  desktop, and 375x667.

## Evidence correction

`docs/superpowers/reviews/2026-07-25-milestone-2a-evidence.md` now identifies
`c51c521` as the candidate implementation head. It records that candidate's
successful build, 4/4 generated-economy browser cases with zero retries, and
5/5 FacilityInspector unit tests. It continues to mark the exact reviewed
source and independent review disposition as pending.

## Files changed

- `src/config/WorldData.ts`
  - require a non-negative safe integer for `paidBuildCost`;
  - enforce uniqueness for both facility instance IDs and definition IDs.
- `tests/unit/WorldSchemaValidation.test.ts`
  - reject distinct facility IDs that share a definition;
  - reject negative and unsafe paid costs;
  - accept the exact safe-integer upper boundary.
- `docs/superpowers/reviews/2026-07-25-milestone-2a-evidence.md`
  - correct candidate attribution and inspector-verification evidence.
- `.superpowers/sdd/2026-07-25-milestone-2a-economy-foundation/final-review-fix-report.md`
  - preserve this red/green and verification record.

## Remaining concern

No implementation blocker is known. Controller re-review is still required
before setting the final reviewed SHA, review disposition, or publishing.
