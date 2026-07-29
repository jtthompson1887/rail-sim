# Milestone 2E Regional Construction Supply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` to implement this plan task by
> task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the generated Port → regional railway → Prefabrication →
regional railway → Town construction-supply loop with profitable steel and
four-module deliveries.

**Architecture:** Schema-10 `WorldData` remains the only authority. Existing
flatbed, cargo, recipe, ledger, objective, construction, and one-second economy
transactions are extended rather than replaced. A pure regional-opportunity
analyzer proves two affordable outer-end extensions and profitable reference
journeys without persisting or constructing its witness.

**Tech Stack:** TypeScript 5, Phaser 3, Jest/jsdom, Playwright/Chromium,
webpack, deterministic seeded generation, localStorage persistence, Sites.

**Design source:**
`docs/superpowers/specs/2026-07-28-milestone-2e-regional-construction-supply-design.md`

## Global Constraints

- Work in the existing linked worktree on `codex/m2e-regional-supply`, starting
  from design commit `a9097b6`.
- Every production change begins with a focused failing test and ends with
  focused green tests, `git diff --check`, review, and a coherent commit.
- Schema 10 is a clean break; add no migration or old-schema compatibility.
- New worlds contain zero player tracks, junctions, stations, trains, or
  services.
- General Flatbed Set remains £90,000 and £20 per active tick, with 60,000 kg
  mass and exactly 100,000 L volume.
- Exact capacities are 60 logs, 60 structural timber, 60 steel, and 4 modules.
- Existing recipes and prices do not change.
- Combined Port/Town construction costs no more than £60,000; add no grant.
- Port attaches to the Quarry-side open endpoint; Town attaches to the
  Forest-side open endpoint.
- Full regional-pair analysis is capped at 32 attempts per economy evaluation.
- Reference travel is `ceil(sampledPathLength / 20) + 60`; steel must be at
  most 1,599 ticks and modules at most 1,060 ticks.
- Production cargo/recipe timing remains cargo, running cost, then industry in
  one atomic economy transaction.
- No continuous imports, handling charges, town consumption, contracts,
  services, automatic routing, new train, or premade scenario.
- Production webpack must expose no privileged `__railSim*` mutation surface.
- The 284-seed production-browser audit remains exact and below 2,000 ms for
  every generated world.

---

### Task 1: Schema-10 flatbed authority

**Files:**

- Modify: `src/freight/FreightSetCatalog.ts`
- Modify: `src/config/WorldData.ts`
- Modify: `tests/unit/FreightSetCatalog.test.ts`
- Modify: `tests/unit/WorldSchemaValidation.test.ts`
- Modify: `tests/unit/ConfigAndLevelData.test.ts`
- Modify: `tests/unit/CargoSystem.test.ts`
- Modify: `tests/unit/ConstructionGuidance.test.ts`
- Modify: `tests/unit/EconomySystem.test.ts`
- Modify: `tests/unit/FreightObjective.test.ts`
- Modify: `tests/unit/PlaceTrackTool.construction.test.ts`
- Modify: `tests/unit/SaveService.test.ts`
- Modify: `tests/unit/WorldManager.test.ts`
- Modify: `tests/unit/WorldSceneEditorGuards.test.ts`
- Modify: `tests/integration/CementSupplyChain.test.ts`
- Modify: `tests/integration/EconomyPersistence.test.ts`
- Modify: `tests/integration/StructuralTimberLink.test.ts`
- Modify: `tests/e2e/cement-supply-chain.test.ts`
- Modify: `tests/e2e/first-freight-route.test.ts`
- Modify: `tests/e2e/structural-timber-link.test.ts`

**Interfaces:**

- Produces: schema-10 `FreightProgressDef` with
  `profitableSteelDeliveryCompleted` and
  `profitableBuildingModuleDeliveryCompleted`.
- Produces: General Flatbed compatibility for `logs`, `structural-timber`,
  `steel`, and `building-modules`, with 100,000 L payload volume.

- [ ] **Step 1: Write the failing catalogue and schema tests**

Require:

```ts
expect(capacityForProduct(flatbed, requireProduct('steel')))
  .toEqual({ ok: true, capacityUnits: 60 });
expect(capacityForProduct(flatbed, requireProduct('building-modules')))
  .toEqual({ ok: true, capacityUnits: 4 });
expect(world.schemaVersion).toBe(10);
expect(world.freightProgress).toEqual({
  progressVersion: 1,
  profitableLogDeliveryCompleted: false,
  developmentGrantAwarded: false,
  profitableStructuralTimberDeliveryCompleted: false,
  profitableLimestoneDeliveryCompleted: false,
  profitableCementDeliveryCompleted: false,
  profitableSteelDeliveryCompleted: false,
  profitableBuildingModuleDeliveryCompleted: false,
});
```

Also require schema 9 rejection, exact eight-key progress validation,
detached cloning, and malformed/missing/new extra progress-key rejection.

- [ ] **Step 2: Run the RED tests**

Run:

```powershell
npx jest tests/unit/FreightSetCatalog.test.ts tests/unit/WorldSchemaValidation.test.ts tests/unit/ConfigAndLevelData.test.ts --runInBand --coverage=false
```

Expected: failures show 96,000 L/unsupported steel and modules/schema 9/missing
progress fields.

- [ ] **Step 3: Implement the minimal root/content change**

Use:

```ts
compatibleProductIds: [
  'logs',
  'structural-timber',
  'steel',
  'building-modules',
],
payloadVolumeLitres: 100_000,
```

Change `WorldData.schemaVersion` and exact raw validation to 10. Initialize,
clone, validate, and freeze the two booleans at every existing root boundary.
Do not add a migration.

- [ ] **Step 4: Run focused verification**

Run the Step 2 command, `npx tsc --noEmit`, and `git diff --check`.
Expected: all pass.

- [ ] **Step 5: Review and commit**

Review schema fail-closed behavior and catalogue immutability. Commit:

```powershell
git add src/freight/FreightSetCatalog.ts src/config/WorldData.ts tests
git commit -m "feat: add schema 10 regional freight authority"
```

### Task 2: Port source and Town sink cargo rules

**Files:**

- Modify: `src/freight/FacilityCargoRules.ts`
- Modify: `src/freight/CargoSystem.ts`
- Modify: `tests/unit/FacilityCargoRules.test.ts`
- Modify: `tests/unit/CargoSystem.test.ts`

**Interfaces:**

- Consumes: Task 1 flatbed compatibility and schema-10 progress.
- Produces: recipe-less Port Steel loading and recipe-less Town Building
  Modules acceptance through existing ten-unit transactional cargo batches.

- [ ] **Step 1: Write boundary-specific RED tests**

Require `potentialLoadProducts(port, flatbed)` to return Steel with authoritative
availability, and `potentialAcceptedProduct(town, 'building-modules')` to
return Town free capacity. Require recipe-less `boundary: 'none'` facilities,
Port modules, Town steel, incompatible sets, empty Port, and full Town to stay
ineligible.

In CargoSystem tests, load 60 steel from Port in six batches and unload it at
Prefab; then load/unload four modules in one batch. Assert exact inventories,
origin, `loadedUnits`, quotes, ledger revenue, and no unrelated boundary
mutation.

- [ ] **Step 2: Prove RED**

Run:

```powershell
npx jest tests/unit/FacilityCargoRules.test.ts tests/unit/CargoSystem.test.ts --runInBand --coverage=false
```

Expected: Port has no load products and Town does not accept modules.

- [ ] **Step 3: Implement only explicit current boundaries**

In `potentialLoadProducts`, supplement recipe outputs only when:

```ts
definition.boundary === 'port'
  && product.category === 'imported-material'
  && definition.inventory declares product.id
```

In acceptance, supplement recipe inputs only when:

```ts
definition.boundary === 'town-consumer'
  && product.category === 'finished-good'
  && definition.inventory declares product.id
```

Keep reservation, capacity, consignment-continuation, set compatibility, and
facility-radius rules unchanged. Do not call `applyFacilityBoundary` from the
runtime and do not replenish/consume stock.

- [ ] **Step 4: Verify**

Run the Step 2 command plus:

```powershell
npx jest tests/unit/IndustrySystem.test.ts tests/unit/Inventory.test.ts --runInBand --coverage=false
npx tsc --noEmit
git diff --check
```

- [ ] **Step 5: Review and commit**

Review that no arbitrary recipe-less facility became a source/sink. Commit:

```powershell
git add src/freight/FacilityCargoRules.ts src/freight/CargoSystem.ts tests/unit/FacilityCargoRules.test.ts tests/unit/CargoSystem.test.ts
git commit -m "feat: activate port and town freight boundaries"
```

### Task 3: Profitable steel and module progress

**Files:**

- Modify: `src/freight/CargoSystem.ts`
- Modify: `src/managers/WorldManager.ts`
- Modify: `tests/unit/CargoSystem.test.ts`
- Modify: `tests/unit/WorldManager.test.ts`
- Modify: `tests/integration/EconomyPersistence.test.ts`

**Interfaces:**

- Consumes: complete-consignment capacity and Task 2 boundary transfers.
- Produces: atomic profitable-steel and profitable-module latches.

- [ ] **Step 1: Write RED progress tests**

Require the steel latch only for a complete 60-unit flatbed consignment ending
at `prefabrication-plant` with:

```ts
operatingProfit = completeTripRevenue - currentTripRunningCost;
operatingProfit > 0;
```

Require the module latch equivalently for four modules ending at
`town-construction-market`. Cover partial loads, wrong facility, wrong product,
zero profit, loss, fatal ledger rejection, malformed progress, save/reload,
and transaction rollback.

- [ ] **Step 2: Prove RED**

Run:

```powershell
npx jest tests/unit/CargoSystem.test.ts tests/unit/WorldManager.test.ts tests/integration/EconomyPersistence.test.ts --runInBand --coverage=false
```

- [ ] **Step 3: Implement minimal latch authority**

Extend `isValidFreightProgress` to the exact eight-key shape. In
`unloadBatch`, derive `completesProfitableFullSteel` and
`completesProfitableFullBuildingModules` beside the existing product latches.
Set the booleans only after the final accepted batch, in the same cloned draft
that receives inventory, cargo, ledger, and trip-stat changes.

- [ ] **Step 4: Verify**

Run Step 2, `npx tsc --noEmit`, and `git diff --check`.

- [ ] **Step 5: Review and commit**

Review all-or-nothing operations semantics and non-vacuous loss cases. Commit:

```powershell
git add src/freight/CargoSystem.ts src/managers/WorldManager.ts tests
git commit -m "feat: track profitable regional supply deliveries"
```

### Task 4: Regional objective, guidance, and units

**Files:**

- Modify: `src/freight/FreightObjective.ts`
- Modify: `src/freight/ConstructionGuidance.ts`
- Modify: `src/economy/FacilityPresentation.ts`
- Modify: `src/freight/FreightPresentation.ts`
- Modify: `src/ui/FacilityInspector.ts`
- Modify: `src/ui/TrainInspector.ts`
- Modify: `src/scenes/WorldScene.ts`
- Modify: `tests/unit/FreightObjective.test.ts`
- Modify: `tests/unit/ConstructionGuidance.test.ts`
- Modify: `tests/unit/FacilityPresentation.test.ts`
- Modify: `tests/unit/FacilityInspector.test.ts`
- Modify: `tests/unit/FreightPresentation.test.ts`
- Modify: `tests/unit/TrainInspector.test.ts`
- Modify: `tests/unit/WorldSceneEditorGuards.test.ts`

**Interfaces:**

- Produces: `regional-construction-supply` objective and five ordered steps.
- Produces: `steel`, `modules`, and final guidance phases.
- Produces: boundary-specific facility presentation and product-correct module
  units/batch denominator.
- Produces:

```ts
interface FacilityBoundaryTradeDto {
  kind: 'import-source' | 'consumer-sink';
  productId: string;
  label: string;
}
// FacilityInspectionDto:
boundaryTrade: FacilityBoundaryTradeDto | null;
```

- [ ] **Step 1: Write objective/guidance RED tests**

Require steps:

```ts
[
  'connect-port',
  'deliver-steel-profitably',
  'assemble-building-modules',
  'connect-town',
  'deliver-building-modules-profitably',
]
```

Use the exact production fact:

```ts
steelLatch && (
  moduleLatch
  || prefabModules + moduleCargoOnTrains + townModules >= 4
)
```

Prove the steel and assembly steps can complete together, exactly one step is
current, achieved progress persists, and celebration is once per world and
objective.

Require guidance copy `Extend the Quarry end to Port Interchange` and
`Extend the Forest end to Town Construction Market`, reserving £90,000 only
when no flatbed exists plus £20,000 operating reserve.

- [ ] **Step 2: Write presentation RED tests**

Require Port `Imported steel available`/`Offers Steel`, depleted status, Town
`Buying Building Modules`/`Buys Building Modules`, full status, and unchanged
Prefab recipe copy. Require `/ module`, `4 modules`, `Batch 4 / 4 modules`,
and flatbed purchase copy listing all four products and exact capacities.

- [ ] **Step 3: Prove RED**

Run:

```powershell
npx jest tests/unit/FreightObjective.test.ts tests/unit/ConstructionGuidance.test.ts tests/unit/FacilityPresentation.test.ts tests/unit/FacilityInspector.test.ts tests/unit/FreightPresentation.test.ts tests/unit/TrainInspector.test.ts tests/unit/WorldSceneEditorGuards.test.ts --runInBand --coverage=false
```

- [ ] **Step 4: Implement immutable presentation**

Add the objective/step unions and derivation. Add boundary-aware status and
`offers`/`buys` DTO fields without inferring authority in DOM code. Replace
hard-coded tonne/generic-unit strings with product `unitLabel`. Set transfer
batch maximum to:

```ts
Math.min(10, dto.cargo.capacityUnits);
```

Thread objective/guidance through existing WorldScene events and do not add
test-only production hooks.

- [ ] **Step 5: Verify, review, commit**

Run Step 3, `npx tsc --noEmit`, and `git diff --check`. Review mobile scroll,
DOM escaping, immutable DTOs, and production/test control separation. Commit:

```powershell
git add src tests
git commit -m "feat: guide the regional construction supply chain"
```

### Task 5: Pure regional construction witness

**Files:**

- Create: `src/economy/RegionalConstructionOpportunity.ts`
- Modify: `src/config/FreightProgression.ts`
- Create: `tests/unit/RegionalConstructionOpportunity.test.ts`

**Interfaces:**

- Produces: `RegionalConstructionSites`, two leg witnesses, total cost,
  sampled path lengths, reference active ticks, and positive minimum margins.
- Produces:

```ts
MAX_REGIONAL_CONSTRUCTION_LINK_COST = 60_000;
MAX_REGIONAL_PAIR_ANALYSES = 32;
REFERENCE_SPEED_WORLD_UNITS_PER_TICK = 20;
REFERENCE_MANOEUVRE_TICKS = 60;
MAX_STEEL_REFERENCE_ACTIVE_TICKS = 1_599;
MAX_MODULE_REFERENCE_ACTIVE_TICKS = 1_060;
```

- Produces these exact callable interfaces:

```ts
export interface RegionalConstructionSites {
  readonly portInterchange: Readonly<Vec2Def>;
  readonly townConstructionMarket: Readonly<Vec2Def>;
}

export interface RegionalConstructionOpportunityWitness {
  readonly portExtension: { readonly proposal: ConstructionProposal };
  readonly townExtension: { readonly proposal: ConstructionProposal };
  readonly topologyCost: number;
  readonly totalCost: number;
  readonly steelPathLength: number;
  readonly modulePathLength: number;
  readonly steelReferenceActiveTicks: number;
  readonly moduleReferenceActiveTicks: number;
  readonly minimumSteelMargin: number;
  readonly minimumModuleMargin: number;
}

export type RegionalConstructionOpportunityAnalyzer = (
  sites: RegionalConstructionSites,
) => RegionalConstructionOpportunityWitness | null;

export function createRegionalConstructionOpportunityAnalyzer(
  analyzer: Pick<ConstructionAnalyzer, 'analyzeDetailed'>,
  opportunity: StarterOpportunityDef,
  prefabricationExtension: PrefabricationExtensionWitness,
  cementSupply: CementSupplyOpportunityWitness,
): RegionalConstructionOpportunityAnalyzer | null;
```

- [ ] **Step 1: Write RED analyzer tests**

Build deterministic analyzer doubles that prove Port starts from the Quarry
open endpoint, Town from the Forest open endpoint, endpoint topology costs are
charged twice, the first new leg is protected while analyzing the second, and
all starter/prefab/cement tracks are protected.

Require exact acceptance at £60,000/1,599/1,060 and rejection one unit/tick
over each boundary. Require invalid analysis, sample failure, crossing,
overlap, reversed endpoints, forged prior witness, overflow, and caller
mutation to fail or leave the frozen result unchanged.

- [ ] **Step 2: Prove RED**

Run:

```powershell
npx jest tests/unit/RegionalConstructionOpportunity.test.ts --runInBand --coverage=false
```

Expected: module/import failures because the analyzer and constants do not
exist.

- [ ] **Step 3: Implement the pure analyzer**

Follow `CementSupplyOpportunity` structure. Replay prior details with
`analyzeDetailed`, build outer cubics with `deriveAutomaticCubic` and
`deriveTrackEndpointOutward`, validate with `hasConstructionClearance`, and
measure every selected segment with `sampleConstructionCurve`.

Compute:

```ts
const referenceTicks = Math.ceil(pathLength / 20) + 60;
const minimumSteelMargin = 31_990 - referenceTicks * 20;
const minimumModuleMargin = 21_216 - referenceTicks * 20;
```

Require both margins positive and return a deep-frozen `clonePlainData`
witness. Persist none of it.

- [ ] **Step 4: Verify, review, commit**

Run Step 2 plus existing Prefab/Cement opportunity tests, TypeScript, and
`git diff --check`. Review production-analysis parity and all numeric
boundaries. Commit:

```powershell
git add src/economy/RegionalConstructionOpportunity.ts src/config/FreightProgression.ts tests/unit/RegionalConstructionOpportunity.test.ts
git commit -m "feat: prove regional construction routes"
```

### Task 6: Bounded generated Port and Town placement

**Files:**

- Modify: `src/economy/WorldEconomyGenerator.ts`
- Modify: `src/managers/WorldManager.ts`
- Modify: `tests/unit/WorldEconomyGenerator.test.ts`
- Modify: `tests/unit/WorldManager.test.ts`
- Modify: `tests/performance/run-world-generation-browser.js`
- Modify: `tests/performance/WorldGenerationBrowserHarness.test.ts`

**Interfaces:**

- Consumes: Task 5 regional analyzer and exact constants.
- Produces: deterministic Port/Town placement diagnostics and independent
  generated-economy replay.

- [ ] **Step 1: Write RED generator tests**

Require Port/Town selection only after a valid mineral witness, lower-bound
ordering, analysis-cache reuse, no more than 32 regional pairs per economy
evaluation, retry after invalid regional pairs, fail-closed exhaustion, and
deterministic diagnostics. Require `validateGeneratedEconomy` to reject moved,
swapped, unaffordable, crossing, over-duration, or forged sites.

- [ ] **Step 2: Prove RED**

Run:

```powershell
npx jest tests/unit/WorldEconomyGenerator.test.ts tests/unit/WorldManager.test.ts tests/performance/WorldGenerationBrowserHarness.test.ts --runInBand --coverage=false
```

- [ ] **Step 3: Implement bounded placement**

Replace first-separated Port/Town selection. Rank Port candidates from Quarry
and Town candidates from Forest by the sum of endpoint chord lower bounds.
Analyze at most 32 pairs through the cached production analyzer. Store only
facility positions and diagnostics; never persist witness geometry.

Extend `validateGeneratedEconomy` and WorldManager diagnostic trust checks to
replay regional cost, path ticks, and margins.

- [ ] **Step 4: Run exact generation gates**

Run Step 2 and:

```powershell
npm run benchmark:world-generation
```

Expected: 284/284 seeds resolve, zero exhaustion, deterministic replay, all
regional costs/ticks/margins in bounds, and every per-world duration below
2,000 ms. If it fails, improve candidate ordering/cache reuse; do not relax
money, analysis, or time caps.

- [ ] **Step 5: Review and commit**

Obtain independent generation review, resolve every Important finding, rerun
Step 4, and commit:

```powershell
git add src/economy/WorldEconomyGenerator.ts src/managers/WorldManager.ts tests
git commit -m "feat: guarantee regional supply extensions"
```

### Task 7: Headless complete regional-chain acceptance

**Files:**

- Create: `tests/fixtures/RegionalConstructionSupplyFixture.ts`
- Create: `tests/integration/RegionalConstructionSupply.test.ts`

**Interfaces:**

- Consumes: public construction commands, freight purchase/cargo authority,
  EconomySystem, persistence, Task 6 generated sites.
- Produces: exact conservation, ledger, progress, and reload proof for the
  complete capstone.

- [ ] **Step 1: Write the full RED journey**

Starting from the accepted cement-complete fixture, commit both regional
extensions through public quotes/commands, reuse a real General Flatbed, load
and unload 60 steel over six economy ticks, and assert the sixth tick commits:

```ts
profitableSteelDeliveryCompleted === true;
prefab.inventories.steel.quantity === 54;
prefab.inventories['building-modules'].quantity === 4;
```

Then load four modules, save/reload, unload at Town, and assert the final latch,
trip result, objective, stock, and ledger.

Reconcile opening + extraction/imported opening + recipe outputs − recipe
inputs = facility + train stock for all six products at every checkpoint.
Reconcile closing cash exactly from opening cash, construction capex, vehicle
capex, delivery revenue, grant, and running expenses.

- [ ] **Step 2: Prove RED**

Run:

```powershell
npx jest tests/integration/RegionalConstructionSupply.test.ts --runInBand --coverage=false
```

- [ ] **Step 3: Add only deterministic fixture orchestration**

Use public managers and fixed EconomySystem ticks. Fixture helpers may locate
generated facilities and drive existing public operations but may not write
cash, cargo, inventory, recipe progress, tracks, or latches directly.

- [ ] **Step 4: Verify, review, commit**

Run the new test plus all economy/freight integration tests, TypeScript, and
`git diff --check`. Obtain economy/conservation review. Commit:

```powershell
git add tests/fixtures/RegionalConstructionSupplyFixture.ts tests/integration/RegionalConstructionSupply.test.ts
git commit -m "test: prove the complete regional supply chain"
```

### Task 8: Real browser gameplay and responsive UX

**Files:**

- Create: `tests/e2e/regional-construction-supply.test.ts`
- Modify: `tests/e2e/mobile-layout.test.ts`

**Interfaces:**

- Produces: real-pointer, real-keyboard, save/reload, desktop/loss/mobile
  evidence without state injection.

- [ ] **Step 1: Write the primary RED browser journey**

Use a fixed generated seed. Through visible controls: create blank world,
complete/prerequisite fixture flow using the same public journey boundaries,
build both outer extensions with real pointer gestures, drive the flatbed to
load 60 steel, observe overlapping Prefab progress, drive/unload four modules,
reload at phase boundaries, and assert all five objective steps and truthful
profit feedback.

- [ ] **Step 2: Add loss and mobile RED cases**

Create one deterministic inefficient steel/module trip that earns revenue but
has non-positive trip profit and does not latch. At 375×667, assert Port/Town
inspector scrolling, `4 / 4 modules`, objective visibility, clear-canvas
construction start, pause ownership, and input-safe train controls.

- [ ] **Step 3: Prove RED**

Run:

```powershell
$env:PLAYWRIGHT_PORT='42521'
npx playwright test tests/e2e/regional-construction-supply.test.ts tests/e2e/mobile-layout.test.ts --workers=1 --retries=0
```

- [ ] **Step 4: Implement only browser-observed product fixes**

Fix production UI/interaction defects exposed by these journeys. Do not inject
world authority, add privileged controls, or weaken real input.

- [ ] **Step 5: Verify, review, commit**

Run Step 3, production/test-control builds, TypeScript, and
`git diff --check`. Obtain independent UX/browser review. Commit:

```powershell
git add src tests/e2e
git commit -m "test: prove regional supply in the browser"
```

### Task 9: Performance and complete regression matrix

**Files:**

- Modify: `tests/performance/EconomyTickBenchmark.test.ts`

**Interfaces:**

- Produces: 16-train deterministic mixed-product performance proof and the
  complete regression result.

- [ ] **Step 1: Expand the benchmark RED fixture**

Use eight flatbeds covering logs, timber, steel, and modules, four aggregate
hoppers, and four cement sets across seven facilities. Keep 500 measured ticks,
16 ms p95, full semantic destination coverage, and deterministic 600-tick hash.

- [ ] **Step 2: Prove RED then optimize only measured bottlenecks**

Run:

```powershell
npx jest tests/performance/EconomyTickBenchmark.test.ts --runInBand --coverage=false
```

If over budget, profile first and preserve validation, rollback, ordering, and
hash semantics.

- [ ] **Step 3: Run focused performance/security gates**

```powershell
npm run benchmark:construction-drag
npm run benchmark:world-generation
npx jest tests/unit/WebpackTestControls.test.ts tests/unit/WorldSceneEditorGuards.test.ts tests/unit/WebShell.test.ts --runInBand --coverage=false
```

- [ ] **Step 4: Run the complete matrix**

```powershell
npx tsc --noEmit
npm run build
npm run build:test-controls
npx jest --runInBand --coverage
$env:PLAYWRIGHT_PORT='42522'
npx playwright test --workers=1 --retries=0
git diff --check
git status --short
```

Require every native exit to be zero. Record exact suites/tests, coverage,
browser count/duration, benchmark percentiles/hash, generation maxima, and
known webpack warnings.

- [ ] **Step 5: Review and commit**

Obtain independent performance/architecture review. Fix and re-review every
Critical/Important finding. Commit any required measured optimization or exact
fixture update separately from evidence.

### Task 10: Final review, evidence, and private Sites release

**Files:**

- Create:
  `docs/superpowers/reviews/2026-07-28-milestone-2e-regional-construction-supply-evidence.md`
- Modify: no production source unless a reviewed acceptance defect requires a
  separate fix commit and scoped re-review

**Interfaces:**

- Produces: audited evidence and exact private Sites version of the verified
  commit.

- [ ] **Step 1: Run whole-branch review**

Package `a9097b6..HEAD` and dispatch independent reviewers for specification,
economy/conservation, generation/performance, and UX/security. One fix agent
owns any complete final finding list; one scoped re-review verifies it.

- [ ] **Step 2: Write and commit evidence**

Record all design invariants, RED/GREEN corrections, review verdicts, exact
matrix outputs, conservation/cash equations, YAGNI deferrals, and known
warnings. Commit:

```powershell
git add docs/superpowers/reviews/2026-07-28-milestone-2e-regional-construction-supply-evidence.md
git commit -m "docs: record milestone 2e acceptance evidence"
```

- [ ] **Step 3: Re-run the complete Task 9 gate at evidence HEAD**

Do not infer success from the pre-evidence run. Re-run every Task 9 command and
require a clean worktree at the exact commit to be published.

- [ ] **Step 4: Publish through existing private Sites project**

Read `.openai/hosting.json`; reuse its exact `project_id`. Build production
without test controls, push the exact verified commit with a per-command
credential, package with the Sites helper, save one version, deploy with
owner-only access, and poll to terminal success.

- [ ] **Step 5: Production smoke test**

Open the returned production URL in the in-app browser. Verify one game canvas,
no console errors, schema-10 blank-world creation, four flatbed products,
regional objective copy, product-correct module units, and no `__railSim*`
globals. Leave the deployed game open for the user.

## Plan Self-Review

- **Spec coverage:** Tasks 1–10 cover every schema, cargo, objective, UI,
  generation, profitability, conservation, performance, review, and
  publication requirement.
- **Scope:** One coherent capstone; port replenishment/handling, consumption,
  contracts, and automation remain explicitly deferred.
- **Type consistency:** The two progress booleans, five objective step IDs,
  six regional constants, exact formulas, and test paths are named
  consistently across producer and consumer tasks.
- **No placeholders:** Every task has exact RED evidence, implementation
  boundaries, verification commands, and a commit outcome.
