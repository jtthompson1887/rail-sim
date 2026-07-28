# Milestone 2D cement supply-chain evidence

**Candidate implementation head:** `de12bef7405671b7b8021fa15ccd2e53d0593896`

**Candidate review range:** `7a00c73..de12bef`

**Sites project:** `appgprj_6a649579a6a081919bdbc5bdc7d9d101`

This record assembles the product, vehicle, processing, construction,
generated-world, browser-playthrough, performance, independent-review, and
release-gate evidence for the first mineral supply chain. The evidence commit
and Sites version are intentionally created after the implementation SHA;
publication identifiers are recorded by the deployment execution.

## Player outcome

Milestone 2D keeps the generated blank sandbox: there are no scenarios and no
prebuilt tracks, junctions, stations, trains, or services. A new world places
economic facilities and presents opportunities, but the player must survey
the terrain, finance every railway asset, and operate every freight movement.

After establishing the timber link, the player:

1. sees **Supply the cement works** and clear Quarry-to-Cement guidance;
2. compares terrain-aware construction previews and builds a viable mineral
   link for no more than £180,000;
3. buys an Aggregate Hopper Set with a 120-ton capacity and £20 active-tick
   running cost;
4. loads limestone aggregate at the Quarry and delivers it to Cement Works;
5. waits 40 economy ticks while the kiln converts exactly 120 tons of
   aggregate into 80 tons of cement;
6. builds the onward link to the Prefabrication Plant;
7. buys a Covered Cement Set with an 80-ton capacity and £22 active-tick
   running cost;
8. moves the complete cement output to Prefabrication;
9. sees honest per-trip revenue, running expense, profit or loss, lifetime
   delivered quantity, and the next remaining production-chain blocker.

The Aggregate Hopper Set costs £110,000 and the Covered Cement Set costs
£105,000. The generated starter corridor is capped at £400,000 and the
required mineral links at £180,000. Prices, recipes, and grants were not
relaxed to make fixture worlds pass.

## Full-chain reconciliation

`tests/integration/CementSupplyChain.test.ts` constructs both links through the
public construction authority, purchases the real freight sets, performs
authoritative load/drive/unload work, advances the recipe with fixed economy
ticks, saves and reconstructs world authority between journey phases, and
proves:

- one 120-ton aggregate consignment enters Cement Works;
- the kiln consumes exactly 120 tons and produces exactly 80 tons of cement
  after 40 ticks;
- one 80-ton cement consignment enters Prefabrication;
- no material is duplicated, lost, or silently rounded across inventory,
  cargo, recipe, and persistence boundaries;
- train operating expenses post only while active;
- delivery revenue, operating expense, capital expenditure, grants, and cash
  remain separate ledger classifications;
- `Rail profit` includes freight revenue minus running expenses, never the
  regional-development grant;
- closing cash reconciles to opening cash, capital expenditure, freight
  revenue, grants, and operating expenses;
- a deliberately unprofitable trip remains a visible loss rather than being
  hidden by a grant or lifetime total.

Prefabrication remains blocked by its other missing inputs after cement
arrives. That is the next organic supply-chain challenge, not a shortcut or
premature completion state.

## Fresh pre-evidence verification

Every accepted command in this table ran on Windows 11 from clean
implementation head `de12bef`.

| Gate | Exact result |
| --- | --- |
| `npx jest --runInBand --coverage` | 110/110 suites and 1,911/1,911 tests passed in 1,618.285s; 96.99% statements, 89.53% branches, 92.31% functions, 96.99% lines |
| Construction preview benchmark inside Jest | 500 proposals; p95 1.244ms against the 8ms local target |
| `npx tsc --noEmit` | Passed with native exit 0 |
| `npm run build` | Production build passed in 10.9s with only three recorded webpack asset/entrypoint warnings |
| `npm run build:test-controls` | Test-control build passed in 10.6s with the same three recorded warnings |
| `npx playwright test --workers=1 --retries=0` | 48/48 browser tests passed in 1,953.1s (32.5 minutes) with native exit 0 and no retries |
| `npm run benchmark:construction-drag` | 500 samples; p95 0.400ms against the 16ms target |
| `npm run benchmark:world-generation` | 284/284 seeds `playtest-601..884` resolved; none exhausted; slowest selected seed `playtest-825` took 1,699.3ms against the exact 2,000ms target |
| Generation bound audit | Maximum resolved attempt 26, maximum economy evaluations 81, maximum total economy candidates 20,736, maximum joint work units 27,392, deterministic replay passed |
| `npx jest tests/performance/EconomyTickBenchmark.test.ts --runInBand --coverage=false` | 12 trains (4 flatbeds, 4 aggregate sets, 4 cement sets), 7 facilities, and 500 measured ticks; p95 8.841ms against the 16ms target; deterministic 600-tick hash `6b45cd75` |
| `npx jest tests/unit/WebpackTestControls.test.ts tests/unit/WorldSceneEditorGuards.test.ts tests/unit/WebShell.test.ts --runInBand --coverage=false` | 3/3 suites and 89/89 tests passed |
| `git diff --check` | Passed with no output before evidence drafting |
| `git status --short` | Clean before evidence drafting |

The standalone browser benchmarks used Chromium 148.0.7778.96 on an AMD
Ryzen 9 7900X 12-Core Processor. The 284-seed audit also bounded maximum
prefabrication analyses at 1,070, maximum mineral-pair analyses at 1,381, and
pair-cap hits at one per resolved seed. Generation remains explicitly bounded
to 26 opportunity attempts, 256 site candidates, 256 economy candidates, and
96 construction-analysis samples. Every audited world was blank, deterministic,
and supplied both a buildable cement witness and the existing timber
opportunity.

The production webpack path does not expose the privileged `__railSim*`
mutation/control surface. The test-control build enables only named browser
test controls; the 89-test security/control matrix verifies the production
split, editor guards, and web shell.

## Real browser evidence

The primary cement playthrough starts from a newly generated world and uses
real pointer track placement, public vehicle purchase and placement flows,
real keyboard train control, authoritative economy ticks, and visible
objective/UI state. It completes the aggregate delivery, kiln processing, and
cement delivery in approximately four minutes without injecting track, cash,
cargo, facility inventory, or completion flags.

The full 48-test browser gate additionally proves:

- both profitable and deliberately loss-making mineral trips are explained;
- aggregate and cement vehicle choices remain usable on desktop and mobile;
- track previews on sloped terrain expose earthworks, bridge, tunnel, grade,
  affordability, and route-tradeoff feedback;
- the four construction playtest witnesses cover cheap surface work,
  earthworks-heavy routing, tunnel/bridge routing, and an unaffordable
  surface proposal;
- legacy timber and first-route journeys still work after the joint
  timber/mineral generation contract;
- menus, pause, inspectors, objectives, placement controls, and derail/re-rail
  interactions remain reachable and input-safe.

The final construction witnesses use deterministic generated seeds
`playtest-632`, `playtest-601`, `playtest-657`, and `playtest-607`. Their
assertions use current terrain quotations rather than obsolete pre-cement
generator coordinates.

## Failure and correction record

- The first joint generator passed the cement link but stale tests still
  expected the old timber-only Larch corridor and £890,000 cap. The exact
  failures were reproduced; contracts now reference the exported £400,000
  cap and include prefab/mineral diagnostics.
- A first attempt at bounding candidate callbacks incorrectly treated 26
  opportunity attempts as the full nested search bound. A reject-all test
  observed 355 callbacks. The corrected test proves the real bounded contract:
  greater than 26 but no more than `26 × 24 = 624`.
- Architecture/economy review found that a browser helper described regional
  grants as `Rail profit`. A grant inside the 24-tick observation window
  reproduced the incorrect £257,080 expectation versus the truthful £7,080
  UI value. The helper now uses delivery revenue minus active running expense;
  grants remain visible under Development and Cash flow.
- The first post-generation Playwright run exposed four stale deterministic
  construction witnesses. A fresh production-browser search selected the four
  seeds above while preserving the original terrain/affordability categories.
  Their focused 4/4 run and the subsequent full 48/48 run both passed.
- One isolated cement-browser attempt timed out while starting MenuScene before
  any world or gameplay assertion. The unchanged primary playthrough passed on
  rerun, and the full gate later passed it without retry.

## Review record

Independent final reviewers covered:

- generated-world determinism, blank-world integrity, finite search bounds,
  corridor caps, and buildable timber/cement opportunities;
- economy conservation, recipe authority, persistence, ledger/P&L
  classification, and mixed-fleet performance;
- browser UX, mobile reachability, real input, security controls, objectives,
  construction feedback, and full playthrough evidence.

All valid findings were first reproduced as failing tests, then corrected and
re-reviewed. The final generation, architecture/economy, and UX/browser
reviews reported **CLEAN** with no open Critical or Important findings.

## Known warnings

- Jest deliberately exercises a failed localStorage write and logs the
  expected save failure while verifying that failure path.
- Webpack succeeds with three existing performance warnings for the legacy
  entrypoint and large texture assets. Asset optimization remains a separate
  measured task rather than being hidden inside this economy milestone.
- Windows Git may warn that touched LF files will be converted to CRLF when
  Git next writes them. `git diff --check` is clean.

## YAGNI deferrals

Milestone 2D intentionally does not add migrations, premade scenarios,
contracts, timetables, signals, routing automation, consist editing, loans,
taxes, depreciation, facility construction/closure, town growth, global
shocks, perishability, or speculative content frameworks.

Schema 9 directly represents the current authoritative state because there is
no existing user data to migrate. The game now exposes timber and cement as
polished player-run supply chains. Steel, building modules, market demand, and
larger network orchestration remain subsequent playable slices toward the
long-term goal of hundreds of trains, products, and materials.

## Publication handoff

The verified implementation is ready to be rebuilt in production mode, pushed
as the exact Sites source state, saved as a private version, deployed, and
smoke-tested at:

https://rail-sim-progress.jt-98.chatgpt.site
