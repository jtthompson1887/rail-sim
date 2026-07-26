# Milestone 2C Structural Timber Link Implementation Plan

> **For Codex:** REQUIRED SKILL: Use `superpowers:subagent-driven-development`
> to execute this plan task by task. Every production change follows
> `superpowers:test-driven-development`; every completion claim follows
> `superpowers:verification-before-completion`.

**Goal:** Extend the generated first freight route into a profitable
Managed-Forest → Sawmill → Prefabrication-Plant processing chain, with a
terrain-feasible funded extension, product-generic flatbed transfers, durable
progress, honest P&L, polished guidance, persistence, and a verified Sites
deployment.

**Architecture:** Keep `WorldData` as the root authority and retain the existing
one-second atomic operations transaction. Replace the obsolete first-route
progress blob with schema-8 freight progress, extract pure facility cargo rules
from the transactional cargo system, and derive UI from catalogue IDs and root
state. The same physical flatbed set carries logs and structural timber. World
generation proves one affordable downstream build without creating player
track. No services, schedules, signalling, mixed cargo, or generic mission
engine are introduced.

**Tech stack:** TypeScript 4, Phaser 3, Matter.js, Jest/ts-jest, jsdom,
Playwright, webpack 5, Sites.

**Design source:**
`docs/superpowers/specs/2026-07-27-milestone-2c-structural-timber-link-design.md`

## Working Rules

- Create the implementation worktree from the exact commit that adds this plan;
  its reviewed design parent chain includes `4cbd31d`.
- Use `superpowers:using-git-worktrees` to create
  `.worktrees/m2c-structural-timber` on branch
  `codex/m2c-structural-timber`.
- Confirm that the new worktree is clean and that the baseline focused tests
  pass before Task 1.
- Never update a production file before observing the corresponding new test
  fail for the intended reason.
- Make the commit named by each task only after its focused tests pass and
  `git diff --check` is clean.
- Preserve all unrelated user changes.
- Keep `src/freight/CargoSystem.ts` transactional. Pure discovery belongs in
  `src/freight/FacilityCargoRules.ts`; presentation text never belongs in the
  simulation.
- Do not add compatibility aliases for schema 7, `firstRouteProgress`, or
  `timber-freight-set`. The user explicitly approved destructive rejection
  because no existing user data must be migrated.
- Do not expose browser-test controls in a production build.

## Constants and Interfaces to Freeze

Create `src/config/FreightProgression.ts` as the single home for:

```ts
export const REGIONAL_DEVELOPMENT_GRANT = 250_000;
export const REGIONAL_DEVELOPMENT_GRANT_REFERENCE =
  'regional-development-grant:v1';
export const PREFAB_ACCESS_LINK_ALLOWANCE = 36_000;
export const PREFAB_EXTENSION_OPERATING_RESERVE = 20_000;
export const MAX_PREFAB_EXTENSION_WITNESS_COST =
  REGIONAL_DEVELOPMENT_GRANT
  - PREFAB_ACCESS_LINK_ALLOWANCE
  - PREFAB_EXTENSION_OPERATING_RESERVE;
```

The result must equal `194_000`. Do not repeat these amounts in generator,
cargo, objective, or presentation code.

Schema 8 owns:

```ts
export interface FreightProgressDef {
  progressVersion: 1;
  profitableLogDeliveryCompleted: boolean;
  developmentGrantAwarded: boolean;
  profitableStructuralTimberDeliveryCompleted: boolean;
}
```

The freight set constants become:

```ts
export const FLATBED_FREIGHT_SET_ID = 'flatbed-freight-set';
export const FLATBED_TRAIN_PURCHASE_PRICE = 90_000;
export const FREIGHT_SETS: readonly FreightSetDefinition[];
```

The one set is named `General Flatbed Set`, accepts `logs` and
`structural-timber`, retains 60,000 kg / 96,000 litres payload, and costs £20
per active tick.

Cargo simulation exposes codes, not sentences:

```ts
export type CargoBlockerCode =
  | 'not-operating'
  | 'derailed'
  | 'train-moving'
  | 'unknown-freight-set'
  | 'incompatible-product'
  | 'outside-eligible-facility'
  | 'source-empty'
  | 'train-full'
  | 'destination-full'
  | 'product-not-accepted'
  | 'insufficient-running-cash';

export interface CargoTransferStatus {
  readonly trainId: string;
  readonly facilityId: string | null;
  readonly productId: string | null;
  readonly kind: 'loading' | 'unloading' | 'blocked' | 'idle';
  readonly blocker: CargoBlockerCode | null;
  readonly batchUnits: number;
  readonly cargoUnits: number;
  readonly capacityUnits: number;
  readonly batchRevenue: number;
}
```

The finance summary becomes:

```ts
export interface ProfitAndLoss {
  deliveryRevenue: number;
  contractBonuses: number;
  operatingExpenses: number;
  railwayOperatingProfit: number;
  capitalExpenditure: number;
  cashFlow: number;
}
```

`railwayOperatingProfit` excludes `contract-bonus`; `cashFlow` includes it.

## Task 1: Establish Schema-8 Freight Progress Authority

**Files:**

- Modify: `src/config/WorldData.ts`
- Modify: `src/managers/WorldManager.ts`
- Modify: `src/freight/CargoSystem.ts`
- Modify: `src/economy/EconomySystem.ts`
- Modify: `src/freight/FirstRouteObjective.ts`
- Modify: `src/scenes/WorldScene.ts`
- Modify: `tests/unit/WorldSchemaValidation.test.ts`
- Modify: `tests/unit/ConfigAndLevelData.test.ts`
- Modify: `tests/unit/WorldManager.test.ts`
- Modify: `tests/unit/SaveService.test.ts`
- Modify: `tests/unit/CargoSystem.test.ts`
- Modify: `tests/unit/EconomySystem.test.ts`
- Modify: `tests/unit/FirstRouteObjective.test.ts`
- Modify: `tests/unit/WorldSceneEditorGuards.test.ts`
- Modify: `tests/integration/FirstFreightRoute.test.ts`
- Modify: `tests/e2e/first-freight-route.test.ts`
- Modify: `tests/fixtures/FirstFreightRouteFixture.ts`
- Modify: any remaining progress fixture literals reported by focused Jest runs

**Step 1: Write failing schema and authority tests**

Add tests that require:

- `createEmptyWorld()` emits `schemaVersion: 8`;
- the root contains exactly the three-field `freightProgress` value above;
- `firstRouteProgress` is absent;
- missing/wrong-version/non-boolean freight progress is rejected;
- schema 7 returns the existing incompatible-world action;
- operations drafts clone and atomically commit `freightProgress`;
- escaped manager snapshots cannot mutate authoritative progress;
- save/load round-trips schema 8 without repair.

Run:

```powershell
npx jest tests/unit/WorldSchemaValidation.test.ts tests/unit/ConfigAndLevelData.test.ts tests/unit/WorldManager.test.ts tests/unit/SaveService.test.ts tests/unit/CargoSystem.test.ts tests/unit/EconomySystem.test.ts tests/unit/FirstRouteObjective.test.ts tests/unit/WorldSceneEditorGuards.test.ts tests/integration/FirstFreightRoute.test.ts --runInBand --coverage=false
```

Expected: FAIL because the current root is schema 7 and owns
`firstRouteProgress`.

**Step 2: Implement the root authority**

- Replace `FirstRouteProgressDef` with `FreightProgressDef`.
- Replace `WorldData.firstRouteProgress` with `WorldData.freightProgress`.
- Initialise all flags false.
- Make validation exact: version 1, all three booleans, no coercion.
- Thread the new aggregate through `OperationsDraft`,
  `applyOperationsBatch`, snapshot comparison, cloning, and commit.
- Mechanically rename the progress aggregate through CargoSystem,
  EconomySystem, the current objective derivation, WorldScene, integration
  harnesses, and browser DTOs. Do not change behavior in this task.
- Update fixture literals mechanically; do not introduce an alias or migration.

Run the focused command again, then:

```powershell
npx tsc --noEmit
```

Expected: PASS.

**Step 3: Commit**

```powershell
git add src/config/WorldData.ts src/managers/WorldManager.ts src/freight/CargoSystem.ts src/economy/EconomySystem.ts src/freight/FirstRouteObjective.ts src/scenes/WorldScene.ts tests/unit/WorldSchemaValidation.test.ts tests/unit/ConfigAndLevelData.test.ts tests/unit/WorldManager.test.ts tests/unit/SaveService.test.ts tests/unit/CargoSystem.test.ts tests/unit/EconomySystem.test.ts tests/unit/FirstRouteObjective.test.ts tests/unit/WorldSceneEditorGuards.test.ts tests/integration/FirstFreightRoute.test.ts tests/e2e/first-freight-route.test.ts tests/fixtures/FirstFreightRouteFixture.ts
git add -u
git commit -m "refactor: establish schema 8 freight progress"
```

## Task 2: Separate Grant Income from Railway Operating Profit

**Files:**

- Modify: `src/economy/FinanceLedger.ts`
- Modify: `src/freight/FreightPresentation.ts`
- Modify: `src/ui/CompanyHud.ts`
- Modify: `tests/unit/FinanceLedger.test.ts`
- Modify: `tests/unit/FreightPresentation.test.ts`
- Modify: `tests/unit/CompanyHud.test.ts`

**Step 1: Write failing finance tests**

Post, in one 24-tick window:

- £1,000 delivery revenue;
- £250,000 contract bonus;
- £300 running expense;
- £2,000 capex.

Require:

```ts
{
  deliveryRevenue: 1_000,
  contractBonuses: 250_000,
  operatingExpenses: 300,
  railwayOperatingProfit: 700,
  capitalExpenditure: 2_000,
  cashFlow: 248_700,
}
```

Require the HUD to render `Last 24 ticks`, a separate `Development £250,000`
line, and `Rail profit £700`. Preserve the stable
`company-operating-profit` selector and add `company-contract-bonuses`.

Run:

```powershell
npx jest tests/unit/FinanceLedger.test.ts tests/unit/FreightPresentation.test.ts tests/unit/CompanyHud.test.ts --runInBand --coverage=false
```

Expected: FAIL because contract bonuses are currently included in the value
mislabelled delivery revenue and operating profit.

**Step 2: Implement category-aware summaries**

- Aggregate `delivery-revenue` and `contract-bonus` separately.
- Compute railway profit from deliveries less operating expenses.
- Include every signed entry in cash flow.
- Update `OperatingSummaryDto`, `buildOperatingSummary()`, and HUD copy.
- Keep train-level trip profit unchanged.

Run the focused command. Expected: PASS.

**Step 3: Commit**

```powershell
git add src/economy/FinanceLedger.ts src/freight/FreightPresentation.ts src/ui/CompanyHud.ts tests/unit/FinanceLedger.test.ts tests/unit/FreightPresentation.test.ts tests/unit/CompanyHud.test.ts
git commit -m "feat: report honest railway operating profit"
```

## Task 3: Generalise the Flatbed Freight Set

**Files:**

- Modify: `src/freight/FreightSetCatalog.ts`
- Modify: `src/freight/FreightPurchaseService.ts`
- Modify: `src/freight/RunningCostSystem.ts`
- Modify: `src/systems/tools/PlaceVehicleTool.ts`
- Modify: `src/ui/VehiclePurchasePanel.ts`
- Modify: `src/services/EventBus.ts`
- Modify: `src/scenes/WorldScene.ts`
- Modify: `tests/unit/FreightSetCatalog.test.ts`
- Modify: `tests/unit/FreightPurchaseService.test.ts`
- Modify: `tests/unit/RunningCostSystem.test.ts`
- Modify: `tests/unit/EventBus.test.ts`
- Modify: `tests/unit/PlaceVehicleTool.test.ts`
- Modify: `tests/unit/VehiclePurchasePanel.test.ts`
- Modify: `tests/unit/Train.test.ts`
- Modify: `tests/unit/TrainManager.test.ts`
- Modify: `tests/integration/GeneratedWorldStart.test.ts`

**Step 1: Write failing catalogue tests**

Require:

- exact ID/name/prices/capacities from the frozen interfaces;
- compatibility with logs and structural timber;
- 60-unit capacity for each;
- rejection of cement;
- immutable set and compatible-product arrays;
- purchase quotes and ledger references use `flatbed-freight-set`;
- running-cost lookup charges the renamed set.

Run:

```powershell
npx jest tests/unit/FreightSetCatalog.test.ts tests/unit/FreightPurchaseService.test.ts tests/unit/RunningCostSystem.test.ts tests/unit/EventBus.test.ts tests/unit/PlaceVehicleTool.test.ts tests/unit/VehiclePurchasePanel.test.ts tests/unit/Train.test.ts tests/unit/TrainManager.test.ts tests/integration/GeneratedWorldStart.test.ts --runInBand --coverage=false
```

Expected: FAIL on the old timber-only ID and compatibility.

**Step 2: Implement the catalogue rename**

- Replace timber constants with the frozen flatbed constants.
- Derive purchase price and event types from the definition where practical.
- Keep first purchase placement inside Managed Forest access and connected to
  Sawmill; this milestone reuses that train and does not add a second purchase
  path.
- Update player copy to `General Flatbed Set`.
- Remove every production occurrence of `timber-freight-set`,
  `TIMBER_FREIGHT`, and `Timber Freight Set`.

Run the focused command and:

```powershell
rg -n "timber-freight-set|TIMBER_FREIGHT|Timber Freight Set" src
```

Expected: tests PASS and scan returns no production matches.

**Step 3: Commit**

```powershell
git add src/freight/FreightSetCatalog.ts src/freight/FreightPurchaseService.ts src/freight/RunningCostSystem.ts src/systems/tools/PlaceVehicleTool.ts src/ui/VehiclePurchasePanel.ts src/services/EventBus.ts src/scenes/WorldScene.ts tests/unit/FreightSetCatalog.test.ts tests/unit/FreightPurchaseService.test.ts tests/unit/RunningCostSystem.test.ts tests/unit/EventBus.test.ts tests/unit/PlaceVehicleTool.test.ts tests/unit/VehiclePurchasePanel.test.ts tests/unit/Train.test.ts tests/unit/TrainManager.test.ts tests/integration/GeneratedWorldStart.test.ts
git commit -m "refactor: generalise the flatbed freight set"
```

## Task 4: Extract Pure Facility Cargo Rules

**Files:**

- Create: `src/freight/FacilityCargoRules.ts`
- Create: `tests/unit/FacilityCargoRules.test.ts`
- Modify: `src/economy/ProductCatalog.ts` only if a read-only ordered recipe
  helper is required
- Modify: `tests/unit/ProductCatalog.test.ts` only with that helper

**Step 1: Write the failing pure-rule matrix**

Test `eligibleLoadProducts()` and `facilityAcceptsProduct()` against cloned
catalogue facilities:

- Managed Forest loads logs, never structural timber;
- Sawmill loads structural timber and accepts logs;
- Prefabrication Plant accepts structural timber;
- Quarry output is rejected by the flatbed;
- a missing/idle/unknown recipe produces no source or destination;
- output order is recipe order with product-ID fallback;
- reserved stock reduces loadable availability;
- inbound free capacity is exactly `capacity - quantity` and ignores
  `reservedQuantity`;
- returned arrays/records are immutable and inputs are unchanged.

Run:

```powershell
npx jest tests/unit/FacilityCargoRules.test.ts tests/unit/ProductCatalog.test.ts --runInBand --coverage=false
```

Expected: FAIL because the rule module does not exist.

**Step 2: Implement pure rules**

The module may read immutable definitions through `ProductCatalog`, but must
not clone or mutate `EconomyStateDef`, post ledger entries, inspect train
runtime, or create UI strings. Return IDs and numeric availability/capacity.

Run the focused command. Expected: PASS.

**Step 3: Commit**

```powershell
git add src/freight/FacilityCargoRules.ts tests/unit/FacilityCargoRules.test.ts src/economy/ProductCatalog.ts tests/unit/ProductCatalog.test.ts
git commit -m "feat: derive cargo rules from facility recipes"
```

## Task 5: Make Cargo Transfer Product-Generic and Atomic

**Files:**

- Modify: `src/freight/CargoSystem.ts`
- Modify: `src/freight/RunningCostSystem.ts`
- Modify: `src/economy/EconomySystem.ts`
- Modify: `tests/unit/CargoSystem.test.ts`
- Modify: `tests/unit/RunningCostSystem.test.ts`
- Modify: `tests/unit/EconomySystem.test.ts`

**Step 1: Write failing transfer tests**

Cover:

- stopped empty flatbed loads logs at Forest;
- after log unloading and Sawmill production, the same flatbed loads
  structural timber;
- loaded structural timber unloads at Prefabrication Plant;
- each product capacity is derived as 60;
- each status carries `productId`, `facilityId`, and a blocker code;
- blocker precedence exactly matches the design;
- one train performs at most one 10-unit batch per tick;
- trains sort by ID; contained facilities sort by distance then ID;
- recipe output order resolves an otherwise ambiguous empty-train load;
- source reservations, destination full state, incompatibility, movement,
  derailment, and unknown definitions never mutate goods or cash;
- delivery events include exact product and delivered units;
- six-train contention remains deterministic and conserves units;
- a rejected operations batch leaks no proposed cargo/status/event state.

The conservation assertion for a completed Sawmill batch is:

```text
initial logs
  = forest logs + train logs + sawmill logs + 10 * completed sawmill batches

8 * completed sawmill batches
  = sawmill structural timber
  + train structural timber
  + prefab structural timber
```

Run:

```powershell
npx jest tests/unit/FacilityCargoRules.test.ts tests/unit/CargoSystem.test.ts tests/unit/RunningCostSystem.test.ts tests/unit/EconomySystem.test.ts --runInBand --coverage=false
```

Expected: FAIL on timber-specific branches, text blockers, and missing event
fields.

**Step 2: Implement generic transaction logic**

- Delete `sourceSlot`, `destinationSlot`, and Forest/Sawmill ID branches.
- Use the pure rule module to choose source/output or destination/input.
- Keep a homogeneous cargo batch and preserve its `originFacilityId`.
- Map running-cost failure to `insufficient-running-cash`.
- Pass `freightProgress` through proposals without changing it yet.
- Preserve the current tick order and single `applyOperationsBatch`.
- Freeze output DTOs and return only post-commit events from `EconomySystem`.

Run the focused command. Expected: PASS.

**Step 3: Commit**

```powershell
git add src/freight/CargoSystem.ts src/freight/RunningCostSystem.ts src/economy/EconomySystem.ts tests/unit/CargoSystem.test.ts tests/unit/RunningCostSystem.test.ts tests/unit/EconomySystem.test.ts
git commit -m "feat: transfer recipe-driven freight products"
```

## Task 6: Award the Development Grant and Latch Exact Deliveries

**Files:**

- Create: `src/config/FreightProgression.ts`
- Create: `src/freight/FreightProgress.ts`
- Modify: `src/freight/CargoSystem.ts`
- Modify: `src/economy/EconomySystem.ts`
- Modify: `src/config/WorldData.ts`
- Modify: `tests/unit/CargoSystem.test.ts`
- Modify: `tests/unit/EconomySystem.test.ts`
- Modify: `tests/unit/WorldSchemaValidation.test.ts`

**Step 1: Write failing progress/grant tests**

Require:

- a profitable full logs delivery to Sawmill latches
  `profitableLogDeliveryCompleted`;
- the same atomic proposal posts exactly £250,000 with category
  `contract-bonus` and reference
  `regional-development-grant:v1`;
- it sets `developmentGrantAwarded` only when posting succeeds;
- unprofitable, partial, wrong-product, or wrong-destination deliveries do
  neither;
- later log deliveries and reload never post a second grant;
- a profitable full structural-timber delivery to Prefabrication Plant latches
  only `profitableStructuralTimberDeliveryCompleted`;
- a stopped transfer tick incurs no active-running charge, and trip profit uses
  every preceding active tick;
- unsafe cash/ledger/progress values reject the whole proposal;
- schema validation requires grant-latch and canonical-ledger consistency.

Run:

```powershell
npx jest tests/unit/CargoSystem.test.ts tests/unit/EconomySystem.test.ts tests/unit/WorldSchemaValidation.test.ts --runInBand --coverage=false
```

Expected: FAIL because no grant or second latch exists.

**Step 2: Implement exact idempotency**

- Use only the progression constants file.
- Implement `countForwardRegionalDevelopmentGrants(company)` in
  `FreightProgress.ts`. Count only exact forward `contract-bonus` entries with
  revenue class, +£250,000 amount, canonical `:v1` reference, and no
  `reversalOf`.
- Qualify completed deliveries by both `productId` and destination definition
  ID.
- Post grant and set both first-log fields in one proposal; if posting fails,
  return the original aggregate.
- Validate exactly zero canonical grant entries when the latch is false and
  exactly one forward £250,000 canonical entry when true.
- Do not interpret unrelated `contract-bonus` entries as this grant.

Run the focused command. Expected: PASS.

**Step 3: Commit**

```powershell
git add src/config/FreightProgression.ts src/freight/FreightProgress.ts src/freight/CargoSystem.ts src/economy/EconomySystem.ts src/config/WorldData.ts tests/unit/CargoSystem.test.ts tests/unit/EconomySystem.test.ts tests/unit/WorldSchemaValidation.test.ts
git commit -m "feat: fund and persist freight progression"
```

## Task 7: Generate an Affordable Prefabrication Extension

**Files:**

- Create: `src/economy/PrefabricationOpportunity.ts`
- Modify: `src/economy/WorldEconomyGenerator.ts`
- Create: `tests/unit/PrefabricationOpportunity.test.ts`
- Modify: `tests/unit/WorldEconomyGenerator.test.ts`
- Modify: `tests/unit/WorldManager.test.ts`
- Modify: `tests/integration/GeneratedWorldStart.test.ts`
- Modify: `tests/performance/WorldGenerationBrowserHarness.test.ts`

**Step 1: Write failing generated-world tests**

For the existing representative seed table plus at least 25 deterministic
seed-sweep values, require:

- Prefabrication Plant remains separated and has valid footprint relief;
- `analyzePrefabricationExtension()` returns a valid ephemeral witness from
  Sawmill access centre to Prefab access centre;
- `proposal.costs.total + ENDPOINT_CONNECTION_COST` is at most £194,000;
- total grant inequality is at most £250,000;
- generation emits no player track, junction, train, station, or service;
- same seed reproduces positions and the recomputed witness cost;
- different seeds vary at least one secondary position;
- candidate count is bounded and exhaustion returns exact diagnostics;
- generated-world validation recomputes the Prefab witness rather than trusting
  generator output;
- a hostile fake economy generator with an unaffordable Prefab result is
  rejected atomically by `WorldManager`.

Run:

```powershell
npx jest tests/unit/PrefabricationOpportunity.test.ts tests/unit/WorldEconomyGenerator.test.ts tests/unit/WorldManager.test.ts tests/integration/GeneratedWorldStart.test.ts tests/performance/WorldGenerationBrowserHarness.test.ts --runInBand --coverage=false
```

Expected: FAIL because Prefab is currently an arbitrary secondary site.

**Step 2: Implement the shared derived witness**

`PrefabricationOpportunity.ts` exposes:

```ts
export interface PrefabricationExtensionWitness {
  readonly proposal: ConstructionProposal;
  readonly topologyCost: typeof ENDPOINT_CONNECTION_COST;
  readonly totalCost: number;
}

export function analyzePrefabricationExtension(
  analyzer: Pick<ConstructionAnalyzer, 'analyze'>,
  sawmill: Readonly<Vec2Def>,
  prefabricationPlant: Readonly<Vec2Def>,
): PrefabricationExtensionWitness | null;
```

It creates `deriveAutomaticCubic({ start: sawmill, end:
prefabricationPlant })`, analyses once, adds one
`ENDPOINT_CONNECTION_COST`, and returns `null` unless the proposal is valid and
total cost is at most `MAX_PREFAB_EXTENSION_WITNESS_COST`.

Write boundary tests for inclusive £194,000, rejected £194,001, invalid
geometry, and inclusion of topology cost.

**Step 3: Implement bounded candidate search**

- Instantiate one `ConstructionAnalyzer` in `WorldEconomyGenerator`.
- Search Prefab candidates first using the existing seeded coarse-grid stream.
- Canonicalise every candidate with `canonicalizeConstructionGridPoint()` and
  the player snap-grid size; de-duplicate canonical coordinates.
- Accept only candidates whose shared derived witness succeeds.
- Reserve the accepted site, then place Quarry, Cement Works, Port, and Town
  with the existing bounded separation/relief rules.
- Preserve the current generator method, result, diagnostics, and error shapes.
  `candidatesEvaluated` remains the total raw-candidate count and
  `facilitiesPlaced` counts Prefab first on failure.
- Make `validateGeneratedEconomy()` independently reanalyse the direct
  geometry and affordability.

Do not persist a solved corridor or draw it for the player.

Run the focused command and:

```powershell
npm run benchmark:world-generation
```

Expected: tests PASS and browser generation remains under two seconds.

**Step 4: Commit**

```powershell
git add src/economy/PrefabricationOpportunity.ts src/economy/WorldEconomyGenerator.ts tests/unit/PrefabricationOpportunity.test.ts tests/unit/WorldEconomyGenerator.test.ts tests/unit/WorldManager.test.ts tests/integration/GeneratedWorldStart.test.ts tests/performance/WorldGenerationBrowserHarness.test.ts
git commit -m "feat: generate an affordable prefab extension"
```

## Task 8: Replace the First-Route Card with Freight Progression

**Files:**

- Move: `src/freight/FirstRouteObjective.ts` →
  `src/freight/FreightObjective.ts`
- Move: `src/ui/FirstRouteObjectiveCard.ts` →
  `src/ui/FreightObjectiveCard.ts`
- Move: `tests/unit/FirstRouteObjective.test.ts` →
  `tests/unit/FreightObjective.test.ts`
- Move: `tests/unit/FirstRouteObjectiveCard.test.ts` →
  `tests/unit/FreightObjectiveCard.test.ts`
- Modify: `src/services/EventBus.ts`
- Modify: `src/scenes/WorldScene.ts`
- Modify: `src/scenes/EditorUIScene.ts`
- Modify: `tests/unit/EventBus.test.ts`
- Modify: `tests/unit/EditorUIScene.test.ts`
- Modify: `tests/unit/WorldSceneEditorGuards.test.ts`

**Step 1: Write failing objective tests**

Freeze:

```ts
type FreightObjectiveId =
  | 'first-profitable-route'
  | 'structural-timber-link';

interface FreightObjectiveDto {
  readonly objectiveVersion: 1;
  readonly id: FreightObjectiveId;
  readonly title: string;
  readonly status: string;
  readonly achieved: boolean;
  readonly steps: readonly FreightObjectiveStep[];
}
```

Require:

- first-route derivation remains unchanged before the first latch;
- after first completion, the active objective is `structural-timber-link`;
- its steps are `produce-structural-timber`, `connect-prefabrication-plant`,
  `load-structural-timber`, and `deliver-structural-timber-profitably`;
- production derives from Sawmill output/recent inflow, any train carrying
  structural timber, Prefab timber inflow, or the durable completion latch;
  connection derives from live topology and loading from train cargo;
- transient steps may regress before completion;
- once achieved, all steps stay complete after track/train removal;
- the card uses `[data-testid="freight-objective"]` and
  `data-objective="structural-timber-link"`;
- the card fits the existing mobile max-height and marks exactly one current
  step;
- celebrations fire once per world and objective ID, not once per render.

Run:

```powershell
npx jest tests/unit/FreightObjective.test.ts tests/unit/FreightObjectiveCard.test.ts tests/unit/EventBus.test.ts tests/unit/EditorUIScene.test.ts tests/unit/WorldSceneEditorGuards.test.ts --runInBand --coverage=false
```

Expected: FAIL until the moved/generalised implementation exists.

**Step 2: Implement the progression DTO and card**

- Rename the event to `ui:freight-objective`.
- Derive catalogue capacity instead of retaining `TIMBER_LOG_CAPACITY_UNITS`.
- Reuse one card; do not create a mission list or unlock subsystem.
- On first completion, show the development grant and next objective.
- On second completion, emit one success toast containing product,
  destination, revenue, and trip profit.
- Preserve pointer containment, responsive layout, and teardown listeners.

Run the focused command. Expected: PASS.

**Step 3: Commit**

```powershell
git add src/freight/FreightObjective.ts src/ui/FreightObjectiveCard.ts src/services/EventBus.ts src/scenes/WorldScene.ts src/scenes/EditorUIScene.ts tests/unit/FreightObjective.test.ts tests/unit/FreightObjectiveCard.test.ts tests/unit/EventBus.test.ts tests/unit/EditorUIScene.test.ts tests/unit/WorldSceneEditorGuards.test.ts
git add -u
git commit -m "feat: guide the structural timber objective"
```

## Task 9: Generalise Freight Presentation and Inspector UX

**Files:**

- Modify: `src/freight/FreightPresentation.ts`
- Modify: `src/economy/FacilityPresentation.ts`
- Modify: `src/ui/VehiclePurchasePanel.ts`
- Modify: `src/ui/TrainInspector.ts`
- Modify: `src/ui/FacilityInspector.ts`
- Modify: `src/systems/tools/PlaceVehicleTool.ts`
- Modify: `tests/unit/FreightPresentation.test.ts`
- Modify: `tests/unit/VehiclePurchasePanel.test.ts`
- Modify: `tests/unit/TrainInspector.test.ts`
- Modify: `tests/unit/FacilityInspector.test.ts`
- Modify: `tests/unit/WorldSceneOpportunityView.test.ts`

**Step 1: Write failing presentation tests**

Require:

- purchase card: `General Flatbed Set`, £90,000, `Logs · Structural Timber`,
  `60 tonnes`, and £20/active tick;
- train cargo displays `Logs 40 / 60 t`,
  `Structural Timber 40 / 60 t`, or `Empty 0 / 60 t`;
- nearest eligible facility comes from the chosen status/rules, never a
  hard-coded definition ID;
- every blocker code resolves to concise product/facility-aware remediation;
- unknown IDs fall back safely without leaking raw `undefined`;
- profit selectors exist:
  `train-current-trip-profit`, `train-last-delivery-profit`,
  `train-lifetime-profit`;
- Sawmill inspector shows log input and timber output;
- Prefab inspector shows structural timber received and remaining cement/steel
  input blockers;
- desktop and mobile panels remain within their existing bounds.

Run:

```powershell
npx jest tests/unit/FreightPresentation.test.ts tests/unit/VehiclePurchasePanel.test.ts tests/unit/TrainInspector.test.ts tests/unit/FacilityInspector.test.ts tests/unit/WorldSceneOpportunityView.test.ts --runInBand --coverage=false
```

Expected: FAIL on literal Logs/Forest/Sawmill/60-only DTOs and selectors.

**Step 2: Implement catalogue-driven presentation**

- Make DTO string fields dynamic.
- Resolve names and unit labels through `ProductCatalog`.
- Calculate capacity through `capacityForProduct`.
- Keep all blocker prose in `FreightPresentation`.
- Fix any existing mojibake touched in these files (`£`, `−`, `…`, `·`).
- Preserve current panel layering, input propagation stops, ARIA labels, and
  mobile bottom-sheet layout.

Run the focused command. Expected: PASS.

**Step 3: Commit**

```powershell
git add src/freight/FreightPresentation.ts src/economy/FacilityPresentation.ts src/ui/VehiclePurchasePanel.ts src/ui/TrainInspector.ts src/ui/FacilityInspector.ts src/systems/tools/PlaceVehicleTool.ts tests/unit/FreightPresentation.test.ts tests/unit/VehiclePurchasePanel.test.ts tests/unit/TrainInspector.test.ts tests/unit/FacilityInspector.test.ts tests/unit/WorldSceneOpportunityView.test.ts
git commit -m "feat: polish product-aware freight feedback"
```

## Task 10: Neutralise the Previously Controlled Train

**Files:**

- Modify: `src/managers/TrainManager.ts`
- Modify: `tests/unit/TrainManager.test.ts`
- Modify: `tests/unit/WorldSceneEditorGuards.test.ts`

**Step 1: Write failing selection tests**

Require both pointer and programmatic paths to:

- set the prior train's `enginePower` to zero before selecting another;
- clear prior `selected` state;
- emit one selection event for the new train;
- neutralise on deselect;
- avoid duplicate events when reselecting the same train;
- leave unrelated trains untouched.

Run:

```powershell
npx jest tests/unit/TrainManager.test.ts tests/unit/WorldSceneEditorGuards.test.ts --runInBand --coverage=false
```

Expected: FAIL because selection currently clears only the highlight.

**Step 2: Implement one internal handoff**

Extract a private `releaseSelectedTrain()` used by click selection,
programmatic selection, deselection, and removal. It sets `enginePower = 0`
before clearing selection/follow state. Do not create a new result type.

Run the focused command. Expected: PASS.

**Step 3: Commit**

```powershell
git add src/managers/TrainManager.ts tests/unit/TrainManager.test.ts tests/unit/WorldSceneEditorGuards.test.ts
git commit -m "fix: stop trains when control selection changes"
```

## Task 11: Prove the Complete Structural-Timber Transaction and Persistence

**Files:**

- Create: `tests/fixtures/StructuralTimberLinkFixture.ts`
- Create: `tests/integration/StructuralTimberLink.test.ts`
- Modify: `tests/integration/FirstFreightRoute.test.ts`
- Modify: `tests/integration/EconomyPersistence.test.ts`
- Modify: `tests/integration/ConstructionSupplyEconomy.test.ts`

**Step 1: Build a public-API integration harness**

Use only public `WorldManager`, `ConstructionService`, construction commands,
`TrackManager`, `FreightPurchaseService`, `EconomySystem`, `SaveService`, and
runtime snapshot APIs. Never cast into a production private field or directly
edit authoritative cargo, inventory, ledger, or progress after harness setup.

Write the test to:

1. create a schema-8 generated blank world;
2. build a valid Forest-to-Sawmill route;
3. buy the flatbed;
4. load 60 logs;
5. drive/unload and prove one profitable log delivery;
6. prove exactly one £250,000 grant;
7. advance fixed ticks until the Sawmill produces structural timber;
8. build the generated Sawmill-to-Prefab extension;
9. load structural timber in the same train;
10. drive/unload it at Prefab;
11. prove exact goods/cash/ledger/statistics/progress conservation;
12. save/reload at loading, transit, waiting-input, and achieved checkpoints;
13. repeat deliveries and prove no duplicate grant.

Run:

```powershell
npx jest tests/integration/StructuralTimberLink.test.ts tests/integration/FirstFreightRoute.test.ts tests/integration/EconomyPersistence.test.ts tests/integration/ConstructionSupplyEconomy.test.ts --runInBand --coverage=false
```

Expected: the new test first FAILS at the first missing public behavior, then
PASSES after only defects in prior task implementations are corrected.

**Step 2: Commit**

```powershell
git add tests/fixtures/StructuralTimberLinkFixture.ts tests/integration/StructuralTimberLink.test.ts tests/integration/FirstFreightRoute.test.ts tests/integration/EconomyPersistence.test.ts tests/integration/ConstructionSupplyEconomy.test.ts
git commit -m "test: prove the structural timber economy loop"
```

## Task 12: Add Real Browser Play Acceptance

**Files:**

- Create: `tests/e2e/structural-timber-link.test.ts`
- Modify: `tests/e2e/first-freight-route.test.ts`
- Modify: `tests/e2e/mobile-layout.test.ts`
- Modify: `src/scenes/WorldScene.ts` only for explicitly gated test-control
  observation, never mutation

**Step 1: Write the failing browser journey**

Run against the `build:test-controls` bundle. Across three fixed seeds, with
one case at 375×667:

- create a generated world and assert zero player infrastructure;
- construct the log route through real pointer gestures;
- purchase/place the General Flatbed Set;
- use genuine W/S input, stop, load, drive, and unload;
- assert one grant, rail profit separated from bonus income, and the objective
  transition;
- construct a player-chosen Sawmill-to-Prefab line;
- wait through real fixed ticks for processing;
- load structural timber in the same selected train;
- drive/unload and assert the exact delivery product/destination/profit;
- pause before conservation assertions;
- save/reload and assert schema/progress/cash/ledger/cargo/inventories;
- switch between two trains once and prove the previous engine power is zero;
- assert no console/page errors, no clipped critical action, and one current
  objective step.

Run:

```powershell
npm run build:test-controls
npx playwright test tests/e2e/first-freight-route.test.ts tests/e2e/structural-timber-link.test.ts tests/e2e/mobile-layout.test.ts --workers=1
```

Expected: FAIL before the journey is supported, then PASS without retries.

**Step 2: Keep controls observation-only**

If an additional test-control field is essential, it may expose a cloned
snapshot or invoke an existing public command. It must not set cash, inventory,
cargo, progress, topology, or objective state. Default production builds must
tree-shake/disable it through `__RAIL_SIM_TEST_CONTROLS__`.

**Step 3: Commit**

```powershell
git add tests/e2e/structural-timber-link.test.ts tests/e2e/first-freight-route.test.ts tests/e2e/mobile-layout.test.ts src/scenes/WorldScene.ts
git commit -m "test: play the structural timber link in browser"
```

## Task 13: Add the Economy Performance Fixture

**Files:**

- Create: `tests/performance/EconomyTickBenchmark.test.ts`
- Modify: `tests/fixtures/StructuralTimberLinkFixture.ts`

**Step 1: Write the benchmark**

Build a valid schema-8 fixture with seven facilities and twelve trains split
across loading, transit, unloading, idle, full-destination, and contention
states. Warm up 100 one-tick `EconomySystem.update(1_000, true, runtime)` calls,
measure 500, sort durations, and require p95 `< 16`.

Also assert deterministic end-state hashes for two identical runs so an
optimisation cannot skip authority work.

Run:

```powershell
npx jest tests/performance/EconomyTickBenchmark.test.ts --runInBand --coverage=false
```

Expected: first FAILS because the benchmark is absent, then PASS with the
production system. If it exceeds budget, profile and optimise only measured
hot paths; do not relax the threshold.

**Step 2: Commit**

```powershell
git add tests/performance/EconomyTickBenchmark.test.ts tests/fixtures/StructuralTimberLinkFixture.ts
git commit -m "test: budget multi-train economy ticks"
```

## Task 14: Run Independent Review and Full Verification

**Files:**

- Create:
  `docs/superpowers/reviews/2026-07-27-milestone-2c-structural-timber-evidence.md`
- Modify production/tests only for review findings proven by a failing
  regression test

**Step 1: Request independent reviews**

Use `superpowers:requesting-code-review` with at least:

- one spec/architecture reviewer;
- one economy/conservation/persistence reviewer;
- one UX/browser/accessibility reviewer.

Give reviewers the design, plan, base commit, head commit, and explicit YAGNI
boundary. Reviewers remain read-only. Triage every finding with
`superpowers:receiving-code-review`; reproduce valid issues before changing
code.

**Step 2: Run the full gates fresh**

```powershell
npx jest --runInBand --coverage
npm run build
npm run build:test-controls
npx playwright test --workers=1
npm run benchmark:construction-drag
npm run benchmark:world-generation
npx jest tests/performance/EconomyTickBenchmark.test.ts --runInBand --coverage=false
npx jest tests/unit/WebpackTestControls.test.ts tests/unit/WorldSceneEditorGuards.test.ts tests/unit/WebShell.test.ts --runInBand --coverage=false
git diff --check
git status --short
```

Required:

- every Jest suite passes;
- project coverage remains at least the existing 85% gate;
- every Playwright test passes without retry;
- construction and generation browser benchmarks remain within budget;
- economy p95 is below 16 ms;
- production build succeeds;
- privileged controls are disabled in production;
- no generated build output, screenshots, videos, coverage, or credentials are
  staged;
- worktree is clean after the evidence commit.

**Step 3: Record evidence**

The review document records exact commit SHA, test counts, coverage,
performance values, three seed outcomes, mobile viewport result, production
security scan, reviewer findings/dispositions, and known deferred scope. Do not
claim a gate that is not represented by fresh command output.

**Step 4: Commit**

```powershell
git add docs/superpowers/reviews/2026-07-27-milestone-2c-structural-timber-evidence.md
git commit -m "docs: record milestone 2c acceptance evidence"
```

Run the production build and security tests once more after this documentation
commit so the deploy SHA itself is verified.

## Task 15: Publish the Exact Verified Commit through Sites

**Skills:** `sites:sites-building`, then `sites:sites-hosting`.

**Files:**

- Reuse: `.openai/hosting.json`
- Do not create another Sites project

**Step 1: Prepare exact source**

- Read `.openai/hosting.json` and reuse its opaque `project_id`.
- Confirm the worktree is clean.
- Push the exact verified commit state required by Sites.
- Package the production output with the Sites skill helper.
- Ensure the archive/source commit is the same SHA recorded in evidence.

**Step 2: Save and deploy**

- Save a new version on the existing `rail-sim-progress` site.
- Keep owner-only access unless the user explicitly changes it.
- Deploy only that saved version.
- Never print or persist a bypass/authorization token.

**Step 3: Smoke-test production**

Using authenticated requests or the signed-in browser session:

- `/` and `/main.js` return 200;
- title is `Rail Sim Game`;
- Phaser creates exactly one canvas;
- no console/page errors occur;
- a blank schema-8 world can be generated;
- cash begins at £1,000,000;
- the first freight objective appears;
- production exposes none of the privileged test globals.

Record the deployed Sites version, deployment URL, exact commit SHA, and smoke
results in a follow-up evidence commit only if doing so does not change the
already deployed source artifact. Otherwise report the confirmed deployment in
the task handoff.

## Milestone 2C Acceptance

The milestone is complete only when:

- schema 8 is the sole accepted root shape and deliberately rejects schema 7;
- the first profitable log delivery posts one and only one £250,000
  development grant;
- grant income is separate from railway operating profit;
- the same General Flatbed Set carries logs and structural timber;
- cargo eligibility comes from active recipes, not hard-coded facility IDs;
- Sawmill processing and Prefab delivery conserve goods, cash, ledger entries,
  statistics, and progress through one authoritative transaction;
- every new generated world has one terrain-valid extension witness costing at
  most £194,000 while creating no player infrastructure;
- objective, inspectors, blockers, P&L, and mobile layout communicate the two
  freight legs clearly;
- selecting another train neutralises the old one;
- achievement, grant, inventories, cargo, and finances survive save/reload;
- full, browser, performance, build, security, and independent-review gates
  pass;
- the exact verified commit is live on the existing Sites project.

## Next Slice Boundary

After publication, continue the active full-game goal with the quarry →
cement-works slice. That slice adds the first real bulk and covered wagon
classes and feeds cement to Prefab. It must reuse the schema-8 progress,
product-generic cargo rules, generated-extension proof, finance separation, and
objective presentation established here. It still must not introduce services,
signals, consists, or a generic contract marketplace.
