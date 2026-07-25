# Milestone 0 Prototype Stabilisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the current uncommitted prototype work into a clean, tested, production-buildable, and privately published baseline without discarding the terrain, vehicle-placement, or recovery improvements.

**Architecture:** Preserve the existing Phaser/Webpack structure and productionise the current changes in focused slices: terrain streaming, typed vehicle identity and persistence, editor integration, and deterministic recovery. Do not add economy or new gameplay systems in this milestone; establish a trustworthy base and a Sites-compatible static Worker wrapper first.

**Tech Stack:** TypeScript 4, Phaser 3.60, Matter.js 0.19, Webpack 5, Jest 29 with ts-jest/jsdom, Playwright 1.60, Cloudflare Worker-compatible ESM, OpenAI Sites.

## Global Constraints

- Preserve all unrelated user changes; never reset or overwrite the dirty worktree wholesale.
- Every new world will ultimately begin with no prebuilt player railway; do not add a scripted or pre-made world.
- Apply YAGNI: this milestone stabilises existing prototype behaviour and hosting only.
- Use test-driven development for changed behaviour and retain the existing 590 passing tests.
- Production code must not contain temporary per-frame diagnostic logging.
- Commit after each coherent, freshly verified behaviour.
- Publish the exact verified commit through Sites at the end of the milestone.
- Do not add dependencies unless the existing toolchain cannot satisfy a verified requirement.

---

## File structure for this milestone

### Production source

- `.gitignore` — exclude generated browser/test diagnostics.
- `src/config/VehicleTypes.ts` — typed vehicle identity and common track-follower contracts.
- `src/config/WorldData.ts` — backwards-compatible persisted vehicle type.
- `src/entities/Carriage.ts` — passive passenger carriage entity.
- `src/entities/Train.ts` — locomotive identity and recovery state synchronisation.
- `src/entities/TerrainChunk.ts` — generated terrain chunk presentation.
- `src/managers/SceneryManager.ts` — zoom-aware scenery streaming.
- `src/managers/TrainManager.ts` — locomotive/carriage lifecycle and recovery.
- `src/scenes/MenuScene.ts` — stable menu preview and E2E test hook cleanup.
- `src/scenes/WorldScene.ts` — terrain zoom wiring and vehicle-tool integration.
- `src/services/EventBus.ts` — typed vehicle/editor events.
- `src/services/WorldContentLoader.ts` — persisted vehicle restoration.
- `src/systems/InputManager.ts` — drag/recovery interaction for track followers.
- `src/systems/TerrainChunkManager.ts` — camera-zoom-aware terrain streaming.
- `src/systems/TerrainGenerator.ts` — deterministic terrain corrections already present in the worktree.
- `src/systems/TrackFlowSolver.ts` — stable track switching and frame-rate-correct damping without diagnostics.
- `src/systems/tools/PlaceVehicleTool.ts` — track-snapped vehicle placement.
- `src/systems/tools/index.ts` — vehicle-tool export.
- `src/ui/EditorToolbar.ts` — vehicle tool entry and stable controls.
- `src/ui/PropertiesPanel.ts` — vehicle choice controls.
- `src/utils/TrainSerializer.ts` — typed vehicle serialisation.
- `src/utils/math.ts` — PID soft-reset support without logging.
- `src/utils/physics.ts` — body-swap state reset without logging.
- `src/hosting/worker.js` — minimal static Sites Worker that delegates to the asset binding.
- `webpack.config.js` — copies the Sites Worker and hosting metadata into `dist`.
- `.openai/hosting.json` — exact Sites project identifier returned by `create_site`.

### Tests

- `tests/unit/TerrainChunk.test.ts`
- `tests/unit/TerrainChunkManager.test.ts`
- `tests/unit/TerrainGenerator.test.ts`
- `tests/unit/Carriage.test.ts`
- `tests/unit/PlaceVehicleTool.test.ts`
- `tests/unit/InputManager.test.ts`
- `tests/unit/TrainSerializer.test.ts`
- `tests/unit/TrainManager.test.ts`
- `tests/unit/TrackFlowSolver.test.ts`
- `tests/unit/MenuScene.test.ts`
- `tests/e2e/derailed-train-recovery.test.ts`

### Removed diagnostics

- `tests/e2e/derailed-train-recovery-debug.test.ts`
- `test-results/`
- `test_output.txt`
- `test_output2.txt`
- `test_output3.txt`
- `tmp_test2.txt`
- `tmp_test_output.txt`

---

### Task 1: Remove generated diagnostics and protect the worktree

**Files:**
- Modify: `.gitignore`
- Delete: `tests/e2e/derailed-train-recovery-debug.test.ts`
- Delete local-only: `test-results/`, `test_output.txt`, `test_output2.txt`, `test_output3.txt`, `tmp_test2.txt`, `tmp_test_output.txt`

**Interfaces:**
- Consumes: existing repository ignore rules.
- Produces: a worktree in which test output and diagnostic captures cannot be accidentally committed.

- [ ] **Step 1: Record the exact disposable paths**

Run:

```powershell
git ls-files -- test-results test_output.txt test_output2.txt test_output3.txt tmp_test2.txt tmp_test_output.txt tests/e2e/derailed-train-recovery-debug.test.ts
```

Expected: no output. If any path is tracked, do not delete it until its history and purpose are reviewed.

- [ ] **Step 2: Add narrow ignore rules**

Append exactly:

```gitignore
/test-results/
/playwright-report/
/test_output*.txt
/tmp_test*.txt
/tmp_test_output.txt
```

- [ ] **Step 3: Remove only the confirmed local diagnostics**

Delete the exact paths listed under “Removed diagnostics.” Keep `tests/e2e/derailed-train-recovery.test.ts`.

- [ ] **Step 4: Verify hygiene**

Run:

```powershell
git status --short
git check-ignore test-results test_output.txt tmp_test_output.txt
```

Expected: the diagnostic paths are absent from `git status`; `git check-ignore` lists all three samples.

- [ ] **Step 5: Commit**

```powershell
git add .gitignore
git commit -m "chore: ignore local test diagnostics"
```

---

### Task 2: Verify zoom-aware generated terrain

**Files:**
- Modify: `tests/unit/TerrainChunkManager.test.ts`
- Modify: `src/entities/TerrainChunk.ts`
- Modify: `src/managers/SceneryManager.ts`
- Modify: `src/systems/TerrainChunkManager.ts`
- Modify: `src/systems/TerrainGenerator.ts`
- Test: `tests/unit/TerrainChunk.test.ts`
- Test: `tests/unit/TerrainGenerator.test.ts`

**Interfaces:**
- Consumes: `GameConfig.RESOLUTION`, `GameConfig.CAMERA.MIN_ZOOM`, `GameConfig.CAMERA.MAX_ZOOM`, and `GameConfig.WORLD.CHUNK_SIZE`.
- Produces: `TerrainChunkManager.update(cameraWorldX: number, cameraWorldY: number, zoom?: number): void` and matching zoom-aware scenery streaming.

- [ ] **Step 1: Reproduce the two stale assertions**

Run:

```powershell
npx jest tests/unit/TerrainChunkManager.test.ts --runInBand
```

Expected: exactly two failures where zoom `0` and `-0.5` return 81 chunks while stale expectations require 25.

- [ ] **Step 2: Encode the clamping rule in the tests**

Add this helper:

```ts
function expectedChunkCountForZoom(zoom: number): number {
  const safeZoom = Math.max(
    GameConfig.CAMERA.MIN_ZOOM,
    Math.min(GameConfig.CAMERA.MAX_ZOOM, Number.isFinite(zoom) ? zoom : 1),
  );
  const neededX = Math.ceil(((WIDTH / safeZoom) / 2) / CHUNK) + 1;
  const neededY = Math.ceil(((HEIGHT / safeZoom) / 2) / CHUNK) + 1;
  const radius = Math.max(2, neededX, neededY);
  return (radius * 2 + 1) ** 2;
}
```

Replace the invalid-zoom expectations with:

```ts
expect(mgr.activeChunkCount).toBe(expectedChunkCountForZoom(0));
expect(mgr.activeChunkCount).toBe(expectedChunkCountForZoom(NaN));
expect(mgr.activeChunkCount).toBe(expectedChunkCountForZoom(-0.5));
expect(mgr.activeChunkCount).toBe(expectedChunkCountForZoom(999));
```

- [ ] **Step 3: Run the terrain unit slice**

Run:

```powershell
npx jest tests/unit/TerrainChunk.test.ts tests/unit/TerrainChunkManager.test.ts tests/unit/TerrainGenerator.test.ts --runInBand
```

Expected: all terrain tests pass with no assertion failures.

- [ ] **Step 4: Verify formatting and production logging**

Run:

```powershell
git diff --check -- src/entities/TerrainChunk.ts src/managers/SceneryManager.ts src/systems/TerrainChunkManager.ts src/systems/TerrainGenerator.ts tests/unit/TerrainChunk.test.ts tests/unit/TerrainChunkManager.test.ts tests/unit/TerrainGenerator.test.ts
rg -n "console\.(log|debug)" src/entities/TerrainChunk.ts src/managers/SceneryManager.ts src/systems/TerrainChunkManager.ts src/systems/TerrainGenerator.ts
```

Expected: `git diff --check` exits 0 and `rg` finds nothing.

- [ ] **Step 5: Commit**

```powershell
git add src/entities/TerrainChunk.ts src/managers/SceneryManager.ts src/systems/TerrainChunkManager.ts src/systems/TerrainGenerator.ts tests/unit/TerrainChunk.test.ts tests/unit/TerrainChunkManager.test.ts tests/unit/TerrainGenerator.test.ts
git commit -m "feat: stream generated terrain at camera zoom"
```

---

### Task 3: Add stable typed vehicle identity and persistence

**Files:**
- Modify: `src/config/VehicleTypes.ts`
- Modify: `src/config/WorldData.ts`
- Modify: `src/entities/Train.ts`
- Modify: `src/entities/Carriage.ts`
- Modify: `src/utils/TrainSerializer.ts`
- Modify: `tests/unit/TrainSerializer.test.ts`
- Test: `tests/unit/Carriage.test.ts`
- Test: `tests/unit/ConfigAndLevelData.test.ts`

**Interfaces:**
- Consumes: existing `VehicleType = 'locomotive' | 'passenger-carriage'`.
- Produces: `ITrackFollower.vehicleType: VehicleType`; `Train.vehicleType = 'locomotive'`; `Carriage.vehicleType = 'passenger-carriage'`; serialised `TrainDef.type`.

- [ ] **Step 1: Write the serializer identity tests**

Add explicit mock identity to every serializer fixture and this carriage case:

```ts
it('serialises the declared vehicle type without constructor-name inspection', () => {
  const carriage = {
    vehicleType: 'passenger-carriage',
    getUUID: () => 'carriage-1',
    currentTrack: {
      getUUID: () => 'track-1',
      getTrackPosition: () => 0.4,
    },
    getMatterBody: () => ({ x: 40, y: 50 }),
    getPassengerCount: () => 8,
  } as unknown as IVehicle;

  expect(TrainSerializer.toTrainDef(carriage)?.type).toBe('passenger-carriage');
});
```

- [ ] **Step 2: Run the serializer test to prove the API is missing**

Run:

```powershell
npx jest tests/unit/TrainSerializer.test.ts --runInBand
```

Expected: FAIL because `TrainSerializer` still derives type from `constructor.name`.

- [ ] **Step 3: Add the discriminator**

In `ITrackFollower`:

```ts
readonly vehicleType: VehicleType;
```

In `Train`:

```ts
readonly vehicleType: VehicleType = 'locomotive';
```

In `Carriage`:

```ts
readonly vehicleType: VehicleType = 'passenger-carriage';
```

Replace constructor inspection in `TrainSerializer`:

```ts
type: vehicle.vehicleType,
```

Remove the temporary `console.log` recovery instrumentation from `Train` and `Carriage` before staging them. Preserve only the state changes covered by their recovery tests.

- [ ] **Step 4: Verify migration and serialisation**

Run:

```powershell
npx jest tests/unit/TrainSerializer.test.ts tests/unit/Carriage.test.ts tests/unit/ConfigAndLevelData.test.ts --runInBand
```

Expected: all tests pass, including backward migration of a vehicle without `type` to `locomotive`.

- [ ] **Step 5: Commit**

```powershell
git add src/config/VehicleTypes.ts src/config/WorldData.ts src/entities/Carriage.ts src/entities/Train.ts src/utils/TrainSerializer.ts tests/unit/Carriage.test.ts tests/unit/TrainSerializer.test.ts tests/unit/ConfigAndLevelData.test.ts
git commit -m "feat: persist typed rail vehicles"
```

---

### Task 4: Productionise vehicle placement and editor integration

**Files:**
- Modify: `src/main.ts`
- Modify: `src/managers/TrainManager.ts`
- Modify: `src/scenes/EditorUIScene.ts`
- Modify: `src/scenes/MenuScene.ts`
- Modify: `src/scenes/WorldScene.ts`
- Modify: `src/services/EventBus.ts`
- Modify: `src/services/WorldContentLoader.ts`
- Modify: `src/systems/InputManager.ts`
- Modify: `src/systems/tools/index.ts`
- Modify: `src/ui/EditorToolbar.ts`
- Modify: `src/ui/PropertiesPanel.ts`
- Create: `src/systems/tools/PlaceVehicleTool.ts`
- Test: `tests/unit/InputManager.test.ts`
- Test: `tests/unit/MenuScene.test.ts`
- Test: `tests/unit/PlaceVehicleTool.test.ts`
- Test: `tests/unit/TrainManager.test.ts`

**Interfaces:**
- Consumes: typed `IVehicle.vehicleType`, `TrainSerializer.toTrainDef(vehicle)`, `TrainManager.createInitialTrain(id?)`, and `TrainManager.createCarriage(id?)`.
- Produces: editor tool id `place-vehicle`, shortcut `N`, event `vehicle:type-changed`, and saved/restored locomotives and passenger carriages.

- [ ] **Step 1: Add an interaction regression test**

In `tests/unit/InputManager.test.ts`, assert the label uses the discriminator:

```ts
it('shows a carriage-specific recovery toast', () => {
  const carriage = makeFollower({ vehicleType: 'passenger-carriage', derailed: true });
  TrainManager.bodyToTrain.set(carriage.getMatterBody(), carriage);
  trainManager.tryRecoverDerailedTrain.mockReturnValue(true);

  emitInput('dragend', pointer, carriage.getMatterBody());

  expect(EventBus.emit).toHaveBeenCalledWith('ui:toast', {
    message: 'Carriage re-railed',
    type: 'success',
  });
});
```

- [ ] **Step 2: Replace runtime class-name checks**

Replace `InputManager.isTrain()` with:

```ts
private isTrain(follower: ITrackFollower): follower is Train {
  return follower.vehicleType === 'locomotive';
}
```

- [ ] **Step 3: Remove duplicate subscriptions**

`WorldScene.create()` must contain exactly one:

```ts
EventBus.on('vehicle:type-changed', this.vehicleTypeChangedHandler);
```

The shutdown handler must contain exactly one matching `EventBus.off`.

- [ ] **Step 4: Remove manager diagnostics before committing**

Remove the temporary `console.log` calls from `TrainManager.tryRecoverDerailedTrain()`. Keep the snap, `setAngle()`, PID reset, and zero-engine-power behaviour.

- [ ] **Step 5: Verify placement, loading, input, and menu slices**

Run:

```powershell
npx jest tests/unit/PlaceVehicleTool.test.ts tests/unit/InputManager.test.ts tests/unit/TrainManager.test.ts tests/unit/MenuScene.test.ts tests/unit/TrainSerializer.test.ts --runInBand
```

Expected: all selected suites pass and no duplicate event call assertions fail.

- [ ] **Step 6: Verify the production build**

Run:

```powershell
npm run build
```

Expected: Webpack exits 0. Asset-size warnings may remain for Milestone 6; TypeScript or module errors may not.

- [ ] **Step 7: Commit**

```powershell
git add src/main.ts src/managers/TrainManager.ts src/scenes/EditorUIScene.ts src/scenes/MenuScene.ts src/scenes/WorldScene.ts src/services/EventBus.ts src/services/WorldContentLoader.ts src/systems/InputManager.ts src/systems/tools/index.ts src/systems/tools/PlaceVehicleTool.ts src/ui/EditorToolbar.ts src/ui/PropertiesPanel.ts tests/unit/InputManager.test.ts tests/unit/MenuScene.test.ts tests/unit/PlaceVehicleTool.test.ts tests/unit/TrainManager.test.ts
git commit -m "feat: add track-snapped vehicle placement"
```

---

### Task 5: Stabilise vehicle recovery and remove diagnostic logging

**Files:**
- Modify: `__mocks__/phaser.js`
- Modify: `src/entities/Train.ts`
- Modify: `src/entities/Carriage.ts`
- Modify: `src/managers/TrainManager.ts`
- Modify: `src/systems/TrackFlowSolver.ts`
- Modify: `src/utils/math.ts`
- Modify: `src/utils/physics.ts`
- Modify: `tests/unit/TrackFlowSolver.test.ts`
- Modify: `tests/unit/TrainManager.test.ts`
- Create: `tests/e2e/derailed-train-recovery.test.ts`

**Interfaces:**
- Consumes: Matter body state (`angle`, `anglePrev`, `position`, `positionPrev`, `velocity`, `angularVelocity`, and `force`) and `PIDController.resetToError(error)`.
- Produces: deterministic `TrainManager.tryRecoverDerailedTrain(follower): boolean` without runtime diagnostics or post-recovery fling.

- [ ] **Step 1: Preserve the numerical regression tests**

Keep assertions proving:

```ts
expect(body.angle).toBe(body.anglePrev);
expect(speed).toBeLessThan(10);
expect(train.derailed).toBe(false);
```

Replace numerical-proof `console.log` calls in tests with direct expectations only.

- [ ] **Step 2: Remove temporary production diagnostics**

Confirm all `console.log` and `console.debug` calls have been removed from:

```text
src/entities/Train.ts
src/entities/Carriage.ts
src/managers/TrainManager.ts
src/systems/TrackFlowSolver.ts
src/utils/math.ts
src/utils/physics.ts
```

Keep the state corrections already justified by tests:

```ts
newBody.force.x = 0;
newBody.force.y = 0;
```

and ensure recovery synchronises angle history through `setAngle()` rather than direct assignment.

- [ ] **Step 3: Run the focused recovery tests**

Run:

```powershell
npx jest tests/unit/TrainManager.test.ts tests/unit/TrackFlowSolver.test.ts tests/unit/Carriage.test.ts tests/unit/physics.test.ts tests/unit/math.test.ts --runInBand
```

Expected: all selected suites pass with no diagnostic console output.

- [ ] **Step 4: Run the real-browser recovery regression**

Run:

```powershell
npx playwright test tests/e2e/derailed-train-recovery.test.ts
```

Expected: both recovery cases pass in the real Phaser/Matter runtime.

- [ ] **Step 5: Prove logging cleanup**

Run:

```powershell
rg -n "console\.(log|debug)" src
```

Expected: no temporary production diagnostics. Existing intentional `console.warn` calls in `SaveService` are allowed.

- [ ] **Step 6: Commit**

```powershell
git add __mocks__/phaser.js src/entities/Train.ts src/entities/Carriage.ts src/managers/TrainManager.ts src/systems/TrackFlowSolver.ts src/utils/math.ts src/utils/physics.ts tests/unit/TrackFlowSolver.test.ts tests/unit/TrainManager.test.ts tests/e2e/derailed-train-recovery.test.ts
git commit -m "fix: stabilise derailed vehicle recovery"
```

---

### Task 6: Run the complete baseline verification

**Files:**
- Modify only files required by an evidenced failing test.

**Interfaces:**
- Consumes: all Milestone 0 production and test changes.
- Produces: a build with a passing unit/integration suite and passing critical browser flows.

- [ ] **Step 1: Run the full Jest suite**

Run:

```powershell
npm test -- --runInBand
```

Expected: 31 suites and 592 or more tests pass; zero failures.

- [ ] **Step 2: Run the complete Playwright suite**

Run:

```powershell
npx playwright test
```

Expected: menu, mobile layout, and recovery flows pass; zero failures.

- [ ] **Step 3: Build from the verified source**

Run:

```powershell
npm run build
```

Expected: Webpack exits 0 and emits `dist/index.html` plus `dist/main.js`.

- [ ] **Step 4: Inspect the final diff**

Run:

```powershell
git diff --check
git status --short
rg -n "console\.(log|debug)" src tests
```

Expected: no whitespace errors, no generated output, and no temporary diagnostics. Any remaining source changes are intentional and enumerated before commit.

- [ ] **Step 5: Commit any evidence-driven final corrections**

If Step 1–4 required a correction, stage only those files and commit:

```powershell
git commit -m "test: complete prototype baseline verification"
```

If no correction was needed, do not create an empty commit.

---

### Task 7: Prepare and publish the verified build with Sites

**Files:**
- Create: `src/hosting/worker.js`
- Modify: `webpack.config.js`
- Create: `.openai/hosting.json`

**Interfaces:**
- Consumes: Webpack static output and the opaque `project_id` returned once by Sites `create_site`.
- Produces: `dist/server/index.js`, `dist/.openai/hosting.json`, a saved Sites version tied to the exact pushed commit, and an owner-only production deployment.

- [ ] **Step 1: Add the static Worker entrypoint**

Create:

```js
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
```

- [ ] **Step 2: Copy hosting files during Webpack builds**

Extend `CopyPlugin` patterns:

```js
{ from: 'src/hosting/worker.js', to: 'server/index.js' },
{ from: '.openai/hosting.json', to: '.openai/hosting.json' },
```

Do not run the build until `.openai/hosting.json` exists.

- [ ] **Step 3: Create the Sites project once**

Confirm `.openai/hosting.json` has no `project_id`, then call Sites `create_site` with:

```text
title: Rail Sim
slug: rail-sim-progress
description: Playable development builds of the Rail Sim railway tycoon game.
```

Immediately persist a JSON object whose sole property is `project_id` and whose value is the `id` field copied verbatim from the `create_site` response. Never invent, transform, or derive the identifier.

- [ ] **Step 4: Build and verify the Sites artifact**

Run:

```powershell
npm run build
Test-Path dist/server/index.js
Test-Path dist/.openai/hosting.json
```

Expected: build exits 0 and both checks print `True`.

- [ ] **Step 5: Commit the hosting adapter**

```powershell
git add src/hosting/worker.js webpack.config.js .openai/hosting.json
git commit -m "build: prepare Rail Sim for Sites hosting"
```

- [ ] **Step 6: Push the exact verified source**

Use the short-lived Sites source-repository credential as a per-command HTTP authorisation header. Push the current branch without storing the token in a remote URL or Git configuration. Record:

```powershell
git rev-parse HEAD
```

as the exact `commit_sha`.

- [ ] **Step 7: Package and save one version**

Run the Sites plugin `scripts/package-site.sh` helper against the repository and a temporary archive. Call `save_site_version` with the persisted `project_id`, exact pushed `commit_sha`, and absolute archive path.

- [ ] **Step 8: Deploy privately**

Call `deploy_private_site_version` with the saved `version_id`, poll `get_deployment_status` until terminal, and confirm `status: succeeded`.

If owner-only access cannot be verified, stop and ask for explicit approval before using the open-world `deploy_site_version`.

- [ ] **Step 9: Open and record the progress build**

Open the exact deployed URL in Codex. Record the milestone, commit SHA, deployment URL, and known remaining design milestones in the final handoff.

---

## Plan self-review

- **Spec coverage:** This plan covers only Milestone 0 from the approved long-term design, because terrain/economy/operations/content are independent subsystems that each require their own TDD plan. The full goal remains represented by the committed design roadmap.
- **YAGNI check:** No economic, cargo, service, or scenario feature is added during stabilisation.
- **Dirty-tree safety:** Every commit lists explicit paths and never stages the repository wholesale.
- **Type consistency:** `vehicleType` is defined once on the shared track-follower contract and consumed by serialisation and input interaction.
- **Hosting consistency:** The archive is built from and saved against the exact pushed commit.
- **Placeholder scan:** No implementation placeholder is present. The response-dependent Sites identifier is handled by an explicit copy-verbatim rule.
