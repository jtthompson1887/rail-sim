# Dual-Mode Train Dynamics and Physics Harness

**Date:** 2026-07-29

**Status:** Approved design; implementation planning pending

**Product intent:** Trains must flow convincingly through curves in normal
operation while retaining dangerous, costly, physically expressive derailments
and crashes.

## 1. Problem

The current follower model cannot represent a railway vehicle's wheelbase.
It derives nominal front and rear points from the body's current heading, but
both guidance forces are calculated from and applied to the vehicle centre.
Those forces are averaged, so they cannot generate independent bogie alignment
or corrective torque. The body is then rotated toward the track tangent beneath
its centre.

This causes three visible failures:

- the body cuts inside curves and appears to skate over the rails;
- front and rear wheel locations do not remain aligned with the track;
- heading is governed by a centre tangent rather than the chord between the
  vehicle's actual bogies.

Tuning the existing PID constants cannot fix this geometry. The normal-running
model needs rail-constrained bogies, while accidents need a deliberate
transition into unrestricted rigid-body physics.

## 2. Goals

The milestone must:

1. keep both bogies of every on-rail vehicle aligned to its routed track;
2. derive the chassis pose from the bogie pair so long vehicles flow naturally
   around curves;
3. simulate every powered and unpowered car individually;
4. propagate tractive effort, braking, resistance, slack, compression and
   tension through couplers;
5. support locomotives at any position in a consist;
6. produce fair, readable overspeed and overload risk;
7. release vehicles into genuine Matter.js crash physics when derailment or
   collision occurs;
8. preserve momentum and physically meaningful accident severity across that
   transition;
9. expose crash telemetry that a later vehicle-condition and maintenance
   system can consume;
10. provide a deterministic headless harness and a visual laboratory for rapid
    physics tuning;
11. accept 40-car consists at normal quality and exercise 100-car consists as a
    stress case.

## 3. Non-goals

YAGNI excludes the following from this milestone:

- detailed wheel flange, suspension or rail-contact simulation;
- individual axles inside a bogie;
- adhesion curves, wheel slip and sanding;
- pneumatic brake-pipe propagation;
- track cant or active suspension;
- maintenance schedules, repair shops and repair pricing;
- cargo damage pricing or insurance;
- deformable vehicle bodies;
- thousand-car consists.

The interfaces must expose physical values needed by later condition and
maintenance work, but this milestone must not implement those systems.

## 4. Chosen architecture

### 4.1 Dual-mode state machine

Every car has exactly one active dynamics mode:

1. **`on-rail`** — bogies are constrained to a routed track path and the car has
   one longitudinal degree of freedom;
2. **`derailing`** — a one-tick transition captures the final constrained pose,
   velocity, curvature, coupler loads and initiating impulse;
3. **`free-body`** — the car is released as a dynamic Matter.js body with no
   track guidance.

Normal running never uses lateral attraction forces to approximate adherence.
Crash mode never receives hidden rail forces. The transition is explicit and
testable.

### 4.2 Arc-length track authority

Bézier parameter `t` is not proportional to travelled distance. A
`TrackArcLengthIndex` therefore provides deterministic queries by world-space
distance:

- point;
- tangent;
- curvature and signed turn direction;
- track-local distance;
- traversal across a connected start or end port.

Each query uses a bounded, deterministic lookup table with local refinement.
The same service is authoritative for simulation, placement, persistence
replay and the harness.

A `RouteCursor` identifies:

- track UUID;
- distance along that track;
- travel direction;
- chosen continuation at the next port.

Moving a cursor by signed distance traverses connected segments without a
position or heading discontinuity. Junction choice comes from the routed
service when one exists and otherwise from the junction's active branch.

### 4.3 Bogie and chassis geometry

Each vehicle definition provides:

- front and rear bogie offsets from chassis centre;
- wheelbase;
- body length;
- mass;
- powered or unpowered status;
- tractive-effort and braking limits when applicable;
- coupler anchor offsets.

One longitudinal car coordinate is authoritative. The front and rear bogie
cursors are derived at their fixed offsets along the selected route. The
rendered chassis:

- sits at the midpoint of the two bogie world positions;
- points from the rear bogie toward the front bogie;
- never uses the tangent beneath the chassis centre as its heading authority.

This makes wheelbase error and lateral bogie error numerical invariants rather
than PID tuning targets.

### 4.4 Individual consist dynamics

A `ConsistDynamicsSolver` advances every car and coupler at a fixed timestep.
Each car contributes:

- mass;
- powered tractive effort, if any;
- service or emergency braking;
- rolling resistance;
- aerodynamic drag;
- gradient force derived from the track's vertical profile.

Each coupler contributes:

- neutral length;
- free slack;
- spring stiffness outside the slack band;
- damping;
- maximum compression;
- maximum tension;
- break threshold.

Coupler forces are equal and opposite. They allow run-in, run-out, buff and
draft forces, distributed power and push-pull operation. Cars are not held at
rigid spacing.

The solver uses deterministic fixed substeps selected for the stiffest supported
coupler configuration. Rendering interpolates between completed physics states
and never changes simulation results.

## 5. Collisions, derailment and crash transition

### 5.1 Readable hybrid risk

Derailment uses three bands:

- **safe:** no derailment hazard;
- **warning:** deterministic hazard accumulates while the unsafe exposure
  persists;
- **hard failure:** immediate derailment.

Inputs include:

- lateral acceleration `v² / radius`;
- sustained wheel unloading proxy on sharp curvature transitions;
- coupler tension and compression;
- collision impulse;
- invalid or discontinuous track traversal.

Hazard is accumulated per fixed physics step. A seeded incident threshold is
drawn once for the exposure episode, not once per render frame. Identical world,
vehicle and control inputs therefore replay identically. Future condition and
maintenance may modify limits and hazard accumulation through explicit
modifiers; their default value is neutral.

### 5.2 On-rail collision authority

On-rail vehicle bodies remain selectable collision proxies but do not rely on
Matter's free-body response for ordinary motion.

- Vehicles sharing a routed rail corridor use ordered longitudinal envelopes
  for buffer and collision detection.
- Crossing or already derailed bodies use swept oriented vehicle bounds.
- Closing speed and effective mass determine the initiating impulse.
- Low-energy buffer contact may be absorbed by coupler and buffer compression.
- An impact that exceeds the derailment envelope releases the involved cars.

This makes crash initiation deterministic and physically explainable. Once
released, Matter.js owns the subsequent pile-up, rotation and secondary
impacts.

### 5.3 Free-body initial conditions

At release, every affected car inherits:

- chassis position and angle from its bogies;
- linear velocity along the bogie chord;
- angular velocity derived from longitudinal speed and local curvature;
- mass and inertia;
- current coupler tension or compression;
- the initiating collision impulse;
- the terrain-relative height/placement required by the 2D presentation.

Couplers may break immediately, remain attached for a bounded transition, or
pull neighbouring cars off the rail according to their measured loads. No
vehicle receives rail guidance after entering `free-body`.

### 5.4 Accident telemetry

The simulation emits an immutable incident record containing:

- incident ID and fixed tick;
- involved vehicle and consist IDs;
- trigger and track location;
- derailment speed;
- lateral acceleration;
- collision impulse and delta-v;
- absorbed kinetic energy;
- angular impulse and rollover severity;
- peak coupler forces and broken couplers;
- secondary impact summaries;
- incident duration.

This distinguishes a slow derailment from a head-on collision without inventing
condition loss or repair costs prematurely. A later damage system will consume
the record.

## 6. Runtime boundaries

The implementation is divided into focused units:

- `TrackArcLengthIndex` — track distance, pose and curvature queries;
- `RouteCursor` — deterministic traversal through connected tracks;
- `RailVehicleModel` — bogie geometry and per-car physical properties;
- `CouplerModel` — slack, buff/draft forces and break limits;
- `ConsistDynamicsSolver` — fixed-step longitudinal integration;
- `DerailmentEvaluator` — safe, warning and hard-failure decisions;
- `CrashTransition` — conversion from constrained to Matter state;
- `RailCollisionDetector` — rail-corridor and swept-bound contacts;
- `TrainDynamicsAdapter` — synchronises simulation state with Phaser bodies,
  selection, persistence and rendering;
- `TrainPhysicsHarness` — scenario execution, metrics and reports.

The pure dynamics layer depends on plain data and math, not Phaser scene state.
Only the runtime adapter and free-body crash phase depend on Matter.js. This
keeps normal dynamics deterministic and makes rapid headless tests practical.

## 7. Physics and tuning harness

### 7.1 Deterministic headless runner

The primary harness runs the pure track, consist, coupler and derailment
systems with a fixed timestep. It supports:

- one scenario or the complete corpus;
- deterministic replay hashes;
- parameter overrides from a typed configuration;
- JSON metric output;
- before/after configuration comparison;
- bounded parameter sweeps.

The canonical corpus includes:

1. straight acceleration;
2. service and emergency braking;
3. constant-radius curves below, inside and beyond the derailment envelope;
4. S-curves and compound curves;
5. uphill, downhill and gradient transitions;
6. connected-segment and junction traversal;
7. locomotive-led, distributed-power and push-pull consists;
8. coupler slack run-in, run-out, compression, tension and breakage;
9. 40-car acceptance consists;
10. 100-car stress consists;
11. rear-end, head-on and crossing collisions;
12. slow derailment and high-energy crash transitions;
13. variable render-frame schedules over identical fixed physics.

### 7.2 Visual laboratory

A browser harness renders any canonical scenario with:

- track centreline and route direction;
- front and rear bogie markers;
- chassis and coupler anchors;
- velocity, force and collision vectors;
- safe, warning and failure envelopes;
- speed, acceleration, jerk, curvature and coupler-force graphs;
- pause, slow motion, frame-step and timeline scrubbing;
- side-by-side parameter configurations;
- incident telemetry and deterministic replay status.

The visual laboratory reuses production geometry and simulation code. It may
not contain a simplified duplicate physics implementation.

### 7.3 Tuning discipline

All physical constants live in a typed `TrainPhysicsConfig`. Parameter sweeps
operate on explicit bounded ranges and report objective metrics. A parameter
change is accepted only when:

- the targeted scenario improves;
- the complete canonical corpus remains within its gates;
- the change has a physical explanation;
- visual review shows no new oscillation, snapping or corner cutting.

## 8. Acceptance gates

### 8.1 Rail adherence

- Front and rear bogie positions match their authoritative route positions
  within `0.01` world units.
- Wheelbase error remains below `0.01` world units.
- Chassis midpoint and bogie-chord heading match the authoritative pose within
  floating-point tolerance.
- Connected track transitions introduce no position jump above `0.1` world
  units.
- Safe-speed corpus cases complete without derailment.

### 8.2 Dynamics

- Powered and unpowered cars couple in any supported ordering.
- Multiple powered cars contribute force without double-moving the consist.
- Coupler forces are equal and opposite within floating-point tolerance.
- A closed, drag-free collision scenario conserves linear momentum within
  `0.5%`.
- Emergency braking never produces NaN, infinite state or a reversed coupler
  force caused only by timestep instability.
- Identical fixed inputs produce an identical replay hash under different
  render-frame schedules.

### 8.3 Derailment and crashes

- Warning-band exposure is deterministic and clears when the vehicle returns
  safely below the envelope.
- Hard-limit cases derail on the expected fixed tick.
- Free-body initial position, velocity and angular velocity match the final
  constrained state.
- Slow and high-energy incidents produce ordered severity telemetry.
- Coupler overload can break one connection without silently deleting or
  teleporting cars.

### 8.4 Scale and feedback

- The complete standard headless corpus finishes in at most two seconds on the
  benchmark environment.
- A 40-car consist passes all normal-operation gates.
- A 100-car stress run completes without NaN, tunnelling through connected
  track, or unbounded coupler energy.
- The browser laboratory can replay a failing scenario from its JSON seed and
  configuration without manual setup.

## 9. Delivery sequence

Implementation should proceed in narrow, reviewable slices:

1. arc-length track queries and route traversal;
2. bogie-derived single-car pose;
3. fixed-step longitudinal vehicle dynamics;
4. individual couplers and mixed powered/unpowered consists;
5. headless corpus and quantitative gates;
6. derailment envelope and deterministic hazard;
7. constrained-to-Matter crash transition;
8. on-rail collision authority and incident telemetry;
9. browser visual laboratory and bounded tuning;
10. production adapter replacement, regression review and acceptance.

The existing centre-force follower remains in place until the new single-car
and consist gates pass. The final switch removes the obsolete PID rail-guidance
path rather than maintaining two competing normal-operation solvers.
