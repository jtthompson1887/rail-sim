# Milestone 2B first profitable freight route evidence

**Candidate implementation head:** `7dfb161907308bd7fa2bad6633914e3ff0faed75`

**Candidate review range:** `e1fcb26..7dfb161`

**Sites project:** `appgprj_6a649579a6a081919bdbc5bdc7d9d101`

This record assembles the schema, operations, generated-route, browser,
agent-operated real-time playtest, review, and release-gate evidence for the
first complete freight-management loop. The evidence commit and Sites version
are intentionally created after this implementation SHA; the Sites version,
deployment ID, terminal status, and production URL are reported by the
publication execution record because they do not exist at evidence-draft time.

## Player outcome

Milestone 2B starts from a generated blank sandbox with no player track,
vehicle, station, service, solved route, scenario, or contract. The player:

1. compares terrain-aware direct and detour corridors;
2. builds a connected Managed Forest-to-Sawmill route;
3. preserves a £110,000 train-and-operating reserve;
4. buys and places a £90,000 Timber Freight Set;
5. loads 60 tonnes of logs in six fixed-tick batches;
6. drives the train with W/S over the player-built route;
7. unloads against six pre-batch local quotes;
8. pays per-active-tick running costs and sees operating profit;
9. supplies the Sawmill, which processes logs into structural timber;
10. repeats and preserves the route through save/reload and derail recovery.

The compact objective card guides this organic sandbox loop without supplying
a prebuilt world or cash reward. Completion permanently latches only after a
profitable delivery.

The immutable freight catalogue contains exactly one SKU, Timber Freight Set:
£90,000 purchase price, 60-log capacity, and £20 per active fixed tick. The
player may purchase multiple instances when cash and valid track placement
permit; one purchase creates one aggregate physics follower.

## Automated verification

All final commands in this section ran on Windows 11 from implementation head
`7dfb161`.

| Gate | Exact result |
| --- | --- |
| `npm test -- --runInBand` | 101/101 suites and 1,579/1,579 tests passed in 308.009s; 96.51% statements, 88.48% branches, 91.41% functions, 96.51% lines |
| Construction preview benchmark inside Jest | 500 proposals; p95 1.973ms against the 8ms local target |
| `npx playwright test --retries=0 --workers=1 --reporter=line,junit` | Hermetic current-source build; 36/36 browser tests passed with zero retries in 8.5 minutes |
| Actual-keyboard browser journey | Purchase-to-unload 195.926s; £6,540 revenue; £3,580 running cost; £2,960 operating profit; generated estimate equalled authoritative paid cost |
| `npm run benchmark:construction-drag` | 500 samples; p95 0.5ms against the 16ms target |
| `npm run benchmark:world-generation` | Worst audited seed `playtest-753` completed in 58.4ms against the 2,000ms target; 284/284 seeds `playtest-601..884` resolved, none exhausted, maximum resolved attempt 11/12, deterministic replay passed |
| `npm run build` | Production build passed in 13.256s |
| `git diff --check` | Passed before evidence drafting |
| `git status --short` | Clean before evidence drafting |
| `rg -n "console\.(log\|debug)" src tests` | No matches |

The standalone benchmarks used Chromium 148.0.7778.96 on an AMD Ryzen 9
7900X 12-Core Processor. Generation remains bounded to 12 opportunity attempts,
256 site candidates, 256 economy candidates, and 96 construction-analysis
samples.

The final browser JUnit artifact is retained locally at
`.superpowers/sdd/2026-07-26-milestone-2b-first-freight-route/manual-evidence/final-e2e-7dfb161907308bd7fa2bad6633914e3ff0faed75.xml`.
It records 36 tests, zero failures, and 512.88864 seconds; SHA-256
`CFC51F052735461D43EA72F33F1524899456E3DFF029C4D15930FD09D4B64BF2`.
Playwright first rebuilt the exact current source with explicit test controls,
served it on dedicated port 41719, and refused existing-process reuse.

Webpack reports the three existing performance warnings for the 1.46MiB
entrypoint and legacy oversized image assets. The production build succeeds;
these asset warnings are recorded rather than expanded into freight-loop scope.
Jest intentionally exercises failed localStorage persistence and emits the
expected `SaveService: failed to save world to localStorage` warning while
verifying the recovery path.

The prescribed legacy-authority scan has two literal matches:
`WorldData.ts:616` rejects legacy `passengers`, and `WorldData.ts:824` rejects
legacy `economyRevision`. Both are negative schema guards, not retained
authority or compatibility code. There are no legacy matches in the freight
operations, serializer, manager, loader, or scene authority paths.

## Collective generated-seed browser acceptance

The dedicated first-route browser cases use:

- `real-terrain-alpha` for the actual-keyboard real-time desktop trip;
- `first-route-browser-beta` for exact transfers, four reload phases, and
  three controlled repeat cycles;
- `first-route-browser-gamma` for mobile interaction, derail/re-rail cargo
  retention, and input-safe layouts.

Collectively these cases prove zero initial player assets, cheapest-corridor
affordability with the £20,000 reserve, sequential witness construction,
connected-component route readiness, atomic purchase/placement, 60-tonne
loading, movement and access guards, exact partial/final unload pricing,
positive operating margin, Sawmill processing, persistence phases, three
repeat cycles, recovery, and desktop plus 375×667 presentation.

The broader no-retry browser matrix also preserves generated-economy
presentation on `economy-presentation-017`, `economy-presentation-113`, and
`economy-presentation-271`, plus current terrain/cost semantics on
`playtest-040`, `playtest-077`, `playtest-082`, and the naturally unaffordable
direct-route seed `playtest-1468`.

The real-time case changes motion only through `page.keyboard` W/S events. It
does not call `setTrainRuntime` or `advanceFixedTicks`. Its feedback driver uses
short symmetric key pulses during final approach; the stopped, in-radius,
empty-cargo, non-derailed, 120–240s, positive-margin, objective, and HUD
assertions remain production-authoritative.

## Three-seed real-time generated playtest

A separate agent-operated release playtest drove the production UI and physics
with one browser worker and zero retries. This is the project's reproducible
interpretation of the manual-playtest gate: Codex operated the same visible
canvas, purchase panel, and W/S controls a player uses. Each first trip
generated a blank world afresh, built the persisted feasibility witness with
canvas gestures, purchased through the visible panel, loaded in real time,
drove with W/S pulses, unloaded six batches, and observed processing and
profit. These first trips did not call runtime setters or controlled ticks.

After each genuine first delivery, the explicit test-controls build accelerated
the repeat cycle and four save/reload phases through the production
`EconomySystem`, atomic world batch, serializer, and save path. It never wrote
cash, ledger, cargo, facility inventory, or objective authority directly. The
recovery setup used test controls to position and load 60 units; derailment
itself used a real S key and re-railing used the visible drag-to-rail UI. The
run then checked desktop plus 375×667 bounds. The privileged controls are
compile-time absent from the production/Sites bundle.

The counted command at implementation SHA
`7dfb161907308bd7fa2bad6633914e3ff0faed75` was:

```powershell
npm run build:test-controls
$env:TASK15_EVIDENCE_SEEDS='task15-manual-larch,task15-manual-cedar,task15-manual-ash'
$env:TASK15_RESET_OUTPUT='1'
npx playwright test --config=.superpowers/sdd/2026-07-26-milestone-2b-first-freight-route/manual-evidence/playwright.config.js --retries=0 --workers=1
```

The run passed 3/3 in 714.4 seconds. Its local raw artifact is retained at
`.superpowers/sdd/2026-07-26-milestone-2b-first-freight-route/manual-evidence/manual-evidence-counted.jsonl`;
that scratch path is intentionally gitignored, while its hash and all required
raw acceptance figures are embedded below. The config used Chromium with
WebGL and served the explicit exact-HEAD test-controls `dist` built by the
preceding command, with 900-second per-test timeouts, zero retries, and one
worker.

The counted JSONL contains exactly three unique records and no dry/diagnostic
seed. Its SHA-256 is
`D631ADAEFDC09D96103DED971225F1505CE430362A06BC18A31BA5A5EF5C5007`.
`Cruise target` below is the controller target; `peak` is measured physics
speed.

| Seed | Corridor estimate / actual | Post-build cash | Load | Travel | Total purchase-to-unload | Cruise target / peak | First revenue / running / profit | Repeat profit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `task15-manual-larch` | £281,670 / £281,670 | £718,330 | 9.323s | 181.813s | 196.391s | 53.801 / 48.965 | £5,650 / £3,600 / **£2,050** | **£5,050** |
| `task15-manual-cedar` | £81,852 / £81,852 | £918,148 | 9.299s | 207.370s | 221.437s | 31.962 / 39.304 | £5,590 / £4,100 / **£1,490** | **£5,340** |
| `task15-manual-ash` | £73,955 / £73,955 | £926,045 | 9.040s | 157.427s | 172.074s | 45.396 / 41.654 | £6,540 / £3,140 / **£3,400** | **£5,880** |

Exact unload and repeat records:

| Seed | Unload | Six batch revenues | Economy ticks | Repeat revenue / running / profit |
| --- | ---: | --- | --- | ---: |
| `task15-manual-larch` | 5.255s | £990, £970, £940, £940, £920, £890 | 188–193 | £5,610 / £560 / **£5,050** |
| `task15-manual-cedar` | 4.768s | £980, £950, £930, £930, £910, £890 | 213–218 | £5,360 / £20 / **£5,340** |
| `task15-manual-ash` | 5.607s | £1,140, £1,120, £1,090, £1,090, £1,060, £1,040 | 164–169 | £6,560 / £680 / **£5,880** |

Every seed:

- loaded and recovered with exactly 60 cargo units;
- paid exactly the generated corridor estimate and retained the complete
  train-and-operating reserve;
- completed six consecutive unload batches whose sum equals recorded revenue;
- finished inside the 120–240 second target with positive first and repeat
  operating margin;
- retained more than the £20,000 reserve after the train purchase;
- recorded Sawmill log outflow 20 and structural-timber output 16;
- passed mid-load, transit, mid-unload, and completed reload phases;
- preserved cargo through a real S-key derail and visible drag-to-rail
  recovery;
- passed desktop and 375×667 viewport checks.

An earlier pre-release counted attempt was rejected rather than recorded: its evidence
driver tapered below practical speed while still outside the 320-unit Sawmill
access radius. Two seeds timed out around 337–339 units away and one completed
3.896s late, while production remained on-rail. A separate dry seed then proved
the corrected minimum outside-radius approach target end-to-end in 217.934s
with £2,380 first-trip profit. The file was reset before every counted
candidate. After the final release-review fixes, the definitive exact-SHA
three-seed run passed 3/3 in 11.9 minutes with zero Playwright retries.

## Schema, authority, and atomicity

Milestone 2B deliberately makes a clean schema-7 break because there is no
existing player data. There is no migration layer: schema 6 and legacy
`type`/`passengers`/`economyRevision` authority are rejected with the existing
start-new-world path.

Headless coverage proves:

- unique non-empty train IDs; known freight-set/product/origin/facility/track
  references; finite track positions; compatible safe-integer cargo; exact
  operations totals; and the versioned objective latch;
- freight definition → live aggregate train → merged definition round-trips
  without the serializer reconstructing or overwriting cargo/economics;
- `revision = constructionRevision + operationsRevision`;
- one `applyOperationsBatch` clone/validate/install boundary updates company,
  economy, trains, and first-route progress together, while stale or rejected
  candidates leave all authority and revisions unchanged;
- purchase compensation for insufficient cash, stale quote, duplicate ID,
  live spawn failure, partial spawn failure, install failure, and persistence
  failure;
- a failed post-commit save retains the authoritative transaction, reports
  `Unsaved`, and retries that exact state without duplicate purchase, transfer,
  cost, or ledger entry.

## Conservation, pricing, and P&L

The fixed-tick integration matrix proves:

- stopped means zero throttle and speed `<= 2`, with mode, access radius,
  derailment, capacity, compatibility, reservation, and source/destination
  blockers checked before transfer;
- each train performs at most one transfer of at most 10 units per tick;
- forest inventory → train cargo → Sawmill inventory conserves exact log units,
  including partial source and destination capacity;
- each unload uses the destination's pre-batch quote and pays only accepted
  units;
- train statistics receive exact per-set cost while the company receives one
  aggregate running-cost ledger entry per active tick;
- insolvency stops affected trains and posts no unpaid cost;
- final unload rolls current totals into last-trip/lifetime totals, starts the
  next trip, and latches the objective only for positive operating profit;
- the inclusive 24-tick summary uses `max(0, t - 23)..t`, includes current-tick
  entries, and excludes vehicle/track capital expenditure from operating
  profit;
- catch-up commits at most four ordered fixed ticks and requests one save of
  the final authoritative state.

Exact reload assertions cover mid-load, transit, mid-unload, completed
delivery, and recovered states, including cash, ledger, facilities, cargo,
origin, trip/lifetime totals, tick, track UUID, `trackT`, facing, and objective
latch.

## Track generation, construction, and long-train handoff

The current generator emits sequentially constructible multi-segment detours:
each later witness starts at the exact endpoint installed by the prior segment.
Construction still calculates real terrain, track, earthwork, bridge, tunnel,
and topology costs; persisted witness estimates remain generation-time
guidance, while the purchase uses the live authoritative quote.

Track guidance assigns front and rear contacts independently and advances each
through an ordered route queue. A 345.75-unit rendered locomotive may straddle
several overlapping short segments without losing its route, snapping back,
receiving a full-force direction reversal, or releasing until both contacts
have migrated and corridor guards pass. The full real-time browser and
three-seed playtests exercise these handoffs on player-built routes.

## Failure and correction record

- Sequential witness routes initially exposed generated endpoint drift and
  non-buildable second segments. The generator now persists exact handoff
  endpoints; construction-loop and four terrain/cost playtests build the
  persisted witnesses rather than inventing arbitrary extensions.
- Production-sized locomotives exposed a long-body A→B→C handoff gap hidden by
  an undersized unit mock. Ordered per-contact queues and bounded blended
  guidance fixed the production behavior; focused tests, a full live coasting
  diagnostic, the real-time browser journey, and counted playtests passed.
- The first refreshed full browser run passed 35/36. The acceptance driver
  could hold W for a full poll after an S reverse-brake pulse and accelerate
  off the route endpoint. Short symmetric W/S pulses with a 34–42
  outside-radius band retained all original acceptance assertions. The exact
  case then passed in 208.724s, and that pre-release suite passed 36/36.
- Generator changes intentionally invalidated stale hard-coded browser
  gestures and seed expectations. Fixtures now build exact persisted
  witnesses, use current semantic cost seeds, advance four deterministic
  economy ticks, and pan mobile through the same primary-pointer branch used by
  touch. The refreshed 11-case slice passed with zero retries and independent
  review found no hidden production defect.
- The counted evidence taper defect and disposition are recorded in the
  three-seed section above. Failed attempts produced no counted record.
- Final release review found that direct Playwright could reuse stale port 8080
  state. The config now builds current test-controls source itself, uses a
  dedicated configurable port, refuses reuse, and emits the SHA-named JUnit
  artifact recorded above.
- Review also found a £372 estimate/paid discrepancy. Systematic tracing proved
  that a browser pointer landed 1.86 world units from a non-grid generated
  waypoint. `PlaceTrackTool` now magnetizes only near-pixel starter gestures to
  the exact persisted waypoint before normal snapping. Generation seeds and
  costs remain unchanged; affected browser acceptance now requires
  authoritative paid cost to equal the generated estimate.
- Privileged browser managers and mutation controls previously shipped as
  globals. They now require the explicit compile-time test-controls flag.
  Production build scanning found zero of eight privileged names, while the
  hermetic test build retained all acceptance coverage.
- The first post-fix full Jest attempt passed 100/101 suites; only
  `WebShell.test.ts` still treated the new webpack config factory as an object.
  The contract test now instantiates the production config. The definitive
  rerun passed 101/101 suites and 1,579/1,579 tests.

## Independent review

Every implementation task received independent specification and code review.
The milestone range review and follow-up reviews produced fixes for schema
authority, purchase cleanup, generated-route acceptance, sequential
constructability, production-sized long-train handoff, and browser-fixture
fidelity.

The first release review of `e1fcb26..9e59bee` returned three Important
findings: browser gates could reuse stale build/server state, generated route
estimates were not yet proven equal to authoritative pointer-built cost, and
privileged test controls shipped in the production bundle. Commits `a410284`,
`89c0cb6`, `6acd465`, and `7dfb161` made browser execution source-hermetic,
compile-time excluded privileged globals from production, aligned near-pixel
starter gestures to the persisted witness, strengthened exact cost/reserve
proof, and updated the webpack contract test.

The strict scoped re-review marked all three Important findings resolved with
no Critical or Important remainder. A second independent reviewer approved the
release-fix delta `9e59bee..7dfb161` with no Critical, Important, or Minor
findings and independently passed 7/7 suites and 96/96 tests. The factual
evidence audit reconciled both artifact hashes, all gate totals, all three seed
records, batch sums, reserves, trip components, and classification of genuine
first trips versus accelerated post-delivery coverage. There are no open
Critical or Important findings on exact range `e1fcb26..7dfb161`.

## YAGNI boundary

Milestone 2B implements exactly one organic timber freight loop and the
architecture it currently needs. It does not add scenarios or prebuilt worlds,
contracts, deadlines, bonuses, cargo purchasing, services, schedules,
automatic routing, signals, consist editing, separately simulated wagons,
multiple locomotive SKUs, maintenance, fuel, paid recovery, loans, taxes,
depreciation, bankruptcy, facility growth, global shocks, or parallel
aggregate/cement/steel/module player flows.

Those remain later milestones. The schema-7 freight aggregate, atomic
operations batch, fixed-tick economy, ledger, connectivity, presentation, and
persistence boundaries are the deliberate foundation for the eventual
hundreds-of-products network without speculatively implementing it here.
