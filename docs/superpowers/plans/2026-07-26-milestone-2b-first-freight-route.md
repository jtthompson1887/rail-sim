# Milestone 2B First Profitable Freight Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the player build, buy, load, manually drive, unload, profit from, repeat, and persist the first organic Managed Forest-to-Sawmill timber route.

**Architecture:** Keep freight content and simulation in small Phaser-free modules under `src/freight`, with schema-7 `WorldData.trains` and `WorldData.firstRouteProgress` as the authority. `WorldManager.applyOperationsBatch` installs company, economy, trains, and first-route progress atomically at one root revision; live `Train` objects provide physics snapshots and presentation only. `EconomySystem` proposes transfer, cost, industry, and market changes in deterministic order, commits at most four one-second ticks, and asks `WorldScene` to save the final committed state once.

**Tech Stack:** TypeScript 4, Phaser 3, Matter.js, Jest/ts-jest, Playwright, Webpack 5, Sites.

## Global Constraints

- The world remains a blank generated sandbox. It creates no player track, train, station, service, solved route, scenario, or contract.
- It is not a scenario, does not prebuild anything, gives no cash reward, and never blocks sandbox play.
- Generated worlds must guarantee that the cheapest valid starter corridor plus £90,000 train purchase plus £20,000 reserve fits within the £1,000,000 starting cash.
- The player may buy multiple instances when cash and valid placement allow it.
- One purchased set is one logical train and one physics follower.
- The stopped-speed boundary is inclusive: exactly 2 counts as stopped and any higher speed does not.
- At Managed Forest a train that is empty or already carrying logs, and remains below capacity, loads up to 10 available, unreserved log units per tick.
- At Sawmill a train carrying logs unloads up to 10 units per tick or the available destination capacity, whichever is smaller.
- The destination's pre-batch local log quote determines each batch's unit delivery payment, so a six-batch unload responds to rising Sawmill inventory pressure instead of locking one quote for the whole delivery.
- There is no commodity purchase charge at the forest: the company is paid for haulage by the receiving industry.
- Each purchased set has a £20 running cost for a fixed tick in which it is powered or moving.
- A stopped, zero-throttle train costs nothing.
- A derailed train costs nothing until recovered.
- All active-train costs in one fixed tick are summed into one `train-running-cost` ledger entry, keeping ledger growth bounded when later milestones add many trains.
- At economy tick `t`, the inclusive window is `max(0, t - 23)` through `t`.
- There is no migration or compatibility path because there is no existing player data.
- Schema 7 rejects schema 6 saves with the existing “Start a new world” action.
- `WorldData.firstRouteProgress` stores this object beside `economy` and `trains`.
- The persisted `WorldData.trains` array owns freight set, cargo, and financial statistics.
- Live `Train` objects own physics and presentation only.
- `TrainSerializer` merges runtime location/facing into an existing authoritative definition and must never reconstruct or overwrite cargo/economics.
- `WorldManager.applyOperationsBatch(expectedRevision, mutate)` clones company, economy, trains, and first-route progress, applies a pure mutation, validates the complete candidate, increments root/operations revisions once, and installs all four domains together.
- Rejection leaves every domain and revision unchanged.
- A train performs at most one load or unload batch per fixed tick.
- Catch-up may commit up to the existing four fixed ticks in order.
- The scene requests one save of the final authoritative catch-up state, not one localStorage write per individual tick.
- If localStorage persistence fails after an in-memory batch commits, the live world and train remain authoritative, the HUD reports `Unsaved`, and the exact state retries through the existing save path.
- A persistence failure never silently reverses or duplicates an economic transaction.
- Keyboard input is ignored when focus is within any inspector/control.
- Before every task commit, its focused tests, `npm run build`, and `git diff --check` must pass so each regular commit is an independently buildable checkpoint.
- Milestone 2B does not add:
  - scenarios or prebuilt worlds;
  - contracts, deadlines, bonuses, or cargo purchasing;
  - stations, services, schedules, or automatic routing;
  - physical couplers, consist editing, or separately simulated wagons;
  - multiple freight sets or locomotive choice;
  - cargo classes beyond the explicit compatibility list;
  - signals, pathfinding, maintenance, fuel, or paid recovery;
  - resale, loans, taxes, depreciation, or bankruptcy;
  - facility/town growth or global economic shocks;
  - parallel aggregate/cement/steel/module player flows.

---

## File Map

- `src/freight/FreightSetCatalog.ts`: immutable freight-set content, validation, lookup, and product-derived capacities.
- `src/config/WorldData.ts`: schema-7 authoritative train, first-route progress, revision, and cross-reference validation.
- `src/managers/WorldManager.ts`: one atomic operations mutation/install boundary and merge-only runtime-location synchronization.
- `src/freight/TrainRuntime.ts`: immutable runtime snapshot types and the live-train adapter that captures physics state.
- `src/entities/Train.ts`: one aggregate freight follower's physics-facing identity and stopped recovery.
- `src/managers/TrainManager.ts`: create/remove aggregate freight trains and stop insolvent trains.
- `src/utils/TrainSerializer.ts`: merge runtime location/facing into an existing authoritative `TrainDef`.
- `src/services/WorldContentLoader.ts`: restore every schema-7 train at its persisted track position and facing, stopped.
- `src/freight/RailAccessConnectivity.ts`: pure endpoint-ring and connected-component query.
- `src/systems/WorldOpportunityGenerator.ts`: reject generated opportunities that cannot preserve the train-and-operating reserve.
- `src/systems/WorldOpportunityValidator.ts`: enforce the same reserve guarantee for generated/persisted opportunities.
- `src/ui/ConstructionPreviewOverlay.ts`: expose reserve-warning state in the immutable construction preview.
- `src/ui/ConstructionInspector.ts`: show the exact route prompt and amber reserve warning.
- `src/freight/FreightPurchaseService.ts`: quote, validate, provisionally spawn, atomically purchase, compensate failed installs, and report save outcome.
- `src/systems/tools/PlaceVehicleTool.ts`: one purchase gesture for the Timber Freight Set instead of free legacy world-vehicle placement.
- `src/freight/CargoSystem.ts`: pure deterministic facility choice, cargo transfer, delivery revenue, trip roll-over, and blocker results.
- `src/freight/RunningCostSystem.ts`: pure per-train active-cost attribution and one aggregate ledger expense.
- `src/economy/EconomySystem.ts`: deterministic transfer/cost/industry/market fixed-tick orchestration.
- `src/freight/FirstRouteObjective.ts`: derive objective steps and session-local celebration from persisted state.
- `src/freight/FreightPresentation.ts`: immutable purchase, train-inspection, route-ready, objective, and company-summary DTOs.
- `src/ui/VehiclePurchasePanel.ts`: the one polished purchasable SKU and exact placement remedies.
- `src/ui/TrainInspector.ts`: selected-train controls, cargo progress, blockers, and trip/lifetime figures.
- `src/ui/FirstRouteObjectiveCard.ts`: compact persistent first-route guidance and achieved state.
- `src/ui/CompanyHud.ts`: inclusive last-24-tick operating summary and delivery cash pulse.
- `src/ui/FacilityInspector.ts`: transfer-aware source/destination status while retaining facility economy detail.
- `src/entities/FacilityView.ts`: route-ready and transfer-state map presentation.
- `src/scenes/EditorUIScene.ts`: own and input-gate the new DOM panels.
- `src/scenes/WorldScene.ts`: runtime snapshot collection, purchase wiring, selection exclusivity, one-save catch-up, objective events, and browser harness.
- `src/services/EventBus.ts`: typed presentation-only events for freight panels, celebration, cash pulse, and purchase intent.
- `tests/fixtures/FirstFreightRouteFixture.ts`: detached schema-7 forest/sawmill/track/train builders shared by unit and integration tests.
- `tests/e2e/first-freight-route.test.ts`: collective three-seed browser acceptance including one real-time trip.
- `docs/superpowers/reviews/2026-07-26-milestone-2b-evidence.md`: exact final evidence, playtest seeds, review disposition, commit SHA, Sites version, and production URL.

---

### Task 1: Validated Timber Freight Set Catalogue

**Files:**

- Create: `src/freight/FreightSetCatalog.ts`
- Create: `tests/unit/FreightSetCatalog.test.ts`
- Test: `tests/unit/ProductCatalog.test.ts`

**Interfaces:**

- Consumes: `ProductDefinition` and `getProduct(id: string): ProductDefinition | undefined`.
- Produces:

```ts
export interface FreightSetDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly compatibleProductIds: readonly string[];
  readonly payloadMassKg: number;
  readonly payloadVolumeLitres: number;
  readonly purchasePrice: number;
  readonly runningCostPerActiveTick: number;
}

export type FreightCapacityResult =
  | { ok: true; capacityUnits: number }
  | { ok: false; code: 'incompatible-product' | 'invalid-definition' };

export type FreightSetValidationResult =
  | { valid: true }
  | { valid: false; code: string; referenceId?: string };

export const TIMBER_FREIGHT_SET_ID = 'timber-freight-set';
export const TIMBER_TRAIN_PURCHASE_PRICE = 90_000;
export const OPERATING_RESERVE = 20_000;
export const STARTER_ROUTE_RESERVE = 110_000;
export const TIMBER_FREIGHT_SETS:
  readonly FreightSetDefinition[];
export function getFreightSet(id: string): FreightSetDefinition | undefined;
export function capacityForProduct(
  set: FreightSetDefinition,
  product: ProductDefinition,
): FreightCapacityResult;
export function validateFreightSetContent(
  sets: readonly FreightSetDefinition[],
  products: readonly ProductDefinition[],
): FreightSetValidationResult;
```

- Used by schema validation, generation affordability, purchase, cargo, running cost, and presentation tasks.

- [ ] **Step 1: Write the failing catalogue tests**

Assert the only ID, exact values, immutability, duplicate and unknown compatibility rejection, positive safe-integer fields, and exact log capacity:

```ts
expect(TIMBER_FREIGHT_SETS).toEqual([{
  id: 'timber-freight-set',
  displayName: 'Timber Freight Set',
  compatibleProductIds: ['logs'],
  payloadMassKg: 60_000,
  payloadVolumeLitres: 96_000,
  purchasePrice: 90_000,
  runningCostPerActiveTick: 20,
}]);
expect(capacityForProduct(
  getFreightSet('timber-freight-set')!,
  getProduct('logs')!,
)).toEqual({ ok: true, capacityUnits: 60 });
```

Also assert that a valid set can be looked up repeatedly but cannot be mutated, an incompatible product returns `{ ok: false, code: 'incompatible-product' }`, and zero/unsafe payload, price, cost, or duplicate compatible-product IDs fail validation.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx jest tests/unit/FreightSetCatalog.test.ts --runInBand --coverage=false
```

Expected: FAIL with `Cannot find module '../../src/freight/FreightSetCatalog'`.

- [ ] **Step 3: Implement the exact immutable catalogue**

Use the capacity formula without persisting its result:

```ts
const massCapacity = Math.floor(set.payloadMassKg / product.unitMassKg);
const volumeCapacity = Math.floor(
  set.payloadVolumeLitres / product.unitVolumeLitres,
);
const capacityUnits = Math.min(massCapacity, volumeCapacity);
```

Reject non-compatible products before division, require every numeric content field to be a positive safe integer, require non-empty unique IDs, and clone/freeze the set plus its compatibility array before exporting it.

- [ ] **Step 4: Run catalogue and product regression tests**

Run:

```powershell
npx jest tests/unit/FreightSetCatalog.test.ts tests/unit/ProductCatalog.test.ts --runInBand --coverage=false
```

Expected: PASS.

- [ ] **Step 5: Commit the independently reviewable catalogue**

```powershell
git add src/freight/FreightSetCatalog.ts tests/unit/FreightSetCatalog.test.ts
git commit -m "feat: add the timber freight set catalogue"
```

---

### Task 2: Schema 7 Freight Authority and Clean Break

**Files:**

- Modify: `src/config/WorldData.ts`
- Modify: `src/utils/TrainSerializer.ts`
- Modify: `src/services/WorldContentLoader.ts`
- Modify: `src/systems/tools/PlaceVehicleTool.ts`
- Modify: `src/scenes/WorldScene.ts`
- Modify: `tests/unit/WorldSchemaValidation.test.ts`
- Modify: `tests/unit/ConfigAndLevelData.test.ts`
- Modify: `tests/unit/SaveService.test.ts`
- Modify: `tests/unit/TrainSerializer.test.ts`
- Modify: `tests/unit/WorldContentLoader.test.ts`
- Modify: `tests/unit/PlaceVehicleTool.test.ts`
- Modify: `tests/unit/WorldSceneEditorGuards.test.ts`
- Create: `tests/fixtures/FirstFreightRouteFixture.ts`

**Interfaces:**

- Consumes: `getFreightSet`, `capacityForProduct`, `getProduct`, and generated facility/track IDs.
- Produces the exact schema-7 definitions:

```ts
export interface TrainCargoDef {
  productId: string;
  units: number;
  originFacilityId: string;
}

export interface TrainOperationsDef {
  currentTripRevenue: number;
  currentTripRunningCost: number;
  lastTripRevenue: number;
  lastTripRunningCost: number;
  lifetimeDeliveredUnits: number;
  lifetimeRevenue: number;
  lifetimeRunningCost: number;
}

export interface TrainDef {
  id: string;
  freightSetId: string;
  trackUUID: string;
  trackT: number;
  facing: 1 | -1;
  cargo: TrainCargoDef | null;
  operations: TrainOperationsDef;
}

export interface FirstRouteProgressDef {
  objectiveVersion: 1;
  profitableDeliveryCompleted: boolean;
}

export interface WorldData {
  schemaVersion: 7;
  revision: number;
  constructionRevision: number;
  operationsRevision: number;
  id: string;
  name: string;
  generationConfig: WorldGenerationConfigDef;
  company: CompanyStateDef;
  economy: EconomyStateDef;
  firstRouteProgress: FirstRouteProgressDef;
  starterOpportunity: StarterOpportunityDef;
  tracks: TrackDef[];
  junctions: JunctionDef[];
  stations: WorldStationDef[];
  trains: TrainDef[];
  scenery: SceneryObjectDef[];
  metadata: { createdAt: number; updatedAt: number };
}
```

- Maintains the invariant `revision = constructionRevision + operationsRevision`.
- Removes saved-train `type` and `passengers`; no schema-6 conversion is produced.
- Removes the authority-violating passenger placement/serialization path in the same buildable commit. Until Task 4 installs the aggregate runtime adapter, schema-7 train definitions remain safely persisted but are not materialised as legacy live passenger vehicles; no in-game purchase path exists until Task 7.

- [ ] **Step 1: Rewrite schema tests to fail on the schema-7 contract**

Add exact assertions for:

```ts
expect(createEmptyWorld('Freight', 'seed', 'temperate', opportunity))
  .toMatchObject({
    schemaVersion: 7,
    revision: 0,
    constructionRevision: 0,
    operationsRevision: 0,
    trains: [],
    firstRouteProgress: {
      objectiveVersion: 1,
      profitableDeliveryCompleted: false,
    },
  });
```

Test schema 6 incompatibility and the exact `Start a new world.` action. Test non-empty unique train IDs, known freight sets/tracks/products/origin facilities, finite `trackT` in `[0, 1]`, facing only `1 | -1`, positive safe cargo units, compatibility, derived capacity, null empty cargo, non-negative safe operation totals, and lifetime totals at least each current/last trip total. Assert any legacy `type` or `passengers` key is rejected.

- [ ] **Step 2: Run schema tests and verify RED**

Run:

```powershell
npx jest tests/unit/WorldSchemaValidation.test.ts tests/unit/ConfigAndLevelData.test.ts tests/unit/SaveService.test.ts --runInBand --coverage=false
```

Expected: FAIL because new worlds still report schema 6, use `economyRevision`, omit `firstRouteProgress`, and accept the legacy train shape.

- [ ] **Step 3: Implement the schema-7 root and cross-reference validator**

Use one validation pass that first validates root fields and ID sets, then trains:

```ts
const trackIds = new Set(world.tracks.map(({ uuid }) => uuid));
const facilityIds = new Set(
  world.economy.facilities.map(({ id }) => id),
);
const trainIds = new Set<string>();

for (const train of world.trains) {
  const set = getFreightSet(train.freightSetId);
  if (!set
    || !trackIds.has(train.trackUUID)
    || trainIds.has(train.id)
    || train.id.trim().length === 0) return incompatible(...);
  trainIds.add(train.id);
  if (train.cargo !== null) {
    const product = getProduct(train.cargo.productId);
    const capacity = product && capacityForProduct(set, product);
    if (!product
      || !facilityIds.has(train.cargo.originFacilityId)
      || !capacity
      || !capacity.ok
      || train.cargo.units > capacity.capacityUnits) return incompatible(...);
  }
}
```

Reject own-properties named `type` or `passengers`; require all monetary/unit totals with `Number.isSafeInteger(value) && value >= 0`; require `schemaVersion === 7`, `objectiveVersion === 1`, and a boolean latch.

- [ ] **Step 4: Update fixtures and old train assertions to the authoritative shape**

Use this empty authoritative train helper in `FirstFreightRouteFixture.ts`:

```ts
export const makeFreightTrainDef = (
  overrides: Partial<TrainDef> = {},
): TrainDef => ({
  id: 'train-1',
  freightSetId: 'timber-freight-set',
  trackUUID: 'forest-sawmill-track',
  trackT: 0.1,
  facing: 1,
  cargo: null,
  operations: {
    currentTripRevenue: 0,
    currentTripRunningCost: 0,
    lastTripRevenue: 0,
    lastTripRunningCost: 0,
    lifetimeDeliveredUnits: 0,
    lifetimeRevenue: 0,
    lifetimeRunningCost: 0,
  },
  ...overrides,
});
```

The fixture must construct referenced tracks and `managed-forest`/`sawmill` economy facilities before adding a train.

In the same step, make every production consumer compile against schema 7 without a compatibility model:

- remove `TrainSerializer.toTrainDef` and leave no serializer that can reconstruct authoritative train data;
- remove free locomotive/carriage creation from `PlaceVehicleTool`; pointer use must create no live/persisted vehicle and emit no false success;
- remove `WorldScene`'s call that rebuilt `WorldData.trains` from live vehicles before save;
- make `WorldContentLoader` skip schema-7 train materialisation rather than reading `type`/`passengers`; Task 4 replaces this deliberate no-runtime bridge with aggregate restoration;
- update the four focused consumer tests to prove no legacy passenger vehicle or destructive train array is produced.

- [ ] **Step 5: Run schema and save tests**

Run:

```powershell
npx jest tests/unit/WorldSchemaValidation.test.ts tests/unit/ConfigAndLevelData.test.ts tests/unit/SaveService.test.ts tests/unit/TrainSerializer.test.ts tests/unit/WorldContentLoader.test.ts tests/unit/PlaceVehicleTool.test.ts tests/unit/WorldSceneEditorGuards.test.ts --runInBand --coverage=false
npm run build
git diff --check
```

Expected: PASS, including schema-6 rejection.

- [ ] **Step 6: Commit the schema clean break**

```powershell
git add src/config/WorldData.ts src/utils/TrainSerializer.ts src/services/WorldContentLoader.ts src/systems/tools/PlaceVehicleTool.ts src/scenes/WorldScene.ts tests/unit/WorldSchemaValidation.test.ts tests/unit/ConfigAndLevelData.test.ts tests/unit/SaveService.test.ts tests/unit/TrainSerializer.test.ts tests/unit/WorldContentLoader.test.ts tests/unit/PlaceVehicleTool.test.ts tests/unit/WorldSceneEditorGuards.test.ts tests/fixtures/FirstFreightRouteFixture.ts
git commit -m "feat: make schema 7 trains freight authoritative"
```

---

### Task 3: One Atomic Operations Boundary

**Files:**

- Modify: `src/managers/WorldManager.ts`
- Modify: `src/economy/EconomySystem.ts`
- Modify: `src/systems/ConstructionService.ts`
- Modify: `src/systems/CommandStack.ts`
- Modify: `src/commands/PlaceTrackCommand.ts`
- Modify: `src/commands/DeleteTracksCommand.ts`
- Modify: `src/commands/ReshapeTrackCommand.ts`
- Modify: `tests/unit/WorldManager.test.ts`
- Modify: `tests/unit/EconomySystem.test.ts`
- Modify: `tests/unit/ConstructionService.test.ts`
- Modify: `tests/unit/PlaceTrackCommand.test.ts`
- Create: `tests/unit/DeleteTracksCommand.test.ts`
- Create: `tests/unit/ReshapeTrackCommand.test.ts`
- Modify: `tests/unit/CommandStack.test.ts`

**Interfaces:**

- Consumes the Task 2 root.
- Produces:

```ts
export interface OperationsDraft {
  company: CompanyStateDef;
  economy: EconomyStateDef;
  trains: TrainDef[];
  firstRouteProgress: FirstRouteProgressDef;
}

applyOperationsBatch(
  expectedRevision: number,
  mutate: (draft: OperationsDraft) => boolean,
): boolean;

export interface CommandRevisionContext {
  readonly authority: object;
  readonly rootRevision: number;
  readonly constructionRevision: number;
}
```

- `expectedRevision` is the root `WorldData.revision`, not the operations subrevision.
- Construction still calls `applyConstructionBatch(expectedConstructionRevision, mutate)`.
- Replaces every `economyRevision`/`applyEconomyBatch` call.
- Every remaining root mutation must advance exactly one matching subrevision. Existing station/scenery mutations advance `constructionRevision`; remove the public add/update/remove/set train-definition helpers so train authority can change only through `applyOperationsBatch`.
- Every revision-aware construction command and quote carries the dual root/construction cursor. A construction batch still mutates by construction subrevision, but the command must reject before it calls the batch unless both authoritative cursor values match.

- [ ] **Step 1: Write atomicity and stale-root tests**

Prove one successful batch can change cash, ledger, a facility, a train, and the progress latch together; increments root and operations revisions once; preserves construction revision; and keeps the invariant. Capture `JSON.stringify(world)` before stale revision, mutator rejection, a `true` no-op mutation, thrown mutation, invalid candidate, nested batch, and install failure, then assert exact byte equality afterward. Retain an escaped draft reference and prove mutating it after a successful commit cannot change the installed world. Also prove add/remove station and scenery mutations advance root plus construction together, the old add/update/remove/set train-definition methods are absent, and a train change through `applyOperationsBatch` advances root plus operations. For place/delete/reshape histories, create an undo and redo state, perform one operations batch, then prove stale undo/redo/record reject without world/live mutation because root changed while construction revision did not. Finally push one freshly quoted construction command: it must clear the invalid old histories, adopt the current dual cursor, execute successfully, and become the sole undo entry.

```ts
const before = JSON.stringify(WorldManager.world);
expect(WorldManager.applyOperationsBatch(
  WorldManager.world!.revision - 1,
  () => true,
)).toBe(false);
expect(JSON.stringify(WorldManager.world)).toBe(before);
```

Add an install-failure test by making one of `company`, `economy`, `trains`, or `firstRouteProgress` non-writable; all four domains and revisions must restore.

- [ ] **Step 2: Run boundary tests and verify RED**

Run:

```powershell
npx jest tests/unit/WorldManager.test.ts tests/unit/EconomySystem.test.ts tests/unit/ConstructionService.test.ts tests/unit/PlaceTrackCommand.test.ts tests/unit/DeleteTracksCommand.test.ts tests/unit/ReshapeTrackCommand.test.ts tests/unit/CommandStack.test.ts --runInBand --coverage=false
```

Expected: FAIL because `applyOperationsBatch` does not exist and the current economy batch compares `economyRevision`.

- [ ] **Step 3: Implement clone-validate-install once**

Use detached plain-data clones:

```ts
const snapshot = clonePlainData(world);
if (world.revision !== expectedRevision || !this.canAdvanceRevision()) {
  return false;
}
const draft: OperationsDraft = {
  company: clonePlainData(world.company),
  economy: clonePlainData(world.economy),
  trains: clonePlainData(world.trains),
  firstRouteProgress: clonePlainData(world.firstRouteProgress),
};
if (!mutate(draft)) return false;
const candidate: WorldData = {
  ...snapshot,
  revision: snapshot.revision + 1,
  operationsRevision: snapshot.operationsRevision + 1,
  company: draft.company,
  economy: draft.economy,
  trains: draft.trains,
  firstRouteProgress: draft.firstRouteProgress,
};
```

Reject when all four draft domains remain plain-data equal to the snapshot. Validate `candidate` before assigning. Install cloned versions of all four domains and both revisions inside one guarded `try`; on any exception call the existing snapshot restore. Keep `batchInProgress` active across mutation, validation, and install so construction/operations nesting rejects.

- [ ] **Step 4: Replace economy batch callers and revision assertions**

At each call, read `const expectedRevision = world.revision`, mutate `draft.economy`, and let `applyOperationsBatch` advance the root once. Replace the old root-only `incrementRevision()` helper with domain-specific revision advancement. Station/scenery helpers advance construction with the root. Delete `addTrainDef`, `updateTrainDef`, `removeTrainDef`, and `setTrainDefs`; Task 2 removed their production callers, while purchase/location/cargo paths use the operations batch.

Change `ConstructionQuote` to store both `rootRevision` and `constructionRevision`. `ConstructionService.revalidateQuote*` rejects if either differs. `PlaceTrackCommand`, `DeleteTracksCommand`, and `ReshapeTrackCommand` store `expectedRootRevision` plus `expectedConstructionRevision`, compare both before execute/undo, advance both after their own successful construction batch, and rebase both. `CommandStack.sameRevisionContext` compares authority plus both fields; `canRecordRevisionContext` accepts only a command result whose root and construction cursors each equal the prior cursor plus one.

Undo, redo, and record require their existing exact/next cursor rules. `push()` has one recovery rule for a genuinely fresh command: when authority is unchanged, the incoming root/construction cursors are each greater than or equal to the last cursor, and at least one is greater, clear both stale stacks, adopt the incoming cursor, then attempt the new command. Never apply this rule to undo/redo/record or to a regressing/different-authority cursor. If the fresh command fails, the already-invalid old history stays cleared. This lets an operations-only root increment invalidate old history while the player's next fresh construction begins a new valid history. Tests must assert `revision === constructionRevision + operationsRevision` after every public mutation.

- [ ] **Step 5: Run focused atomicity and construction regression tests**

Run:

```powershell
npx jest tests/unit/WorldManager.test.ts tests/unit/EconomySystem.test.ts tests/unit/ConstructionService.test.ts tests/unit/PlaceTrackCommand.test.ts tests/unit/DeleteTracksCommand.test.ts tests/unit/ReshapeTrackCommand.test.ts tests/unit/CommandStack.test.ts --runInBand --coverage=false
```

Expected: PASS.

- [ ] **Step 6: Commit the operations boundary**

```powershell
git add src/managers/WorldManager.ts src/economy/EconomySystem.ts src/systems/ConstructionService.ts src/systems/CommandStack.ts src/commands/PlaceTrackCommand.ts src/commands/DeleteTracksCommand.ts src/commands/ReshapeTrackCommand.ts tests/unit/WorldManager.test.ts tests/unit/EconomySystem.test.ts tests/unit/ConstructionService.test.ts tests/unit/PlaceTrackCommand.test.ts tests/unit/DeleteTracksCommand.test.ts tests/unit/ReshapeTrackCommand.test.ts tests/unit/CommandStack.test.ts
git commit -m "refactor: install operations through one atomic batch"
```

---

### Task 4: Aggregate Train Runtime, Serializer, and Loader

**Files:**

- Create: `src/freight/TrainRuntime.ts`
- Modify: `src/entities/Train.ts`
- Modify: `src/managers/TrainManager.ts`
- Modify: `src/utils/TrainSerializer.ts`
- Modify: `src/services/WorldContentLoader.ts`
- Modify: `src/scenes/WorldScene.ts`
- Modify: `tests/unit/Train.test.ts`
- Modify: `tests/unit/TrainManager.test.ts`
- Modify: `tests/unit/TrainSerializer.test.ts`
- Modify: `tests/unit/WorldContentLoader.test.ts`
- Modify: `tests/unit/WorldSceneEditorGuards.test.ts`

**Interfaces:**

- Consumes `TrainDef`, `FreightSetDefinition`, and `WorldManager.applyOperationsBatch`.
- Produces:

```ts
export interface TrainRuntimeSnapshot {
  readonly trainId: string;
  readonly trackUUID: string | null;
  readonly trackT: number | null;
  readonly facing: 1 | -1;
  readonly x: number;
  readonly y: number;
  readonly speedWorldUnitsPerSecond: number;
  readonly throttle: -1 | 0 | 1;
  readonly derailed: boolean;
}

export function captureTrainRuntime(train: Train): TrainRuntimeSnapshot;

export class TrainSerializer {
  static mergeRuntime(
    authoritative: TrainDef,
    runtime: TrainRuntimeSnapshot,
  ): TrainDef | null;
}

TrainManager.createFreightTrain(
  id: string,
  freightSetId: string,
): Train;
TrainManager.removeFreightTrain(trainId: string): boolean;
TrainManager.stopFreightTrains(trainIds: readonly string[]): void;
```

- `mergeRuntime` changes only `trackUUID`, `trackT`, and `facing`; cargo and all seven operations totals remain byte-equal.

- [ ] **Step 1: Write aggregate runtime round-trip tests**

Test authoritative definition → live train → runtime merge for facing `1` and `-1`; stopped reload; exact track `t`; and cargo/economic preservation:

```ts
const merged = TrainSerializer.mergeRuntime(authoritative, runtime)!;
expect(merged).toEqual({
  ...authoritative,
  trackUUID: 'track-b',
  trackT: 0.75,
  facing: -1,
});
expect(merged.cargo).toEqual(authoritative.cargo);
expect(merged.cargo).not.toBe(authoritative.cargo);
expect(merged.operations).toEqual(authoritative.operations);
expect(merged.operations).not.toBe(authoritative.operations);
```

Test off-track/derailed runtime returns `null`, loader skips a missing referenced track defensively, placement applies `track.getTrackAngle(body) + 180` for facing `-1`, and every restored train has zero velocity and zero engine power. In a mixed sync, a moved on-track train commits its new location while a derailed train retains a detached clone of its last authoritative location and cargo/statistics; no `null` enters `draft.trains`. Assert no carriage is created for a freight set.

- [ ] **Step 2: Run runtime tests and verify RED**

Run:

```powershell
npx jest tests/unit/Train.test.ts tests/unit/TrainManager.test.ts tests/unit/TrainSerializer.test.ts tests/unit/WorldContentLoader.test.ts tests/unit/WorldSceneEditorGuards.test.ts --runInBand --coverage=false
```

Expected: FAIL because runtime merge/facing APIs do not exist and the loader reads legacy `type`/`passengers`.

- [ ] **Step 3: Implement the one-follower freight runtime**

Store only `freightSetId` as presentation identity on `Train`; do not store cargo or financial totals. `createFreightTrain` must create one `Train`, one `TrackFlowSolver`, and one body mapping. `removeFreightTrain` removes it from arrays/maps, destroys its body/container, clears selection if selected, and updates active-train count.

Capture speed from Matter velocity:

```ts
const velocity = train.getMatterBody().body.velocity;
const speedWorldUnitsPerSecond = Math.hypot(velocity.x, velocity.y) * 60;
```

Convert `enginePower` to `-1 | 0 | 1`. Derive facing by the dot product of the body's forward unit vector and `currentTrack.getCurvePath().getTangent(trackT)`; `dot >= 0` is `1`, otherwise `-1`.

- [ ] **Step 4: Implement merge-only serialization and stopped restoration**

Clone the nested authoritative fields before return. Reject runtime snapshots whose train ID differs, track fields are null, or `trackT` is outside `[0, 1]`.

In `WorldContentLoader.restoreVehicle`, call `createFreightTrain(def.id, def.freightSetId)`, place at `def.trackT`, set track, set angle with facing, then explicitly call:

```ts
vehicle.enginePower = 0;
vehicle.getMatterBody().setVelocity(0, 0);
vehicle.getMatterBody().setAngularVelocity(0);
```

- [ ] **Step 5: Replace destructive world-train synchronization**

Replace Task 2's save-only no-runtime bridge with `WorldScene.syncTrainLocationsAndSave()`. Capture live snapshots, then call one `applyOperationsBatch(world.revision, draft => ...)` that maps each authoritative train through `mergeRuntime`; use `merged ?? clonePlainData(authoritative)` for an off-track/derailed snapshot, return `false` if no valid location changed, and never rebuild the array from live objects. If the location batch has no changes, call `WorldManager.save()` directly; if it commits, save that committed state.

- [ ] **Step 6: Run runtime and save-guard tests**

Run:

```powershell
npx jest tests/unit/Train.test.ts tests/unit/TrainManager.test.ts tests/unit/TrainSerializer.test.ts tests/unit/WorldContentLoader.test.ts tests/unit/WorldSceneEditorGuards.test.ts --runInBand --coverage=false
```

Expected: PASS, including proof that a save cannot erase cargo or statistics.

- [ ] **Step 7: Commit the aggregate runtime boundary**

```powershell
git add src/freight/TrainRuntime.ts src/entities/Train.ts src/managers/TrainManager.ts src/utils/TrainSerializer.ts src/services/WorldContentLoader.ts src/scenes/WorldScene.ts tests/unit/Train.test.ts tests/unit/TrainManager.test.ts tests/unit/TrainSerializer.test.ts tests/unit/WorldContentLoader.test.ts tests/unit/WorldSceneEditorGuards.test.ts
git commit -m "feat: restore aggregate freight trains without losing authority"
```

---

### Task 5: Pure Rail-Access Connectivity

**Files:**

- Create: `src/freight/RailAccessConnectivity.ts`
- Modify: `src/scenes/WorldScene.ts`
- Create: `tests/unit/RailAccessConnectivity.test.ts`
- Test: `tests/unit/TrackManager.test.ts`
- Test: `tests/unit/WorldSceneOpportunityView.test.ts`

**Interfaces:**

- Consumes existing `TrackTopologySnapshot`, persisted `TrackDef` endpoints, and facility `railAccess`.
- Produces:

```ts
export interface RailAccessRing {
  readonly facilityId: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface RailAccessConnectivityResult {
  readonly connected: boolean;
  readonly sourceEndpointTrackUUIDs: readonly string[];
  readonly destinationEndpointTrackUUIDs: readonly string[];
  readonly connectedTrackUUIDs: readonly string[];
}

export function queryRailAccessConnectivity(
  tracks: readonly TrackDef[],
  topology: TrackTopologySnapshot,
  source: RailAccessRing,
  destination: RailAccessRing,
): RailAccessConnectivityResult;
```

- `TrackManager.captureTopology()` remains the live graph adapter; no Phaser object enters the pure query.

- [ ] **Step 1: Write endpoint/component tests**

Cover a connected direct line, a multi-track chain, a junction path, two disconnected endpoint stubs, an orphan source-ring stub beside a different valid route, midpoint-only ring overlap, an endpoint exactly on the radius boundary, a missing topology node, and stable sorted endpoint/connected UUIDs.

```ts
expect(queryRailAccessConnectivity(
  tracks,
  disconnectedTopology,
  forestRing,
  sawmillRing,
).connected).toBe(false);
```

The midpoint-only case must remain false because access is proven by endpoints, not a curve sample.

- [ ] **Step 2: Run connectivity tests and verify RED**

Run:

```powershell
npx jest tests/unit/RailAccessConnectivity.test.ts tests/unit/TrackManager.test.ts --runInBand --coverage=false
```

Expected: FAIL because `RailAccessConnectivity.ts` does not exist.

- [ ] **Step 3: Implement deterministic graph traversal**

Select a track endpoint when:

```ts
Math.hypot(endpoint.x - ring.x, endpoint.y - ring.y) <= ring.radius
```

Build an adjacency map from each topology node's `previous` and `next` references, adding both directions. For every sorted source track UUID, breadth-first traverse `track:<uuid>` plus junction nodes. Return connected when any visited `track:<uuid>` belongs to the destination set. Return `connectedTrackUUIDs` as the stable sorted union of track nodes in only those source components that reach a destination endpoint; unknown references do not create connectivity.

- [ ] **Step 4: Replace the one-ring presentation helper**

Keep `WorldScene`'s single-facility display capability, but route-ready, purchase placement, and objective callers must all call `queryRailAccessConnectivity` with the same captured topology and persisted tracks. Do not retain a second two-ring connectivity algorithm.

- [ ] **Step 5: Run connectivity tests**

Run:

```powershell
npx jest tests/unit/RailAccessConnectivity.test.ts tests/unit/TrackManager.test.ts tests/unit/WorldSceneOpportunityView.test.ts --runInBand --coverage=false
```

Expected: PASS.

- [ ] **Step 6: Commit the shared graph query**

```powershell
git add src/freight/RailAccessConnectivity.ts src/scenes/WorldScene.ts tests/unit/RailAccessConnectivity.test.ts tests/unit/WorldSceneOpportunityView.test.ts
git commit -m "feat: prove facility access through the live rail graph"
```

---

### Task 6: Starter Affordability Guarantee and Reserve Warning

**Files:**

- Modify: `src/systems/WorldOpportunityGenerator.ts`
- Modify: `src/systems/WorldOpportunityValidator.ts`
- Modify: `src/ui/ConstructionPreviewOverlay.ts`
- Modify: `src/ui/ConstructionInspector.ts`
- Modify: `src/systems/tools/PlaceTrackTool.ts`
- Modify: `src/scenes/WorldScene.ts`
- Modify: `tests/unit/WorldOpportunityGenerator.test.ts`
- Modify: `tests/unit/WorldOpportunityValidator.test.ts`
- Modify: `tests/unit/ConstructionInspector.test.ts`
- Modify: `tests/unit/PlaceTrackTool.construction.test.ts`
- Modify: `tests/unit/WorldSceneOpportunityView.test.ts`

**Interfaces:**

- Consumes `STANDARD_STARTING_CASH = 1_000_000` and Task 1 `STARTER_ROUTE_RESERVE = 110_000`.
- Produces:

```ts
export const MAX_STARTER_CORRIDOR_COST =
  STANDARD_STARTING_CASH - STARTER_ROUTE_RESERVE; // 890_000

export interface ConstructionPreviewModel {
  readonly phase: ConstructionToolPhase;
  readonly proposal: ConstructionProposal;
  readonly predictedConnections:
    ReadonlyArray<PredictedEndpointConnectionDef>;
  readonly engineeringSubtotal: number;
  readonly topologyCost: number;
  readonly totalCost: number;
  readonly cashBefore: number;
  readonly cashAfter: number;
  readonly structureLengths:
    Readonly<Record<StructureType, number>>;
  readonly affordable: boolean;
  readonly canConfirm: boolean;
  readonly stale: boolean;
  readonly message: string;
  readonly actions:
    ReadonlyArray<'confirm' | 'backstep' | 'cancel'>;
  readonly breachesStarterReserve: boolean;
}
```

- The reserve is advisory at construction confirmation; normal affordability remains the only hard cash rejection.
- Define and export `MAX_STARTER_CORRIDOR_COST` from `WorldOpportunityValidator.ts`; `WorldOpportunityGenerator.ts` already imports that module and must consume the same constant rather than define a second limit.

- [ ] **Step 1: Write affordability and warning tests**

Assert generation/validation accepts a cheapest corridor of exactly `890_000` and rejects `890_001`. Assert a `cashAfter` of `110_000` has no warning, `109_999` has an amber warning but `canConfirm === true`, and a genuinely unaffordable build still rejects.

Assert both the inspector/presentation model and `WorldScene.renderStarterOpportunitySurvey()` contain this exact prompt:

```text
Connect Managed Forest to Sawmill. Keep £110,000 for a timber train and operating reserve.
```

- [ ] **Step 2: Run reserve tests and verify RED**

Run:

```powershell
npx jest tests/unit/WorldOpportunityGenerator.test.ts tests/unit/WorldOpportunityValidator.test.ts tests/unit/ConstructionInspector.test.ts tests/unit/PlaceTrackTool.construction.test.ts tests/unit/WorldSceneOpportunityView.test.ts --runInBand --coverage=false
```

Expected: FAIL because the current opportunity limit is £1,000,000 and previews have no reserve state.

- [ ] **Step 3: Enforce the generated-world guarantee**

Replace both generator and validator cheaper-corridor limits with `MAX_STARTER_CORRIDOR_COST`. Keep bounded generation attempts unchanged. Update the validator's rejection reason to `opportunity breaches starter reserve`.

- [ ] **Step 4: Add the advisory preview and exact copy**

Set:

```ts
breachesStarterReserve:
  preview.affordable && preview.cashAfter < STARTER_ROUTE_RESERVE
```

Render the exact prompt above in `WorldScene.renderStarterOpportunitySurvey()`. In the construction inspector render an amber message `Build leaves less than the £110,000 train and operating reserve` while leaving the build button enabled. An unaffordable message remains the hard blocker.

- [ ] **Step 5: Run generation and inspector tests**

Run:

```powershell
npx jest tests/unit/WorldOpportunityGenerator.test.ts tests/unit/WorldOpportunityValidator.test.ts tests/unit/ConstructionInspector.test.ts tests/unit/PlaceTrackTool.construction.test.ts tests/unit/WorldSceneOpportunityView.test.ts --runInBand --coverage=false
```

Expected: PASS.

- [ ] **Step 6: Commit the starter reserve**

```powershell
git add src/systems/WorldOpportunityGenerator.ts src/systems/WorldOpportunityValidator.ts src/ui/ConstructionPreviewOverlay.ts src/ui/ConstructionInspector.ts src/systems/tools/PlaceTrackTool.ts src/scenes/WorldScene.ts tests/unit/WorldOpportunityGenerator.test.ts tests/unit/WorldOpportunityValidator.test.ts tests/unit/ConstructionInspector.test.ts tests/unit/PlaceTrackTool.construction.test.ts tests/unit/WorldSceneOpportunityView.test.ts
git commit -m "feat: preserve the starter train operating reserve"
```

---

### Task 7: Atomic Freight-Set Purchase and Placement

**Files:**

- Create: `src/freight/FreightPurchaseService.ts`
- Modify: `src/systems/tools/PlaceVehicleTool.ts`
- Modify: `src/managers/TrainManager.ts`
- Modify: `src/scenes/WorldScene.ts`
- Modify: `src/services/EventBus.ts`
- Create: `tests/unit/FreightPurchaseService.test.ts`
- Modify: `tests/unit/PlaceVehicleTool.test.ts`
- Modify: `tests/unit/WorldSceneEditorGuards.test.ts`
- Modify: `tests/unit/EventBus.test.ts`

**Interfaces:**

- Consumes Task 3 `applyOperationsBatch(expectedRevision, mutate)`, Task 4 runtime creation/removal, Task 5 connectivity, `postLedgerEntry`, and `WorldManager.save()`.
- Produces:

```ts
export type FreightPurchaseBlocker =
  | 'no-track'
  | 'outside-forest-access'
  | 'disconnected-route'
  | 'insufficient-cash'
  | 'duplicate-gesture'
  | 'duplicate-train-id'
  | 'stale-revision'
  | 'live-spawn-failed'
  | 'live-placement-failed'
  | 'world-install-failed';

export interface FreightPurchaseQuote {
  readonly expectedRevision: number;
  readonly freightSetId: 'timber-freight-set';
  readonly trackUUID: string;
  readonly trackT: number;
  readonly facing: 1 | -1;
  readonly purchasePrice: 90_000;
  readonly cashAfter: number;
  readonly affordable: boolean;
  readonly valid: boolean;
  readonly blocker: FreightPurchaseBlocker | null;
}

export type FreightPurchaseResult =
  | {
    ok: true;
    trainId: string;
    saved: boolean;
    saveState: 'saved' | 'unsaved';
  }
  | { ok: false; blocker: FreightPurchaseBlocker };

export interface FreightPurchaseRuntimePort {
  spawn(trainId: string, freightSetId: string): Train | null;
  place(
    train: Train,
    trackUUID: string,
    trackT: number,
    facing: 1 | -1,
  ): boolean;
  remove(trainId: string): void;
}

export interface FreightPurchaseQuoteInput {
  readonly freightSetId: 'timber-freight-set';
  readonly trackUUID: string;
  readonly trackT: number;
  readonly x: number;
  readonly y: number;
  readonly topology: TrackTopologySnapshot;
}

export class FreightPurchaseService {
  constructor(
    worldPort: Pick<
      typeof WorldManager,
      'world' | 'applyOperationsBatch' | 'save'
    >,
    runtimePort: FreightPurchaseRuntimePort,
    idFactory: () => string = () => crypto.randomUUID(),
  );
  quote(input: FreightPurchaseQuoteInput): FreightPurchaseQuote;
  purchase(quote: FreightPurchaseQuote): FreightPurchaseResult;
}
```

- A SKU ID is never checked for uniqueness; only generated train IDs and an in-flight gesture token are unique, so one SKU permits multiple train instances.
- Add these exact typed `EventMap` contracts using type-only imports:

```ts
'freight:purchase-mode-requested': {
  freightSetId: 'timber-freight-set';
};
'ui:freight-purchase-state': {
  quote: FreightPurchaseQuote | null;
  cash: number;
  message: string;
};
'freight:purchase-confirmed': {
  quote: FreightPurchaseQuote;
};
'freight:purchase-result': FreightPurchaseResult;
```

`VehiclePurchasePanel` consumes/emits them in Task 12; Task 7 wires `PlaceVehicleTool` and `WorldScene`, freezes/detaches quotes before emission, and proves the typed payload round trip through `EventBus.test.ts`.

- [ ] **Step 1: Write purchase failure-matrix tests**

Test success plus insufficient cash, stale root revision, duplicate train ID, duplicate simultaneous gesture, no track, outside forest ring, disconnected route, live spawn failure, live placement failure, operations install failure, and post-commit save failure. Assert the exact blocker union member for every case.

On success assert exactly one train, one `vehicle-capex` ledger entry of `-90_000`, cash reduced by `90_000`, and one operations/root revision increment. On every pre-commit failure assert no live/persisted train, cash/ledger/revisions unchanged. Include the case where one valid forest-to-sawmill route exists but the selected forest-ring track is an orphan stub, and the case where a connected route track's midpoint enters the ring while neither endpoint does; both placements must return `disconnected-route`. On save failure assert the live and persisted train plus ledger remain, result is `saveState: 'unsaved'`, and retrying save does not post a second purchase.

- [ ] **Step 2: Run purchase tests and verify RED**

Run:

```powershell
npx jest tests/unit/FreightPurchaseService.test.ts tests/unit/PlaceVehicleTool.test.ts tests/unit/WorldSceneEditorGuards.test.ts tests/unit/EventBus.test.ts --runInBand --coverage=false
```

Expected: FAIL because `FreightPurchaseService.ts` and the quoted purchase flow do not exist.

- [ ] **Step 3: Implement quote validation**

Require the placement point to be on player track, its centre inside Managed Forest's persisted access ring with `distance <= radius`, and the selected track UUID to belong to both Task 5's `sourceEndpointTrackUUIDs` and `connectedTrackUUIDs`; global connectivity through a different source-ring stub or a connected track with no endpoint inside Forest access is insufficient. Derive facing from that selected source-ring endpoint: `1` when `p0` is the unique Forest endpoint and `-1` when `p3` is; if both endpoints are inside, choose the facing whose endpoint tangent has the greater dot product toward the Sawmill rail-access centre, with `1` as the exact tie-break. Compute cash from current authoritative company state. Return one exact blocker in this priority: duplicate gesture, stale revision, no track, outside access, disconnected route, insufficient cash.

- [ ] **Step 4: Implement provisional spawn then atomic install**

Generate the train ID once. Reject `duplicate-train-id` before spawning if it already exists in authoritative state. Spawn and place the live train before world mutation so a spawn failure cannot spend cash. Map `spawn() === null` to `live-spawn-failed`; map `place() === false` to `live-placement-failed` and remove the provisional train immediately. Then:

```ts
const createPurchasedTrainDef = (
  trainId: string,
  quote: FreightPurchaseQuote,
): TrainDef => ({
  id: trainId,
  freightSetId: 'timber-freight-set',
  trackUUID: quote.trackUUID,
  trackT: quote.trackT,
  facing: quote.facing,
  cargo: null,
  operations: {
    currentTripRevenue: 0,
    currentTripRunningCost: 0,
    lastTripRevenue: 0,
    lastTripRunningCost: 0,
    lifetimeDeliveredUnits: 0,
    lifetimeRevenue: 0,
    lifetimeRunningCost: 0,
  },
});

const committed = worldPort.applyOperationsBatch(
  quote.expectedRevision,
  (draft) => {
    if (draft.trains.some(({ id }) => id === trainId)) return false;
    const posted = postLedgerEntry(draft.company, {
      magnitude: 90_000,
      category: 'vehicle-capex',
      tick: draft.economy.tick,
      referenceId: trainId,
      direction: 'forward',
    });
    if (!posted.ok) return false;
    draft.company = posted.company;
    draft.trains.push(createPurchasedTrainDef(trainId, quote));
    return true;
  },
);
if (!committed) runtimePort.remove(trainId);
```

If the batch rejects after provisional placement, remove the live train and return `stale-revision` when the root changed, otherwise `world-install-failed`; cash, ledger, persisted trains, and revisions remain unchanged. After a committed purchase, clear the now-stale construction command stack/toolbar state, select the purchased aggregate train, clear facility selection, retain the quote's facing so positive throttle points from the Forest-side placement toward Sawmill, and call save once. Do not remove or refund on save failure.

- [ ] **Step 5: Replace free placement with the purchase gesture**

`PlaceVehicleTool` supports only `timber-freight-set` in generated worlds. Hover renders valid player track inside forest access; click requests a fresh quote and confirmation through typed events. Keep one `purchaseInFlight` boolean until the result returns. Report exact remedies:

```text
Click on player track to place the Timber Freight Set
Place inside Managed Forest rail access
Connect Managed Forest and Sawmill first
Insufficient cash for Timber Freight Set
Purchase already in progress
```

On `stale-revision`, discard the old quote, build and render a fresh quote from the current root revision, and report `Freight state changed · review and retry purchase`. Do not reuse the provisional ID or spawn from the stale quote.

- [ ] **Step 6: Run purchase and placement tests**

Run:

```powershell
npx jest tests/unit/FreightPurchaseService.test.ts tests/unit/PlaceVehicleTool.test.ts tests/unit/WorldSceneEditorGuards.test.ts tests/unit/EventBus.test.ts tests/unit/FinanceLedger.test.ts --runInBand --coverage=false
```

Expected: PASS.

- [ ] **Step 7: Commit the atomic purchase**

```powershell
git add src/freight/FreightPurchaseService.ts src/systems/tools/PlaceVehicleTool.ts src/managers/TrainManager.ts src/scenes/WorldScene.ts src/services/EventBus.ts tests/unit/FreightPurchaseService.test.ts tests/unit/PlaceVehicleTool.test.ts tests/unit/WorldSceneEditorGuards.test.ts tests/unit/EventBus.test.ts
git commit -m "feat: purchase and place freight sets atomically"
```

---

### Task 8: Pure Cargo Transfer, Delivery Revenue, and Trip Roll-Over

**Files:**

- Create: `src/freight/CargoSystem.ts`
- Create: `tests/unit/CargoSystem.test.ts`

**Interfaces:**

- Consumes authoritative company/economy/trains/progress, freight/product catalogues, `quoteLocalProduct`, `postLedgerEntry`, and Task 4 runtime snapshots.
- Produces:

```ts
export type CargoBlocker =
  | 'Stop the train to transfer cargo'
  | 'Move inside Managed Forest rail access'
  | 'Move inside Sawmill rail access'
  | 'Waiting for logs'
  | 'Timber set is full'
  | 'Sawmill input storage is full'
  | 'Cargo is not accepted here'
  | 'Insufficient cash for running costs'
  | 'Re-rail the train before operating';

export interface CargoTransferStatus {
  readonly trainId: string;
  readonly facilityId: string | null;
  readonly kind: 'loading' | 'unloading' | 'blocked' | 'idle';
  readonly blocker: CargoBlocker | null;
  readonly batchUnits: number;
  readonly cargoUnits: number;
  readonly capacityUnits: number;
  readonly batchRevenue: number;
}

export interface CargoTickProposal {
  readonly company: CompanyStateDef;
  readonly economy: EconomyStateDef;
  readonly trains: readonly TrainDef[];
  readonly firstRouteProgress: FirstRouteProgressDef;
  readonly statuses: readonly CargoTransferStatus[];
  readonly completedDeliveries: readonly FreightDeliveryEvent[];
  readonly changed: boolean;
}

export interface FreightDeliveryEvent {
  readonly trainId: string;
  readonly destinationFacilityId: string;
  readonly tick: number;
  readonly revenue: number;
  readonly runningCost: number;
  readonly operatingProfit: number;
}

export function proposeCargoTick(input: {
  readonly operating: boolean;
  readonly company: CompanyStateDef;
  readonly economy: EconomyStateDef;
  readonly trains: readonly TrainDef[];
  readonly firstRouteProgress: FirstRouteProgressDef;
  readonly runtime: readonly TrainRuntimeSnapshot[];
}): CargoTickProposal;
```

- The function is pure and returns detached frozen output.
- Every train is processed once in stable train-ID order and receives at most one batch.

- [ ] **Step 1: Write eligibility, selection, and blocker tests**

Cover Operate mode, on-track, derailment, zero throttle, speed `0`, exactly `2`, and `2.000001`; centre/radius inclusion; physical rings before eligibility; overlapping rings; nearest eligible facility; facility-ID tie-break; nearest contained physical blocker; and nearest relevant source/destination “move inside” remedy.

Assert exact blockers from the interface. A derailed train always reports `Re-rail the train before operating`; any non-zero throttle or speed above `2` reports `Stop the train to transfer cargo`.

- [ ] **Step 2: Run eligibility tests and verify RED**

Run:

```powershell
npx jest tests/unit/CargoSystem.test.ts --runInBand --coverage=false
```

Expected: FAIL because `CargoSystem.ts` does not exist.

- [ ] **Step 3: Write conservation and capacity tests**

Test empty and partial train loading, an already-log-loaded train, incompatible onboard cargo, 10-unit clamps, source unreserved availability, source exhaustion, exact capacity, partial destination space, full destination, movement interruption, and at-most-one batch.

For every accepted load:

```ts
expect(
  beforeForestLogs + beforeCargoUnits,
).toBe(afterForestLogs + afterCargoUnits);
```

For every accepted unload:

```ts
expect(
  beforeCargoUnits + beforeSawmillLogs,
).toBe(afterCargoUnits + afterSawmillLogs);
```

- [ ] **Step 4: Implement deterministic facility resolution and loading**

For each runtime snapshot, first collect all facility rings containing `(x, y)` using `distance <= radius`. Determine load eligibility from a Managed Forest log output slot and unload eligibility from a destination inventory slot accepting the onboard product. Sort eligible facilities by distance then ID. If none is eligible, derive the blocker from the nearest contained physical facility; if no ring contains the train, derive the nearest relevant source/destination remedy.

Load:

```ts
accepted = Math.min(
  10,
  source.quantity - source.reservedQuantity,
  capacityUnits - currentCargoUnits,
);
```

Subtract exactly `accepted` from source quantity, add its recent outflow, and create/extend `TrainCargoDef` with `originFacilityId` set on the first accepted unit. Do not post a charge.

- [ ] **Step 5: Implement pre-batch quoted unloading and final trip roll-over**

Before mutating the Sawmill slot, call:

```ts
const quote = quoteLocalProduct(
  cargo.productId,
  economy.market,
  destinationSlot,
);
```

Then compute:

```ts
accepted = Math.min(
  10,
  cargo.units,
  destinationSlot.capacity - destinationSlot.quantity,
);
batchRevenue = accepted * quote.unitPrice;
```

Require a safe integer revenue. Add only accepted units and recent inflow, subtract cargo, post one `delivery-revenue` entry with `referenceId: `${train.id}:${economy.tick}:${destination.id}``, and add revenue/lifetime delivered units to that train.

When and only when the last onboard unit unloads:

```ts
const profitable =
  operations.currentTripRevenue + batchRevenue
  > operations.currentTripRunningCost;
operations.lastTripRevenue =
  operations.currentTripRevenue + batchRevenue;
operations.lastTripRunningCost =
  operations.currentTripRunningCost;
operations.currentTripRevenue = 0;
operations.currentTripRunningCost = 0;
firstRouteProgress.profitableDeliveryCompleted ||= profitable;
train.cargo = null;
```

This ordering makes the return trip begin immediately after complete unload.

- [ ] **Step 6: Add batch-by-batch repricing assertions**

Starting with a 60-unit train and empty Sawmill log slot, run six proposals against each preceding output. Assert six independently computed pre-batch quotes, exact total revenue, six ledger entries, 60 lifetime delivered units, a null cargo, copied last-trip figures, zeroed current-trip figures, and the profitability latch only when revenue exceeds cost. The first five proposals emit no completed-delivery event; the sixth emits exactly one detached event with the complete trip revenue, running cost, and operating profit at the current economy tick.

At the validated market-factor bounds, assert the six-batch gross falls in the approved approximate `£5,290..£7,930` range before concurrent Sawmill processing.

- [ ] **Step 7: Run cargo tests**

Run:

```powershell
npx jest tests/unit/CargoSystem.test.ts tests/unit/Inventory.test.ts tests/unit/MarketSystem.test.ts tests/unit/FinanceLedger.test.ts --runInBand --coverage=false
```

Expected: PASS.

- [ ] **Step 8: Commit pure cargo operations**

```powershell
git add src/freight/CargoSystem.ts tests/unit/CargoSystem.test.ts
git commit -m "feat: transfer timber cargo and settle delivery revenue"
```

---

### Task 9: Aggregate Running Costs and Insolvency Stop

**Files:**

- Create: `src/freight/RunningCostSystem.ts`
- Create: `tests/unit/RunningCostSystem.test.ts`

**Interfaces:**

- Consumes Task 1 freight-set costs, Task 4 runtime snapshots, Task 8 post-transfer train state, and `postLedgerEntry`.
- Produces:

```ts
export interface RunningCostTickProposal {
  readonly company: CompanyStateDef;
  readonly trains: readonly TrainDef[];
  readonly activeTrainIds: readonly string[];
  readonly stopTrainIds: readonly string[];
  readonly aggregateCost: number;
  readonly blockerByTrainId: Readonly<Record<string, CargoBlocker | null>>;
  readonly changed: boolean;
}

export function proposeRunningCosts(input: {
  readonly tick: number;
  readonly company: CompanyStateDef;
  readonly trains: readonly TrainDef[];
  readonly runtime: readonly TrainRuntimeSnapshot[];
}): RunningCostTickProposal;
```

- A train is active exactly when it is not derailed and either `throttle !== 0` or `speedWorldUnitsPerSecond > 2`; a zero-throttle train at exactly `2` is stopped and costs nothing.

- [ ] **Step 1: Write active/cost attribution tests**

Cover powered stopped, unpowered moving, fully stopped, derailed powered, one train, multiple instances of the same SKU, missing runtime, and safe-integer overflow. For three active timber trains assert one `train-running-cost` ledger entry for `£60`, and exactly `£20` added to each train's current-trip and lifetime running cost.

- [ ] **Step 2: Run running-cost tests and verify RED**

Run:

```powershell
npx jest tests/unit/RunningCostSystem.test.ts --runInBand --coverage=false
```

Expected: FAIL because `RunningCostSystem.ts` does not exist.

- [ ] **Step 3: Implement one aggregate expense**

Sort active train IDs, sum each set's integer `runningCostPerActiveTick` with safe-integer checks, and post:

```ts
postLedgerEntry(company, {
  magnitude: aggregateCost,
  category: 'train-running-cost',
  tick,
  referenceId: `active-trains:${tick}`,
  direction: 'forward',
});
```

On success, add each train's own set cost directly to `currentTripRunningCost` and `lifetimeRunningCost`; do not divide the aggregate.

- [ ] **Step 4: Implement all-or-nothing insolvency**

If company cash cannot cover `aggregateCost`, return the original company and train definitions, `changed: false`, every active ID in `stopTrainIds`, and `Insufficient cash for running costs` for every affected train. No unpaid entry or statistic is posted. The scene will zero those live trains before another tick.

- [ ] **Step 5: Run cost and ledger tests**

Run:

```powershell
npx jest tests/unit/RunningCostSystem.test.ts tests/unit/FinanceLedger.test.ts --runInBand --coverage=false
```

Expected: PASS.

- [ ] **Step 6: Commit aggregate running costs**

```powershell
git add src/freight/RunningCostSystem.ts tests/unit/RunningCostSystem.test.ts
git commit -m "feat: aggregate freight running costs per tick"
```

---

### Task 10: Fixed-Tick Operations Orchestration and Save Retry

**Files:**

- Modify: `src/economy/EconomySystem.ts`
- Modify: `src/scenes/WorldScene.ts`
- Modify: `src/managers/WorldManager.ts`
- Modify: `src/managers/TrainManager.ts`
- Modify: `src/systems/InputManager.ts`
- Modify: `tests/unit/EconomySystem.test.ts`
- Modify: `tests/unit/WorldSceneEditorGuards.test.ts`
- Modify: `tests/unit/TrainManager.test.ts`
- Modify: `tests/unit/InputManager.test.ts`
- Test: `tests/unit/SaveService.test.ts`
- Modify: `tests/integration/EconomyPersistence.test.ts`

**Interfaces:**

- Consumes Tasks 8 and 9 proposal functions plus existing industry/market functions.
- Produces:

```ts
export interface EconomyUpdateResult {
  readonly ticksAdvanced: number;
  readonly changedFacilityIds: string[];
  readonly cargoStatuses: readonly CargoTransferStatus[];
  readonly completedDeliveries: readonly FreightDeliveryEvent[];
  readonly runningCostBlockerByTrainId:
    Readonly<Record<string, CargoBlocker | null>>;
  readonly stopTrainIds: readonly string[];
  readonly commitRejected: boolean;
  readonly authoritativeChanged: boolean;
}

update(
  deltaMs: number,
  operating: boolean,
  runtime: readonly TrainRuntimeSnapshot[],
): EconomyUpdateResult;
```

- Retains `ECONOMY_TICK_MS = 1_000` and `MAX_ECONOMY_TICKS_PER_FRAME = 4`.

- [ ] **Step 1: Write orchestration-order and catch-up tests**

Assert each fixed tick executes:

```text
stable-ID cargo transfer
aggregate running cost
facility recipes and boundary production
market drift
one operations install
presentation result
```

Prove final unload resets the completed trip to zero while the stopped zero-throttle train incurs no same-tick running cost; the next later tick in which that train is powered or moving adds its cost to the new current trip. Prove entries from 24 successful updates are labelled ticks 1..24 and all 24 appear in the inclusive tick-24 P&L window. Prove 5,000 ms commits exactly four ticks on the first update and one on the next; each tick increments root/operations revisions once; at most one transfer per train per tick; completed deliveries from an early catch-up sub-tick remain in the returned event list; running-cost blockers survive the catch-up result; a rejected tick remains accumulated; and Build/paused mode advances none. In a consecutive-frame scene/input test, hold W through an insolvent tick and prove the train is zeroed before input handling, remains zero on the next committed frame, cannot move unpaid, and continues to display `Insufficient cash for running costs` rather than a cargo idle/location blocker until unlocked.

- [ ] **Step 2: Run orchestrator tests and verify RED**

Run:

```powershell
npx jest tests/unit/EconomySystem.test.ts tests/unit/WorldSceneEditorGuards.test.ts tests/unit/SaveService.test.ts tests/integration/EconomyPersistence.test.ts --runInBand --coverage=false
```

Expected: FAIL because `EconomySystem.update` has no runtime input and does not orchestrate cargo/cost domains.

- [ ] **Step 3: Implement one operations batch per fixed tick**

For each pending tick, snapshot the runtime by train ID and call `applyOperationsBatch(world.revision, draft => ...)`. Inside:

1. Compute `operationTick = draft.economy.tick + 1`, reject overflow, and set `draft.economy.tick = operationTick` before any ledger-producing operation.
2. Call `proposeCargoTick` using draft domains; clone its company/economy/progress outputs and assign `draft.trains = cargo.trains.map(clonePlainData)` so the readonly proposal never aliases the mutable draft.
3. Call `proposeRunningCosts` with `tick: operationTick` using the post-transfer company/trains; clone its company and assign `draft.trains = costs.trains.map(clonePlainData)`.
4. Advance facilities in stable ID order.
5. Drift the market using `operationTick`.
6. Return `true`.

Consume exactly 1,000 accumulator milliseconds only after a successful install. Retain the latest cargo status per train ID, merge the latest non-null running-cost blocker per train ID, append every completed-delivery event in committed tick/train order, and return the stable sorted union of stop IDs. Never emit proposal events from a rejected tick.

- [ ] **Step 4: Preserve runtime locations in the same tick candidate**

Before cargo resolution, merge every valid runtime location into its corresponding authoritative train with `TrainSerializer.mergeRuntime`. This gives each committed tick an exact persisted track location/facing without another revision. Cargo/economic nested fields remain from the authoritative draft.

- [ ] **Step 5: Save once after catch-up and retain committed state on failure**

In `WorldScene.update`, capture runtime once, call `EconomySystem.update`, and clear any still-exposed construction command history/toolbar state on the first `authoritativeChanged` operations result. Add all returned stop IDs to a scene-owned `operationsLockedTrainIds`, and zero them before any same-frame input handling. Pass that lock set to `TrainManager`/`InputManager` so held keyboard and mobile throttle cannot immediately repower a locked train. Clear the complete lock set only after a later committed update leaves those IDs unblocked and authoritative cash can cover the sum of one active tick for every locked train; otherwise retain it. For every still-locked ID, synthesize/retain `Insufficient cash for running costs` as the inspector's overriding transfer blocker even when the now-zeroed train produces no fresh running-cost blocker; remove it atomically with the lock. Refresh every presentation surface after the complete batch, emit one concise success toast and positive cash pulse for each returned completed-delivery event, merge any returned running-cost blocker into the affected train inspector status, and call `saveWorldAndReport(false)` once if `authoritativeChanged`.

If save returns false, retain `lastReportedSaveState = 'unsaved'`. A later `Ctrl+S`, mode switch, periodic safety save, or committed tick calls `WorldManager.save()` on the same current world. It must not rerun `EconomySystem.update`, repost ledger entries, or reconstruct trains.

If `commitRejected` is true, do not consume the tick or save. Refresh runtime and presentation from the current authoritative world and emit `Freight state changed · retry operation`; the next eligible fixed tick proposes the operation again from the refreshed root revision.

- [ ] **Step 6: Test a post-commit localStorage failure and exact retry**

Mock the first `SaveService.saveWorld` call false and the second true. Assert the in-memory tick, inventory, cargo, ledger, statistics, cash, and revisions after the first call equal the values written on the second call; assert ledger length and operation revision do not increase during retry.

- [ ] **Step 7: Run orchestrator and persistence tests**

Run:

```powershell
npx jest tests/unit/EconomySystem.test.ts tests/unit/WorldSceneEditorGuards.test.ts tests/unit/TrainManager.test.ts tests/unit/InputManager.test.ts tests/unit/SaveService.test.ts tests/integration/EconomyPersistence.test.ts --runInBand --coverage=false
```

Expected: PASS.

- [ ] **Step 8: Commit fixed-tick operations and retry**

```powershell
git add src/economy/EconomySystem.ts src/scenes/WorldScene.ts src/managers/WorldManager.ts src/managers/TrainManager.ts src/systems/InputManager.ts tests/unit/EconomySystem.test.ts tests/unit/WorldSceneEditorGuards.test.ts tests/unit/TrainManager.test.ts tests/unit/InputManager.test.ts tests/integration/EconomyPersistence.test.ts
git commit -m "feat: commit freight operations on fixed ticks"
```

---

### Task 11: Derived First-Route Objective and Session Celebration

**Files:**

- Create: `src/freight/FirstRouteObjective.ts`
- Create: `tests/unit/FirstRouteObjective.test.ts`

**Interfaces:**

- Consumes Task 5 connectivity and authoritative world state.
- Produces:

```ts
export type FirstRouteStepId =
  | 'connect-route'
  | 'buy-train'
  | 'load-logs'
  | 'deliver-logs'
  | 'run-profitably';

export interface FirstRouteObjectiveStep {
  readonly id: FirstRouteStepId;
  readonly label: string;
  readonly state: 'complete' | 'current' | 'pending';
}

export interface FirstRouteObjectiveDto {
  readonly objectiveVersion: 1;
  readonly achieved: boolean;
  readonly steps: readonly FirstRouteObjectiveStep[];
}

export function deriveFirstRouteObjective(
  world: WorldData,
  topology: TrackTopologySnapshot,
): FirstRouteObjectiveDto;

export class FirstRouteCelebrationSession {
  consume(worldId: string, dto: FirstRouteObjectiveDto): boolean;
}

export const firstRouteCelebrationSession:
  FirstRouteCelebrationSession;
```

- Only `WorldData.firstRouteProgress.profitableDeliveryCompleted` is a dedicated historical latch. The other four steps derive from persisted track/train/cargo/operations facts; `Load logs` remains derived as complete after any recorded delivery so an unprofitable first trip cannot visually regress the ordered objective.

- [ ] **Step 1: Write objective derivation tests**

Prove:

- disconnected endpoint stubs leave `Connect the route` current;
- connected graph completes `Connect the route`;
- any persisted Timber Freight Set instance completes `Buy the train`;
- a timber train at 60/60 completes `Load logs`; after the first partial unload and every later phase, `lifetimeDeliveredUnits > 0` keeps that derived step complete;
- `lastTripRevenue > 0` and `lifetimeDeliveredUnits > 0` completes `Deliver logs`;
- only the root latch completes `Run profitably`;
- later track/train deletion cannot clear achieved state;
- achieved state yields one celebration per world ID from a fresh session object and zero on subsequent refreshes/scene reloads within that runtime session; another achieved world ID may celebrate once.

- [ ] **Step 2: Run objective tests and verify RED**

Run:

```powershell
npx jest tests/unit/FirstRouteObjective.test.ts --runInBand --coverage=false
```

Expected: FAIL because `FirstRouteObjective.ts` does not exist.

- [ ] **Step 3: Implement immutable step derivation**

Use the exact labels:

```ts
[
  'Connect the route',
  'Buy the train',
  'Load logs',
  'Deliver logs',
  'Run profitably',
]
```

Define `Load logs` as complete when a timber train is currently at 60/60 or any timber train has `lifetimeDeliveredUnits > 0`; define `Deliver logs` as complete when any timber train has both `lastTripRevenue > 0` and `lifetimeDeliveredUnits > 0`. Mark all facts before the first incomplete step `complete`, the first incomplete step `current`, and later steps `pending`. If the root latch is true, all steps are `complete` regardless of later demolition/deletion.

- [ ] **Step 4: Implement one celebration per runtime session**

`FirstRouteCelebrationSession` owns an in-memory `Set<string>` of celebrated world IDs; `consume(worldId, dto)` returns true only on the first achieved call for that non-empty world ID. Export one module-lifetime `firstRouteCelebrationSession` singleton. `WorldScene` must consume this singleton in Task 12, so destroying/recreating the scene or save/reloading the same world in the same page cannot replay the celebration. A full browser/page reload starts a new runtime session. It does not mutate `WorldData`.

- [ ] **Step 5: Run objective tests**

Run:

```powershell
npx jest tests/unit/FirstRouteObjective.test.ts tests/unit/RailAccessConnectivity.test.ts --runInBand --coverage=false
```

Expected: PASS.

- [ ] **Step 6: Commit the derived objective**

```powershell
git add src/freight/FirstRouteObjective.ts tests/unit/FirstRouteObjective.test.ts
git commit -m "feat: derive the first profitable route objective"
```

---

### Task 12: Freight Presentation, Responsive UI, and Input Safety

**Files:**

- Create: `src/freight/FreightPresentation.ts`
- Create: `src/ui/VehiclePurchasePanel.ts`
- Create: `src/ui/TrainInspector.ts`
- Create: `src/ui/FirstRouteObjectiveCard.ts`
- Modify: `src/ui/CompanyHud.ts`
- Modify: `src/ui/FacilityInspector.ts`
- Modify: `src/entities/FacilityView.ts`
- Modify: `src/scenes/EditorUIScene.ts`
- Modify: `src/scenes/WorldScene.ts`
- Modify: `src/systems/InputManager.ts`
- Modify: `src/services/EventBus.ts`
- Create: `tests/unit/FreightPresentation.test.ts`
- Create: `tests/unit/VehiclePurchasePanel.test.ts`
- Create: `tests/unit/TrainInspector.test.ts`
- Create: `tests/unit/FirstRouteObjectiveCard.test.ts`
- Modify: `tests/unit/CompanyHud.test.ts`
- Modify: `tests/unit/FacilityInspector.test.ts`
- Modify: `tests/unit/FacilityView.test.ts`
- Modify: `tests/unit/EditorUIScene.test.ts`
- Modify: `tests/unit/InputManager.test.ts`
- Modify: `tests/unit/EventBus.test.ts`
- Modify: `tests/unit/WorldSceneEditorGuards.test.ts`

**Interfaces:**

- Consumes purchase quotes/results, cargo statuses, runtime snapshots, objective DTO, `summariseProfitAndLoss`, and authoritative train/company state.
- Produces immutable DTO builders:

```ts
export interface OperatingSummaryDto {
  readonly fromTick: number;
  readonly throughTick: number;
  readonly deliveryRevenue: number;
  readonly runningExpenses: number;
  readonly operatingProfit: number;
  readonly capitalExpenditure: number;
  readonly cashFlow: number;
}

export interface FreightPurchaseDto {
  readonly freightSetId: 'timber-freight-set';
  readonly displayName: 'Timber Freight Set';
  readonly price: 90_000;
  readonly compatibleCargoLabel: 'Logs';
  readonly capacityLabel: '60 tonnes';
  readonly runningCostLabel: '£20 / active tick';
  readonly cashAfter: number;
  readonly affordable: boolean;
  readonly validPlacement: boolean;
  readonly remedy: string;
}

export interface TrainInspectionDto {
  readonly trainId: string;
  readonly displayName: 'Timber Freight Set';
  readonly direction: 'forward' | 'neutral' | 'reverse';
  readonly throttle: -1 | 0 | 1;
  readonly movementState: 'stopped' | 'moving' | 'derailed';
  readonly cargo: {
    readonly productLabel: 'Logs' | 'Empty';
    readonly units: number;
    readonly capacityUnits: 60;
    readonly text: string;
  };
  readonly nearestEligibleFacility: string | null;
  readonly transfer: CargoTransferStatus;
  readonly currentTrip: {
    readonly revenue: number;
    readonly runningCost: number;
    readonly operatingProfit: number;
  };
  readonly lastDelivery: {
    readonly revenue: number;
    readonly runningCost: number;
    readonly operatingProfit: number;
  };
  readonly lifetime: {
    readonly deliveredUnits: number;
    readonly revenue: number;
    readonly runningCost: number;
    readonly operatingProfit: number;
  };
}

export function buildOperatingSummary(
  company: CompanyStateDef,
  economyTick: number,
): OperatingSummaryDto;

export function buildTrainInspection(
  world: WorldData,
  runtime: TrainRuntimeSnapshot,
  transfer: CargoTransferStatus,
): TrainInspectionDto | null;

export function buildFreightPurchasePresentation(
  quote: FreightPurchaseQuote | null,
  cash: number,
): FreightPurchaseDto;
```

- `buildOperatingSummary` calls `summariseProfitAndLoss(company, Math.max(0, economyTick - 23), economyTick)`.
- Extend the exact typed events with type-only imports:

```ts
'ui:train-inspection': {
  inspection: TrainInspectionDto | null;
};
'ui:first-route-objective': FirstRouteObjectiveDto;
'ui:freight-delivery-completed': FreightDeliveryEvent;
```

Extend `'ui:company-state'` with `operatingSummary: OperatingSummaryDto`.

- Panels expose these concrete lifecycles:

```ts
class VehiclePurchasePanel {
  constructor();
  setState(state: {
    quote: FreightPurchaseQuote | null;
    cash: number;
    message: string;
  }): void;
  setVisible(visible: boolean): void;
  containsScreenPoint(x: number, y: number): boolean;
  destroy(): void;
}

class TrainInspector {
  constructor();
  setState(dto: TrainInspectionDto | null): void;
  setVisible(visible: boolean): void;
  containsScreenPoint(x: number, y: number): boolean;
  destroy(): void;
}

class FirstRouteObjectiveCard {
  constructor();
  setState(dto: FirstRouteObjectiveDto): void;
  setVisible(visible: boolean): void;
  containsScreenPoint(x: number, y: number): boolean;
  destroy(): void;
}
```

The purchase card emits `freight:purchase-mode-requested`; its confirmation button emits `freight:purchase-confirmed` with the currently displayed frozen quote. Every class subscribes/unsubscribes its exact events once and removes its DOM root in `destroy()`.

- [ ] **Step 1: Write presentation DTO tests**

Assert:

- vehicle card: Timber Freight Set, £90,000, 60 tonnes, Logs, £20 / active tick, cash after purchase, affordability, and exact remedy;
- selected train: name, throttle/direction, stopped/moving/derailed, `Logs 40 / 60 t`, nearest eligible facility, transfer state/blocker, batch progress, current trip, last delivery, and lifetime figures;
- company summary at tick 23 includes ticks 0..23, and tick 24 includes ticks 1..24, including current-tick entries;
- construction/vehicle capex changes capital expenditure/cash flow but not operating profit;
- Sawmill changes from `Needs logs` to `Working` when its recipe can advance.
- purchase, inspection, objective, company-summary, and completed-delivery event payloads round-trip through the typed EventBus, and panel destruction removes its listeners.

- [ ] **Step 2: Run presentation tests and verify RED**

Run:

```powershell
npx jest tests/unit/FreightPresentation.test.ts tests/unit/CompanyHud.test.ts tests/unit/FacilityInspector.test.ts tests/unit/FacilityView.test.ts tests/unit/EventBus.test.ts --runInBand --coverage=false
```

Expected: FAIL because freight DTO builders and the operating-summary fields do not exist.

- [ ] **Step 3: Implement detached presentation builders**

Never pass live `Train`, Phaser objects, or mutable world arrays into UI classes. Calculate trip operating profit as revenue minus running cost. Build movement state with the same exact `<= 2` stopped boundary as cargo. Build transfer progress as numeric `value/max` plus text, not colour alone.

- [ ] **Step 4: Write DOM UI and 375×667 layout tests**

Instantiate every panel under jsdom at desktop and `375×667`. Assert HUD, objective card, and whichever inspector is visible remain inside the viewport, all scrollable content has a bounded max height, facility/train selection is mutually exclusive, progress elements have text/ARIA labels, and buttons/inputs stop pointer propagation. Require the stable browser selectors `[data-testid="timber-freight-set-buy"]`, `[data-testid="freight-purchase-confirm"]`, `[data-testid="train-inspector"]`, `[data-testid="train-cargo-progress"]`, `[data-testid="first-route-objective"]`, and `[data-testid="company-operating-profit"]`.

Assert exact blocker copy:

```text
Stop the train to transfer cargo
Move inside Managed Forest rail access
Move inside Sawmill rail access
Waiting for logs
Timber set is full
Sawmill input storage is full
Cargo is not accepted here
Insufficient cash for running costs
Re-rail the train before operating
```

- [ ] **Step 5: Run UI tests and verify RED**

Run:

```powershell
npx jest tests/unit/VehiclePurchasePanel.test.ts tests/unit/TrainInspector.test.ts tests/unit/FirstRouteObjectiveCard.test.ts tests/unit/CompanyHud.test.ts tests/unit/EditorUIScene.test.ts tests/unit/InputManager.test.ts tests/unit/EventBus.test.ts tests/unit/WorldSceneEditorGuards.test.ts --runInBand --coverage=false
```

Expected: FAIL because the three freight panels do not exist and focus is not part of the W/S movement gate.

- [ ] **Step 6: Implement panels and scene wiring**

`VehiclePurchasePanel` is visible in Build mode and contains exactly one SKU card. `TrainInspector` is visible only for a selected train in Operate mode. `FirstRouteObjectiveCard` remains visible in both modes and remains achieved. `CompanyHud` adds the five operating-summary values. `FacilityView` and the objective use Task 5 route-ready state. A final unload emits `ui:freight-delivery-completed`, producing one concise success toast and one visible positive cash pulse.

In `EditorUIScene.containsScreenPoint`, include all new panels. When a train is selected, clear facility selection; when a facility is selected, deselect the train. `WorldScene` must call the module-lifetime `firstRouteCelebrationSession.consume(world.id, dto)` rather than constructing a scene-local session; recreate `WorldScene`/reload the same world in `WorldSceneEditorGuards.test.ts` and prove the celebration event does not replay in that page session.

- [ ] **Step 7: Gate keyboard and mobile throttle by focused controls**

Add:

```ts
export function isGameplayInputFocused(
  activeElement: Element | null = document.activeElement,
): boolean;
```

Return true for content-editable elements, `BUTTON`, `INPUT`, `SELECT`, `TEXTAREA`, or any ancestor matching:

```text
[data-testid="construction-inspector"]
[data-testid="facility-inspector"]
[data-testid="vehicle-purchase-panel"]
[data-testid="train-inspector"]
[data-testid="first-route-objective"]
```

`InputManager.handleTrainMovement` must set no new throttle while true. `WorldScene.handleKeyDown` uses the same helper for shortcuts.

- [ ] **Step 8: Run presentation and UI tests**

Run:

```powershell
npx jest tests/unit/FreightPresentation.test.ts tests/unit/VehiclePurchasePanel.test.ts tests/unit/TrainInspector.test.ts tests/unit/FirstRouteObjectiveCard.test.ts tests/unit/CompanyHud.test.ts tests/unit/FacilityInspector.test.ts tests/unit/FacilityView.test.ts tests/unit/EditorUIScene.test.ts tests/unit/InputManager.test.ts tests/unit/EventBus.test.ts tests/unit/WorldSceneEditorGuards.test.ts --runInBand --coverage=false
```

Expected: PASS.

- [ ] **Step 9: Commit freight presentation and interaction**

```powershell
git add src/freight/FreightPresentation.ts src/ui/VehiclePurchasePanel.ts src/ui/TrainInspector.ts src/ui/FirstRouteObjectiveCard.ts src/ui/CompanyHud.ts src/ui/FacilityInspector.ts src/entities/FacilityView.ts src/scenes/EditorUIScene.ts src/scenes/WorldScene.ts src/systems/InputManager.ts src/services/EventBus.ts tests/unit/FreightPresentation.test.ts tests/unit/VehiclePurchasePanel.test.ts tests/unit/TrainInspector.test.ts tests/unit/FirstRouteObjectiveCard.test.ts tests/unit/CompanyHud.test.ts tests/unit/FacilityInspector.test.ts tests/unit/FacilityView.test.ts tests/unit/EditorUIScene.test.ts tests/unit/InputManager.test.ts tests/unit/EventBus.test.ts tests/unit/WorldSceneEditorGuards.test.ts
git commit -m "feat: present and control the first freight route"
```

---

### Task 13: Headless Freight Integration and Persistence Matrix

**Files:**

- Create: `tests/integration/FirstFreightRoute.test.ts`
- Modify: `tests/integration/EconomyPersistence.test.ts`
- Modify: `tests/integration/GeneratedWorldStart.test.ts`
- Modify: `tests/integration/ConstructionSupplyEconomy.test.ts`
- Modify: `tests/unit/WorldSceneEditorGuards.test.ts`
- Modify: `tests/fixtures/FirstFreightRouteFixture.ts`

**Interfaces:**

- Consumes all Task 1–12 headless interfaces.
- Produces a deterministic complete-route integration harness:

```ts
export interface FirstRouteHarness {
  buildConnectedRoute(): void;
  purchaseTimberSet(): string;
  setRuntime(
    trainId: string,
    snapshot: Partial<TrainRuntimeSnapshot>,
  ): void;
  advanceTicks(count: number): void;
  saveReload(): void;
  readonly world: WorldData;
  destroy(): void;
}
```

- The harness uses production systems and detached runtime snapshots; it does not invoke private mutations to cargo, ledger, facilities, or progress.
- Implement the fixture with this exact adapter shape:

```ts
class FirstRouteHarnessImpl implements FirstRouteHarness {
  private readonly runtimeByTrainId =
    new Map<string, TrainRuntimeSnapshot>();
  private topology: TrackTopologySnapshot | null = null;
  private readonly trackManager: TrackManager;
  private readonly constructionService: ConstructionService;
  private readonly purchase: FreightPurchaseService;
  private readonly economy = new EconomySystem(WorldManager);

  constructor(seed: string) {
    // Build one deterministic empty schema-7 world with the public fixture,
    // save it through SaveService, then load it into WorldManager.
    // Create the Phaser mock scene, real TrackManager, TerrainGenerator(seed),
    // ConstructionAnalyzer, and ConstructionService exactly as the focused
    // construction tests do.
    // The purchase runtime port records spawn/place/remove in runtimeByTrainId
    // but never mutates WorldData.
  }

  get world(): WorldData {
    if (!WorldManager.world) throw new Error('Harness world is not loaded');
    return clonePlainData(WorldManager.world);
  }

  buildConnectedRoute(): void {
    // For every segment in the cheaper persisted feasibility witness, call
    // constructionService.createQuote(p0, p3, stableUUID), require a quote,
    // then execute a real PlaceTrackCommand against trackManager. After the
    // final command, capture topology through trackManager.captureTopology().
    // Assert one construction-capex ledger entry per command and exact cash.
    this.topology = this.trackManager.captureTopology();
  }

  purchaseTimberSet(): string {
    // Call purchase.quote(...) with the forest access point/topology, then
    // purchase.purchase(quote). Never push directly into world.trains.
    if (!this.topology) throw new Error('Build the connected route first');
  }

  advanceTicks(count: number): void {
    // Repeat economy.update(ECONOMY_TICK_MS, true,
    // [...runtimeByTrainId.values()]) exactly count times and assert one tick.
  }

  saveReload(): void {
    // WorldManager.save(), clone expected authority, reset/load by ID, then
    // assert the reloaded plain data equals expected; runtime positions are
    // rebuilt only from authoritative TrainDefs.
  }

  destroy(): void {
    // Reset WorldManager and clear only this test's localStorage keys.
  }
}
```

Use public `WorldManager`, `SaveService`, `ConstructionService`, `PlaceTrackCommand`, `TrackManager`, `FreightPurchaseService`, `EconomySystem`, and schema/fixture builders only. Install/restore storage spies and destroy live test tracks in `beforeEach`/`afterEach`; never cast into a production private field or directly edit cargo, ledger, facilities, statistics, or the progress latch.

- [ ] **Step 1: Write the complete route integration test**

From a fixed generated schema-7 world, assert zero initial player railway assets; build the cheaper valid corridor; preserve at least £110,000; purchase exactly one £90,000 set inside forest access; load 60 logs over six stopped ticks; move outside access and prove no transfer; drive state to Sawmill; unload six batches; start Sawmill processing; and prove:

```ts
expect(train.operations.lastTripRevenue)
  .toBeGreaterThan(train.operations.lastTripRunningCost);
expect(world.firstRouteProgress.profitableDeliveryCompleted).toBe(true);
expect(world.company.cash).toBe(
  openingCash
  - constructionCapex
  - vehicleCapex
  - runningCost
  + deliveryRevenue
);
```

Reconcile forest + onboard + sawmill logs across every transfer and explicit recipe consumption.

- [ ] **Step 2: Run integration test and verify RED**

Run:

```powershell
npx jest tests/integration/FirstFreightRoute.test.ts --runInBand --coverage=false
```

Expected: FAIL because the complete harness and integrated route assertions do not exist.

- [ ] **Step 3: Add purchase/transfer/cost failure integration cases**

At the real `WorldManager` boundary test stale purchase, insufficient cash, duplicate train ID, live failure, install failure, save retry, partial destination capacity, reserved source inventory, movement interruption, derail/re-rail cargo retention, and running-cost insolvency. Compare serialized worlds before/after every rejected operation.

- [ ] **Step 4: Add exact save/reload phase cases**

Save/reload:

1. after 30/60 loaded;
2. in transit;
3. after a partial unload;
4. after the profitable delivery;
5. after derail and free recovery.

At every phase assert exact cargo, origin, all trip/lifetime totals, economy tick, cash, ledger, facilities, track UUID, `trackT`, facing, and progress latch. Reloaded trains are stopped.

- [ ] **Step 5: Add repetition, history, and construction regressions**

Run three full load/deliver cycles with controlled ticks and assert no quantity drift, one transfer per train/tick, one aggregate cost entry/tick, and monotonic lifetime values. Prove an operations revision invalidates stale construction undo/redo history while fresh construction still works. Prove generated starts remain empty and cheapest corridor affordability is maintained.

- [ ] **Step 6: Run the integration matrix**

Run:

```powershell
npx jest tests/integration/FirstFreightRoute.test.ts tests/integration/EconomyPersistence.test.ts tests/integration/GeneratedWorldStart.test.ts tests/integration/ConstructionSupplyEconomy.test.ts tests/unit/WorldSceneEditorGuards.test.ts --runInBand --coverage=false
```

Expected: PASS.

- [ ] **Step 7: Commit headless route evidence**

```powershell
git add tests/integration/FirstFreightRoute.test.ts tests/integration/EconomyPersistence.test.ts tests/integration/GeneratedWorldStart.test.ts tests/integration/ConstructionSupplyEconomy.test.ts tests/unit/WorldSceneEditorGuards.test.ts tests/fixtures/FirstFreightRouteFixture.ts
git commit -m "test: prove the complete profitable timber route"
```

---

### Task 14: Collective Three-Seed Browser Acceptance and Tuning

**Files:**

- Create: `tests/e2e/first-freight-route.test.ts`
- Modify: `src/scenes/WorldScene.ts`
- Modify: `src/freight/TrainRuntime.ts`
- Modify if tuning is evidenced: `src/config/GameConfig.ts`
- Modify if tuning is evidenced: `src/entities/Train.ts`
- Modify: `tests/e2e/construction-loop.test.ts`
- Modify: `tests/e2e/derailed-train-recovery.test.ts`
- Modify: `tests/e2e/mobile-layout.test.ts`
- Modify: `tests/performance/WorldGenerationBrowserHarness.test.ts`
- Modify if tuning is evidenced: `tests/unit/Train.test.ts`

**Interfaces:**

- Consumes the production browser UI and a test-only `window.__railSimFirstRouteHarness` installed by `WorldScene`.
- The harness may control fixed ticks and runtime position for deterministic cases, but may not directly change company, ledger, facility inventory, train cargo/operations, or progress.
- Produces collective proof across three explicit seeds, with one real-time physics trip.

```ts
export interface FirstRouteBrowserSnapshot {
  readonly world: WorldData;
  readonly runtime: readonly TrainRuntimeSnapshot[];
  readonly saveState: 'saved' | 'unsaved' | 'saving';
  readonly objective: FirstRouteObjectiveDto;
  readonly camera: {
    readonly scrollX: number;
    readonly scrollY: number;
    readonly zoom: number;
    readonly width: number;
    readonly height: number;
  };
}
```

- [ ] **Step 1: Write the collective browser cases**

Use three fixed seed constants in the test file. Across the cases collectively prove:

- zero initial player railway assets;
- cheapest corridor + set + £20,000 reserve affordability;
- construction reaches both access rings and has a live graph path;
- atomic £90,000 purchase/placement;
- stopped 60-tonne automatic loading;
- no transfer moving or outside access;
- exact partial/final pre-batch unload payments;
- Sawmill starts processing;
- positive first-delivery operating margin;
- three repeatable controlled-tick cycles;
- save/reload mid-load, transit, mid-unload, and completed;
- derail/re-rail cargo retention;
- desktop and 375×667 input-safe layout.

- [ ] **Step 2: Run the new browser file and verify RED**

Run:

```powershell
npm run build
npx playwright test tests/e2e/first-freight-route.test.ts --retries=0
```

Expected: FAIL because the collective browser harness/cases are not yet present.

- [ ] **Step 3: Add a constrained deterministic harness**

Expose:

```ts
interface FirstRouteBrowserHarness {
  snapshot(): FirstRouteBrowserSnapshot;
  setMode(mode: 'create' | 'play'): void;
  advanceFixedTicks(count: number): void;
  setTrainRuntime(
    trainId: string,
    runtime: Pick<
      TrainRuntimeSnapshot,
      'x' | 'y' | 'speedWorldUnitsPerSecond' | 'throttle' | 'derailed'
    >,
  ): void;
  retrySave(): boolean;
}
```

Each method must enter the same production `GameStateManager`, `EconomySystem`, runtime adapter, and save path used by play. `snapshot()` reads the authoritative main camera into the five camera fields so world-to-screen gestures use the same transform as `construction-loop.test.ts`. Freeze snapshots. Do not expose setters for authoritative economic fields.

In the browser file, define concrete local helpers by reusing the proven gesture math from `construction-loop.test.ts`:

```ts
createFixedSeedWorld(page, seed);
waitForFirstRouteHarness(page);
snapshot(page);
toScreen(page, worldPoint, snapshot);
dragRoute(page, startScreen, endScreen);
buildWitnessCorridor(page, corridorIndex);
purchaseTimberSetAtForest(page);
openOnlySavedWorld(page);
```

`buildWitnessCorridor` selects the minimum `estimatedCost` corridor (corridor ID is the exact tie-break), presses `P`, drags each feasibility-witness segment from its persisted `p0` to `p3`, asserts `[data-testid="construction-confirm"]` is enabled, confirms it, and waits for `[data-testid="company-save-state"]` to read `Saved`. It then asserts the route query is connected and total paid cost is at most £890,000.

Task 12 must provide stable selectors used here:

```text
[data-testid="timber-freight-set-buy"]
[data-testid="freight-purchase-confirm"]
[data-testid="train-inspector"]
[data-testid="train-cargo-progress"]
[data-testid="first-route-objective"]
[data-testid="company-operating-profit"]
```

`purchaseTimberSetAtForest` clicks the buy control, converts the forest-side point of the connected track to screen coordinates, clicks that canvas point, asserts the fresh quote shows £90,000 and leaves a valid placement, clicks the confirmation control, then waits for one authoritative/live train and exact capex/cash change. The purchased train is selected and its facing points from Forest toward Sawmill.

- [ ] **Step 4: Implement one actual-keyboard real-time trip**

On one desktop seed call `buildWitnessCorridor`, record `performance.now()` immediately before `purchaseTimberSetAtForest`, then `setMode('play')`. Wait until `[data-testid="train-cargo-progress"]` reports `60 / 60`, and drive only with `page.keyboard.down/up('w')` plus short `s` braking pulses while polling frozen runtime snapshots. Release both keys, reach the persisted Sawmill access radius, and wait for speed `<= 2`, throttle `0`, final cargo `null`, and `lastTripRevenue > lastTripRunningCost`. Set `test.setTimeout(300_000)`, require the purchase-to-final-unload interval to be 120–240 seconds, and assert the objective/HUD show positive operating margin. Do not call `setTrainRuntime` or `advanceFixedTicks` in this case.

- [ ] **Step 5: Implement controlled coverage on the other seeds**

On the other two explicit seeds, still build and purchase through the UI helpers, then use only `setTrainRuntime` and `advanceFixedTicks` for exact batch pricing, three cycles, persistence phases, derail/re-rail, and mobile layout. Reload phases use the real page reload plus `openOnlySavedWorld`; authoritative state changes only through the production systems. These are collective proofs: do not repeat the real-time wait on every seed.

- [ ] **Step 6: Tune only evidenced route timing/margin**

If a valid starter route falls outside 2–4 minutes or has non-positive first-delivery margin, adjust only existing `GameConfig.TRAIN.ENGINE_POWER` or Matter resistance/mass values in `GameConfig.ts`/`Train.ts`. Keep the £20 active-tick cost, freight content values, six 10-unit batches, local quote rules, and stopped `<= 2` boundary unchanged. Add the failing seed as a permanent browser case before tuning, update the focused `Train.test.ts` physics assertions, and include all conditional tuning files in the task commit.

- [ ] **Step 7: Run browser and performance regressions**

Run:

```powershell
npm run build
npx playwright test tests/e2e/first-freight-route.test.ts tests/e2e/construction-loop.test.ts tests/e2e/derailed-train-recovery.test.ts tests/e2e/mobile-layout.test.ts --retries=0
npm run benchmark:world-generation
```

Expected: PASS without retries; the measured real-time trip is 120–240 seconds; the world-generation budget remains inside its existing threshold.

- [ ] **Step 8: Commit browser acceptance**

```powershell
git add tests/e2e/first-freight-route.test.ts src/scenes/WorldScene.ts src/freight/TrainRuntime.ts tests/e2e/construction-loop.test.ts tests/e2e/derailed-train-recovery.test.ts tests/e2e/mobile-layout.test.ts tests/performance/WorldGenerationBrowserHarness.test.ts
# If Step 6 changed tuning, also stage:
git add src/config/GameConfig.ts src/entities/Train.ts tests/unit/Train.test.ts
git commit -m "test: prove the first freight route in browser"
```

---

### Task 15: Full Evidence, Independent Review, and Exact Sites Deployment

**Files:**

- Create: `docs/superpowers/reviews/2026-07-26-milestone-2b-evidence.md`
- Read: `.openai/hosting.json`
- Verify: all files committed by Tasks 1–14

**Interfaces:**

- Consumes the exact reviewed commit from all previous tasks.
- Produces the final evidence record and deploys that exact source state to Sites project `appgprj_6a649579a6a081919bdbc5bdc7d9d101`.

- [ ] **Step 1: Verify the evidence record is absent**

Run:

```powershell
Test-Path docs/superpowers/reviews/2026-07-26-milestone-2b-evidence.md
```

Expected: `False`, because final evidence cannot be written before the gates and playtests exist.

- [ ] **Step 2: Run the complete automated gates**

Run from repository root:

```powershell
npm test -- --runInBand
npx playwright test --retries=0
npm run benchmark:construction-drag
npm run benchmark:world-generation
npm run build
git diff --check
git status --short
rg -n "console\.(log|debug)" src tests
rg -n "passengers|type: 'locomotive'|economyRevision|applyEconomyBatch" src/config/WorldData.ts src/managers/WorldManager.ts src/economy/EconomySystem.ts src/freight src/scenes/WorldScene.ts src/services/WorldContentLoader.ts src/utils/TrainSerializer.ts
```

Expected: all Jest tests pass with project coverage at least 85%; Playwright passes with no retries; both performance commands remain within their existing budgets; production build succeeds; `git diff --check` is clean; no generated output is staged; no diagnostic logging exists; and the legacy-authority scan returns no matches in the listed Milestone 2B authority paths.

- [ ] **Step 3: Perform the manual generated real-time playtest**

On at least three recorded generated seeds, manually build a valid route, start a purchase-to-final-unload timer immediately before buying the train, load 60 tonnes, drive with W/S, unload, observe Sawmill working and positive first-delivery operating profit, repeat a cycle, save/reload at multiple phases, derail/re-rail with cargo retained, and inspect desktop plus 375×667 layouts. Record actual corridor cost, post-build cash, purchase-to-final-unload time, load time, travel time, unload batches/revenue, running cost, first-delivery profit, save/reload checks, and every seed.

- [ ] **Step 4: Request independent review of the exact range**

Review from the pre-Milestone-2B base through current HEAD for:

- schema-7 strictness and cross-references;
- root-revision atomicity and rollback;
- serializer authority preservation;
- connected-component correctness;
- purchase compensation and save retry;
- stopped/radius/mode/derailment/throttle guards;
- batch conservation and pre-batch quoting;
- cost aggregation and insolvency;
- fixed-tick order/catch-up;
- objective latch and one-session celebration;
- 24-tick inclusive summaries;
- input capture and responsive layout;
- construction/world-generation regressions and YAGNI boundaries.

Do not proceed while any Critical or Important finding is open. Apply a correction by returning to the owning task's exact file list, rerunning that task's RED/GREEN commands and the complete gates, then request review of the corrected range.

- [ ] **Step 5: Write and commit the exact evidence record**

The document must contain exact Jest suite/test/coverage totals, Playwright case count and retries, benchmark values, build result, three browser seeds, three manual seeds, measured trip timing/margin, schema/revision/conservation checks, save-failure retry result, review findings/disposition, YAGNI confirmation, the independently reviewed implementation SHA from before this evidence-only commit, and the Sites project ID. Final Sites version/deployment values belong in the execution report because they do not exist until after this one evidence commit.

```powershell
git add docs/superpowers/reviews/2026-07-26-milestone-2b-evidence.md
git commit -m "docs: record milestone 2b acceptance evidence"
```

- [ ] **Step 6: Re-run immutable release checks at evidence HEAD**

Run:

```powershell
npm run build
git diff --check
git status --short
git rev-parse HEAD
```

Expected: build PASS, clean diff/status, and one exact reviewed/evidenced SHA.

- [ ] **Step 7: Publish the exact reviewed source through Sites**

Use the `sites:sites-building` and `sites:sites-hosting` skills. Read `.openai/hosting.json` and reuse its opaque `project_id` exactly. Push the exact clean evidence HEAD to the Sites source repository, package the source state represented by that pushed commit, save one private Sites version whose `commit_sha` equals that pushed SHA, deploy only that saved version, and poll deployment status to terminal success. Every Sites deployment URL is production.

- [ ] **Step 8: Verify production and finish the evidence record without changing source**

Open the production URL, run the startup/create-world smoke path, and verify schema-7 blank start, route prompt, purchase card, and no console failure. Record the evidence commit SHA, Sites version number, deployment ID, terminal status, and production URL in the execution report. Do not change any tracked file after the SHA used for the saved Sites version is established.

---

## Milestone 2B Acceptance

Milestone 2B is complete only when:

- every generated world begins with zero player track, trains, stations, services, solved routes, scenarios, and contracts;
- every valid generated starter opportunity has a cheapest corridor costing at most £890,000;
- the graph, not two endpoint stubs, proves Managed Forest-to-Sawmill connectivity;
- exactly one Timber Freight Set SKU exists, with £90,000 price, 60-log capacity, and £20 active-tick cost, while multiple instances can be purchased;
- purchase creates the live train, authoritative definition, cash change, and one vehicle-capex ledger entry atomically;
- schema 7 rejects schema 6 and validates every train/content/track/facility reference and safe-integer invariant;
- authoritative cargo/economics survive runtime merge, save/reload, derail/re-rail, and failed persistence;
- stopped means zero throttle and speed `<= 2` world units/second;
- every load/unload moves at most 10 units, respects reservations/capacity, conserves logs, and gives one transfer per train per tick;
- every unload batch uses the Sawmill's pre-batch quote and pays only accepted units;
- every active train receives its exact cost while the company ledger receives one aggregate running-cost entry per tick;
- insolvency stops all affected trains and posts no unpaid cost;
- a complete unload rolls trip totals, starts the next trip, and permanently latches `WorldData.firstRouteProgress.profitableDeliveryCompleted` only when revenue exceeds running cost;
- the last-24-tick summary includes `max(0, t - 23)..t`, including current-tick entries, and excludes capex from operating profit;
- the route objective, panels, blockers, progress text, cash pulse, toast, selection rules, and focused-input guards work at desktop and 375×667;
- catch-up commits at most four ordered ticks and requests one save of the final state;
- a failed save reports `Unsaved` and retries the same authoritative state without duplicate transactions;
- collective browser proof covers three generated seeds, one actual-keyboard real-time trip, controlled deterministic cases, three cycles, persistence phases, recovery, economics, and mobile layout;
- manual real-time playtests on at least three seeds take roughly two to four minutes after purchase and produce positive first-delivery operating margin;
- complete Jest, no-retry Playwright, construction/world-generation performance, production build, hygiene, independent review, and exact Sites deployment gates pass;
- the exact reviewed and evidenced source SHA is the source SHA deployed to production.

## Next Milestone 2C Boundary

Milestone 2C may add bulk and flatbed parallel flows, port handling/global trade, dynamic contracts, full P&L/goals UI, construction-chain progression, and player delivery of building modules to the town market. It must build on the schema-7 aggregate freight, atomic operations, fixed-tick, ledger, connectivity, presentation, and persistence boundaries delivered here; Milestone 2B does not implement those flows, contracts, or progression systems.
