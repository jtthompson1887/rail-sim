# Milestone 2A economy-foundation evidence

**Candidate implementation head:** `4fe2839`

**Independent review:** Approved after one task-review fix and one final-review fix wave

**Reviewed source:** `4fe2839`

**Private Sites version and URL:** Version 4 — https://rail-sim-progress.jt-98.chatgpt.site

This record assembles the Task 9 implementation, automated-gate, generated
economy playtest, independent-review, and private-publication evidence.

## Full-chain reconciliation

`tests/integration/ConstructionSupplyEconomy.test.ts` drives real recipe ticks,
real inventory transfers, explicit resource/import receipts, and explicit town
consumption. The hand-checked product ledger is:

| Product | Opening | Boundary inflow | Processing output | Processing input | Boundary outflow | Closing |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Logs | 60 | 8 | 0 | 10 | 0 | 58 |
| Structural timber | 0 | 0 | 8 | 8 | 0 | 0 |
| Limestone aggregate | 75 | 10 | 0 | 12 | 0 | 73 |
| Cement | 0 | 0 | 8 | 8 | 0 | 0 |
| Steel | 120 | 6 | 0 | 6 | 0 | 120 |
| Building modules | 0 | 0 | 4 | 0 | 4 | 0 |

The same test verifies the exact chain:

```text
forest extraction -> logs
logs -> structural timber
quarry extraction -> limestone aggregate
limestone aggregate -> cement
port import -> steel
structural timber + cement + steel -> building modules
town consumption -> explicit sink
```

Every internal transfer is quantity-preserving. Extraction/import and
consumption are represented by explicit receipts; processing inputs and outputs
are represented by exact recipe deltas.

The finance portion starts at £500,000 and records ledger amounts
`[500000, -20000, 1200, -300]`. Closing cash is £480,900 and equals the ledger
sum. The tick 1–3 P&L is:

| Revenue | Operating expenses | Operating profit | Capital expenditure | Cash flow |
| ---: | ---: | ---: | ---: | ---: |
| £1,200 | £300 | £900 | £20,000 | -£19,100 |

Construction capital expenditure is therefore included in cash flow but
excluded from operating profit.

## Automated verification

All final commands were run on Windows 11 from `codex/full-game`.

| Gate | Exact result |
| --- | --- |
| `npx jest tests/integration/ConstructionSupplyEconomy.test.ts --runInBand --coverage=false` | 1 suite, 2 tests passed |
| `npm test -- --runInBand` | 84 suites, 1,262 tests passed; 96.05% statements, 88.60% branches, 90.50% functions, 96.05% lines |
| Construction preview benchmark inside Jest | 500 proposals; p95 0.996 ms against the 8 ms local target |
| `npx playwright test --retries=0` | 33 browser tests passed with zero retries in 3.1 minutes |
| `npm run benchmark:construction-drag` | 500 samples; p95 0.4000000059604645 ms against the 16 ms target |
| `npm run benchmark:world-generation` | Seed `playtest-884`; 73.90000000596046 ms against the 2,000 ms target; opportunity resolved on attempt 12 of 12; 21 economy candidates evaluated; deterministic replay passed |
| `npm run build` | Production build passed in 8.782 seconds |
| `git diff --check` | Passed with no output |
| `git status --short` | Clean before evidence drafting |
| `rg -n "console\.(log\|debug)" src tests` | No matches (`rg` exit 1 is the expected no-match status) |

Browser benchmarks used Chromium 148.0.7778.96 on an AMD Ryzen 9 7900X
12-Core Processor. The bounded generation caps remain 12 opportunity attempts,
256 site candidates, 256 economy candidates, and 96 construction-analysis
samples.

Candidate `c51c521` adds load-bearing inspector inventory and local-quote
assertions to every fixed-seed presentation case. At that candidate,
`npx playwright test tests/e2e/generated-economy-presentation.test.ts
--retries=0` passed 4/4 with one worker and zero retries,
`npx jest tests/unit/FacilityInspector.test.ts --runInBand --coverage=false`
passed 1/1 suite and 5/5 tests, and `npm run build` passed. This updates
candidate attribution only; the exact final reviewed source and independent
review disposition remain pending controller re-review.

## Fixed-seed generated-economy playtest

The durable browser playtest uses these fixed seeds:

- `economy-presentation-017` at desktop and 375×667;
- `economy-presentation-113` at desktop;
- `economy-presentation-271` at desktop.

All four cases passed. Observations:

- each generated world contains exactly seven facilities and no player track
  or trains;
- Managed Forest and Sawmill match the two generated starter-opportunity sites;
- each seed exposes at least one initial forest-to-sawmill corridor whose
  estimated cost is within starting company cash;
- Operate mode advances Managed Forest logs and Quarry aggregate through fixed
  recipe ticks while Sawmill remains visibly blocked with `Needs logs`;
- switching back to Build mode stops economy time, saves the exact tick,
  inventory quantities, recipe progress, and blocker, and a reload restores
  those values exactly;
- a staged near-capacity copy of generated seed
  `economy-presentation-017` started at 232/240 logs and 290/300 aggregate,
  reached exactly 240/240 and 300/300 through real Operate ticks, stopped
  advancing when paused, and showed `Output storage full` in the Managed Forest
  inspector;
- the facility inspector remains open after map selection and reports the
  facility name, blocker, inventory, and quote information;
- at 375×667 the inspector and company HUD remain inside the viewport, the
  mobile layout is selected, and neither document nor body overflows
  horizontally.

The playtest stages only the near-capacity inventory quantities to avoid a
90-second wall-clock wait. Saturation itself is reached by the real fixed-tick
economy and is not written directly.

## Failure and correction record

- The required integration-test path initially returned `No tests found`
  (exit 1). After authoring the full gate, its first compile exposed three
  test-only boolean-narrowing errors. Matching the established
  `result.ok === false` pattern produced the focused green result of 2/2 tests.
- The first complete browser run passed 30/31. The existing low-cash fixture
  changed `company.cash` to £1 without changing its opening ledger entry, so
  schema 6 correctly rejected the persisted state during reload. The fixture
  now sets both cash and its opening ledger amount to £1. The failed case then
  passed 1/1, and the full suite passed first at 31/31 and finally at 33/33
  after multi-seed coverage was added.
- An earlier browser attempt reused a day-old local server on port 8080 that
  served a temporary review build. The two exact stale rail-sim server
  processes were stopped before the clean-server gate. This was environmental
  and required no source change.
- Review fix candidate `c51c521` strengthened the generated-economy browser
  helper to assert two Sawmill inventory rows, quantity/capacity text and
  progress values, two local quote cards, numeric GBP unit quotes, and all
  three quote explanations. Its focused build, 4/4 zero-retry browser cases,
  and 5/5 FacilityInspector unit tests passed.

No production implementation file required tuning during the Task 9
generated-economy playtest.

## Known warnings

- The Jest suite deliberately exercises a failed localStorage write and emits
  `SaveService: failed to save world to localStorage` through `console.warn`.
  The test passes and verifies the failure path.
- Webpack succeeds with three existing performance warnings: the 1.4 MiB
  entrypoint and several legacy source textures exceed its recommended asset
  size. These are recorded rather than hidden or expanded into Task 9 scope.
- Git on Windows reports that touched LF test files may be converted to CRLF
  when Git next writes them. `git diff --check` remains clean.

## YAGNI deferrals

Milestone 2A intentionally does not add cargo vehicles, loading/unloading,
services, contracts, consist editing, facility expansion/closure, town growth,
loans, taxes, depreciation, perishability, global shocks, or additional
products. Port export remains a validated explicit boundary supported by the
headless system; the initial full-chain gate uses town consumption as its final
explicit sink.

## Review record

The Task 9 reviewer found one Important test-quality gap: the browser playtest
opened the facility inspector but did not assert its inventory and quote
content. Commit `c51c521` added snapshot-derived quantity/capacity, progress,
numeric unit-quote, and factor-explanation assertions across all three seeds
and the mobile case. Scoped re-review marked the finding addressed with no new
Critical or Important breakage.

The final reviewer examined the exact Milestone 2A range from published
Milestone 1 commit `52a31ad` through `c51c521`. Product conservation, atomic
recipes and transfers, explicit boundaries, market bounds, ledger/cash
equality, P&L classification, deterministic blank-world generation, fixed
ticks, construction compatibility, and UI input capture were approved except
for two Important schema gaps:

- facility instance IDs were unique, but duplicate facility definition IDs
  could still pass validation;
- `paidBuildCost` accepted integers outside JavaScript's safe range, while the
  demolition refund path correctly rejected them.

Commit `4fe2839` enforces unique facility definitions and non-negative safe
build costs, with regression and boundary tests. The scoped final re-review
marked both Important findings and the stale evidence attribution addressed,
with no new Critical or Important breakage.

The exact reviewed source is `4fe2839`. There are no open Critical or Important
review findings.

## Publication

Reviewed source `4fe2839` was pushed to the existing Sites source repository
and built from an isolated archive of that exact commit. Sites saved private
version 4, deployed it to terminal `succeeded` status, and opened the production
URL in Codex:

https://rail-sim-progress.jt-98.chatgpt.site
