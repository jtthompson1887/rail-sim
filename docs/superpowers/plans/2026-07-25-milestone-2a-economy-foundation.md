# Milestone 2A Economy Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate, persist, simulate, and clearly present a conserved
six-product construction economy in every blank world, ready for the first
manual freight route in Milestone 2B.

**Architecture:** Put the authoritative economy in small Phaser-free modules
under `src/economy`. Products, recipes, and facility definitions are immutable
validated content; inventories, markets, the company ledger, and simulation
ticks are serialisable world state. `WorldScene` advances the headless systems
on a fixed Operate-mode tick and renders read-only facility views; it does not
use the event bus for authoritative mutations.

**Tech Stack:** TypeScript, Phaser 3, Jest/ts-jest, Playwright, Webpack, Sites.

## Global Constraints

- This is a deliberate schema-6 clean break. There is no migration code because
  the user confirmed there is no existing player data.
- A new world contains generated terrain and facilities but zero player track,
  trains, services, or pre-solved railway.
- Do not add scenario maps. Remove the unused saved-world `scenarios` field
  rather than repurposing it for contracts.
- Products, recipes, and facility types are data keyed by stable string IDs.
  Core systems must not branch on the six initial product IDs.
- Every quantity, capacity, tick, price, cash value, and ledger amount is a safe
  integer. Failed operations leave authoritative state byte-for-byte unchanged.
- Resource extraction, port trade, and town consumption are explicit boundary
  operations. Processing recipes conserve their declared inputs and outputs.
- Facilities are independently owned. Company money is railway cash, not a
  facility operating account.
- Economy simulation advances only in Operate mode, at a fixed tick, and never
  from frame-dependent quantities.
- All seven facilities are generated and visible from world creation.
  Progression will highlight contracts later; it must not spawn scripted
  facilities.
- Defer cargo vehicles, loading, services, contracts, deadlines, consist
  editing, facility expansion/closure, town growth, loans, taxes, depreciation,
  perishability, global shocks, and broad product content.

---

## File Map

- `src/economy/EconomyData.ts`: serialisable IDs, inventories, facilities,
  markets, ledger, and economy state.
- `src/economy/ProductCatalog.ts`: generic catalogue lookup and validation.
- `src/economy/InitialEconomyContent.ts`: exactly six products, five recipes,
  and seven facility definitions.
- `src/economy/Inventory.ts`: atomic inventory transfer and capacity helpers.
- `src/economy/IndustrySystem.ts`: recipe progress, blockers, and atomic batch
  completion.
- `src/economy/MarketSystem.ts`: bounded deterministic factors and explained
  local quotes.
- `src/economy/FinanceLedger.ts`: the only company cash mutation boundary and
  period P&L queries.
- `src/economy/WorldEconomyGenerator.ts`: bounded deterministic placement and
  initial state for all seven facilities.
- `src/economy/EconomySystem.ts`: fixed-tick orchestration over persisted state.
- `src/entities/FacilityView.ts`: map presentation only.
- `src/ui/FacilityInspector.ts`: immutable facility decision/status panel.

---

### Task 1: Validated Economy Content

**Files:**

- Create: `src/economy/EconomyData.ts`
- Create: `src/economy/ProductCatalog.ts`
- Create: `src/economy/InitialEconomyContent.ts`
- Test: `tests/unit/ProductCatalog.test.ts`

**Interfaces:**

- Produces:
  `validateEconomyContent(products, recipes, facilities): ContentValidationResult`
- Produces: `getProduct(id)`, `getRecipe(id)`, and
  `getFacilityDefinition(id)` returning immutable definitions or `undefined`.
- Consumed by every later task in this plan.

- [x] **Step 1: Write failing catalogue tests**

Cover the exact initial IDs and reject duplicates, unknown recipe products,
unknown facility recipes, duplicate inventory slots, non-positive or unsafe
quantities, invalid cargo classes, invalid cycles, processing recipes without
inputs, and recipes without outputs.

```ts
expect(INITIAL_PRODUCTS.map((item) => item.id)).toEqual([
  'logs',
  'structural-timber',
  'limestone-aggregate',
  'cement',
  'steel',
  'building-modules',
]);
expect(validateEconomyContent(
  INITIAL_PRODUCTS,
  INITIAL_RECIPES,
  INITIAL_FACILITY_DEFINITIONS,
)).toEqual({ valid: true });
```

- [x] **Step 2: Run the focused test and verify the red state**

```powershell
npx jest tests/unit/ProductCatalog.test.ts --runInBand --coverage=false
```

Expected: fail because the economy modules do not exist.

- [x] **Step 3: Add the serialisable domain types**

Define these exact foundations in `EconomyData.ts`:

```ts
export type ProductId = string;
export type RecipeId = string;
export type FacilityId = string;
export type FacilityDefinitionId = string;
export type CargoClass = 'bulk' | 'covered' | 'flatbed';

export interface ProductAmount {
  productId: ProductId;
  quantity: number;
}

export interface ProductDefinition {
  id: ProductId;
  displayName: string;
  category: string;
  cargoClass: CargoClass;
  unitLabel: string;
  unitMassKg: number;
  unitVolumeLitres: number;
  basePrice: number;
  marketSector: 'construction';
}

export interface RecipeDefinition {
  id: RecipeId;
  kind: 'resource-extraction' | 'processing';
  cycleTicks: number;
  inputs: ProductAmount[];
  outputs: ProductAmount[];
}

export interface InventorySlotDef {
  productId: ProductId;
  quantity: number;
  reservedQuantity: number;
  capacity: number;
  recentInflow: number;
  recentOutflow: number;
  targetStock: number;
}

export interface FacilityDefinition {
  id: FacilityDefinitionId;
  displayName: string;
  recipeIds: RecipeId[];
  inventory: Array<{
    productId: ProductId;
    capacity: number;
    targetStock: number;
    initialQuantity: number;
  }>;
  boundary: 'none' | 'port' | 'town-consumer';
}
```

- [x] **Step 4: Add exactly the approved construction-chain content**

Use these products and recipes:

```ts
export const INITIAL_RECIPES: RecipeDefinition[] = [
  {
    id: 'forest-harvest',
    kind: 'resource-extraction',
    cycleTicks: 4,
    inputs: [],
    outputs: [{ productId: 'logs', quantity: 8 }],
  },
  {
    id: 'quarry-extraction',
    kind: 'resource-extraction',
    cycleTicks: 4,
    inputs: [],
    outputs: [{ productId: 'limestone-aggregate', quantity: 10 }],
  },
  {
    id: 'sawmill-cut',
    kind: 'processing',
    cycleTicks: 3,
    inputs: [{ productId: 'logs', quantity: 10 }],
    outputs: [{ productId: 'structural-timber', quantity: 8 }],
  },
  {
    id: 'cement-kiln',
    kind: 'processing',
    cycleTicks: 4,
    inputs: [{ productId: 'limestone-aggregate', quantity: 12 }],
    outputs: [{ productId: 'cement', quantity: 8 }],
  },
  {
    id: 'module-assembly',
    kind: 'processing',
    cycleTicks: 6,
    inputs: [
      { productId: 'structural-timber', quantity: 8 },
      { productId: 'cement', quantity: 8 },
      { productId: 'steel', quantity: 6 },
    ],
    outputs: [{ productId: 'building-modules', quantity: 4 }],
  },
];
```

Create facility definitions for `managed-forest`, `sawmill`, `quarry`,
`cement-works`, `port-interchange`, `prefabrication-plant`, and
`town-construction-market`. Give each referenced product one slot, with positive
capacity/target values. Only the port and town use non-`none` boundaries.

- [x] **Step 5: Implement catalogue validation and immutable lookup**

Validation returns:

```ts
export type ContentValidationResult =
  | { valid: true }
  | { valid: false; code: string; referenceId?: string };
```

Clone and freeze the exported content at module creation. Lookups must not
return mutable shared arrays.

- [x] **Step 6: Run focused and configuration tests**

```powershell
npx jest tests/unit/ProductCatalog.test.ts tests/unit/ConfigAndLevelData.test.ts --runInBand --coverage=false
```

Expected: pass.

- [x] **Step 7: Commit**

```powershell
git add src/economy tests/unit/ProductCatalog.test.ts
git commit -m "feat: add validated freight economy catalogue"
```

---

### Task 2: Conserved Inventories and Generic Recipes

**Files:**

- Create: `src/economy/Inventory.ts`
- Create: `src/economy/IndustrySystem.ts`
- Test: `tests/unit/Inventory.test.ts`
- Test: `tests/unit/IndustrySystem.test.ts`

**Interfaces:**

- Consumes: Task 1 product, recipe, and inventory definitions.
- Produces:
  `transferProduct(source, destination, requestedUnits): InventoryTransferResult`
- Produces:
  `advanceFacilityRecipe(facility, recipe): IndustryTickResult`
- Produces:
  `applyFacilityBoundary(facility, definition, productId, requestedUnits, kind): FacilityBoundaryResult`

- [x] **Step 1: Write failing transfer conservation tests**

Prove 80 units into a 30-unit free slot moves exactly 30, reserved stock cannot
move, destination capacity is respected, recent flow counters update by the
same amount, differing source/destination product IDs are rejected without
turning one product into another, and invalid requests mutate neither input.

```ts
const result = transferProduct(source, destination, 50);
expect(result).toMatchObject({ movedUnits: 30, reason: 'moved' });
expect(result.source.quantity + result.destination.quantity)
  .toBe(source.quantity + destination.quantity);
```

- [x] **Step 2: Run the inventory test and verify failure**

```powershell
npx jest tests/unit/Inventory.test.ts --runInBand --coverage=false
```

Expected: fail because `Inventory.ts` does not exist.

- [x] **Step 3: Implement immutable atomic transfer**

Use this result contract:

```ts
export type InventoryTransferResult =
  | {
    movedUnits: number;
    reason: 'moved';
    source: InventorySlotDef;
    destination: InventorySlotDef;
  }
  | {
    movedUnits: 0;
    reason: 'invalid' | 'no-available-stock' | 'destination-full';
    source: InventorySlotDef;
    destination: InventorySlotDef;
  };
```

Never mutate the inputs. Compute movable units from requested units,
`source.quantity - source.reservedQuantity`, and
`destination.capacity - destination.quantity`.

- [x] **Step 4: Write failing all-or-nothing recipe tests**

Prove:

- a forest produces only after four ticks and stops at output capacity;
- a sawmill reports `waiting-input` without ten logs;
- full timber storage reports `output-full` without consuming logs;
- completion consumes exactly ten logs and creates eight timber;
- the three-input prefab recipe consumes all three inputs atomically;
- port import creates only the accepted quantity and reports
  `kind: 'import'`;
- town consumption removes only available unreserved quantity and reports
  `kind: 'consumption'`;
- port import/export rejects a non-port facility, town consumption rejects a
  non-town facility, and no caller can invoke resource extraction as a generic
  boundary;
- an invalid boundary request returns the original slot unchanged;
- splitting the same tick count into different call groupings gives identical
  state.

- [x] **Step 5: Run the recipe test and verify failure**

```powershell
npx jest tests/unit/IndustrySystem.test.ts --runInBand --coverage=false
```

Expected: fail because `IndustrySystem.ts` does not exist.

- [x] **Step 6: Implement one-active-recipe facility ticks**

Add the state and result types to `EconomyData.ts`:

```ts
export interface FacilityEconomyDef {
  id: FacilityId;
  definitionId: FacilityDefinitionId;
  name: string;
  x: number;
  y: number;
  railAccess: { x: number; y: number; radius: number };
  inventories: Record<ProductId, InventorySlotDef>;
  activeRecipeId: RecipeId | null;
  recipeProgressTicks: number;
}

export type IndustryBlocker =
  | 'idle'
  | 'waiting-input'
  | 'output-full'
  | 'working';
```

`advanceFacilityRecipe` returns a cloned facility, blocker, completed batch
count (`0 | 1`), and exact product deltas. Validate capacity and all inputs
before incrementing. On the completion tick, apply all deltas to a clone and
commit once. For a `resource-extraction` recipe, tag each positive output delta
as an explicit `resource-extraction` boundary receipt; a processing recipe has
no boundary receipt.

- [x] **Step 7: Implement explicit inventory boundaries**

Use:

```ts
export type InventoryBoundaryKind =
  | 'import'
  | 'consumption'
  | 'export';

export interface FacilityBoundaryResult {
  acceptedUnits: number;
  kind: InventoryBoundaryKind;
  facility: FacilityEconomyDef;
  receipt:
    | {
      facilityId: FacilityId;
      productId: ProductId;
      units: number;
      kind: InventoryBoundaryKind;
    }
    | null;
}
```

Positive boundary `import` adds only available capacity. Negative boundaries
(`consumption`, `export`) remove only unreserved stock. Extraction is
authorised solely by a validated `resource-extraction` recipe. Require
`definition.boundary === 'port'` for import/export and
`definition.boundary === 'town-consumer'` for consumption. The receipt is the
conservation-accounting evidence; no other operation may create or destroy
product.

- [x] **Step 8: Run the focused economy tests**

```powershell
npx jest tests/unit/ProductCatalog.test.ts tests/unit/Inventory.test.ts tests/unit/IndustrySystem.test.ts --runInBand --coverage=false
```

Expected: pass.

- [x] **Step 9: Commit**

```powershell
git add src/economy tests/unit/Inventory.test.ts tests/unit/IndustrySystem.test.ts
git commit -m "feat: conserve facility inventory and production"
```

---

### Task 3: Bounded Explained Market Quotes

**Files:**

- Create: `src/economy/MarketSystem.ts`
- Update: `src/economy/EconomyData.ts`
- Test: `tests/unit/MarketSystem.test.ts`

**Interfaces:**

- Consumes: Task 1 catalogue and Task 2 inventory slots.
- Produces:
  `quoteLocalProduct(productId, market, slot): LocalQuoteResult`
- Produces:
  `advanceMarketTick(market, seed, economyTick): MarketStateDef`

- [x] **Step 1: Write failing quote-bound tests**

Cover exact factor bounds, deterministic rounding, low/high inventory pressure,
unknown products, unsafe multiplication, factor explanations, and identical
results for the same seed/tick.

```ts
expect(quote.factors).toEqual([
  { id: 'global-construction', basisPoints: 10_000 },
  { id: 'regional-demand', basisPoints: 10_000 },
  { id: 'inventory-pressure', basisPoints: 10_000 },
]);
```

- [x] **Step 2: Run the market test and verify failure**

```powershell
npx jest tests/unit/MarketSystem.test.ts --runInBand --coverage=false
```

Expected: fail because `MarketSystem.ts` does not exist.

- [x] **Step 3: Add persisted market state**

```ts
export interface MarketStateDef {
  constructionIndexBps: number;
  regionalDemandBpsByProduct: Record<ProductId, number>;
}
```

Use these inclusive bounds:

- construction index: `8_500..11_500`;
- regional demand: `8_000..12_000`;
- inventory pressure: `7_500..13_000`.

- [x] **Step 4: Define exact quote results and inventory pressure**

Use:

```ts
export type LocalQuoteResult =
  | {
    ok: true;
    productId: ProductId;
    unitPrice: number;
    factors: Array<{
      id:
        | 'global-construction'
        | 'regional-demand'
        | 'inventory-pressure';
      basisPoints: number;
    }>;
  }
  | {
    ok: false;
    code:
      | 'unknown-product'
      | 'product-slot-mismatch'
      | 'invalid-market-state'
      | 'invalid-inventory'
      | 'price-overflow';
  };
```

Reject unless `slot.productId === productId`. For valid slots calculate:

```ts
pressureDeltaBps = Math.round(
  (slot.targetStock - slot.quantity) * 3_000 / slot.targetStock,
);
inventoryPressureBps = clamp(
  10_000 + pressureDeltaBps,
  7_500,
  13_000,
);
```

Content validation requires `targetStock > 0`. At target stock pressure is
exactly `10_000`; empty stock is `13_000`; stock at or above twice target is
clamped to `7_500`.

- [x] **Step 5: Implement checked sequential pricing**

Calculate:

```text
base price
× construction index / 10,000
× regional demand / 10,000
× inventory pressure / 10,000
```

Round to the nearest whole pound after each factor. Reject an intermediate
value before multiplication when it would exceed `Number.MAX_SAFE_INTEGER`.
Return the three named factor explanations with the quote.

- [x] **Step 6: Implement small deterministic index drift**

Key the existing seeded random helper with
`${seed}:construction-market:${economyTick}`. Move by `-25`, `0`, or `25`
basis points once per 24 economy ticks and clamp to `8_500..11_500`. Do not add
shocks or price history in this task.

- [x] **Step 7: Run focused tests**

```powershell
npx jest tests/unit/MarketSystem.test.ts tests/unit/SeededRandom.test.ts --runInBand --coverage=false
```

If `tests/unit/SeededRandom.test.ts` does not exist, run only
`MarketSystem.test.ts` plus the full suite at Task 9. Expected: pass.

- [x] **Step 8: Commit**

```powershell
git add src/economy/EconomyData.ts src/economy/MarketSystem.ts tests/unit/MarketSystem.test.ts
git commit -m "feat: derive bounded local freight quotes"
```

---

### Task 4: Persistent Finance Ledger and P&L

**Files:**

- Create: `src/economy/FinanceLedger.ts`
- Update: `src/economy/EconomyData.ts`
- Test: `tests/unit/FinanceLedger.test.ts`

**Interfaces:**

- Produces: `createCompanyState(startingCash): CompanyStateDef`
- Produces: `postLedgerEntry(company, request): LedgerPostResult`
- Produces: `summariseProfitAndLoss(company, fromTick, throughTick): ProfitAndLoss`
- Consumed by Task 5 construction integration and Milestone 2B freight income.

- [x] **Step 1: Write failing money-conservation tests**

Prove every accepted entry changes cash by exactly its policy-derived signed
amount, IDs are monotonic, failed/unsafe/zero entries mutate nothing, cash
cannot become negative, every category has the required class/sign, reversals
point to an earlier matching entry with the opposite sign, and P&L excludes
capital expenditure while cash flow includes it.

```ts
expect(summary).toEqual({
  revenue: 1_200,
  operatingExpenses: 300,
  operatingProfit: 900,
  capitalExpenditure: 500,
  cashFlow: 400,
});
```

- [x] **Step 2: Run the ledger test and verify failure**

```powershell
npx jest tests/unit/FinanceLedger.test.ts --runInBand --coverage=false
```

Expected: fail because `FinanceLedger.ts` does not exist.

- [x] **Step 3: Add exact ledger types**

```ts
export type LedgerCategory =
  | 'opening-balance'
  | 'construction-capex'
  | 'construction-refund'
  | 'vehicle-capex'
  | 'delivery-revenue'
  | 'contract-bonus'
  | 'train-running-cost'
  | 'port-handling';

export type LedgerClass =
  | 'opening'
  | 'revenue'
  | 'operating-expense'
  | 'capital-expenditure';

export interface LedgerEntryDef {
  id: number;
  tick: number;
  category: LedgerCategory;
  ledgerClass: LedgerClass;
  amount: number;
  referenceId: string;
  reversalOf?: number;
}

export interface CompanyStateDef {
  cash: number;
  nextLedgerId: number;
  ledger: LedgerEntryDef[];
}
```

- [x] **Step 4: Implement immutable ledger posting**

`createCompanyState` creates entry `1`, category `opening-balance`, with the
starting cash and sets `nextLedgerId` to `2`. `postLedgerEntry` returns a new
company state and the frozen entry, or the original state and a stable rejection
code. Callers provide a positive `magnitude`, category, tick, reference, and:

```ts
direction: 'forward' | 'reversal'
```

The ledger, not the caller, derives `ledgerClass` and signed `amount`:

| Category | Class | Forward sign |
| --- | --- | --- |
| `opening-balance` | `opening` | positive |
| `construction-capex` | `capital-expenditure` | negative |
| `construction-refund` | `capital-expenditure` | positive |
| `vehicle-capex` | `capital-expenditure` | negative |
| `delivery-revenue` | `revenue` | positive |
| `contract-bonus` | `revenue` | positive |
| `train-running-cost` | `operating-expense` | negative |
| `port-handling` | `operating-expense` | negative |

A reversal requires `reversalOf`, rejects opening balance, verifies the earlier
entry has the same category/reference/magnitude, and flips its sign while
retaining its class. It never silently clamps values.

- [x] **Step 5: Implement period P&L**

Use inclusive tick bounds. Revenue and operating expenses determine operating
profit. Capital expenditure is reported separately. Cash flow is the sum of
all signed entries in the period, including capex and excluding the opening
entry unless tick `0` is requested.

- [x] **Step 6: Run focused tests**

```powershell
npx jest tests/unit/FinanceLedger.test.ts --runInBand --coverage=false
```

Expected: pass.

- [x] **Step 7: Commit**

```powershell
git add src/economy/EconomyData.ts src/economy/FinanceLedger.ts tests/unit/FinanceLedger.test.ts
git commit -m "feat: add conserved company ledger and pnl"
```

---

### Task 5: Schema 6 and Construction Ledger Integration

**Files:**

- Modify: `src/config/WorldData.ts`
- Modify: `src/managers/WorldManager.ts`
- Modify: `src/systems/ConstructionEconomy.ts`
- Modify: `src/systems/ConstructionService.ts`
- Modify: `src/commands/PlaceTrackCommand.ts`
- Modify: `src/commands/DeleteTracksCommand.ts`
- Modify: `src/scenes/WorldScene.ts`
- Update: `tests/unit/WorldSchemaValidation.test.ts`
- Update: `tests/unit/ConstructionEconomy.test.ts`
- Update: `tests/unit/PlaceTrackCommand.test.ts`
- Update: `tests/unit/WorldManager.test.ts`
- Update: `tests/unit/SaveService.test.ts`

**Interfaces:**

- Consumes: Tasks 1–4 economy state and ledger.
- Produces: schema-6 `WorldData` with `economy` and ledger-backed `company`.
- Produces:
  `WorldManager.applyEconomyBatch(expectedEconomyRevision, mutate): boolean`.
- Produces a construction draft that commits tracks, junctions, company cash,
  and ledger together.

- [x] **Step 1: Write the schema-6 red tests**

Prove:

- schema 6 with an empty valid economy state round-trips exactly;
- schema 5 rejects with `Start a new world.`;
- no conversion or migration function runs;
- malformed/duplicate facility IDs, invalid product references, unsafe
  inventory, invalid market factors, invalid ledger sequence, and a ledger cash
  mismatch reject;
- schema 6 has no `scenarios` field;
- construction mutations advance `revision` and `constructionRevision`;
- economy mutations advance `revision` and `economyRevision` without making
  construction command history stale.

- [x] **Step 2: Run schema and world-manager tests**

```powershell
npx jest tests/unit/WorldSchemaValidation.test.ts tests/unit/WorldManager.test.ts --runInBand --coverage=false
```

Expected: fail against schema 5.

- [x] **Step 3: Replace the saved-world root**

Use:

```ts
export interface EconomyStateDef {
  economyVersion: 1;
  tick: number;
  facilities: FacilityEconomyDef[];
  market: MarketStateDef;
}

export interface WorldData {
  schemaVersion: 6;
  revision: number;
  constructionRevision: number;
  economyRevision: number;
  // existing identity, generation, opportunity, construction and content data
  company: CompanyStateDef;
  economy: EconomyStateDef;
  // tracks, junctions, stations, trains, scenery, metadata
}
```

Remove `ScenarioDef`, `ScenarioObjectiveType`, and `scenarios`. Update the
deletion guard in `WorldScene` so it no longer checks saved scenarios.
`createEmptyWorld` uses `createCompanyState(startingCash)` and accepts an
economy state argument.

- [x] **Step 4: Add strict economy and ledger validation**

Validate unique facility IDs, definition IDs, product/recipe references, all
slot fields, rail-access geometry, active recipe compatibility, tick and
progress bounds, exact market factor key coverage, sequential ledger IDs,
valid category/class/sign/reversal policy, `nextLedgerId`, all three non-negative
safe-integer revisions, and:

```ts
company.cash === company.ledger.reduce(
  (cash, entry) => cash + entry.amount,
  0,
)
```

Reject unknown extra root fields only where current validation already does so;
do not add a general reflection framework.

- [x] **Step 5: Write failing construction-ledger tests**

Prove build, undo, redo, demolition refund, demolition undo, and rollback each
leave cash equal to the ledger sum. Reversal entries must reference the original
entry and have the opposite amount. An injected graph or persisted-world
failure commits neither track/junction data nor company/ledger state, so failed
construction writes no ledger entry. Economy-only revisions must not invalidate
an otherwise current construction command.

- [x] **Step 6: Draft construction money with construction data**

Extend `WorldConstructionDraft` with a cloned `company` and the current economy
tick. Refactor `ConstructionEconomy` into a pure draft operation:

```ts
applyConstructionTransaction(
  company: CompanyStateDef,
  request: {
    kind: 'purchase' | 'demolition-refund';
    magnitude: number;
    referenceId: string;
    direction: 'forward' | 'reversal';
    reversalOf?: number;
  },
  tick: number,
): ConstructionTransactionResult
```

`PlaceTrackCommand` and `DeleteTracksCommand` first make their reversible live
graph change, then call one `applyConstructionBatch` whose draft applies both
the matching track/junction mutation and the ledger transaction. Only after the
callback succeeds does `WorldManager` install cloned tracks, junctions, and
company fields together. On failure, commands roll back only the live graph;
the world company/ledger was never changed. User-visible undo/redo uses a new
successful batch and therefore posts a real reversal/reapplication entry.

Construction commands compare `constructionRevision`, not root `revision`.
Economy batches compare `economyRevision`. Every successful batch also advances
root `revision` once for persistence ordering. Rename the construction quote
cursor from `worldRevision` to `constructionRevision`; have
`ConstructionService.quote` capture `world.constructionRevision` and
`ConstructionService.build` revalidate that same cursor so economy-only ticks
cannot stale a live construction preview or quote.

- [x] **Step 7: Run all affected construction/persistence tests**

```powershell
npx jest tests/unit/WorldSchemaValidation.test.ts tests/unit/WorldManager.test.ts tests/unit/SaveService.test.ts tests/unit/ConstructionEconomy.test.ts tests/unit/PlaceTrackCommand.test.ts tests/unit/ConstructionService.test.ts tests/unit/TrackManager.test.ts --runInBand --coverage=false
```

Expected: pass.

- [x] **Step 8: Commit**

```powershell
git add src/config/WorldData.ts src/managers/WorldManager.ts src/systems/ConstructionEconomy.ts src/systems/ConstructionService.ts src/commands src/scenes/WorldScene.ts tests/unit
git commit -m "feat: persist the schema six railway economy"
```

---

### Task 6: Deterministic Generated Facility Graph

**Files:**

- Create: `src/economy/WorldEconomyGenerator.ts`
- Modify: `src/systems/WorldOpportunityGenerator.ts`
- Modify: `src/systems/WorldOpportunityValidator.ts`
- Modify: `src/managers/WorldManager.ts`
- Modify: `src/config/WorldGeneration.ts`
- Update: `tests/unit/WorldOpportunityGenerator.test.ts`
- Create: `tests/unit/WorldEconomyGenerator.test.ts`
- Update: `tests/integration/GeneratedWorldStart.test.ts`
- Update: `tests/fixtures/StarterOpportunityFixture.ts`

**Interfaces:**

- Consumes: Task 5 schema and Task 1 facility content.
- Produces:
  `WorldEconomyGenerator.generate(config, opportunity): EconomyGenerationResult`.

- [x] **Step 1: Write deterministic generation tests**

Prove:

- opportunity Site A is the managed forest and Site B is the sawmill;
- all seven facilities have stable IDs, terrain-safe positions, unique bounded
  rail-access points, and deterministic initial inventories;
- forest/sawmill remain the two endpoints of both feasible corridors;
- the other five facilities are separated and inside world bounds;
- the same seed gives identical economy state;
- different seeds vary at least one secondary facility or demand factor;
- bounded exhaustion returns `economy-exhausted` and persists no partial world;
- a new world has no tracks, trains, stations, or scenarios field.

- [x] **Step 2: Run generation tests and verify failure**

```powershell
npx jest tests/unit/WorldOpportunityGenerator.test.ts tests/unit/WorldEconomyGenerator.test.ts tests/integration/GeneratedWorldStart.test.ts --runInBand --coverage=false
```

Expected: fail because planning sites are generic and no economy generator
exists.

- [x] **Step 3: Name the initial opportunity without changing its geometry**

Change only the two site IDs/labels:

```ts
{ id: 'managed-forest', label: 'Managed Forest', ...start }
{ id: 'sawmill', label: 'Sawmill', ...end }
```

Keep corridor witnesses, camera, feasibility, topology cost, and deterministic
attempt selection unchanged.

- [x] **Step 4: Implement bounded secondary-facility placement**

Use a separate seeded stream `${seed}:economy`. Scan at most 256 jittered grid
candidates, reject footprints over the existing maximum site relief, enforce a
configured minimum facility separation, and take the first valid candidate for
each of:

```text
quarry
cement-works
port-interchange
prefabrication-plant
town-construction-market
```

Do not generate track or surveyed routes for these later opportunities. Create
rail-access points at the facility centres for this milestone; Milestone 2B
uses the persisted radius for transfer proximity.

- [x] **Step 5: Generate initial economy and market state**

Instantiate slots from facility definitions. Resource outputs start at half
target stock so the first world is active but not full. Processing inputs and
outputs start empty. Port steel starts at target stock as an explicit import
boundary. Regional product factors derive deterministically within
`8_000..12_000`.

- [x] **Step 6: Make world creation atomic across both generators**

`WorldManager.tryCreateNew` must generate opportunity, then economy, then create
and validate one detached schema-6 world, then save it once. A failure before
the successful save leaves the active world and storage unchanged.

- [x] **Step 7: Run generation, schema, and worst-case benchmarks**

```powershell
npx jest tests/unit/WorldOpportunityGenerator.test.ts tests/unit/WorldEconomyGenerator.test.ts tests/integration/GeneratedWorldStart.test.ts tests/unit/WorldSchemaValidation.test.ts --runInBand --coverage=false
npm run benchmark:world-generation
```

Expected: tests pass and generation remains below the existing 2-second local
target with explicit candidate caps.

- [x] **Step 8: Commit**

```powershell
git add src/economy/WorldEconomyGenerator.ts src/systems/WorldOpportunityGenerator.ts src/systems/WorldOpportunityValidator.ts src/managers/WorldManager.ts src/config/WorldGeneration.ts tests
git commit -m "feat: generate the construction supply economy"
```

---

### Task 7: Fixed-Tick Persisted Industry Simulation

**Files:**

- Create: `src/economy/EconomySystem.ts`
- Modify: `src/managers/WorldManager.ts`
- Modify: `src/scenes/WorldScene.ts`
- Create: `tests/unit/EconomySystem.test.ts`
- Create: `tests/integration/EconomyPersistence.test.ts`

**Interfaces:**

- Consumes: Tasks 2, 3, 5, and 6.
- Produces:
  `EconomySystem.update(deltaMs, operating): EconomyUpdateResult`.

- [x] **Step 1: Write fixed-step red tests**

Prove:

- four 250 ms updates equal one 1,000 ms update;
- Build mode and paused Operate mode advance zero ticks;
- a frame can catch up at most four ticks;
- each committed tick advances `economy.tick` exactly once;
- industry and market outputs are identical for equivalent elapsed tick counts;
- a failed economy-revision check commits none of the facility/market changes;
- successful ticks advance root/economy revisions but not construction
  revision;
- save/reload resumes at the exact tick, recipe progress, and inventories.

- [x] **Step 2: Run the economy-system tests and verify failure**

```powershell
npx jest tests/unit/EconomySystem.test.ts tests/integration/EconomyPersistence.test.ts --runInBand --coverage=false
```

Expected: fail because `EconomySystem.ts` does not exist.

- [x] **Step 3: Implement fixed tick orchestration**

Use:

```ts
export const ECONOMY_TICK_MS = 1_000;
export const MAX_ECONOMY_TICKS_PER_FRAME = 4;
```

Keep the sub-tick accumulator in the system, not persisted. On each tick,
advance each facility once in stable facility-ID order, then advance the market
for the new tick. Commit through Task 5's `applyEconomyBatch`, using
`economyRevision` as the expected cursor. Return changed facility IDs and
blockers for presentation.

- [x] **Step 4: Integrate only with generated `WorldScene` Operate mode**

Call `update(delta, this.mode === 'play' && !this.scene.isPaused())` from
`WorldScene.update`. Use the existing save-state/retry path after changed
economy batches; do not add economy logic to legacy `GameScene`.

- [x] **Step 5: Run economy and existing world-loop tests**

```powershell
npx jest tests/unit/EconomySystem.test.ts tests/integration/EconomyPersistence.test.ts tests/unit/WorldSceneEditorGuards.test.ts tests/integration/GameFlow.test.ts --runInBand --coverage=false
```

Expected: pass.

- [x] **Step 6: Commit**

```powershell
git add src/economy/EconomySystem.ts src/managers/WorldManager.ts src/scenes/WorldScene.ts tests
git commit -m "feat: tick the generated freight economy"
```

---

### Task 8: Legible Facility Map and Inspector

**Files:**

- Create: `src/entities/FacilityView.ts`
- Create: `src/economy/FacilityPresentation.ts`
- Create: `src/ui/FacilityInspector.ts`
- Modify: `src/scenes/WorldScene.ts`
- Modify: `src/scenes/EditorUIScene.ts`
- Modify: `src/ui/CompanyHud.ts`
- Modify: `src/ui/PropertiesPanel.ts`
- Modify: `src/services/EventBus.ts`
- Update: `tests/unit/WorldSceneOpportunityView.test.ts`
- Create: `tests/unit/FacilityView.test.ts`
- Create: `tests/unit/FacilityInspector.test.ts`
- Create: `tests/e2e/generated-economy-presentation.test.ts`

**Interfaces:**

- Consumes:
  `buildFacilityInspection(world, facilityId, railConnected): FacilityInspectionDto | null`.
- Produces UI-only events:
  `facility:selected`, `facility:inspection`, and `facility:deselected`.

Use this immutable DTO boundary:

```ts
export interface FacilityInspectionDto {
  id: FacilityId;
  name: string;
  status: {
    code:
      | 'working'
      | 'waiting-input'
      | 'output-full'
      | 'waiting-railway'
      | 'idle';
    label: string;
  };
  produces: ProductId[];
  needs: ProductId[];
  inventories: Array<{
    productId: ProductId;
    displayName: string;
    quantity: number;
    capacity: number;
  }>;
  quotes: Array<{
    productId: ProductId;
    unitPrice: number;
    factors: Array<{ id: string; basisPoints: number }>;
  }>;
  railConnected: boolean;
}
```

- [x] **Step 1: Write presentation lifecycle tests**

Prove:

- all seven generated facilities render with names;
- forest and sawmill replace generic planning-site labels;
- map badges expose one status: `Working`, `Needs <product>`,
  `Output storage full`, or `Waiting for railway`;
- rail-access rings visually distinguish connected/unconnected state without
  creating track;
- clicking a facility selects only it and opens its inspector;
- the inspector shows produces/needs, inventory quantities/capacities, blocker,
  local quote factors, and rail connection;
- clearing selection destroys stale panel content and input bounds;
- desktop and 375×667 layouts keep the primary status readable.

- [x] **Step 2: Run focused UI tests and verify failure**

```powershell
npx jest tests/unit/FacilityView.test.ts tests/unit/FacilityInspector.test.ts tests/unit/WorldSceneOpportunityView.test.ts --runInBand --coverage=false
```

Expected: fail because the new presentation classes do not exist.

- [x] **Step 3: Implement `FacilityView` as presentation only**

Use a map marker, label, compact inventory bar, status text, and rail-access
ring. Scale label offsets and ring widths from desired screen pixels using the
current camera zoom, following the surveyed-corridor presentation contract.
The view receives DTO updates and never mutates `WorldData`.

`WorldScene` derives `railConnected` by checking whether any live track endpoint
is inside the persisted rail-access radius:

```ts
trackManager
  .getTracksInRadius(facility.railAccess, facility.railAccess.radius)
  .some((track) => {
    const { p0, p3 } = track.getControlPoints();
    return Math.hypot(p0.x - facility.railAccess.x, p0.y - facility.railAccess.y)
        <= facility.railAccess.radius
      || Math.hypot(p3.x - facility.railAccess.x, p3.y - facility.railAccess.y)
        <= facility.railAccess.radius;
  });
```

This is read-only presentation state; do not create a station, snap track
automatically, or alter the track graph.

- [x] **Step 4: Implement a compact right inspector**

Primary hierarchy:

```text
Facility name
Working / blocker
Produces and needs
Inventory bars
Local quote and three factor explanations
Rail access: connected / not connected
```

Keep the world visible. Reuse existing dark panel colours, typography, and
responsive helpers. Do not add a report screen.

- [x] **Step 5: Keep the company top bar visible in both modes**

`CompanyHud` continues showing cash/save state and adds only the persisted
economy day/tick and current construction-sector index. Detailed P&L remains
for Milestone 2B when freight creates operating transactions.

- [x] **Step 6: Add the browser acceptance flow**

At desktop and mobile:

1. create a fixed-seed world;
2. assert zero track and trains;
3. observe named forest and sawmill at the surveyed endpoints;
4. inspect the sawmill and read `Needs logs`;
5. enter Operate mode;
6. observe raw producers advance while the sawmill remains blocked;
7. reload and verify identical tick/inventory/status.

- [x] **Step 7: Run focused and browser tests**

```powershell
npx jest tests/unit/FacilityView.test.ts tests/unit/FacilityInspector.test.ts tests/unit/WorldSceneOpportunityView.test.ts tests/unit/CompanyHud.test.ts --runInBand --coverage=false
npx playwright test tests/e2e/generated-economy-presentation.test.ts --retries=0
```

Expected: pass.

- [x] **Step 8: Commit**

```powershell
git add src/entities/FacilityView.ts src/economy/FacilityPresentation.ts src/ui/FacilityInspector.ts src/scenes src/ui src/services/EventBus.ts tests
git commit -m "feat: present the generated freight economy"
```

---

### Task 9: Full-Chain Headless Gate, Review, and Publication

**Files:**

- Create: `tests/integration/ConstructionSupplyEconomy.test.ts`
- Create: `docs/superpowers/reviews/2026-07-25-milestone-2a-evidence.md`
- Modify only implementation files required by evidenced failures.

**Interfaces:**

- Consumes all prior tasks.
- Produces the reviewed Milestone 2A Sites build.

- [x] **Step 1: Prove the complete six-product economy headlessly**

Drive deterministic ticks and explicit boundary transfers to prove:

```text
forest extraction -> logs
logs -> structural timber
quarry extraction -> aggregate
aggregate -> cement
port import -> steel
timber + cement + steel -> building modules
town consumption / port export -> explicit sink
```

Reconcile every product:

```text
opening inventory
+ explicit extraction/import boundary inflow
+ processing recipe outputs
- processing recipe inputs
- explicit town consumption/export boundary outflow
= closing facility inventory
```

Also prove every company cash mutation equals its ledger, and P&L distinguishes
operating results from construction capital expenditure.

- [x] **Step 2: Run the complete automated gates**

```powershell
npm test -- --runInBand
npx playwright test --retries=0
npm run benchmark:construction-drag
npm run benchmark:world-generation
npm run build
git diff --check
git status --short
rg -n "console\.(log|debug)" src tests
```

Expected: all tests pass without retries; coverage remains at least 85%; both
performance budgets remain inside target; build succeeds; no diagnostics or
generated output are staged.

- [x] **Step 3: Perform a generated-economy playtest**

Use at least three fixed seeds and verify facility placement, initial route
affordability, raw production, processor blockers, inventory saturation,
Build/Operate pause behaviour, save/reload, facility inspection, and mobile
readability. Tune only evidenced problems.

- [x] **Step 4: Request independent code review**

Review the exact Milestone 2A range for product/inventory conservation, recipe
atomicity, market bounds, ledger/cash equality, schema references, deterministic
generation, fixed-tick behaviour, construction regressions, and UI input
capture. Fix all Critical and Important findings and re-review corrections.

- [x] **Step 5: Commit evidence**

Record exact test counts, coverage, benchmark values, fixed seeds, manual
observations, review disposition, and YAGNI deferrals. Do not create an empty
commit.

- [x] **Step 6: Publish exact reviewed source**

Build from clean reviewed HEAD, push that exact SHA to the existing Sites source
repository, package with the Sites helper, save one private version, deploy it,
poll to terminal success, open the production URL in Codex, and report the
version number and URL.

---

## Milestone 2A Acceptance

Milestone 2A is complete only when:

- every new blank world contains seven deterministic, visible facilities and
  the six validated construction products;
- no player track, train, service, scenario, or solved route is created;
- the initial forest/sawmill terrain opportunity remains feasible and
  affordable;
- inventories and processing are atomic, bounded, and conserved;
- extraction/import/consumption/export are explicit boundary deltas;
- local quotes are bounded, deterministic, and explained;
- construction cash is fully represented in the persisted ledger;
- operating ticks are fixed, deterministic, pausable, and persist exactly;
- facility blockers and inventories are legible on map and in the inspector;
- the complete six-product chain reconciles in a headless integration test;
- review has no open Critical or Important findings;
- the exact reviewed commit is deployed privately through Sites.

## Next Plans

- **Milestone 2B:** preconfigured freight sets, atomic vehicle purchase,
  cargo capacity, stopped-train loading/unloading, delivery revenue and running
  costs, the first profitability milestone, train/facility transfer UI, and the
  first end-to-end manual timber route.
- **Milestone 2C:** bulk and flatbed parallel flows, port handling/global trade,
  dynamic contracts, full P&L/goals UI, construction-chain progression, and
  player delivery of building modules to the town market.
