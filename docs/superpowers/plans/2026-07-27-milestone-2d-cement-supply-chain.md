# Milestone 2D Cement Supply Chain Implementation Plan

> **For Codex:** REQUIRED SKILL: use
> `superpowers:subagent-driven-development` task by task. Every production
> change follows `superpowers:test-driven-development`; every completion claim
> follows `superpowers:verification-before-completion`.

**Goal:** Add a complete, profitable, player-built Quarry → Cement Works →
Prefabrication Plant chain using real bulk and covered rolling stock, generated
terrain guarantees, durable progression, honest P&L, polished guidance, and an
exact private Sites deployment.

**Architecture:** Keep schema-9 `WorldData` as the sole authority and reuse the
existing atomic one-second economy transaction. Add two explicit freight sets
and three explicit purchase-route policies; do not build a generic marketplace.
Generation proves two sequential mineral links without installing them.
Objectives and UI derive from authoritative progress, inventory, topology, and
catalogue data.

**Design source:**
`docs/superpowers/specs/2026-07-27-milestone-2d-cement-supply-chain-design.md`

## Working Rules

- Work on `codex/m2d-quarry-cement` from accepted commit `7a00c736`.
- Preserve the unrelated staged cab-view work in the original checkout.
- Observe a focused RED test before each production behavior change.
- Commit each task only after focused tests, build/typecheck as appropriate,
  and `git diff --check` pass.
- Do not add a migration or schema-8 compatibility path.
- Do not expose test controls in production.
- Do not change recipes, commodity prices, or add a second grant to conceal a
  generation/balance defect.

## Frozen Content

```ts
export const MAX_STARTER_CORRIDOR_COST = 400_000;
export const MAX_CEMENT_SUPPLY_LINK_COST = 180_000;

export const AGGREGATE_HOPPER_SET_ID = 'aggregate-hopper-set';
export const COVERED_CEMENT_SET_ID = 'covered-cement-set';

// Aggregate: 120 t limestone
payloadMassKg: 120_000;
payloadVolumeLitres: 75_000;
purchasePrice: 110_000;
runningCostPerActiveTick: 20;

// Cement: 80 t cement
payloadMassKg: 80_000;
payloadVolumeLitres: 64_000;
purchasePrice: 105_000;
runningCostPerActiveTick: 22;
```

`FreightSetDefinition` gains `cargoClass`, and validation requires every
compatible product to have that exact class.

Schema 9 progress adds:

```ts
profitableLimestoneDeliveryCompleted: boolean;
profitableCementDeliveryCompleted: boolean;
```

## Task 1: Catalogue and Schema-9 Authority

**Files:**

- Modify `src/freight/FreightSetCatalog.ts`
- Modify `src/config/WorldData.ts`
- Modify schema/progress fixtures reported by the focused compiler/tests
- Modify `tests/unit/FreightSetCatalog.test.ts`
- Modify `tests/unit/WorldSchemaValidation.test.ts`
- Modify `tests/unit/ConfigAndLevelData.test.ts`
- Modify `tests/unit/SaveService.test.ts`
- Modify `tests/unit/WorldManager.test.ts`

**RED:** require all three exact immutable definitions, derived capacities
60/120/80, cargo-class mismatch rejection, schema 9, exact five-boolean
progress, and schema-8 rejection.

```powershell
npx jest tests/unit/FreightSetCatalog.test.ts tests/unit/WorldSchemaValidation.test.ts tests/unit/ConfigAndLevelData.test.ts tests/unit/SaveService.test.ts tests/unit/WorldManager.test.ts --runInBand --coverage=false
```

**GREEN:** implement the catalogue and root shape mechanically. Thread the two
new booleans through atomic draft cloning/validation without changing cargo
behavior.

**Commit:** `feat: add schema 9 mineral freight authority`

## Task 2: Explicit Multi-SKU Purchase Policies

**Files:**

- Modify `src/freight/FreightPurchaseService.ts`
- Modify `src/freight/FreightPresentation.ts`
- Modify `tests/unit/FreightPurchaseService.test.ts`
- Modify `tests/unit/FreightPresentation.test.ts`

**RED:** prove policy lookup for the three sets, selected-set pricing, source
access, relevant graph connection, facing toward the correct first
destination, unknown-set rejection, forged/cross-set/stale quote rejection,
and unchanged spawn/place/rollback/save semantics.

Replace Forest-specific blockers with product/facility-neutral codes carrying
quote context. Keep the WeakSet and root-revision boundaries.

```powershell
npx jest tests/unit/FreightPurchaseService.test.ts tests/unit/FreightPresentation.test.ts --runInBand --coverage=false
```

**Commit:** `feat: generalize freight purchases by route policy`

## Task 3: Vehicle Choice and Placement UX

**Files:**

- Modify `src/ui/VehiclePurchasePanel.ts`
- Modify `src/systems/tools/PlaceVehicleTool.ts`
- Modify `src/services/EventBus.ts`
- Modify `src/scenes/WorldScene.ts`
- Modify `tests/unit/VehiclePurchasePanel.test.ts`
- Modify `tests/unit/PlaceVehicleTool.test.ts`
- Modify `tests/unit/EventBus.test.ts`
- Modify `tests/unit/WorldSceneEditorGuards.test.ts`

**RED:** require three accessible SKU controls, exact price/capacity/cargo/cost
copy, active selection, stale-quote clearing on selection, source-specific
remedies, confirmation safety, mobile layout, and no input leak to the world.

Use stable selectors:

```text
[data-testid="flatbed-freight-set-buy"]
[data-testid="aggregate-hopper-set-buy"]
[data-testid="covered-cement-set-buy"]
[data-testid="freight-purchase-confirm"]
```

```powershell
npx jest tests/unit/VehiclePurchasePanel.test.ts tests/unit/PlaceVehicleTool.test.ts tests/unit/EventBus.test.ts tests/unit/WorldSceneEditorGuards.test.ts --runInBand --coverage=false
```

**Commit:** `feat: add mineral rolling stock purchase UX`

## Task 4: Profitable Mineral Delivery Progress

**Files:**

- Modify `src/freight/CargoSystem.ts`
- Modify `src/economy/EconomySystem.ts` only if type threading requires it
- Modify `tests/unit/CargoSystem.test.ts`
- Modify `tests/unit/EconomySystem.test.ts`
- Modify `tests/integration/EconomyPersistence.test.ts`

**RED:** require the limestone latch only for a full profitable 120 t
Aggregate Hopper delivery at Cement Works and the cement latch only for a full
profitable 80 t Covered Cement delivery at Prefab. Prove partial, wrong set,
wrong destination, zero-profit, loss, and malformed-state cases leave all
progress unchanged.

Preserve pre-batch quotes, one transfer/train/tick, full conservation, trip
rollover, aggregate running-cost ledger entries, fatal rollback, and one-save
catch-up.

```powershell
npx jest tests/unit/CargoSystem.test.ts tests/unit/EconomySystem.test.ts tests/integration/EconomyPersistence.test.ts --runInBand --coverage=false
```

**Commit:** `feat: track profitable mineral deliveries`

## Task 5: Cement Objective and Dynamic Construction Guidance

**Files:**

- Modify `src/freight/FreightObjective.ts`
- Add `src/freight/ConstructionGuidance.ts`
- Modify `src/ui/FreightObjectiveCard.ts`
- Modify `src/ui/ConstructionPreviewOverlay.ts`
- Modify `src/ui/ConstructionInspector.ts`
- Modify `src/systems/tools/PlaceTrackTool.ts`
- Modify `tests/unit/FreightObjective.test.ts`
- Modify `tests/unit/FreightObjectiveCard.test.ts`
- Add `tests/unit/ConstructionGuidance.test.ts`
- Modify `tests/unit/ConstructionInspector.test.ts`
- Modify `tests/unit/ConstructionPreviewOverlay.test.ts`
- Modify `tests/unit/PlaceTrackTool.test.ts`

**RED:** require one current cement-chain step, transient topology/load facts,
durable profit latches, exact 120 → 80 production evidence, end copy pointing
only to steel, and one celebration per world/objective.

Require phase-aware construction copy and a reserve equal to the operating
reserve plus prices of the currently required unowned sets. The warning stays
advisory.

```powershell
npx jest tests/unit/FreightObjective.test.ts tests/unit/FreightObjectiveCard.test.ts tests/unit/ConstructionGuidance.test.ts tests/unit/ConstructionInspector.test.ts tests/unit/ConstructionPreviewOverlay.test.ts tests/unit/PlaceTrackTool.test.ts --runInBand --coverage=false
```

**Commit:** `feat: guide the cement supply chain`

## Task 6: Processing, Delivery, and Loss Feedback

**Files:**

- Modify `src/economy/FacilityPresentation.ts`
- Modify `src/ui/FacilityInspector.ts`
- Modify `src/ui/CompanyHud.ts` only for delivery tone if needed
- Modify `src/scenes/WorldScene.ts`
- Modify `tests/unit/FacilityPresentation.test.ts`
- Modify `tests/unit/FacilityInspector.test.ts`
- Modify `tests/unit/CompanyHud.test.ts`
- Modify `tests/unit/WorldSceneEditorGuards.test.ts`

**RED:** require kiln recipe copy, `Working n / 4 ticks`, input/output stock,
receiving £/t and full-load gross value, and product/destination/revenue/trip
profit delivery feedback. Losses render distinctly and do not claim objective
completion.

```powershell
npx jest tests/unit/FacilityPresentation.test.ts tests/unit/FacilityInspector.test.ts tests/unit/CompanyHud.test.ts tests/unit/WorldSceneEditorGuards.test.ts --runInBand --coverage=false
```

**Commit:** `feat: explain mineral production and trip results`

## Task 7: Deterministic Mineral-Link Generation

**Files:**

- Modify `src/config/FreightProgression.ts`
- Modify `src/systems/WorldOpportunityValidator.ts`
- Add `src/economy/CementSupplyOpportunity.ts`
- Modify `src/economy/WorldEconomyGenerator.ts`
- Modify `tests/unit/WorldOpportunityValidator.test.ts`
- Add `tests/unit/CementSupplyOpportunity.test.ts`
- Modify `tests/unit/WorldEconomyGenerator.test.ts`
- Modify `tests/integration/GeneratedWorldStart.test.ts`
- Modify `tests/performance/run-world-generation-browser.js`
- Modify exact generation fixtures only after stable measured GREEN output

**RED:** enforce starter ≤ £400k, sequential terrain-valid mineral proposals
≤ £180k combined, canonical endpoints, topology costs, route clearance,
bounded deterministic search, blank infrastructure, validation replay, and
failure atomicity.

Run focused generation tests, then the 284-seed browser audit. If a permanent
seed proves £400k/£180k infeasible under bounded work, adjust only the smallest
measured cap necessary and record the seed; do not add cash or change prices.

```powershell
npx jest tests/unit/WorldOpportunityValidator.test.ts tests/unit/CementSupplyOpportunity.test.ts tests/unit/WorldEconomyGenerator.test.ts tests/integration/GeneratedWorldStart.test.ts --runInBand --coverage=false
npm run benchmark:world-generation
```

**Commit:** `feat: guarantee buildable cement supply links`

## Task 8: Headless Full-Chain Acceptance

**Files:**

- Add `tests/fixtures/CementSupplyChainFixture.ts`
- Add `tests/integration/CementSupplyChain.test.ts`
- Modify related integration fixtures only through public production APIs

Build the actual generated starter, Prefab, Quarry, and Cement proposals with
construction commands. Buy both real sets. Move 120 limestone, run exactly ten
kiln cycles over forty processing ticks, and move 80 cement.

Assert:

- exact product conservation at every phase;
- exact pre-batch revenue and cash/ledger reconciliation;
- capex excluded from railway operating profit;
- both trips profitable;
- Prefab ends with 80 cement and zero steel;
- module assembly remains blocked;
- save/reload at partial load, transit, processing wait, partial unload, and
  achieved states;
- derail/re-rail retains cargo and statistics;
- stale/save/live failures never duplicate or partially commit.

```powershell
npx jest tests/integration/CementSupplyChain.test.ts tests/integration/ConstructionSupplyEconomy.test.ts tests/integration/EconomyPersistence.test.ts tests/integration/FirstFreightRoute.test.ts --runInBand --coverage=false
```

**Commit:** `test: prove the complete cement supply chain`

## Task 9: Browser Gameplay and Responsive UX

**Files:**

- Add `tests/e2e/cement-supply-chain.test.ts`
- Modify `tests/e2e/generated-economy-presentation.test.ts`
- Modify `tests/e2e/structural-timber-link.test.ts` only for schema/next-card
  expectations
- Modify test-only WorldScene harness types only when public UI cannot observe
  an authoritative fact

Across at least three fixed generated seeds, collectively prove:

- blank start and capital caps;
- real pointer construction for both mineral links;
- three visible rolling-stock choices and source-specific placement;
- W/S driving for at least one real mineral trip;
- 120 t limestone load/profitable unload;
- visible forty-tick kiln progress and exactly 80 t output;
- 80 t cement load/profitable Prefab unload;
- objective, facility, train, delivery, P&L, and loss feedback;
- save/reload and recovery;
- desktop and 375×667 input-safe layout;
- no console/page error.

The harness may control time/runtime for deterministic coverage but may not set
cash, cargo, inventories, ledger, progress, or topology.

```powershell
npm run build:test-controls
npx playwright test tests/e2e/cement-supply-chain.test.ts tests/e2e/generated-economy-presentation.test.ts tests/e2e/structural-timber-link.test.ts --workers=1 --retries=0
```

**Commit:** `test: prove the cement chain in browser`

## Task 10: Mixed-Fleet Performance and Regression Matrix

**Files:**

- Modify `tests/performance/EconomyTickBenchmark.test.ts`
- Modify its deterministic hash only from a stable verified fixture

Include flatbed, aggregate, and cement trains across loading, transit,
unloading, waiting, and contention while preserving deterministic p95 < 16 ms.

```powershell
npx jest tests/performance/EconomyTickBenchmark.test.ts --runInBand --coverage=false
npm run benchmark:construction-drag
npm run benchmark:world-generation
```

**Commit:** `test: budget mixed mineral freight ticks`

## Task 11: Independent Review, Evidence, and Sites

Request independent spec/architecture, economy/conservation, generation, and
UX/browser reviews of the exact implementation range. Reproduce every valid
finding with a failing test before correction.

Run fresh:

```powershell
npx jest --runInBand --coverage
npm run build
npm run build:test-controls
npx playwright test --workers=1 --retries=0
npm run benchmark:construction-drag
npm run benchmark:world-generation
npx jest tests/performance/EconomyTickBenchmark.test.ts --runInBand --coverage=false
npx jest tests/unit/WebpackTestControls.test.ts tests/unit/WorldSceneEditorGuards.test.ts tests/unit/WebShell.test.ts --runInBand --coverage=false
git diff --check
git status --short
```

Create
`docs/superpowers/reviews/2026-07-27-milestone-2d-cement-supply-chain-evidence.md`
with exact test, coverage, benchmark, seed, balance, conservation, review, and
YAGNI evidence. Commit it, then rerun the complete gate set at the evidence
HEAD.

Use `sites:sites-building` then `sites:sites-hosting`. Reuse project
`appgprj_6a649579a6a081919bdbc5bdc7d9d101`; push, package, save, and privately
deploy the exact verified evidence commit. Open production and smoke-test one
canvas, no errors, schema-9 blank start, three vehicle choices, cement
objective progression, and no privileged globals.

**Evidence commit:** `docs: record milestone 2d acceptance evidence`

## Next Slice

After Milestone 2D publication, add the Port Interchange → Prefabrication Plant
steel-import leg and only the minimum global-market behavior needed to make
import pricing, port handling, and exposure to world demand meaningful. Do not
implement module delivery or a generic contract market until steel completes
the first three-input processing chain.

