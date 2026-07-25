# Rail Sim Milestone 1: Satisfying Map and Track Construction

> **For Codex:** Use `superpowers:subagent-driven-development` to execute this
> plan task by task. Use `superpowers:test-driven-development` for every
> behavior change, request review after each task, and use
> `superpowers:verification-before-completion` before every commit and publish.

**Goal:** Make a fresh generated world start with no railway and let the player
understandably, enjoyably, and affordably build a terrain-aware first route
whose preview exactly matches the committed and reloaded track.

**Architecture:** Keep Phaser as the rendering/input shell, but move track
geometry, construction analysis, world-opportunity generation, and money rules
into deterministic TypeScript modules. A construction proposal is the single
geometry/engineering source of truth consumed by preview, validation,
serialization, and UI. A construction quote adds final topology cost and is the
single transaction/affordability authority consumed by command execution and
undo. Existing alternate tools must use those boundaries or be temporarily
unavailable where they cannot preserve the new invariants.

**Technology:** TypeScript, Phaser 3, Jest/ts-jest, Playwright, Webpack, Sites.

---

## Milestone outcome

At the end of this milestone:

- Every new game uses a deterministic generated terrain seed and a generated,
  feasible first freight opportunity.
- The company starts with no track, no train, and no prebuilt solution.
- The player can survey at least two materially different route corridors.
- A live curved preview reports length, steepest grade, minimum radius,
  structures, itemised cost, affordability, and one useful remedy.
- The previewed geometry, committed geometry, validation, rendering, undo/redo,
  and save/reload geometry are identical.
- Track placement is atomic: graph, persisted world, neighbouring adjustment,
  and cash either all change or none change.
- Placement supports snapping, chained continuation, cancel, step-back,
  undo/redo, and clear error feedback.
- The complete construction loop is tested, committed, playtested, and
  published as the next private Sites version.

## Explicit YAGNI boundary

Milestone 1 includes only the money and generated-site data needed to make
construction decisions.

Do **not** add:

- products, recipes, inventory, cargo, wagons, loading, or unloading;
- industries that produce or consume goods;
- contracts, markets, global price indices, P&L, loans, tax, interest, or
  operating costs;
- timetables, signals, path reservations, or automated services;
- bridges or tunnels as separately placeable tools;
- a general ECS, plugin system, scripting engine, or server backend.

The two generated route endpoints are planning sites for the first opportunity,
not functioning Milestone 2 industries.

## Foundational decisions

1. **Canonical horizontal geometry:** replace the prototype spline with a cubic
   Bézier defined by `p0`–`p3`, matching the existing data contract and the
   intended click-drag construction model. Every consumer uses one pure geometry
   module.
2. **No prototype-save compatibility:** there is no existing user data, so do
   not build converters or dual data paths. `geometryVersion` remains 1 for the
   canonical cubic. Required world-shape changes increment checkpoint schemas:
   v1 geometry/base world, v2 engineering, v3 company cash/settings, v4
   opportunity, v5 transaction revision. Loading any non-current checkpoint is
   rejected with a clear “Start a new world” action; no conversion is required.
3. **Vertical profile:** construction analysis derives a compact piecewise
   profile and structure intervals. Dense preview samples are not persisted.
4. **Construction money:** persist company cash and per-track paid build value.
   `paidBuildCost` always equals the full final `quote.totalCost`, including
   topology charges, and the 50% demolition refund applies to that complete
   amount. No general financial ledger is introduced until Milestone 2.
5. **Generated opportunity:** persist resolved site/corridor output and the
   bounded generation attempt. Reloading never regenerates an existing world.
6. **Authority:** UI events display proposal data but cannot authorize a build.
   Only the construction command/service can revalidate and transact.
7. **Automatic cubic authoring:** Milestone 1 exposes no free Bézier handles.
   The start derivative follows the start port's outward vector. The end
   derivative is the negative of the end port's outward vector, producing an
   inward arrival. An unsnapped endpoint uses the chord direction. Control
   distance is a deterministic clamped fraction of chord length. Curves emerge
   from continuation and port alignment, keeping the first construction
   interaction understandable.

   Task 1 adds:

   ```ts
   GameConfig.TRACK.MIN_CONTROL_DISTANCE_PX = 50;
   GameConfig.TRACK.MAX_CONTROL_DISTANCE_PX = 400;
   ```

   These match the current snap-grid and short generated-section/junction scale.
8. **Performance budgets:** analysis and generation use configured operation
   caps. A live proposal samples at most 96 curve/profile positions; generation
   tries at most 12 attempts and 256 site candidates per attempt. Task 9
   measures preview p95 and worst-case generation time on the development
   reference machine rather than relying only on subjective playtest.

---

### Task 1: Lock canonical cubic Bézier geometry and exact persistence

**Files:**

- Create: `src/systems/TrackGeometry.ts`
- Modify: `src/entities/RailTrack.ts`
- Modify: `src/systems/TerrainValidator.ts`
- Modify: `src/utils/TrackSerializer.ts`
- Modify: `src/config/WorldData.ts`
- Modify: `src/services/WorldContentLoader.ts`
- Modify duplicated serialization in:
  - `src/systems/TrackCompleterSystem.ts`
  - `src/systems/JunctionCreatorSystem.ts`
- Test: `tests/unit/TrackGeometry.test.ts`
- Test: `tests/unit/TrackSerializer.test.ts`
- Test: `tests/unit/WorldManager.test.ts`
- Test: `tests/unit/WorldContentLoader.test.ts`
- Create: `tests/unit/WorldSchemaValidation.test.ts`
- Update affected geometry tests.

**Interfaces:**

```ts
export interface TrackGeometryDef {
  geometryVersion: 1;
  p0: Vec2Def;
  p1: Vec2Def;
  p2: Vec2Def;
  p3: Vec2Def;
}

export interface TrackGeometry {
  pointAt(t: number): Vec2Def;
  tangentAt(t: number): Vec2Def;
  approximateLength(sampleCount?: number): number;
  sample(sampleCount: number): Array<{ t: number; point: Vec2Def }>;
}

export interface AutomaticCubicInput {
  start: Vec2Def;
  end: Vec2Def;
  startOutward?: Vec2Def;
  endOutward?: Vec2Def;
}

export function deriveAutomaticCubic(
  input: AutomaticCubicInput,
): TrackGeometryDef;

export type ConstructionDifficultyId = 'relaxed' | 'standard' | 'challenging';

export interface WorldGenerationConfigDef {
  generationConfigVersion: 1;
  seed: string;
  biome: BiomeType;
  constructionDifficultyId: ConstructionDifficultyId;
}
```

- [ ] **Step 1: Write failing geometry parity and round-trip tests**

Prove:

- pure geometry points/tangents match Phaser's cubic Bézier implementation at
  representative `t` values;
- validation samples the same geometry;
- serialize -> restore -> serialize preserves all four knots exactly;
- repeated save/reload does not drift;
- newly created worlds and tracks carry schema/geometry version 1;
- schema 1 loads, unsupported/missing schemas are rejected with “Start a new
  world,” and no conversion function runs;
- automatic cubic control points follow the exact port-sign and clamped-distance
  rules for free, one-snapped, and two-snapped endpoints;
- tangent continuity is deterministic across chained segments.

Run:

```powershell
npx jest --runInBand --coverage=false tests/unit/TrackGeometry.test.ts tests/unit/TrackSerializer.test.ts tests/unit/WorldContentLoader.test.ts
```

Expected: new parity and round-trip assertions fail against the current spline
runtime and resampling serializer.

- [ ] **Step 2: Implement one pure cubic Bézier geometry source**

Implement only point, tangent, sampling, and approximate length operations used
by the milestone. Replace `Phaser.Curves.Path.splineTo()` with a cubic Bézier
curve and make `RailTrack`, terrain/curvature validation, selection/preview
helpers, and serializers consume the same knots and semantics.

Implement `deriveAutomaticCubic()` here. Tasks 4 and 6 must call this helper;
they may not reproduce its control-point math.

- [ ] **Step 3: Add explicit versions for new data**

Add:

```ts
schemaVersion: 1;
geometryVersion: 1;
```

Set both on newly created worlds/tracks and validate them on load. Do not add a
prototype spline migration or dual compatibility path. Keep `p0`–`p3` flat in
`TrackDef` for this milestone to avoid an unrelated storage redesign.

Replace permissive `migrateWorld()` backfilling with strict current-schema
validation and an explicit incompatible-save result used by the world picker.
No field conversion is implemented.

Persist one authoritative `WorldData.generationConfig` using the interface
above. Terrain, difficulty, opportunity generation, and reload all read this
object rather than duplicate seed/biome/difficulty fields.

- [ ] **Step 4: Remove duplicate lossy serializers**

All live-track persistence must call `TrackSerializer.toTrackDef()`. The
serializer must use `getControlPoints()` rather than `curve.getPoint(0.33/0.67)`.

- [ ] **Step 5: Verify and commit**

Run focused suites, then:

```powershell
npm test -- --runInBand
npm run build
git diff --check
```

Commit:

```text
feat: unify track geometry and persistence
```

---

### Task 2: Build the pure terrain-aware construction analyser

**Files:**

- Create: `src/config/ConstructionConfig.ts`
- Create: `src/systems/ConstructionAnalyzer.ts`
- Create: `src/systems/VerticalAlignment.ts`
- Refactor: `src/systems/TerrainValidator.ts`
- Modify: `src/entities/RailTrack.ts`
- Modify: `src/utils/TrackSerializer.ts`
- Modify: `src/services/WorldContentLoader.ts`
- Modify: `src/systems/tools/PlaceTrackTool.ts`
- Modify: `src/scenes/WorldScene.ts`
- Modify: `src/ui/EditorToolbar.ts`
- Modify: `src/ui/PropertiesPanel.ts`
- Modify: `src/config/WorldData.ts`
- Test: `tests/unit/ConstructionAnalyzer.test.ts`
- Test: `tests/unit/VerticalAlignment.test.ts`
- Update: `tests/unit/TrackSerializer.test.ts`
- Update: `tests/unit/WorldContentLoader.test.ts`
- Update: `tests/unit/WorldSchemaValidation.test.ts`
- Update: `tests/unit/TerrainValidator.test.ts`

**Interfaces:**

```ts
export type StructureType = 'surface' | 'cut' | 'fill' | 'bridge' | 'tunnel';

export interface VerticalProfileDef {
  profileVersion: 1;
  knots: Array<{
    t: number;
    elevation: number;
  }>;
}

export interface StructureInterval {
  type: StructureType;
  startT: number;
  endT: number;
  startElevation: number;
  endElevation: number;
}

export interface ConstructionCostBreakdown {
  track: number;
  earthworks: number;
  bridge: number;
  tunnel: number;
  total: number;
}

export interface ConstructionProposal {
  geometry: TrackGeometryDef;
  verticalProfile: VerticalProfileDef;
  length: number;
  minimumRadius: number;
  maximumGradePercent: number;
  maximumGradeT: number;
  structures: StructureInterval[];
  costs: ConstructionCostBreakdown;
  valid: boolean;
  reasonCode:
    | 'ok'
    | 'too-short'
    | 'too-long'
    | 'out-of-bounds'
    | 'grade'
    | 'curvature'
    | 'clearance'
    | 'misaligned';
  remedy: string;
}
```

- [ ] **Step 1: Write analyser fixtures first**

Create deterministic terrain fixtures for:

- flat surface track;
- rolling terrain requiring cut/fill;
- a river/depression requiring a bridge interval;
- a ridge requiring a tunnel interval;
- invalid excessive grade;
- invalid radius;
- a maximum-length valid segment and an over-length rejected segment;
- a narrow terrain feature at the configured analysis spacing;
- out-of-bounds geometry;
- mixed surface/bridge/tunnel intervals;
- exact cost-component summation and monotonicity.
- analyser operation count never exceeds the configured sample cap.

Expected: tests fail because the analyser does not exist.

- [ ] **Step 2: Implement a compact vertical alignment**

Derive a piecewise profile from terrain samples with bounded grade and smooth
transitions. Classify intervals using configured clearance/depth thresholds.
Keep the algorithm deterministic and Phaser-independent.

Profile invariants:

- `profileVersion === 1`;
- at least two finite knots;
- first `t === 0`, last `t === 1`;
- strictly increasing intermediate `t`;
- structure interval endpoints align with or interpolate from the same profile;
- serialization/restore preserves knots exactly.

- [ ] **Step 3: Make analysis follow the real curve**

Sample the canonical geometry, not the endpoint chord. Report the steepest
grade location and minimum radius. Replace `TerrainValidator` internals with a
compatibility wrapper around `ConstructionAnalyzer`; do not maintain two rule
sets.

- [ ] **Step 4: Add itemised construction costs**

Use named configuration rates. Cost must be a pure function of analysed length,
earthworks, and bridge/tunnel intervals. Junction/topology work is added later
when a final snapped quote has topology context.

Enforce a maximum of 96 analysis samples per live proposal and add an
operation-count test so pointer movement cannot trigger unbounded terrain work.
Define:

```ts
MAX_ANALYSIS_SAMPLES = 96;
TERRAIN_ANALYSIS_SPACING = GameConfig.TERRAIN.SAMPLE_STEP / 2;
MAX_SEGMENT_LENGTH =
  TERRAIN_ANALYSIS_SPACING * (MAX_ANALYSIS_SAMPLES - 1);
```

Reject longer proposals with `too-long` instead of claiming validity from
undersampling.

- [ ] **Step 5: Persist compact engineering output**

Extend `TrackDef` only with:

```ts
verticalProfile: VerticalProfileDef;
structures: StructureInterval[];
paidBuildCost: number;
```

All Milestone 1 tracks are created through the analyser and therefore carry
their engineering output from creation. Geometry-version-1/schema-2 validation
rejects tracks missing any required field; no prototype-data compatibility is
needed.
This required shape advances `WorldData.schemaVersion` to 2. The loader rejects
schema 1 rather than migrating it.

`RailTrack` retains the proposal's profile, structure intervals, and
`paidBuildCost`; `TrackSerializer` remains the only live-to-data path. Prove:

```text
proposal -> live RailTrack -> TrackDef -> reload -> RailTrack -> TrackDef
```

preserves profile knots, structure intervals, and paid value exactly. At this
pre-topology stage, paid value equals the proposal subtotal; Task 5 requires
full `quote.totalCost` once topology charges exist.

Extend the table-driven schema test: schema 2 loads, schema 1 rejects with
“Start a new world,” and no conversion path runs.

- [ ] **Step 6: Close engineering-rule bypasses before commit**

Adapt the current primary placement path just enough to persist the complete
proposal output. Disable generator, completer, junction creation, reshape, and
manual tunnel/property mutations before this task commits; none may create an
incomplete schema-2 `TrackDef`. Task 6 later replaces the primary interaction,
and Task 8 may selectively re-enable secondary tools through the final service.

- [ ] **Step 7: Verify and commit**

Run focused suites, full Jest, build, and diff check.

Commit:

```text
feat: analyse terrain-aware track construction
```

---

### Task 3: Add the narrow construction economy

**Files:**

- Create: `src/systems/ConstructionEconomy.ts`
- Modify: `src/config/WorldData.ts`
- Modify: `src/managers/WorldManager.ts`
- Modify: `src/services/SaveService.ts`
- Modify: `src/scenes/WorldScene.ts`
- Modify: `src/ui/EditorToolbar.ts`
- Modify: `src/ui/PropertiesPanel.ts`
- Test: `tests/unit/ConstructionEconomy.test.ts`
- Update: `tests/unit/WorldManager.test.ts`
- Update: `tests/unit/SaveService.test.ts`
- Update: `tests/unit/WorldSchemaValidation.test.ts`

**Interfaces:**

```ts
export interface CompanyConstructionState {
  cash: number;
}

export interface ConstructionTransaction {
  amount: number;
  beforeCash: number;
  afterCash: number;
}
```

- [ ] **Step 1: Write money-conservation tests**

Prove:

- new-world starting cash is deterministic for the chosen difficulty;
- economy affordability accepts one explicit transaction amount; Task 5 proves
  that final construction always supplies `quote.totalCost`, never the
  engineering proposal subtotal;
- rejected purchases change nothing;
- purchase, refund, undo, and redo conserve exact integer cash;
- double execution or double refund is rejected;
- save/reload preserves cash and track paid value;
- new worlds receive the configured starting balance;
- difficulty ID persists and selects stable configuration;
- demolition refund is exactly
  `floor(track.paidBuildCost * DEMOLITION_REFUND_RATE)`.

- [ ] **Step 2: Implement only construction cash operations**

Use integer currency units. Do not add categories, history, dates, revenue, or
operating expense models. Return transaction objects so commands can reverse
exact values.

- [ ] **Step 3: Add minimal world schema**

Persist:

```ts
company: { cash: number };
```

Keep this shape extensible for Milestone 2 without adding unused fields.
Difficulty is read only from the authoritative
`WorldData.generationConfig.constructionDifficultyId` introduced in Task 1.
Adding required company state advances `WorldData.schemaVersion` to 3; reject
schema 2 rather than migrating it.

Extend the table-driven schema test: schema 3 loads, schema 2 rejects with
“Start a new world,” and no conversion path runs.

- [ ] **Step 4: Configure refunds and close money-rule bypasses**

Set one visible demolition rule in `ConstructionConfig`:

```ts
DEMOLITION_REFUND_RATE = 0.5;
```

Keep the engineering bypasses disabled from Task 2. Also disable deletion or
any remaining path that could change paid build value/cash without the
construction economy. Show a concise disabled hint. Selection remains
available. This guard lands before later tasks introduce authoritative
construction commands.

- [ ] **Step 5: Verify and commit**

Commit:

```text
feat: add construction affordability
```

---

### Task 4: Generate a blank world with a feasible first opportunity

**Files:**

- Create: `src/config/WorldGeneration.ts`
- Create: `src/systems/WorldOpportunityGenerator.ts`
- Create: `src/systems/WorldOpportunityValidator.ts`
- Modify: `src/config/WorldData.ts`
- Modify: `src/managers/WorldManager.ts`
- Modify: `src/scenes/WorldSelectScene.ts`
- Modify: `src/services/WorldContentLoader.ts`
- Modify: `src/scenes/WorldScene.ts`
- Test: `tests/unit/WorldOpportunityGenerator.test.ts`
- Test: `tests/unit/WorldOpportunityValidator.test.ts`
- Test: `tests/unit/WorldContentLoader.test.ts`
- Update: `tests/unit/WorldSchemaValidation.test.ts`
- Test: `tests/integration/GeneratedWorldStart.test.ts`

**Interfaces:**

```ts
export interface PlanningSiteDef {
  id: string;
  label: string;
  x: number;
  y: number;
  footprintRadius: number;
}

export interface OpportunityCorridorDef {
  id: string;
  /** Broad survey band shown to the player, not exact build geometry. */
  waypoints: Vec2Def[];
  /** Player-facing summary; must equal feasibilityWitness.totalCost. */
  estimatedCost: number;
  dominantTradeoff: 'short-steep' | 'long-flat' | 'structure-heavy';
  /** Hidden validation evidence; never rendered as a solved railway. */
  feasibilityWitness: {
    witnessVersion: 1;
    segments: Array<{
      geometry: TrackGeometryDef;
      verticalProfile: VerticalProfileDef;
      structures: StructureInterval[];
      costs: ConstructionCostBreakdown;
      topologyCost: 0;
    }>;
    /** Quote-equivalent sum: proposal subtotals plus topology cost. */
    totalCost: number;
  };
}

export interface StarterOpportunityDef {
  opportunityVersion: 1;
  resolvedAttempt: number;
  sites: [PlanningSiteDef, PlanningSiteDef];
  corridors: [OpportunityCorridorDef, OpportunityCorridorDef];
  recommendedCamera: { x: number; y: number; zoom: number };
}
```

- [ ] **Step 1: Write deterministic generation tests**

Prove:

- same world seed/config yields identical terrain samples, sites, corridors,
  resolved attempt, and start camera;
- different seeds vary;
- sites remain inside bounds on usable footprints;
- two corridors are spatially distinct and have a meaningful cost/engineering
  tradeoff;
- the cheaper valid route fits starting cash;
- witness `totalCost` is quote-equivalent; simple blank-world endpoint chaining
  has explicitly tested zero topology charge;
- player-facing `estimatedCost` equals the witness total exactly;
- bounded retries always terminate or return an explicit generation error;
- generation evaluates no more than 12 attempts and 256 site candidates per
  attempt;
- generated data/config is persisted and never recomputed on reload;
- generation failure persists no partial world and leaves the picker active.

- [ ] **Step 2: Implement bounded planning-site search**

Use the existing terrain generator plus the construction analyser on a coarse
grid. For each candidate corridor, deterministically produce a chain of
canonical cubic proposals using Task 1's `deriveAutomaticCubic()` helper and
retain it as a hidden feasibility witness. Each simple new endpoint-chain
segment has zero topology charge, making witness totals quote-equivalent.
Render only broad survey bands and trade-off summaries so the player receives
route choices, not a solved railway. Generate only two planning sites and two
corridor summaries. Do not add industry recipes or production.

Enforce the 12-attempt and 256-candidate caps in configuration and tests.

- [ ] **Step 3: Remove automatic starter railway content**

Delete the empty-world fallback that creates starter track and a train.
`WorldContentLoader.load()` must leave an empty saved world empty.

- [ ] **Step 4: Improve the new-world picker**

Expose:

- world name;
- seed with a randomise control;
- biome;
- one construction difficulty that changes starting cash/cost pressure.

Keep advanced terrain sliders out of this milestone.

Create and persist the world only after opportunity validation succeeds. On
retry exhaustion, persist nothing, stay in the picker, show the failed seed, and
offer Randomise Seed and Retry actions. Persist generation config and validated
result in the same successful `WorldData` creation.

Adding the required opportunity advances `WorldData.schemaVersion` to 4; reject
schema 3 rather than migrating it. `WorldData.generationConfig` remains the
single authority for seed, biome, and difficulty.

Extend the table-driven schema test: schema 4 loads, schema 3 rejects with
“Start a new world,” and no conversion path runs.

- [ ] **Step 5: Frame and display the opportunity**

Start the camera from the generated recommendation and render lightweight
planning-site/corridor survey markers. They are guidance, not prebuilt track.

- [ ] **Step 6: Verify and commit**

Commit:

```text
feat: generate feasible blank railway worlds
```

---

### Task 5: Make construction one atomic undoable command

**Files:**

- Create: `src/commands/PlaceTrackCommand.ts`
- Create: `src/systems/ConstructionService.ts`
- Modify: `src/commands/DeleteTracksCommand.ts`
- Modify: `src/commands/ReshapeTrackCommand.ts`
- Modify: `src/managers/TrackManager.ts`
- Modify: `src/managers/WorldManager.ts`
- Modify: `src/services/SaveService.ts`
- Modify: `src/systems/CommandStack.ts`
- Test: `tests/unit/PlaceTrackCommand.test.ts`
- Test: `tests/unit/ConstructionService.test.ts`
- Update: `tests/unit/CommandStack.test.ts`
- Update: `tests/unit/TrackManager.test.ts`
- Update: `tests/unit/WorldSchemaValidation.test.ts`

**Interfaces:**

```ts
export interface ConstructionQuote {
  quoteId: string;
  worldRevision: number;
  expectedCash: number;
  proposal: ConstructionProposal;
  neighbourAdjustment?: TrackAdjustmentDef;
  expectedAffectedTracks: Array<{
    trackUUID: string;
    geometry: TrackGeometryDef;
  }>;
  predictedJunction?: PredictedJunctionDef;
  topologyCost: number;
  totalCost: number;
}
```

- [ ] **Step 1: Write atomicity tests**

Prove:

- quote geometry equals committed geometry;
- affordability and debit use `quote.totalCost`, never
  `proposal.costs.total`;
- proposal is revalidated immediately before execution;
- unaffordable/stale/invalid quotes mutate nothing;
- track, neighbour adjustment, topology index, persisted definition, and cash
  commit together;
- failure during any stage rolls back all earlier changes;
- undo restores cash, graph, persisted world, and neighbour geometry exactly;
- redo reapplies the same IDs and values without double debit;
- a nonzero-topology quote stores
  `newTrack.paidBuildCost === quote.totalCost`;
- save/reload preserves that full paid value;
- deletion refunds exactly `floor(quote.totalCost * 0.5)`, and undo/redo
  conserve cash for that same topology-bearing quote;
- deletion refund follows one configured policy and removes dependent
  references safely;
- stale world revision, changed cash, or changed neighbour geometry rejects the
  quote with zero mutation;
- injected failure at each prepare/commit stage restores the complete
  before-state;
- durable save failure preserves the last valid stored snapshot, keeps the
  current in-memory world intact and marked unsaved, and never emits “Saved”.

- [ ] **Step 2: Implement the authoritative service**

The service may create quotes and execute commands, but UI and tools may not
directly debit cash or mutate persisted tracks.

Add a monotonic `WorldData.revision` incremented by every authoritative world
mutation. Quotes capture it; undo and redo are mutations and receive new
revision values rather than rewinding the counter.

Adding required revision state advances `WorldData.schemaVersion` to 5; reject
schema 4 rather than migrating it. Schema 5 is the stable Milestone 1 world
shape used by all later tasks.

Extend the table-driven schema test: schema 5 loads, schema 4 rejects with
“Start a new world,” and no conversion path runs.

Quote order is mandatory:

1. snap endpoints and predict topology;
2. produce the one final canonical geometry;
3. analyse that final geometry;
4. add topology/junction cost;
5. capture world revision, cash, and affected-neighbour before-state;
6. return one immutable quote.

`proposal.geometry` is the only geometry authority.

- [ ] **Step 3: Route topology changes through TrackManager**

Eliminate direct live-track vector mutations that bypass chunk indexing and
connection rebuilding.

- [ ] **Step 4: Upgrade existing commands**

Reshape and delete must preserve the new geometry/profile/structure/build-value
fields and exact reversible financial effects. Deletion shows and applies
`floor(paidBuildCost * 0.5)`. Keep reshape unavailable until it can quote a cost
delta through the same service; do not silently make reshaping free.

- [ ] **Step 5: Define live atomicity versus durable saving**

Command atomicity covers the live graph, authoritative in-memory `WorldData`,
topology revision, and cash. After a successful command, autosave attempts to
replace the stored snapshot. If storage fails, retain the previous stored
snapshot, keep the valid in-memory change, mark the world unsaved, and offer
Retry Save. Add failure-injection tests for both command rollback and storage
failure messaging.

- [ ] **Step 6: Verify and commit**

Commit:

```text
feat: transact track construction atomically
```

---

### Task 6: Replace two-click placement with a trustworthy live build tool

**Files:**

- Refactor: `src/systems/tools/PlaceTrackTool.ts`
- Modify: `src/systems/SnapSystem.ts`
- Modify: `src/scenes/WorldScene.ts`
- Modify: `src/systems/InputManager.ts`
- Create: `src/ui/ConstructionPreviewOverlay.ts`
- Test: `tests/unit/PlaceTrackTool.test.ts`
- Test: `tests/unit/SnapSystem.test.ts`
- Test: `tests/unit/ConstructionPreviewOverlay.test.ts`
- Test: `tests/integration/ConstructionInteraction.test.ts`

**State machine:**

```text
idle -> dragging -> review -> committed -> chained
                   |          |
                   + cancel <-+
```

- [ ] **Step 1: Write interaction-state tests**

Cover:

- pointer-down starts from a snapped or free anchor;
- dragging updates final snapped geometry and proposal;
- a snapped start port sets the outward `p0 -> p1` tangent;
- a snapped end port sets the inward `p2 -> p3` tangent;
- an unsnapped endpoint uses the chord direction;
- control distance is
  `clamp(chordLength / 3, MIN_CONTROL_DISTANCE, MAX_CONTROL_DISTANCE)`;
- identical endpoints/snaps produce identical `p1/p2`;
- continued segments preserve tangent continuity at the shared port;
- pointer-up enters a clear confirm/review state rather than committing a
  different geometry;
- confirm executes the quote;
- Escape cancels the active proposal;
- right-click steps back one construction state;
- chained continuation starts at the committed snapped endpoint;
- invalid and unaffordable proposals cannot commit;
- undo/redo operate after confirmation;
- preview updates are throttled by input change, not arbitrary timers.

Milestone 1 uses automatic cubic controls only. There are no draggable Bézier
handles. If automatic geometry is invalid, remedies name real actions available
to the player: move the endpoint, extend the approach, or build a shorter
intermediate segment.

- [ ] **Step 2: Implement one proposal pipeline**

Build the final snapped geometry first, then analyse it. Preview, validation,
cost, and commit must use the same immutable proposal/quote.

Call Task 1's pure tested `deriveAutomaticCubic()` helper; pointer rendering may
not reproduce or vary the control-point math.

- [ ] **Step 3: Render engineering intervals**

Draw the canonical curve with distinct surface, cut/fill, bridge, and tunnel
styles. Mark the steepest-grade location, snapped endpoints, and predicted
junction. Do not instantiate a live `RailTrack` every pointer frame.

- [ ] **Step 4: Improve cancellation and error guidance**

Keep messages short, specific, and actionable:

- “Too steep here — move the endpoint downhill or use a shorter section.”
- “Section too long to survey safely — build a shorter section.”
- “Tunnel section exceeds your cash.”
- “Curve radius too tight — widen the approach.”

- [ ] **Step 5: Enforce live-preview performance**

Cache analysis by immutable geometry/config key and skip unchanged pointer
positions. Keep the analyser at or below 96 samples per proposal. On the
development reference machine, 500 representative proposal analyses must be
below 8 ms p95 and the browser drag loop below 16 ms p95 excluding screenshot
capture. Record the machine/browser in the playtest report; deterministic
sample-count tests remain the portable CI gate.

- [ ] **Step 6: Verify and commit**

Commit:

```text
feat: add live terrain-aware track preview
```

---

### Task 7: Add the polished construction inspector and cash HUD

**Files:**

- Create: `src/ui/ConstructionInspector.ts`
- Create: `src/ui/CompanyHud.ts`
- Modify: `src/scenes/EditorUIScene.ts`
- Modify: `src/ui/ValidationHint.ts`
- Modify: `src/ui/PropertiesPanel.ts`
- Modify: `src/services/EventBus.ts` types if typed events are introduced
- Test: `tests/unit/ConstructionInspector.test.ts`
- Test: `tests/unit/CompanyHud.test.ts`
- Update: `tests/unit/PropertiesPanel.test.ts`
- Test: `tests/e2e/construction-loop.test.ts`

- [ ] **Step 1: Write UI lifecycle and readability tests**

Prove:

- inspector shows length, minimum radius, maximum grade/location, structure
  lengths, itemised cost, total, cash remaining, and affordability;
- displayed total, affordability, and cash-after use `quote.totalCost`,
  including topology cost, while the engineering subtotal remains labelled;
- only one remedy is shown for the current blocking issue;
- cash HUD updates after build/undo/redo;
- track deletion confirmation shows the exact 50% refund before execution;
- reshape remains visibly unavailable until a cost-delta quote exists;
- editor UI hides and disables correctly in play mode;
- empty/cancelled proposals leave no stale numbers or interactions;
- mobile layout keeps the build confirmation and blocking reason visible.

- [ ] **Step 2: Implement compact RCT-like information hierarchy**

Show the primary decision first:

```text
Build £12,450    Cash after £37,550
```

Then engineering detail. Avoid a spreadsheet panel and avoid modal confirmation
for every ordinary valid segment.

- [ ] **Step 3: Connect immutable UI DTOs**

Use EventBus for display updates only. The inspector emits a confirm/cancel
intent; `ConstructionService` remains authoritative.

- [ ] **Step 4: Add the first real browser construction flow**

In a fixed-seed world:

1. verify no railway or vehicle exists;
2. inspect the generated opportunity;
3. drag a valid surface route and see cost/grade;
4. reject an invalid and unaffordable route without mutation;
5. confirm a build;
6. continue from the snapped endpoint;
7. undo/refund and redo;
8. save/reload and verify identical geometry, structures, and cash.

- [ ] **Step 5: Verify and commit**

Commit:

```text
feat: polish the construction decision UI
```

---

### Task 8: Selectively re-enable secondary construction tools

**Files:**

- Modify: `src/systems/tools/GeneratorTool.ts`
- Modify: `src/systems/TrackCompleterSystem.ts`
- Modify: `src/systems/JunctionCreatorSystem.ts`
- Modify: reshape/tunnel/property handlers in `src/scenes/WorldScene.ts`
- Modify: relevant commands and UI controls
- Update construction characterization suites.

- [ ] **Step 1: Write invariant tests first**

The bypass paths were disabled across Tasks 2–3. For each path proposed for
re-enablement, prove:

- it uses the canonical geometry and analyser;
- it cannot bypass affordability;
- it commits atomically through the command stack;
- it preserves graph/index/persistence consistency;
- partial multi-track generation does not silently commit.

- [ ] **Step 2: Route or constrain each path**

Where a tool can cleanly use `ConstructionService`, route it through the
service. Where the complete interaction is not yet understandable or atomic,
leave the Task 3 disabled state and concise hint in place. Milestone completion
does not require generator, completer, junction, or reshape to be re-enabled.

- [ ] **Step 3: Remove manual tunnel toggles**

Tunnel/bridge classification is analyser output in Milestone 1, not a free
property toggle. Keep manual tunnel controls removed. Re-enable reshape only if
it can display and atomically apply its exact positive/negative cost delta;
otherwise leave it disabled.

- [ ] **Step 4: Verify and commit**

Commit:

```text
refactor: enforce construction rules across editor tools
```

---

### Task 9: Full playtest, review, and Sites publication

**Files:**

- Modify only files required by evidenced failures.
- Update documentation with player controls and known limits if necessary.

- [ ] **Step 1: Run complete automated gates**

```powershell
npm test -- --runInBand
npx playwright test --retries=0
npm run build
git diff --check
git status --short
rg -n "console\.(log|debug)" src tests
```

Expected:

- all Jest tests pass;
- global line coverage remains at or above 85%;
- all browser flows pass with no retries;
- production build succeeds;
- no temporary diagnostics or generated output are staged.

- [ ] **Step 2: Perform a focused construction playtest**

Use at least three fixed seeds and cover:

- flat cheap route;
- rolling terrain with earthworks;
- bridge/tunnel tradeoff;
- invalid and unaffordable feedback;
- snapping and chained continuation;
- cancel, step-back, undo, redo;
- save/reload;
- desktop and mobile readability.

Record concrete observations and tune only evidenced usability or balance
problems. Do not add new systems during polish.

- [ ] **Step 3: Run the performance gate**

On the documented development reference machine:

- 500 representative proposal analyses: below 8 ms p95;
- browser drag-loop proposal updates: below 16 ms p95;
- configured worst-case world generation: below 2 seconds;
- CI smoke generation: below 5 seconds with the same 12-attempt,
  256-candidate, and 96-sample caps.

Portable tests assert operation caps and determinism; timing results are
playtest evidence and must not be “fixed” by loosening correctness.

- [ ] **Step 4: Request milestone-wide code review**

Review the complete Milestone 1 range against this plan and the approved
long-term design. Fix all Critical and Important findings, record Minor items,
and re-review corrections.

- [ ] **Step 5: Commit final evidence-driven corrections**

Do not create an empty commit.

- [ ] **Step 6: Publish exact reviewed source**

1. Build from clean reviewed HEAD.
2. Push exact HEAD to the existing Sites source repository.
3. Package the exact build with the Sites helper.
4. Save a new version using the exact commit SHA.
5. Deploy privately to production.
6. Poll to terminal success.
7. Open the exact production URL in Codex.
8. Report the Sites version number and production URL.

---

## Final milestone acceptance

Milestone 1 is complete only when:

- a new world contains generated terrain, planning sites, and route
  opportunities but no track, train, or pre-solved railway;
- generation is deterministic, bounded, persisted, and yields affordable
  feasible corridors backed by hidden canonical witnesses without rendering a
  solved route;
- failed generation persists no partial world and offers retry/randomise;
- construction difficulty and generation config persist with the world;
- preview, validation, commit, rendering, and persistence share identical
  horizontal geometry;
- terrain analysis reports real curve grade, structure intervals, validity,
  remedy, and itemised cost;
- cash prevents unaffordable construction and is conserved by undo/redo;
- construction is atomic across live graph, persistence, topology adjustments,
  and money;
- durable save failures preserve the prior stored snapshot, mark the current
  world unsaved, and never claim success;
- placement interaction is clear, cancellable, chainable, and enjoyable on
  slopes;
- unsupported secondary tools remain disabled rather than bypassing rules;
- live preview and generation meet the recorded operation and timing budgets;
- the full automated suite and coverage gate pass;
- independent review has no open Critical or Important findings;
- the exact reviewed commit is deployed as the current private Sites build.

## Deferred to Milestone 2

- turn planning sites into working producers, processors, consumers, and ports;
- add the six initial materials, recipes, inventories, quotes, freight capacity,
  loading/unloading, contracts, company milestones, P&L, and bounded global
  construction-sector economy;
- use the Milestone 1 construction-supply route as the first playable economic
  chain.
