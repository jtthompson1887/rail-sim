# Task 14 Report: Collective Three-Seed Browser Acceptance and Tuning

## Outcome

Implemented collective browser acceptance for the first profitable timber
route across three explicit generated-world seeds:

- `real-terrain-alpha`
- `first-route-browser-beta`
- `first-route-browser-gamma`

The acceptance uses production UI gestures for construction and purchase on
all three seeds. One desktop seed runs an actual real-time physics trip using
only W input, coasting, and short S braking pulses. The other seeds use a
constrained window adapter for deterministic production economy ticks and
live runtime placement.

No freight, economy, train-physics, or route-generation constants were
changed. Evidence showed the production physics can complete the selected
starter route inside the required interval with a positive margin.

## RED Evidence

The browser file was created before the production harness.

Fresh production build:

```powershell
npm run build
```

Result:

```text
webpack 5.88.1 compiled with 3 warnings
Exit code: 0
```

The first no-retry Playwright run was observed RED. A focused rerun isolated
the expected missing capability:

```powershell
npx playwright test tests/e2e/first-freight-route.test.ts --retries=0 --grep "controlled seed" --reporter=line
```

Result:

```text
page.waitForFunction: Test timeout of 60000ms exceeded
at waitForFirstRouteHarness
1 failed
```

The page had reached `WorldScene`; the failure was solely that
`window.__railSimFirstRouteHarness` did not yet exist.

## Implementation

### Constrained browser adapter

`WorldScene` now exposes the exact Task 14 adapter:

- `snapshot()` clones and recursively freezes the authoritative world,
  live train runtime, save state, objective DTO, and exact main-camera
  scroll/zoom/viewport fields.
- `setMode()` enters Create or Play through `GameStateManager`.
- `advanceFixedTicks()` advances only through `EconomySystem`, then applies
  the same presentation, operation-lock, save, and HUD paths as normal play.
- `setTrainRuntime()` controls only live position, velocity, throttle, and
  derail state through `TrainManager`, `TrackManager`, and Matter runtime.
- `retrySave()` calls the existing world save/report path.

There are no company, cash, ledger, facility inventory, cargo, operations,
progress, or objective setters.

Captured train runtime objects are frozen. Controlled runtime application
also clears retained Matter force and angular velocity so exact stopped
states do not inherit force from a preceding moving state.

### Exact persistence fix

A real mid-transit reload exposed an authoritative drift:

```text
Expected trackT: 0.5001669799657912
Received trackT: 0.5002536876153704
```

Startup Create mode restored the exact saved Bézier position, immediately
reprojected it, and saved the approximation over the authoritative `trackT`.
Startup persistence now skips runtime resynchronisation only during the
existing startup-save window. Ordinary saves and Create/Play mode changes
continue to synchronise live runtime.

### Browser evidence

The three-seed browser file proves collectively:

- zero initial tracks, junctions, stations, and trains;
- cheapest-corridor selection by `estimatedCost` then corridor ID;
- corridor, £90,000 set, and £20,000 reserve affordability;
- UI construction from every persisted witness `p0` to `p3`;
- connected first-route objective and construction spend at most £890,000;
- real UI timber-set quote, placement, confirmation, cash, capex, and facing;
- stopped six-batch automatic loading to 60 tonnes;
- no transfer while moving;
- exact pre-batch partial and final local-price payments;
- positive completed-trip operating margin and Sawmill processing;
- exact mid-load, transit, mid-unload, and completed real reloads;
- three controlled complete cycles with one £20 transit tick per cycle;
- derail/re-rail cargo retention;
- mobile 375×667 panel bounds and real throttle-control clicks.

The legacy construction suite now activates overlapped accessible controls
through focus plus Enter. This retains a real browser gesture while avoiding
the vehicle purchase panel intercepting the underlying DOM button.

## Real-Trip Diagnostic Evidence

The initial real-trip helper exposed three test-driver issues in sequence:

1. Clicking empty canvas deselected the train, so W had no target.
2. Repeated S pulses reversed the train and drove it back beyond the Forest.
3. A final creep branch restarted after the first unload batch.

Runtime telemetry established each cause before changing the helper. The
final operator profile:

- selects the live train through its camera-transformed canvas position;
- observes a loaded terminal dwell;
- uses W/coast for the route;
- begins braking three Sawmill access radii out;
- uses short S pulses and slow W creep;
- latches arrival after the first cargo decrease.

Fresh combined-gate measurement:

```text
[first-route] purchase-to-unload=135.647s revenue=6640 running=1840
```

The final train was inside Sawmill access, stopped at or below 2 world
units/second, neutral, not derailed, and empty. Last-trip operating margin
was £4,800 and the first-route objective/HUD were positive.

## GREEN Evidence

Fresh exact Task 14 browser command:

```powershell
npm run build
npx playwright test tests/e2e/first-freight-route.test.ts tests/e2e/construction-loop.test.ts tests/e2e/derailed-train-recovery.test.ts tests/e2e/mobile-layout.test.ts --retries=0
```

Result:

```text
26 passed (4.5m)
Exit code: 0
```

Per file:

- construction loop: 3 passed;
- derailed train recovery: 2 passed;
- collective first freight route: 3 passed;
- mobile layout: 18 passed.

Fresh world-generation browser benchmark:

```powershell
npm run benchmark:world-generation
```

Result:

```text
durationMs: 70.19999998807907
targetMs: 2000
deterministicReplay: true
Exit code: 0
```

The build retains the repository's existing three webpack asset-size and
performance warnings.

## Tuning Decision

No production tuning was made.

The required route completed in 135.647 seconds with a £4,800 positive
last-trip margin. Therefore `GameConfig.TRAIN.ENGINE_POWER`, train mass,
Matter resistance, the £20 active-tick cost, freight values, six ten-unit
batches, local quote rules, and stopped-speed boundary remain unchanged.

## Review Round 1

This section supersedes the earlier references to a terminal dwell and
keyboard activation of overlapped construction controls.

### Browser-first RED/GREEN evidence

The construction loop was first restored to real pointer `.click()` calls
and given an assertion that the vehicle purchase panel yields while the
construction inspector is active. The focused no-retry browser run failed
because the purchase panel remained visible. A focused unit regression also
failed because `EditorUIScene` had no construction-preview visibility seam.

`EditorUIScene` now listens to the production `construction:preview` event,
hides the purchase panel only while a live construction decision is active,
and restores it after cancel or a completed/null preview. The listener is
removed on scene shutdown and play mode clears stale construction state.
The construction loop now uses pointer clicks for Back, Cancel, Build, and
Retry Save; it asserts both review-time yielding and post-commit restoration.

Focused GREEN evidence:

```text
EditorUIScene.test.ts: 10 passed
construction-loop "builds..." (no retries): 1 passed (21.3s)
```

### Independent transfer blockers

The controlled seed now has two separate production economy steps:

1. A partially loaded train is inside Managed Forest access with available
   source inventory, but is moving above the transfer speed with throttle
   applied. The production status is `Stop the train to transfer cargo`.
2. The same partially loaded train is stopped, neutral, non-derailed, and
   has Sawmill capacity available, but is outside Sawmill access. The
   production status is `Move inside Sawmill rail access`.

Before/after frozen snapshots prove unchanged cargo and delivery revenue in
both cases. The moving case separately proves the expected Â£20 running cost,
so transfer assertions do not confuse legitimate operating expense with a
cargo mutation.

The Sawmill recipe assertion now proves a real `0 -> 1 -> 0` progress
transition and positive log outflow. Mobile acceptance now checks the actual
train inspector, objective card, and company HUD against all four viewport
edges, and checks each throttle control vertically inside the inspector as
well as horizontally inside the viewport.

### Unpadded real trip

The artificial 25-second post-load dwell was removed before adjusting the
driver. The timer remains immediately before the real purchase click and
ends at final unload. The real case never calls `setTrainRuntime()` or
`advanceFixedTicks()`.

Observed browser-first timing sequence:

```text
No dwell, original cadence RED: 105.405s
Slower W/coast cadence RED:     111.948s
First unpadded GREEN:           123.355s
Exact-gate unpadded GREEN:      130.808s
```

The final operator cadence uses only selected-train W input, coasting
between low-speed feedback pulses, and short S braking pulses on approach.
There are no timer-threshold waits or production physics changes.

Exact-gate final state:

```text
purchase-to-final-unload: 130.808s
last-trip revenue:         Â£6,540
last-trip running cost:    Â£2,240
last-trip margin:          Â£4,300
runtime:                   inside Sawmill, stopped, neutral, not derailed
cargo:                     empty
objective:                 Route profitable
```

### Review Round 1 verification

Fresh production build and exact four-file browser gate:

```powershell
npm run build
npx playwright test tests/e2e/first-freight-route.test.ts tests/e2e/construction-loop.test.ts tests/e2e/derailed-train-recovery.test.ts tests/e2e/mobile-layout.test.ts --retries=0
```

Result:

```text
webpack 5.88.1 compiled with 3 existing performance warnings
26 passed (4.4m)
Exit code: 0
```

Fresh full Jest run:

```text
97 suites passed
1,524 tests passed
Exit code: 0
```

Fresh world-generation browser benchmark:

```text
durationMs: 70.89999997615814
targetMs: 2000
deterministicReplay: true
Exit code: 0
```
