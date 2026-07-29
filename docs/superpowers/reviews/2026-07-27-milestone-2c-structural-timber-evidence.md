# Milestone 2C structural-timber link evidence

**Candidate implementation head:** `6799f811c5dc59bc96fb8459671c81d1adee623d`

**Candidate review range:** `9119189..6799f81`

**Sites project:** `appgprj_6a649579a6a081919bdbc5bdc7d9d101`

This record assembles the schema, product-aware freight, progression,
generated-world, browser-playthrough, performance, independent-review, and
release-gate evidence for the second profitable freight link. The evidence
commit and Sites version are intentionally created after this implementation
SHA; publication identifiers are recorded by the subsequent deployment
execution.

## Player outcome

Milestone 2C continues the generated blank sandbox rather than supplying a
scenario or prebuilt railway. After completing the first profitable log route,
the player:

1. receives one canonical £250,000 regional-development grant;
2. sees the objective advance to **Extend the timber chain**;
3. runs two complete 60-unit log consignments to feed the Sawmill;
4. waits for the recipe-driven Sawmill to produce structural timber;
5. compares terrain-aware construction feedback and builds a connected
   Sawmill-to-Prefabrication Plant extension;
6. buys and places a General Flatbed Set when another train is useful;
7. loads and drives structural timber over player-built track;
8. pays active-train running costs and earns batch-priced delivery revenue;
9. completes the objective only after a profitable structural-timber delivery;
10. is told that prefabrication still awaits cement and steel, establishing the
    next organic supply-chain challenge.

Worlds still begin with zero player tracks, junctions, stations, trains, or
services. The generator places seven economic facilities and opportunities,
but never persists a solved route or gives the player a premade railway.

The General Flatbed Set is product-aware rather than timber-specific. Its
capacity is derived from product mass/volume rules, and load/unload
eligibility is derived from facility recipes and inventories. Consignment
origin, capacity, blockers, revenue, running costs, lifetime results, objective
flags, and the development grant remain authoritative across save/reload.

## Headless full-chain reconciliation

`tests/integration/StructuralTimberLink.test.ts` commits generated construction
through the public quote/command APIs, purchases real freight sets, performs
fixed-tick cargo and recipe work, saves and reconstructs managers between
journey phases, and reconciles the complete authority:

- two 60-unit log deliveries and one 60-unit structural-timber delivery;
- 18 unique 10-unit unloading batches;
- £24,770 total batch revenue;
- £80 running expense from four deliberately active ticks;
- £723,843 capital expenditure including the flatbed;
- one £250,000 grant, posted exactly once;
- £550,847 closing cash, independently reconciled as
  `£1,000,000 - £723,843 + £24,770 + £250,000 - £80`;
- 180 lifetime delivered units;
- 120 logs out of the Forest and into the Sawmill;
- 60 structural timber out of the Sawmill and into Prefabrication.

Cement and steel remain zero and the Prefabrication recipe remains blocked.
That is an explicit current challenge, not a hidden completion shortcut.

## Fresh pre-evidence verification

Every accepted command in this table ran on Windows 11 from clean
implementation head `6799f81`.

| Gate | Exact result |
| --- | --- |
| `npx jest --runInBand --coverage` | 106/106 suites and 1,776/1,776 tests passed in 427.835s; 96.82% statements, 89.23% branches, 91.78% functions, 96.82% lines |
| Construction preview benchmark inside Jest | 500 proposals; p95 1.912ms against the 8ms local target |
| `npm run build` | Production build passed; `main.js` 1.48 MiB; three recorded webpack performance warnings |
| `npm run build:test-controls` | Test-control build passed with the same three recorded performance warnings |
| `$env:PLAYWRIGHT_PORT='42359'; npx playwright test --workers=1` | 45/45 browser tests passed in 40.4 minutes with one worker, native exit 0, and no retry entries |
| `npm run benchmark:construction-drag` | 500 samples; p95 0.5ms against the 16ms target |
| `npm run benchmark:world-generation` | 284/284 seeds `playtest-601..884` resolved; none exhausted; selected worst-work seed `playtest-666` took 136.5ms; slowest audited seed took 169.5ms against the 2,000ms target |
| Generation bound audit | Maximum resolved attempt 3, maximum economy evaluations 5, maximum total economy candidates 1,155, maximum joint work units 1,762, deterministic replay passed |
| `npx jest tests/performance/EconomyTickBenchmark.test.ts --runInBand --coverage=false` | 12 trains, 7 facilities, 500 measured ticks; p95 13.822ms against the 16ms target; deterministic 600-tick hash `0284c75e` |
| `npx jest tests/unit/WebpackTestControls.test.ts tests/unit/WorldSceneEditorGuards.test.ts tests/unit/WebShell.test.ts --runInBand --coverage=false` | 3/3 suites and 77/77 tests passed |
| `git diff --check` | Passed with no output |
| `git status --short` | Clean before evidence drafting |

The standalone browser benchmarks used Chromium 148.0.7778.96 on an AMD
Ryzen 9 7900X 12-Core Processor. Generation remains explicitly bounded to 12
opportunity attempts, 256 site candidates per attempt, 256 economy candidates
per evaluation, and 96 construction-analysis samples.

The production webpack path does not expose the privileged `__railSim*`
mutation/control surface. The test-control build enables only the named
browser-test controls, and the 77-test security/control matrix verifies the
production/test split, editor guards, and web shell.

## Three-seed real browser playthrough

All structural journeys started from a newly generated world and used real
pointer placement, real keyboard train control, authoritative fixed economy
ticks, real save/reload, and public UI flows. The tests did not inject tracks,
cash, cargo, facility inventory, progress flags, or completed objectives.

| Seed / viewport | Result |
| --- | --- |
| `playtest-753`, desktop | 318 ticks; 2 player tracks; £129,589 extension; £28,940 delivery revenue; £5,920 running cost; £928,233 closing cash; passed in 7.5m |
| `real-terrain-alpha`, desktop | 482 ticks; 3 player tracks; £32,815 extension; £27,020 delivery revenue; £8,860 running cost; £963,176 closing cash; passed in 10.2m |
| `first-route-browser-gamma`, 375×667 mobile | 542 ticks; 3 player tracks; £14,774 extension; £26,320 delivery revenue; £10,040 running cost; £848,228 closing cash; passed in 11.2m |

The separate actual-keyboard first-route journey completed purchase-to-unload
in 191.579s with £6,620 revenue and £3,520 running cost.

Every observed structural train maximum speed remained below the 72-unit
safety bound. Recorded maxima ranged from 59.37 to 61.64. The recovery helper
uses only bounded 20ms real-key pulses; it cannot write train position,
velocity, cargo, tick, cash, or objective state.

Mobile evidence additionally verifies:

- the objective and facility inspector do not occlude each other;
- every facility decision section can be scrolled into reach;
- pause owns the screen and can return from an open train inspector;
- purchase and placement controls remain reachable;
- track placement begins on clear canvas below the objective;
- cargo survives derail/re-rail and controls remain input-safe;
- there is no horizontal document/body overflow.

## Economy performance disposition

The first full coverage attempt preserved hash `0284c75e` but measured
19.941ms p95 because Jest's V8 precise-coverage profiler instruments the timed
production call. A fresh uninstrumented run then exposed a narrow 16.912ms
outlier. The 16ms requirement was not relaxed.

A CPU profile attributed most work to redundant deep cloning and structural
equality. Commit `6799f81` removes only duplicate clones between deeply frozen
cargo/running-cost proposals while retaining the mutable economy copy,
transaction validation, rollback, final authoritative clone, and deterministic
ordering. `equalPlainData` now compares own-key sets without recursively
sorting both key arrays.

Three consecutive uninstrumented review runs passed at 14.350ms, 14.060ms,
and 14.397ms; the final gate passed at 13.822ms with the same hash. A custom
Jest node environment reads `globalConfig.collectCoverage`: coverage mode
still executes and verifies the entire 1,200-update correctness workload,
states, revisions, finite telemetry, and deterministic hash, while only the
dedicated uninstrumented command judges the production timing budget.

Independent performance review approved the isolation and atomicity of this
change. Focused EconomySystem, CargoSystem, RunningCostSystem, WorldManager,
and PlainData verification passed 156/156 tests, and the reviewer separately
passed 93 targeted tests plus three 14.17–14.40ms budget repetitions.

## Failure and correction record

- The browser generation audit initially failed because its exact fixture
  still expected obsolete maxima from an earlier generator. Fresh repeated
  audits agreed on attempt/evaluation/candidate/work-unit maxima
  `3 / 5 / 1,155 / 1,762` and worst-work seed `playtest-666`. Independent
  review confirmed stale evidence rather than a regression; the runner now
  asserts the independently computed maxima and the seed's actual
  `4 evaluations / 994 candidates` without conflating them.
- The jsdom harness duplicated Chromium's 2,000ms requirement and produced
  2.18–2.58s instrumentation outliers while real Chromium stayed near
  0.15s. The jsdom test now verifies finite timing telemetry and all semantic
  bounds; the unchanged browser runner remains the sole 2,000ms acceptance
  gate.
- The first final Playwright attempt completed 42 tests, including the entire
  26.9-minute structural file, before its fixed-port preview server vanished.
  The final three Task 9 cases and retries received only
  `ERR_CONNECTION_REFUSED`. A separate Windsurf worktree began using the same
  default port at the failure boundary. No product assertion failed.
- All four Task 9 tests then passed in 56.8s with retries disabled on a unique
  port. A subsequent foreground full run was terminated by the command
  transport before Playwright could finalize metadata and is not claimed.
  The accepted full run used the configuration's supported
  `PLAYWRIGHT_PORT` override in an independent hidden process with separate
  stdout, stderr, and exit-code files. It completed 45/45 with native exit 0.
- A PowerShell `Tee-Object` wrapper treated Jest's normal stderr progress as a
  terminating native-command error. That partial run is not claimed. The exact
  Jest command was rerun directly and passed 106/106.

## Review record

At least three independent final reviewers covered:

- specification, architecture, schema, transaction boundaries, and YAGNI;
- economy conservation, ledger/P&L, persistence, and deterministic authority;
- browser UX, mobile/accessibility, real input, security controls, and
  playthrough evidence.

They approved the final implementation after verified fix waves. Significant
review findings addressed during the milestone include:

- fail-closed malformed facility, cargo, progression, and generated-site
  validation;
- transaction-wide rollback on fatal freight/progression failures;
- detached and independently revalidated generated opportunity/economy data;
- one exact grant and honest operating-profit/capex classification;
- shared recipe-derived cargo eligibility and visible product-aware feedback;
- exact batch/ledger/cash reconciliation in the integration journey;
- mobile panel occlusion, scroll reachability, purchase focus, camera
  ownership, clear-canvas placement, and return-to-menu state;
- real-pointer construction framing across terrain and viewport variants;
- bounded real-tick train recovery with an enforced maximum speed;
- honest separation of instrumented correctness checks from browser/runtime
  performance gates.

The final economy optimization review and world-generation fixture review both
reported **APPROVED** with no blockers. There are no open Critical or Important
review findings.

## Known warnings

- Jest deliberately exercises a failed localStorage write and emits
  `SaveService: failed to save world to localStorage`; the passing test verifies
  that failure path.
- Webpack succeeds with three existing performance warnings: the 1.48 MiB
  entrypoint and several legacy source textures exceed its recommended asset
  size. Asset optimization remains a separate measured task rather than being
  hidden or expanded into this gameplay milestone.
- Git on Windows may warn that touched LF files will be converted to CRLF when
  Git next writes them. `git diff --check` is clean.

## YAGNI deferrals

Milestone 2C intentionally does not add migrations, scenarios, contracts,
services, timetables, signals, routing automation, consist editing, loans,
taxes, depreciation, facility expansion/closure, town growth, global shocks,
perishability, or speculative content frameworks.

The seven-facility construction economy already contains Quarry, Cement
Works, Port Interchange, Prefabrication Plant, and Town Construction Market,
but this milestone exposes only the next structural-timber link as a polished
player objective. The next slice will make Quarry-to-Cement a full player-run
challenge before expanding toward steel, modules, town demand, and eventually
hundreds of simultaneous products and trains.

## Publication handoff

The verified implementation is ready to be rebuilt in production mode, pushed
as the exact Sites source state, saved as a private version, deployed, and
smoke-tested at:

https://rail-sim-progress.jt-98.chatgpt.site

