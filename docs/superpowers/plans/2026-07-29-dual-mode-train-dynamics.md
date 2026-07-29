# Dual-Mode Train Dynamics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace centre-force train guidance with deterministic
rail-constrained bogies, individual-car consist dynamics, and genuine
free-body derailment/crash physics backed by rapid headless and visual tuning
harnesses.

**Architecture:** A pure TypeScript fixed-step layer owns arc-length route
traversal, bogie pose, longitudinal car dynamics, couplers and derailment
decisions. A Phaser adapter renders constrained cars and performs an explicit
one-way transition into Matter.js for crashes. Production and test harnesses
share the same solver and typed physics configuration.

**Tech Stack:** TypeScript 4, Jest/ts-jest, Phaser 3.60, Matter.js 0.19,
Webpack, Playwright/Chromium.

## Global Constraints

- Normal running uses rail-constrained bogies; no lateral PID attraction force
  may be the authoritative rail-adherence mechanism.
- Every powered and unpowered car is simulated individually.
- Front/rear bogie error and wheelbase error must remain below `0.01` world
  units in the canonical corpus.
- Connected track transitions may not jump more than `0.1` world units.
- The normal acceptance target is 40 cars; the stress target is 100 cars.
- Derailment uses safe, warning and hard-failure bands with deterministic
  fixed-step hazard accumulation.
- Released cars retain constrained position, velocity, angular velocity,
  coupler load and initiating collision impulse before Matter.js takes over.
- Future vehicle condition and maintenance may modify explicit thresholds, but
  this plan must not implement maintenance, repair pricing or insurance.
- Physical constants belong in one typed `TrainPhysicsConfig`; no scattered
  tuning literals.
- The complete standard headless corpus must finish within two seconds on the
  benchmark environment.
- Use TDD for every production change and commit each independently reviewable
  task.
- Preserve unrelated workspace changes.

---

## File map

### New pure dynamics files

- `src/physics/TrainPhysicsConfig.ts` — typed constants and the production
  configuration.
- `src/physics/TrackArcLengthIndex.ts` — distance-based point, tangent and
  curvature queries over one cubic track.
- `src/physics/RouteCursor.ts` — deterministic movement through connected
  track ports.
- `src/physics/RailVehicleModel.ts` — bogie-derived pose and per-car state.
- `src/physics/CouplerModel.ts` — slack, spring/damper and break-force rules.
- `src/physics/ConsistDynamicsSolver.ts` — fixed-step individual-car
  longitudinal integration.
- `src/physics/DerailmentEvaluator.ts` — safe/warning/hard envelope and seeded
  hazard.
- `src/physics/RailCollisionDetector.ts` — same-route and swept-bound contacts.
- `src/physics/CrashTransition.ts` — constrained-to-free-body initial state and
  telemetry.
- `src/physics/TrainPhysicsHarness.ts` — deterministic scenario runner and
  metrics.
- `src/physics/TrainPhysicsScenarios.ts` — canonical scenario corpus.

### Runtime integration files

- `src/systems/TrainDynamicsAdapter.ts` — production bridge between pure
  dynamics, Train/Carriage display bodies and Matter.
- `src/managers/TrainManager.ts` — consist ownership and fixed-step dispatch.
- `src/entities/Train.ts` and `src/entities/Carriage.ts` — vehicle definitions
  and runtime-body hooks; no track-following PID authority.
- `src/config/VehicleTypes.ts` — common rail-vehicle physical contract.
- `src/config/WorldData.ts` and `src/utils/TrainSerializer.ts` — persisted
  constrained/free-body vehicle state.
- `src/services/EventBus.ts` — typed derailment/crash telemetry events.
- `src/systems/TrackFlowSolver.ts` — deleted after the production adapter
  acceptance gate.

### Harness files

- `tests/physics/*.test.ts` — pure deterministic dynamics tests.
- `tests/performance/TrainPhysicsBenchmark.test.ts` — headless corpus runtime
  gate.
- `tests/performance/train-physics-browser-entry.ts` — visual laboratory.
- `tests/performance/run-train-physics-browser.js` — Chromium harness runner.
- `tests/performance/TrainPhysicsBrowserHarness.test.ts` — production-stack
  composition guard.
- `src/ui/TrainPhysicsLabOverlay.ts` — visual vectors, graphs and scenario
  controls used only by the laboratory entry point.

---

### Task 1: Typed physics configuration and arc-length track index

**Files:**

- Create: `src/physics/TrainPhysicsConfig.ts`
- Create: `src/physics/TrackArcLengthIndex.ts`
- Test: `tests/physics/TrackArcLengthIndex.test.ts`
- Modify: `src/entities/RailTrack.ts`

**Interfaces:**

- Consumes: `TrackGeometryDef` control points and `RailTrack.getControlPoints()`.
- Produces:

```ts
export interface TrackPose {
  point: { x: number; y: number };
  tangent: { x: number; y: number };
  curvature: number;
}

export interface CouplerPhysicsConfig {
  slackMetres: number;
  stiffnessNPerMetre: number;
  dampingNsPerMetre: number;
  maxCompressionMetres: number;
  maxTensionMetres: number;
  breakForceN: number;
}

export interface DerailmentPhysicsConfig {
  warningLateralAccelerationMps2: number;
  hardLateralAccelerationMps2: number;
  warningCouplerLoadRatio: number;
  hazardPerSecondAtHardBoundary: number;
}

export class TrackArcLengthIndex {
  constructor(
    geometry: TrackGeometryDef,
    sampleSpacing: number,
  );
  get length(): number;
  poseAtDistance(distance: number): TrackPose;
  distanceForPoint(point: { x: number; y: number }): number;
}

export interface TrainPhysicsConfig {
  fixedStepSeconds: number;
  worldUnitsPerMetre: number;
  arcSampleSpacing: number;
  bogieTolerance: number;
  transitionTolerance: number;
  rollingResistancePerKg: number;
  aerodynamicDrag: number;
  coupler: CouplerPhysicsConfig;
  derailment: DerailmentPhysicsConfig;
}

export const TRAIN_PHYSICS_CONFIG: Readonly<TrainPhysicsConfig>;
```

Start with one explicit, reviewable configuration:

```ts
export const TRAIN_PHYSICS_CONFIG = Object.freeze({
  fixedStepSeconds: 1 / 120,
  worldUnitsPerMetre: 10,
  arcSampleSpacing: 4,
  bogieTolerance: 0.01,
  transitionTolerance: 0.1,
  rollingResistancePerKg: 0.01962,
  aerodynamicDrag: 6,
  coupler: {
    slackMetres: 0.08,
    stiffnessNPerMetre: 1_200_000,
    dampingNsPerMetre: 80_000,
    maxCompressionMetres: 0.35,
    maxTensionMetres: 0.45,
    breakForceN: 4_000_000,
  },
  derailment: {
    warningLateralAccelerationMps2: 4,
    hardLateralAccelerationMps2: 6,
    warningCouplerLoadRatio: 0.85,
    hazardPerSecondAtHardBoundary: 2,
  },
} satisfies TrainPhysicsConfig);
```

These are initial harness values, not hidden balance authority. Every later
tuning change must cite corpus evidence.

- [ ] **Step 1: Write RED arc-length tests**

Create straight and cubic fixtures and assert endpoints, midpoint distance,
unit tangents, finite signed curvature, clamping and nearest-distance replay:

```ts
it('queries a curved track by travelled distance rather than raw Bezier t', () => {
  const index = new TrackArcLengthIndex(curvedGeometry, 8);
  const half = index.poseAtDistance(index.length / 2);
  expect(Math.hypot(half.tangent.x, half.tangent.y)).toBeCloseTo(1, 8);
  expect(Number.isFinite(half.curvature)).toBe(true);
  expect(index.distanceForPoint(half.point)).toBeCloseTo(index.length / 2, 1);
});
```

- [ ] **Step 2: Prove RED**

Run:

```powershell
npx jest tests/physics/TrackArcLengthIndex.test.ts --runInBand --coverage=false
```

Expected: fail because the module does not exist.

- [ ] **Step 3: Implement the minimal deterministic index**

Use a bounded monotonic `{t, distance, point}` table. Locate distance with
binary search, refine the local `t`, calculate the cubic derivative for the
tangent, and calculate signed curvature from first and second derivatives.
Clamp queries to `[0, length]`; reject non-finite control points in the
constructor.

- [ ] **Step 4: Expose a cached index from RailTrack**

Add:

```ts
getArcLengthIndex(): TrackArcLengthIndex
```

Rebuild the cached index inside `updateTrackVectors`; no consumer constructs a
second index for the same live track.

- [ ] **Step 5: Run focused and neighbouring tests**

```powershell
npx jest tests/physics/TrackArcLengthIndex.test.ts tests/unit/RailTrack.test.ts --runInBand --coverage=false
npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 6: Commit**

```powershell
git add src/physics/TrainPhysicsConfig.ts src/physics/TrackArcLengthIndex.ts src/entities/RailTrack.ts tests/physics/TrackArcLengthIndex.test.ts
git commit -m "feat: index tracks by travelled distance"
```

---

### Task 2: Deterministic route cursor across connected tracks

**Files:**

- Create: `src/physics/RouteCursor.ts`
- Test: `tests/physics/RouteCursor.test.ts`
- Modify: `src/entities/TrackPort.ts`
- Modify: `src/entities/RailTrack.ts`
- Modify: `src/entities/Junction.ts`

**Interfaces:**

- Consumes: `RailTrack.getArcLengthIndex()`, start/end `TrackPort.connections`,
  and the junction's active branch.
- Produces:

```ts
export type TravelDirection = 1 | -1;

export interface RouteCursorState {
  trackUUID: string;
  distance: number;
  direction: TravelDirection;
}

export interface RouteResolver {
  trackByUUID(uuid: string): RailTrack | null;
  continuation(
    track: RailTrack,
    exit: 'start' | 'end',
    preferredTrackUUID?: string,
  ): { track: RailTrack; direction: TravelDirection } | null;
}

export class RouteCursor {
  constructor(state: RouteCursorState, resolver: RouteResolver);
  get state(): Readonly<RouteCursorState>;
  pose(): TrackPose;
  movedBy(deltaDistance: number, preferredTrackUUID?: string): RouteCursor;
}
```

- [ ] **Step 1: Write RED traversal tests**

Cover forward and reverse traversal, a connected two-track boundary, an active
junction branch, no continuation, and exact-boundary replay:

```ts
it('crosses a connected end port without a world-space jump', () => {
  const before = cursor.movedBy(firstLength - 0.05).pose().point;
  const after = cursor.movedBy(firstLength + 0.05).pose().point;
  expect(distance(before, after)).toBeLessThanOrEqual(0.1);
  expect(cursor.movedBy(firstLength + 1).state.trackUUID).toBe('second');
});
```

- [ ] **Step 2: Prove RED**

```powershell
npx jest tests/physics/RouteCursor.test.ts --runInBand --coverage=false
```

Expected: missing module.

- [ ] **Step 3: Implement bounded port traversal**

Consume remaining distance one segment at a time. Stop when no continuation
exists. Reject connection loops that traverse more than `64` ports during one
step with a typed `route-cycle` result rather than hanging.

- [ ] **Step 4: Run focused tests and TypeScript**

```powershell
npx jest tests/physics/RouteCursor.test.ts tests/unit/TrackPort.test.ts tests/unit/Junction.test.ts --runInBand --coverage=false
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```powershell
git add src/physics/RouteCursor.ts tests/physics/RouteCursor.test.ts src/entities/TrackPort.ts src/entities/RailTrack.ts src/entities/Junction.ts
git commit -m "feat: traverse connected track routes by distance"
```

---

### Task 3: Bogie-constrained single-car pose

**Files:**

- Create: `src/physics/RailVehicleModel.ts`
- Test: `tests/physics/RailVehicleModel.test.ts`
- Modify: `src/config/VehicleTypes.ts`
- Modify: `src/config/GameConfig.ts`

**Interfaces:**

- Consumes: `RouteCursor`.
- Produces:

```ts
export interface RailVehicleDefinition {
  id: string;
  massKg: number;
  bodyLength: number;
  wheelbase: number;
  frontCouplerOffset: number;
  rearCouplerOffset: number;
  maxTractiveEffortN: number;
  maxBrakeForceN: number;
}

export interface OnRailVehicleState {
  mode: 'on-rail';
  vehicleId: string;
  centre: RouteCursorState;
  speedMps: number;
}

export interface RailVehiclePose {
  centre: { x: number; y: number };
  angleRad: number;
  frontBogie: { x: number; y: number };
  rearBogie: { x: number; y: number };
  frontCoupler: { x: number; y: number };
  rearCoupler: { x: number; y: number };
  curvature: number;
}

export function deriveRailVehiclePose(
  definition: RailVehicleDefinition,
  state: OnRailVehicleState,
  resolver: RouteResolver,
): RailVehiclePose;
```

- [ ] **Step 1: Write RED geometry tests**

Test a straight, constant-radius curve, S-curve and a pose straddling a segment
boundary. Assert both bogies equal their authoritative cursor poses, their
separation follows the route wheelbase, and the body angle equals the rear to
front chord:

```ts
expect(distance(pose.frontBogie, expectedFront)).toBeLessThan(0.01);
expect(distance(pose.rearBogie, expectedRear)).toBeLessThan(0.01);
expect(angleDifference(
  pose.angleRad,
  Math.atan2(
    pose.frontBogie.y - pose.rearBogie.y,
    pose.frontBogie.x - pose.rearBogie.x,
  ),
)).toBeLessThan(1e-9);
```

- [ ] **Step 2: Prove RED**

```powershell
npx jest tests/physics/RailVehicleModel.test.ts --runInBand --coverage=false
```

- [ ] **Step 3: Implement the pure pose function**

Move cloned centre cursors by `±wheelbase / 2`; never project the body centre
independently. Derive coupler anchors by moving route cursors to their offsets
so long cars remain well behaved on curves.

- [ ] **Step 4: Define the two current vehicle types**

Add one locomotive and one unpowered carriage definition to the existing
vehicle registry. Derive displayed sprite dimensions separately from physical
wheelbase; do not infer physics from texture width.

- [ ] **Step 5: Run tests and commit**

```powershell
npx jest tests/physics/RailVehicleModel.test.ts tests/unit/Train.test.ts tests/unit/Carriage.test.ts --runInBand --coverage=false
npx tsc --noEmit
git add src/physics/RailVehicleModel.ts tests/physics/RailVehicleModel.test.ts src/config/VehicleTypes.ts src/config/GameConfig.ts
git commit -m "feat: derive rail vehicle pose from bogies"
```

---

### Task 4: Individual couplers and fixed-step consist dynamics

**Files:**

- Create: `src/physics/CouplerModel.ts`
- Create: `src/physics/ConsistDynamicsSolver.ts`
- Test: `tests/physics/CouplerModel.test.ts`
- Test: `tests/physics/ConsistDynamicsSolver.test.ts`

**Interfaces:**

- Consumes: `RailVehicleDefinition`, `OnRailVehicleState`,
  `TRAIN_PHYSICS_CONFIG`.
- Produces:

```ts
export interface CouplerState {
  id: string;
  leadingVehicleId: string;
  trailingVehicleId: string;
  extension: number;
  relativeSpeed: number;
  forceN: number;
  broken: boolean;
}

export interface ConsistState {
  id: string;
  vehicles: OnRailVehicleState[];
  couplers: CouplerState[];
}

export interface ConsistControl {
  throttle: number; // -1..1
  brake: number; // 0..1
  emergencyBrake: boolean;
}

export interface ConsistStepResult {
  state: ConsistState;
  forcesByVehicleId: Readonly<Record<string, VehicleForceBreakdown>>;
  brokenCouplerIds: readonly string[];
}

export interface VehicleForceBreakdown {
  tractionN: number;
  brakingN: number;
  rollingResistanceN: number;
  aerodynamicDragN: number;
  gradientN: number;
  leadingCouplerN: number;
  trailingCouplerN: number;
  netN: number;
}

export class ConsistDynamicsSolver {
  step(
    state: Readonly<ConsistState>,
    definitions: ReadonlyMap<string, RailVehicleDefinition>,
    control: Readonly<ConsistControl>,
    resolver: RouteResolver,
    dtSeconds: number,
  ): ConsistStepResult;
}
```

- [ ] **Step 1: Write RED coupler tests**

Assert zero force inside slack, equal/opposite spring force outside slack,
damping sign, compression/tension limits and a single deterministic break:

```ts
expect(result.forceOnLeadingN).toBeCloseTo(-result.forceOnTrailingN, 9);
expect(overload.broken).toBe(true);
```

- [ ] **Step 2: Write RED consist tests**

Cover:

- one powered locomotive and one unpowered car accelerating together;
- locomotive in the middle;
- push-pull with powered cars at both ends;
- unpowered consist remaining unpowered;
- service and emergency braking;
- slack run-in/run-out;
- 40-car stability;
- variable render schedules producing the same fixed-step hash.

- [ ] **Step 3: Prove RED**

```powershell
npx jest tests/physics/CouplerModel.test.ts tests/physics/ConsistDynamicsSolver.test.ts --runInBand --coverage=false
```

- [ ] **Step 4: Implement semi-implicit fixed-substep integration**

For each substep:

1. calculate traction/braking/resistance/gradient per car;
2. calculate each coupler once and apply equal/opposite force;
3. integrate per-car velocity;
4. integrate route distance with `RouteCursor`;
5. update coupler state and break flags.

Clamp only documented controls and force limits. Do not rigidly rewrite car
spacing after integration.

- [ ] **Step 5: Run focused tests, TypeScript and commit**

```powershell
npx jest tests/physics/CouplerModel.test.ts tests/physics/ConsistDynamicsSolver.test.ts --runInBand --coverage=false
npx tsc --noEmit
git add src/physics/CouplerModel.ts src/physics/ConsistDynamicsSolver.ts tests/physics/CouplerModel.test.ts tests/physics/ConsistDynamicsSolver.test.ts
git commit -m "feat: simulate individual coupled rail cars"
```

---

### Task 5: Headless scenario corpus and rapid benchmark

**Files:**

- Create: `src/physics/TrainPhysicsHarness.ts`
- Create: `src/physics/TrainPhysicsScenarios.ts`
- Create: `tests/physics/TrainPhysicsHarness.test.ts`
- Create: `tests/performance/TrainPhysicsBenchmark.test.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: `ConsistDynamicsSolver`, route fixtures and typed config.
- Produces:

```ts
export interface TrainPhysicsMetrics {
  replayHash: string;
  maxFrontBogieError: number;
  maxRearBogieError: number;
  maxWheelbaseError: number;
  maxTransitionJump: number;
  maxCouplerForceN: number;
  maxAccelerationMps2: number;
  maxJerkMps3: number;
  derailmentTick: number | null;
  durationMs: number;
}

export interface TrainPhysicsScenario {
  id: string;
  durationSeconds: number;
  build(): TrainPhysicsScenarioState;
  controlAt(tick: number): ConsistControl;
  assert(metrics: TrainPhysicsMetrics): void;
}

export function runTrainPhysicsScenario(
  scenario: TrainPhysicsScenario,
  config?: Readonly<TrainPhysicsConfig>,
): TrainPhysicsMetrics;

export function compareTrainPhysicsConfigs(
  scenario: TrainPhysicsScenario,
  baseline: Readonly<TrainPhysicsConfig>,
  candidate: Readonly<TrainPhysicsConfig>,
): {
  baseline: TrainPhysicsMetrics;
  candidate: TrainPhysicsMetrics;
};

export function sweepTrainPhysicsConfig(
  scenarios: readonly TrainPhysicsScenario[],
  base: Readonly<TrainPhysicsConfig>,
  variants: readonly Partial<TrainPhysicsConfig>[],
): readonly {
  overrides: Partial<TrainPhysicsConfig>;
  metricsByScenario: Readonly<Record<string, TrainPhysicsMetrics>>;
}[];
```

- [ ] **Step 1: Write RED harness composition tests**

Require production solver imports, fixed timestep ownership, replay hashes and
metric bounds. Reject a harness that calls Phaser scene update as its numeric
authority.

- [ ] **Step 2: Implement the initial corpus**

Add straight acceleration/braking, constant-radius safe curve, S-curve,
connected segments, active-junction traversal, uphill/downhill gradient
transitions, mixed-power consist, 40-car acceptance and 100-car stress. Each
scenario contains exact metric assertions; no snapshot-only approval.

- [ ] **Step 3: Add the benchmark command**

Add:

```json
"benchmark:train-physics": "jest tests/performance/TrainPhysicsBenchmark.test.ts --runInBand --coverage=false"
```

The standard corpus excludes the 100-car stress case and must finish below
`2_000 ms`; the stress case has a separate `5_000 ms` diagnostic gate.

- [ ] **Step 4: Run and commit**

```powershell
npx jest tests/physics/TrainPhysicsHarness.test.ts tests/performance/TrainPhysicsBenchmark.test.ts --runInBand --coverage=false
npm run benchmark:train-physics
npx tsc --noEmit
git add src/physics/TrainPhysicsHarness.ts src/physics/TrainPhysicsScenarios.ts tests/physics/TrainPhysicsHarness.test.ts tests/performance/TrainPhysicsBenchmark.test.ts package.json
git commit -m "test: add deterministic train physics harness"
```

---

### Task 6: Hybrid derailment envelope

**Files:**

- Create: `src/physics/DerailmentEvaluator.ts`
- Test: `tests/physics/DerailmentEvaluator.test.ts`
- Modify: `src/physics/TrainPhysicsConfig.ts`
- Modify: `src/physics/ConsistDynamicsSolver.ts`
- Modify: `src/physics/TrainPhysicsScenarios.ts`

**Interfaces:**

- Consumes: speed, curvature, coupler forces, route continuity and a neutral
  future-condition modifier.
- Produces:

```ts
export interface DerailmentHazardState {
  episodeId: number;
  accumulatedHazard: number;
  seededThreshold: number;
}

export type DerailmentCause =
  | 'lateral-acceleration'
  | 'coupler-overload'
  | 'collision'
  | 'route-discontinuity';

export interface DerailmentInputs {
  speedMps: number;
  curvature: number;
  peakCouplerForceN: number;
  collisionImpulseNs: number;
  routeContinuous: boolean;
  conditionModifier: number; // exactly 1 in this milestone
}

export type DerailmentDecision =
  | { kind: 'safe'; hazard: DerailmentHazardState }
  | { kind: 'warning'; hazard: DerailmentHazardState; ratio: number }
  | { kind: 'derail'; hazard: DerailmentHazardState; cause: DerailmentCause };

export function evaluateDerailment(
  previous: Readonly<DerailmentHazardState>,
  inputs: Readonly<DerailmentInputs>,
  config: Readonly<DerailmentPhysicsConfig>,
  dtSeconds: number,
): DerailmentDecision;
```

Task 6 extends `OnRailVehicleState` from Task 3 with:

```ts
hazard: DerailmentHazardState;
```

- [ ] **Step 1: Write RED boundary tests**

Assert zero hazard below the safe boundary, deterministic accumulation in the
warning band, clearing after safe recovery, exact-tick hard failure, immediate
route discontinuity and neutral `conditionModifier: 1`.

- [ ] **Step 2: Add scenario RED tests**

Extend the corpus with safe, warning and overspeed versions of the same curve.
Run each under two render-frame schedules and require identical derailment
ticks.

- [ ] **Step 3: Implement and integrate**

Use `lateralAcceleration = speedMps ** 2 * Math.abs(curvature)`. Draw one
seeded threshold per exposure episode from stable world/vehicle/tick inputs.
Never call `Math.random`.

- [ ] **Step 4: Verify and commit**

```powershell
npx jest tests/physics/DerailmentEvaluator.test.ts tests/physics/TrainPhysicsHarness.test.ts --runInBand --coverage=false
npm run benchmark:train-physics
npx tsc --noEmit
git add src/physics/DerailmentEvaluator.ts src/physics/TrainPhysicsConfig.ts src/physics/ConsistDynamicsSolver.ts src/physics/TrainPhysicsScenarios.ts tests/physics/DerailmentEvaluator.test.ts
git commit -m "feat: add deterministic derailment risk"
```

---

### Task 7: Collision detection, crash transition and incident telemetry

**Files:**

- Create: `src/physics/RailCollisionDetector.ts`
- Create: `src/physics/CrashTransition.ts`
- Test: `tests/physics/RailCollisionDetector.test.ts`
- Test: `tests/physics/CrashTransition.test.ts`
- Modify: `src/services/EventBus.ts`
- Modify: `src/physics/TrainPhysicsScenarios.ts`

**Interfaces:**

- Consumes: rail poses, longitudinal states, coupler loads and Matter-neutral
  vehicle definitions.
- Produces:

```ts
export interface RailCollision {
  vehicleAId: string;
  vehicleBId: string;
  point: { x: number; y: number };
  normal: { x: number; y: number };
  closingSpeedMps: number;
  impulseNs: number;
}

export interface FreeBodyInitialState {
  mode: 'free-body';
  vehicleId: string;
  x: number;
  y: number;
  angleRad: number;
  velocity: { x: number; y: number };
  angularVelocityRadPerSec: number;
  initiatingImpulse: { x: number; y: number };
}

export interface TrainIncidentRecord {
  incidentId: string;
  fixedTick: number;
  cause: DerailmentCause;
  involvedVehicleIds: readonly string[];
  derailmentSpeedMps: number;
  lateralAccelerationMps2: number;
  collisionImpulseNs: number;
  deltaVelocityMps: number;
  absorbedEnergyJ: number;
  angularImpulseNms: number;
  rolloverSeverity: number;
  peakCouplerForceN: number;
  brokenCouplerIds: readonly string[];
  secondaryImpacts: readonly {
    otherVehicleId: string | null;
    impulseNs: number;
    absorbedEnergyJ: number;
  }[];
  durationSeconds: number;
}

export function detectRailCollisions(
  vehicles: readonly RailCollisionVehicle[],
  previousPoses: ReadonlyMap<string, RailVehiclePose>,
  currentPoses: ReadonlyMap<string, RailVehiclePose>,
  dtSeconds: number,
): readonly RailCollision[];

export function createCrashTransition(
  vehicles: readonly CrashTransitionVehicle[],
  trigger: DerailmentDecision | RailCollision,
  fixedTick: number,
): {
  freeBodies: readonly FreeBodyInitialState[];
  incident: TrainIncidentRecord;
};
```

- [ ] **Step 1: Write RED collision tests**

Cover same-route buffer contact, closing rear-end collision, opposing head-on
collision, swept crossing bounds and no false positive for separated tracks.

- [ ] **Step 2: Write RED transition tests**

Require preserved position, chord velocity, curvature angular velocity,
equal/opposite initiating impulses, low-versus-high severity ordering and
stable incident IDs.

- [ ] **Step 3: Implement the smallest production collision model**

Use ordered route envelopes for same-corridor cars and swept oriented
rectangles for crossing/free bodies. Calculate one impulse from closing
velocity and effective mass. Do not implement deformable bodies.

- [ ] **Step 4: Add typed incident events**

Extend EventBus with:

```ts
'train:incident': TrainIncidentRecord;
'coupler:broken': { consistId: string; couplerId: string; forceN: number };
```

- [ ] **Step 5: Add headless crash scenarios**

Add slow derailment, rear-end and head-on cases. Assert momentum error below
`0.5%` in the closed drag-free head-on fixture and ordered severity.

- [ ] **Step 6: Verify and commit**

```powershell
npx jest tests/physics/RailCollisionDetector.test.ts tests/physics/CrashTransition.test.ts tests/physics/TrainPhysicsHarness.test.ts --runInBand --coverage=false
npx tsc --noEmit
git add src/physics/RailCollisionDetector.ts src/physics/CrashTransition.ts src/services/EventBus.ts src/physics/TrainPhysicsScenarios.ts tests/physics/RailCollisionDetector.test.ts tests/physics/CrashTransition.test.ts
git commit -m "feat: transition derailed trains into crash physics"
```

---

### Task 8: Production runtime adapter and persistence

**Files:**

- Create: `src/systems/TrainDynamicsAdapter.ts`
- Test: `tests/unit/TrainDynamicsAdapter.test.ts`
- Modify: `src/managers/TrainManager.ts`
- Modify: `src/entities/Train.ts`
- Modify: `src/entities/Carriage.ts`
- Modify: `src/config/VehicleTypes.ts`
- Modify: `src/config/WorldData.ts`
- Modify: `src/utils/TrainSerializer.ts`
- Modify: `src/services/WorldContentLoader.ts`
- Test: `tests/unit/TrainManager.test.ts`
- Test: `tests/unit/TrainSerializer.test.ts`
- Test: `tests/unit/WorldSchemaValidation.test.ts`

**Interfaces:**

- Consumes: pure consist step results and crash transitions.
- Produces:

```ts
export type PersistedVehicleDynamics =
  | {
      mode: 'on-rail';
      trackUUID: string;
      distance: number;
      direction: TravelDirection;
      speedMps: number;
      consistId: string;
      consistOrder: number;
    }
  | {
      mode: 'free-body';
      x: number;
      y: number;
      angleRad: number;
      velocityX: number;
      velocityY: number;
      angularVelocityRadPerSec: number;
    };

export class TrainDynamicsAdapter {
  fixedUpdate(dtSeconds: number): void;
  render(alpha: number): void;
  transitionToFreeBody(
    state: FreeBodyInitialState,
    incident: TrainIncidentRecord,
  ): void;
}
```

- [ ] **Step 1: Write RED adapter tests**

Assert:

- on-rail body position and angle equal bogie-derived pose;
- render interpolation does not mutate fixed physics state;
- a released body becomes dynamic and receives exact velocity/angular velocity;
- no track force is applied after release;
- mixed powered/unpowered vehicles remain in one consist;
- incident events emit once.

- [ ] **Step 2: Write RED persistence tests**

Round-trip both persisted union variants, consist order, direction and speed.
Reject non-finite dynamics values, duplicate consist order and free-body state
containing track fields.

- [ ] **Step 3: Implement the adapter**

Use an accumulator in `TrainManager.update`:

```ts
accumulatorSeconds += Math.min(delta / 1000, maxFrameSeconds);
while (accumulatorSeconds >= config.fixedStepSeconds) {
  adapter.fixedUpdate(config.fixedStepSeconds);
  accumulatorSeconds -= config.fixedStepSeconds;
}
adapter.render(accumulatorSeconds / config.fixedStepSeconds);
```

On-rail Matter bodies are non-authoritative collision/selectable proxies.
Free-body Matter bodies are dynamic and simulation-authoritative.

- [ ] **Step 4: Replace Train and Carriage update authority**

Remove propulsion force application from `Train.update`; throttle becomes
input to the consist solver. Remove PID ownership from `ITrackFollower` only
after every runtime caller uses `TrainDynamicsAdapter`.

- [ ] **Step 5: Implement schema and loader round-trip**

Update schema version `6` to `7` on this branch and change every schema literal,
validator message and fixture deliberately. Since every required field is
validated at the root, do not accept partially shaped dynamics state.

- [ ] **Step 6: Run focused and integration tests**

```powershell
npx jest tests/unit/TrainDynamicsAdapter.test.ts tests/unit/TrainManager.test.ts tests/unit/TrainSerializer.test.ts tests/unit/WorldSchemaValidation.test.ts tests/unit/Train.test.ts tests/unit/Carriage.test.ts --runInBand --coverage=false
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```powershell
git add src/systems/TrainDynamicsAdapter.ts src/managers/TrainManager.ts src/entities/Train.ts src/entities/Carriage.ts src/config/VehicleTypes.ts src/config/WorldData.ts src/utils/TrainSerializer.ts src/services/WorldContentLoader.ts tests/unit/TrainDynamicsAdapter.test.ts tests/unit/TrainManager.test.ts tests/unit/TrainSerializer.test.ts tests/unit/WorldSchemaValidation.test.ts tests/unit/Train.test.ts tests/unit/Carriage.test.ts
git commit -m "feat: run consists with dual-mode train dynamics"
```

---

### Task 9: Browser physics laboratory

**Files:**

- Create: `src/ui/TrainPhysicsLabOverlay.ts`
- Create: `tests/performance/train-physics-browser-entry.ts`
- Create: `tests/performance/run-train-physics-browser.js`
- Create: `tests/performance/TrainPhysicsBrowserHarness.test.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: production `TrainPhysicsHarness`, scenarios, adapter and config.
- Produces browser globals:

```ts
interface Window {
  __prepareTrainPhysicsLab(scenarioId: string): Promise<void>;
  __stepTrainPhysicsLab(ticks: number): TrainPhysicsMetrics;
  __runTrainPhysicsLab(): TrainPhysicsMetrics;
  __setTrainPhysicsOverrides(
    overrides: Partial<TrainPhysicsConfig>,
  ): void;
}
```

- [ ] **Step 1: Write RED composition test**

Require actual production imports for solver, scenarios, Phaser, Matter and
overlay. Forbid a duplicate inline physics function. Require Chromium runner
to load `phaser/dist/phaser.js`.

- [ ] **Step 2: Implement the visual laboratory**

Render track, bogies, chassis, couplers and vector overlays. Add pause,
single-fixed-tick step, slow motion, scenario selector, timeline scrubbing,
side-by-side baseline/candidate configurations, JSON report export and a
compact graph for speed, lateral acceleration and peak coupler force.

- [ ] **Step 3: Add deterministic browser acceptance**

The runner executes safe curve, mixed-power 40-car and head-on scenarios,
compares replay hashes with headless results, checks finite metrics and records
duration.

- [ ] **Step 4: Add command and run**

Add:

```json
"benchmark:train-physics-browser": "node tests/performance/run-train-physics-browser.js"
```

Run:

```powershell
npx jest tests/performance/TrainPhysicsBrowserHarness.test.ts --runInBand --coverage=false
npm run benchmark:train-physics-browser
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```powershell
git add src/ui/TrainPhysicsLabOverlay.ts tests/performance/train-physics-browser-entry.ts tests/performance/run-train-physics-browser.js tests/performance/TrainPhysicsBrowserHarness.test.ts package.json
git commit -m "feat: add train physics visual laboratory"
```

---

### Task 10: Remove the obsolete follower and prove game acceptance

**Files:**

- Delete: `src/systems/TrackFlowSolver.ts`
- Delete or rewrite: `tests/unit/TrackFlowSolver.test.ts`
- Modify: every remaining import reported by
  `rg -n "TrackFlowSolver|pidControllerFront|pidControllerRear" src tests`
- Modify: `tests/e2e/menu.test.ts`
- Create: `tests/integration/TrainDynamicsAcceptance.test.ts`
- Modify: `docs/superpowers/specs/2026-07-29-dual-mode-train-dynamics-design.md`

**Interfaces:**

- Consumes: all prior tasks.
- Produces: one production train-motion path and complete acceptance evidence.

- [ ] **Step 1: Write the final RED acceptance test**

Build a connected curved route and a mixed 40-car consist, run acceleration,
curve traversal and emergency braking, then trigger a controlled collision.
Assert:

- bogie and wheelbase gates;
- no centre-tangent skating;
- powered and unpowered cars remain coupled before impact;
- the expected cars enter free-body mode;
- incident severity is finite and non-zero;
- unrelated cars remain on rail unless coupler loads exceed their threshold.

- [ ] **Step 2: Remove TrackFlowSolver and PID rail guidance**

Use:

```powershell
rg -n "TrackFlowSolver|pidControllerFront|pidControllerRear" src tests
```

Expected after removal: no production match. Retain the generic `PIDController`
utility only if another system imports it.

- [ ] **Step 3: Run the complete physics gates**

```powershell
npx jest tests/physics tests/integration/TrainDynamicsAcceptance.test.ts tests/unit/TrainManager.test.ts tests/unit/TrainSerializer.test.ts tests/unit/WorldSchemaValidation.test.ts --runInBand --coverage=false
npm run benchmark:train-physics
npm run benchmark:train-physics-browser
npx tsc --noEmit
npm run build
git diff --check
```

Expected: all pass; headless standard corpus `< 2_000 ms`; 40-car acceptance
and 100-car stress finite; browser/headless replay hashes match.

- [ ] **Step 4: Run the wider regression suite**

```powershell
npx jest --runInBand --coverage=false
npm run test:e2e
```

Expected: all pass.

- [ ] **Step 5: Review tuning output**

Inspect the browser laboratory for:

- curve entry/exit;
- S-curves;
- segment boundaries;
- slack run-in/run-out;
- distributed power;
- emergency braking;
- slow derailment;
- head-on crash.

No configuration change is accepted without rerunning Task 10 Steps 3 and 4.

- [ ] **Step 6: Record acceptance and commit**

Update the design status to `Implemented and verified`, add exact command
results, then:

```powershell
git add src tests package.json docs/superpowers/specs/2026-07-29-dual-mode-train-dynamics-design.md
git commit -m "feat: complete dual-mode train dynamics"
```
