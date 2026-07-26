# Rail Sim: 3D Cab View — Implementation Plan

**Date:** 2026-07-26  
**Scope:** Add a fully isolated Babylon.js 3D cab view to Rail Sim. It must not affect the existing game: no save-schema, economy, construction, input, or Phaser rendering changes.

---

## 1. Goal

A visually spectacular, first-person cab view rendered in its own WebGL overlay canvas. It is **optional**, **toggle-able**, and **read-only** with respect to the rest of the game.

---

## 2. Foundational decisions

### 2.1 Renderer

- **Babylon.js** (`@babylonjs/core` + `@babylonjs/materials`) in a separate `<canvas>` overlay.
- Lazy-loaded into its own webpack chunk so `main.js` does not grow.
- Imported only from `src/cab3d/renderer/**`.

### 2.2 Scale contract

**1 game world unit = 1 metre.** This is consistent with the existing map (`WORLD_WIDTH 16384` ≈ 16.4 km, `AMPLITUDE 380` ≈ ±380 m relief, `MIN_CURVE_RADIUS_PX 150`, `MAX_SLOPE_PERCENT 2.5`).

### 2.3 Coordinate mapping

Use **one** conversion function everywhere. No inline transforms.

```text
Babylon X =  worldX
Babylon Y =  elevation          (metres)
Babylon Z = -worldY             (game Y is screen-down; Babylon Z is forward)
heading (Babylon yaw, radians) = -atan2(worldDy, worldDx)
```

Use Babylon's default left-handed coordinate system (`useRightHandedSystem = false`).

### 2.4 Isolation contract

These rules are mechanically enforced by a unit test in Phase 1.

| Rule | Detail |
|------|--------|
| Location | All new code lives in `src/cab3d/**` |
| Babylon imports | Only `src/cab3d/renderer/**` may import `@babylonjs/*` |
| Phaser imports | Only `src/cab3d/adapters/**` may import `phaser` or `src/{managers,entities,scenes}` |
| Game state | Nothing in `src/cab3d/**` may import `SaveService`, `WorldManager`, `EconomySystem`, `CommandStack`, or `src/commands/**` |
| Public API | Only `src/scenes/WorldScene.ts` may import `src/cab3d`; it imports the barrel only |
| Persistence | Zero changes to `WorldData`, schema version, or saved state |

### 2.5 Why it will look realistic

| # | Lever | Concrete setting |
|---|-------|-----------------|
| 1 | True-scale parallax | Driver eye 2.40 m above rail, desk edge 0.60 m away, horizon 3–6 km |
| 2 | Image-based lighting | `ReflectionProbe` from sky → `scene.environmentTexture` |
| 3 | ACES tonemapping | `TONEMAPPING_ACES`, exposure 1.1, contrast 1.25 |
| 4 | Interior/exterior stop difference | Cab interior ~2 stops darker than outdoor sun |
| 5 | Aerial perspective | `FOGMODE_EXP2` density 0.00022, fog colour from sky horizon |
| 6 | Ride motion | Bounce, sway, curve roll, grade pitch, rail-joint impulses |
| 7 | Post-FX | Bloom, vignette, chromatic aberration, grain, DoF at 40 m |
| 8 | Cascaded shadows | 3 cascades, `shadowMaxZ 200` |
| 9 | Imperfect glass | Procedural streak/grime layer at low alpha |
| 10 | Instanced density | Sleepers every 0.65 m, thin-instanced ballast and scenery |

---

## 3. Module layout

```
src/cab3d/
  index.ts                  public barrel
  CabConfig.ts              all tunables, frozen
  contracts/                ICabRenderer, ICabSnapshotSource, etc.
  model/                    pure data models and samplers
  camera/                   cab camera rig, ride model, look controller
  cab/                      cab geometry spec, materials, instruments
  world/                    terrain colour, terrain/track/scenery builders
  atmosphere/               time of day, weather
  quality/                  quality tiers + auto selector
  renderer/                 Babylon.js renderer files ONLY
  adapters/                 Phaser adapter ONLY
  ui/                       cab HUD + toggle button
```

Everything outside `renderer/` and `adapters/` is pure TypeScript and unit tested.

---

## 4. Existing files that change

| File | Change |
|------|--------|
| `package.json` | add `@babylonjs/core`, `@babylonjs/materials` |
| `tsconfig.json` | `module: esnext`, `target: es2017`, add `dom.iterable` lib |
| `webpack.config.js` | `publicPath: '/'`, `chunkFilename` for code splitting |
| `jest.config.js` | exclude `src/cab3d/renderer/**/*.ts` from coverage |
| `src/config/GameConfig.ts` | add `CAB3D` config block |
| `src/services/EventBus.ts` | add `cab:toggle`, `cab:state` events |
| `src/scenes/WorldScene.ts` | ~20 lines: instantiate host, call update, cleanup, event handler |
| `README.md` | add `C` control |

**No changes** to `WorldData`, `SaveService`, `WorldManager`, `EconomySystem`, `TrackManager`, `TrainManager`, `TrackFlowSolver`, `CameraController`, `InputManager`, `TerrainChunk`, `SceneryGenerator`, or any command.

---

## 5. WorldScene integration (the only diff in existing logic)

```ts
import { CabViewHost } from '../cab3d';
import { PhaserCabSnapshotSource } from '../cab3d/adapters/PhaserCabSnapshotSource';

// field
private cabViewHost: CabViewHost | null = null;

// handler
private readonly cabStateHandler = ({ active }: { active: boolean }) => {
  this.cameraController.setInputLockOwner(active ? 'ui' : 'camera');
  this.scene.setVisible(!active);
  this.scene.setVisible(!active, EDITOR_UI_SCENE_KEY);
};

// in create()
if (GameConfig.CAB3D.ENABLED) {
  this.cabViewHost = new CabViewHost(
    new PhaserCabSnapshotSource(
      this,
      this.trackManager,
      this.trainManager,
      this.terrainGenerator,
    ),
  );
}
EventBus.on('cab:state', this.cabStateHandler);

// last line of update()
this.cabViewHost?.update(time, delta);

// in SHUTDOWN handler
EventBus.off('cab:state', this.cabStateHandler);
this.cabViewHost?.destroy();
this.cabViewHost = null;
```

---

## 6. Phases

Every phase gates on:

```powershell
npm test -- --runInBand      # must pass, coverage >= 85%
npm run build                # must succeed
```

---

### Phase 0 — Guard rails first

1. Create `src/cab3d/` tree with placeholder files.
2. Write `tests/unit/Cab3dIsolation.test.ts`: walk `src/**/*.ts` imports and enforce the 6 isolation rules.
3. Write `tests/unit/Cab3dPurity.test.ts`: no `document` / `window` / `HTMLCanvasElement` / `performance.now` references in pure modules.
4. Verify by intentionally breaking a rule, confirm the test fails, then fix it.

---

### Phase 1 — Babylon build system + lifecycle

1. `npm install @babylonjs/core @babylonjs/materials --save`
2. Configure `tsconfig.json` and `webpack.config.js` for code splitting.
3. `CabViewHost.ts` lazy-loads `BabylonCabRenderer.ts` via dynamic `import()` with `webpackChunkName: "cab3d"`.
4. `CabCanvasMount.ts`: create/destroy a fixed `<canvas>` overlay with `z-index: 1500`.
5. Add `GameConfig.CAB3D` block:
   - `ENABLED: true`
   - `TOGGLE_KEY: 'C'`
   - `EYE_FORWARD_OFFSET_M: 8.5`
   - `SPEED_SCALE: 1.0`
   - `DETERMINISTIC: false`
6. Add `EventBus` events: `cab:toggle` and `cab:state`.
7. Wire `WorldScene` integration (above).
8. `import` style mandate: always use the `@babylonjs/core` root barrel, never deep paths.

**Verification:**
- `dist/main.js` within 2% of baseline size.
- `dist/cab3d.*.chunk.js` exists and > 500 KB.
- Existing Playwright suite still passes.
- New e2e `tests/e2e/cab3d-lifecycle.test.ts`: press `C` 20×, assert canvas appears/disappears and `document.querySelectorAll('canvas').length === 1` at end.

---

### Phase 2 — Snapshot pipeline + camera rig

`CabWorldSnapshot` is a frozen plain-data object produced once per frame:

```ts
interface CabTrackSample {
  x: number;            // world metres
  y: number;
  elevation: number;
  headingRad: number;
  curvature: number;
  structure: StructureType;
  distance: number;     // metres from eye, +ahead
}

interface CabVehicleSnapshot {
  id: string;
  x: number;
  y: number;
  headingRad: number;
  speedMps: number;
  throttle: number;
  derailed: boolean;
  onTrack: boolean;
}

interface CabWorldSnapshot {
  valid: boolean;
  seed: string;
  biome: BiomeType;
  vehicle: CabVehicleSnapshot | null;
  path: ReadonlyArray<CabTrackSample>;   // -120 m .. +800 m, 2 m spacing
  elapsedSecs: number;
}
```

1. `CabPathSampler` (pure): walk Béziers via `getCurvePath()`, `verticalProfile`, `structures`, arc-length reparametrised at 2 m.
2. `CabCurvature` (pure): signed curvature from 3 consecutive points.
3. `CabSpeed` (pure): `hypot(vx,vy) * (1000/max(1,lastDeltaMs)) * SPEED_SCALE`.
4. `PhaserCabSnapshotSource`: read `selectedTrain`, `getMatterBody()`, `currentTrack`, `TerrainGenerator`.
5. `CabCameraRig`: node chain `bogie → body → head → eye`.
6. `CabRideModel` constants:
   - Vertical bounce: 2.1 Hz, 0.012 m (+ 4.3 Hz harmonic ×0.7)
   - Lateral sway: 1.3 Hz, 0.009 m
   - Curve roll: `clamp(-0.055 * k * v², ±2.5°)`
   - Grade pitch: `atan(dElevation/dDistance)`, clamp ±1.5°
   - Rail joint: every 18.29 m, 0.004 m impulse, decay τ = 0.09 s
7. `CabLookController`: yaw ±120°, pitch -35° to +25°, critically damped spring.

Camera: `UniversalCamera`, vertical FOV 50° (0.873 rad), `minZ 0.15`, `maxZ 6000`.

**Verification:**
- Unit tests for straight track, 300 m curve, 2% grade, rail joint.
- Expose `window.__railSimCab3d.snapshot()` with eye/camera values.
- E2E: assert `|eye.elevation - (getHeightAt(eye) + 2.40)| < 0.75 m` at 20 points.
- E2E: assert eye displacement per frame ≤ `speedMps * dt * 1.5`.

---

### Phase 3 — Track mesh

**Rail profile** (BS113A simplified, metres, origin at foot centre, closed 12-point loop):

```
(-0.0700, 0.0000) (0.0700, 0.0000) (0.0700, 0.0140) (0.0200, 0.0400)
(0.0200, 0.1200)  (0.0335, 0.1400) (0.0335, 0.1590) (-0.0335, 0.1590)
(-0.0335, 0.1400) (-0.0200, 0.1200) (-0.0200, 0.0400) (-0.0700, 0.0140)
```

| Element | Spec |
|---------|------|
| Gauge | 1.435 m between inner faces; rail centres at x = ±0.7515 m |
| Rail body | `#5A4A3E`, metallic 0.55, roughness 0.80 |
| Rail head cap | 0.067 m wide × 0.004 m tall at y = 0.157; `#C8CCD0`, metallic 0.95, roughness 0.14. Separate mesh. |
| Sleepers | 2.50 × 0.20 × 0.25 m concrete, spacing 0.650 m, thin instances |
| Ballast | Top 3.60 m, bottom 5.60 m, depth 0.35 m, 1:1.5 shoulders, noise bump |
| Bridge | Deck box 5.0 m × 0.6 m + piers every 25 m |
| Tunnel | Bore cylinder r = 3.2 m + portal ring, terrain clipped |
| Cut/Fill | Terrain vertices displaced toward rail elevation within 12 m lateral |

Build from `snapshot.path` in `TrackMeshBuilder`. Rebuild only after eye advances 64 m.

**Verification:**
- 100 m straight mesh bounding box inside `x ∈ [-2.8, 2.8]`, `y ∈ [-0.35, 0.16]`.
- Rail centre separation = 1.435 ± 0.001 m at 200 samples.
- Sleeper count over 130 m = `floor(130 / 0.65) = 200`.
- Screenshot regression at fixed seed.

---

### Phase 4 — Terrain mesh

Three LOD rings, re-centred when eye crosses 64 m boundary:

| Ring | Extent | Resolution | Verts |
|------|--------|------------|-------|
| Near | 1024 × 1024 m | 8 m | ~16.6k |
| Mid | 4096 × 4096 m | 32 m | ~16.6k |
| Far | 12288 × 12288 m | 128 m | ~9.4k |

- Heights from `TerrainGenerator.getHeightAt()`.
- Vertex colours from new `src/cab3d/world/TerrainColour.ts`.
- **Do not refactor `TerrainChunk`**. Add parity test versus its private `bandColor` for 200 heights × 4 biomes.
- Skirts: 60 m downward edge to avoid sky gaps.
- Water: plane at y = 0, alpha 0.72, rough 0.08, scrolling normal texture.

**Verification:**
- Vertex height at grid (i,j) equals `getHeightAt()` exactly.
- Normals unit length and `y > 0`.
- E2E: no sky below horizon at 8 positions.

---

### Phase 5 — Sky, sun, atmosphere, IBL

| Feature | Setting |
|---------|---------|
| Sky | `SkyMaterial` on 10000 m box, luminance 0.6, turbidity 4.5, rayleigh 2.0, mie coefficient 0.005, mie g 0.82 |
| Sun | `DirectionalLight` intensity 3.0 |
| Fill | `HemisphericLight` intensity 0.35, ground colour = biome LOWLAND × 0.5 |
| Cab interior | `PointLight` at cab-local (0, 3.10, 0.20), intensity 0.20, range 4.0 |
| IBL | `ReflectionProbe(256)` from sky box; refresh when sun altitude changes > 2° |
| Tonemapping | ACES, exposure 1.1, contrast 1.25 |
| Fog | `FOGMODE_EXP2` density 0.00022, fog colour from sky horizon |

`CabTimeOfDay` (pure): `simHours = 6 + (elapsedSecs / 60) % 18`.

**Verification:** sun vector unit tests at 06:00 / 12:00 / 18:00; screenshot regression per time of day.

---

### Phase 6 — Cab interior geometry

**Cab-local frame:** origin on rail head, track centreline, driver's eye station.  
**+X right, +Y up, +Z forward.**

All parts are defined in frozen tables. The builder walks the tables and creates primitives.

#### 6a. Shell

| id | kind | size (w,h,d) | position | rot° | material |
|----|------|--------------|----------|------|----------|
| floor | box | 2.60, 0.06, 2.30 | 0, 1.17, 0.25 | 0,0,0 | floorRubber |
| ceiling | box | 2.60, 0.06, 2.30 | 0, 3.27, 0.25 | 0,0,0 | shellCream |
| wallLeft | box | 0.08, 2.10, 2.30 | -1.30, 2.22, 0.25 | 0,0,0 | shellCream |
| wallRight | box | 0.08, 2.10, 2.30 | 1.30, 2.22, 0.25 | 0,0,0 | shellCream |
| bulkheadRear | box | 2.60, 2.10, 0.08 | 0, 2.22, -0.94 | 0,0,0 | shellGrey |

#### 6b. Front assembly

Parent `frontAssembly` at `(0, 2.30, 1.32)`, rotation `(-8°, 0, 0)`. All children local to this node.

| id | kind | size | local pos | rot° | material |
|----|------|------|-----------|------|----------|
| screenSill | box | 2.44, 0.14, 0.12 | 0, -0.62, 0 | 0,0,0 | frameAlloy |
| screenHeader | box | 2.44, 0.16, 0.12 | 0, 0.63, 0 | 0,0,0 | frameAlloy |
| screenPostL | box | 0.14, 1.40, 0.12 | -1.15, 0, 0 | 0,0,0 | frameAlloy |
| screenPostR | box | 0.14, 1.40, 0.12 | 1.15, 0, 0 | 0,0,0 | frameAlloy |
| screenPillarC | box | 0.10, 1.26, 0.11 | 0, 0, 0 | 0,0,0 | frameAlloy |
| glassL | plane | 1.05, 1.20 | -0.575, 0, 0.005 | 0,0,0 | glassScreen |
| glassR | plane | 1.05, 1.20 | 0.575, 0, 0.005 | 0,0,0 | glassScreen |
| frontPanelLower | box | 2.44, 0.50, 0.10 | 0, -0.94, 0 | 0,0,0 | shellGrey |
| sunVisorL | box | 0.95, 0.03, 0.24 | -0.60, 0.58, -0.14 | -25,0,0 | visorDark |
| sunVisorR | box | 0.95, 0.03, 0.24 | 0.60, 0.58, -0.14 | -25,0,0 | visorDark |
| wiperPivotL | node | - | -0.575, -0.52, 0.07 | 0,0,0 | - |
| wiperArmL | box | 0.03, 0.90, 0.03 | 0, 0.45, 0 | 0,0,0 | frameDark |
| wiperBladeL | box | 0.70, 0.025, 0.025 | 0, 0.86, 0.015 | 0,0,0 | rubberBlack |
| wiperPivotR | node | - | 0.575, -0.52, 0.07 | 0,0,0 | - |
| wiperArmR | box | 0.03, 0.90, 0.03 | 0, 0.45, 0 | 0,0,0 | frameDark |
| wiperBladeR | box | 0.70, 0.025, 0.025 | 0, 0.86, 0.015 | 0,0,0 | rubberBlack |

Wipers sweep `±0.62 rad` around local Z, 0.9 s per sweep, only in rain/snow.

#### 6c. Desk assembly

Parent `deskAssembly` at `(-0.58, 0, 0)`.

| id | kind | size | local pos | rot° | material |
|----|------|------|-----------|------|----------|
| deskTop | box | 1.30, 0.05, 0.60 | 0, 2.00, 0.92 | -6,0,0 | deskDark |
| deskLip | box | 1.30, 0.05, 0.06 | 0, 2.02, 0.60 | 0,0,0 | frameAlloy |
| deskFace | box | 1.30, 0.52, 0.05 | 0, 1.74, 1.21 | 0,0,0 | shellGrey |
| deskPedestal | box | 1.24, 0.56, 0.52 | 0, 1.48, 0.96 | 0,0,0 | shellGrey |
| deskCheekL | box | 0.05, 0.84, 0.60 | -0.65, 1.60, 0.92 | 0,0,0 | shellGrey |
| deskCheekR | box | 0.05, 0.84, 0.60 | 0.65, 1.60, 0.92 | 0,0,0 | shellGrey |

#### 6d. Instrument panel

Parent `instrumentPanel` at `(-0.58, 2.03, 0.92)`, rotation `(-6°, 0, 0)`. Cylinders need no extra rotation.

| id | kind | diameter × thickness | local position | material |
|----|------|----------------------|----------------|----------|
| gaugeSpeedo | cylinder | 0.150 × 0.030 | -0.02, 0.015, 0.02 | bezelDark |
| gaugeSpeedoFace | cylinder | 0.132 × 0.002 | -0.02, 0.031, 0.02 | dynSpeedo |
| gaugeSpeedoNeedle | box | 0.006, 0.002, 0.058 | -0.02, 0.033, 0.049 | needleOrange |
| gaugeBrakeDuplex | cylinder | 0.110 × 0.028 | 0.20, 0.014, 0.02 | bezelDark |
| gaugeBrakeDuplexFace | cylinder | 0.096 × 0.002 | 0.20, 0.029, 0.02 | dynBrakeDuplex |
| needleBrakePipe | box | 0.005, 0.002, 0.042 | 0.20, 0.031, 0.041 | needleRed |
| needleMainRes | box | 0.005, 0.002, 0.042 | 0.20, 0.033, 0.041 | needleWhite |
| gaugeBrakeCyl | cylinder | 0.090 × 0.026 | 0.36, 0.013, 0.02 | bezelDark |
| gaugeBrakeCylFace | cylinder | 0.078 × 0.002 | 0.36, 0.027, 0.02 | dynBrakeCyl |
| needleBrakeCyl | box | 0.005, 0.002, 0.034 | 0.36, 0.029, 0.037 | needleRed |
| awsSunflower | cylinder | 0.080 × 0.024 | -0.24, 0.012, 0.02 | bezelDark |
| awsSunflowerFace | cylinder | 0.068 × 0.002 | -0.24, 0.025, 0.02 | dynAws |
| gaugeAmmeter | cylinder | 0.090 × 0.026 | -0.42, 0.013, 0.02 | bezelDark |
| gaugeAmmeterFace | cylinder | 0.078 × 0.002 | -0.42, 0.027, 0.02 | dynAmmeter |
| needleAmmeter | box | 0.005, 0.002, 0.034 | -0.42, 0.029, 0.037 | needleWhite |

Needle pivot: `setPivotPoint(new Vector3(0, 0, -halfLength))`, rotate `rotation.y`.

#### 6e. Controls

| id | kind | size | position | rot° | material |
|----|------|------|----------|------|----------|
| powerQuadrant | box | 0.20, 0.05, 0.30 | -1.16, 2.00, 0.80 | 0,0,0 | frameAlloy |
| powerPivot | node | - | -1.16, 2.03, 0.72 | 0,0,0 | - |
| powerLever | cylinder | 0.028 × 0.30 | 0, 0.15, 0 | 0,0,0 | chromeShaft |
| powerKnob | sphere | 0.070 | 0, 0.30, 0 | 0,0,0 | bakelite |
| brakeQuadrant | box | 0.18, 0.05, 0.26 | -0.06, 2.00, 0.82 | 0,0,0 | frameAlloy |
| brakePivot | node | - | -0.06, 2.03, 0.76 | 0,0,0 | - |
| brakeLever | cylinder | 0.026 × 0.26 | 0, 0.13, 0 | 0,0,0 | chromeShaft |
| brakeKnob | sphere | 0.064 | 0, 0.26, 0 | 0,0,0 | bakelite |
| reverserBody | box | 0.11, 0.04, 0.11 | -1.16, 2.01, 1.08 | 0,0,0 | frameAlloy |
| reverserStub | cylinder | 0.020 × 0.10 | -1.16, 2.06, 1.08 | 0,0,0 | chromeShaft |
| hornHigh | cylinder | 0.046 × 0.014 | -0.86, 2.03, 0.68 | 0,0,0 | buttonRed |
| hornLow | cylinder | 0.046 × 0.014 | -0.78, 2.03, 0.68 | 0,0,0 | buttonYellow |
| awsReset | cylinder | 0.040 × 0.016 | -0.70, 2.03, 0.68 | 0,0,0 | buttonBlack |
| dsdPedal | box | 0.18, 0.035, 0.24 | -0.58, 1.27, 0.52 | -12,0,0 | frameDark |

Lever notch angles (rotation.x on pivot node, degrees):

- **Power:** Off -26, N1 -13, N2 0, N3 +9, N4 +18, N5 +26
- **Brake:** Release -24, Initial -8, Step2 +2, Step3 +12, FullService +22, Emergency +34
- **Reverser:** Reverse -35, Neutral 0, Forward +35

#### 6f. Seats (driver at x = -0.58; mirror secondman at x = +0.58)

| id | kind | size | position | rot° | material |
|----|------|------|----------|------|----------|
| seatPedestalD | cylinder | 0.16 × 0.42 | -0.58, 1.41, -0.10 | 0,0,0 | frameDark |
| seatBaseD | box | 0.50, 0.12, 0.48 | -0.58, 1.68, -0.10 | 0,0,0 | moquette |
| seatBackD | box | 0.50, 0.58, 0.10 | -0.58, 2.00, -0.36 | -9,0,0 | moquette |
| seatHeadD | box | 0.30, 0.20, 0.09 | -0.58, 2.34, -0.39 | -9,0,0 | moquette |

#### 6g. Detail

| id | kind | size | position | rot° | material |
|----|------|------|----------|------|----------|
| grabHandleL | cylinder | 0.030 × 0.34 | -1.24, 2.70, 0.10 | 0,0,90 | chromeShaft |
| roofLampHousing | box | 0.34, 0.06, 0.16 | 0, 3.22, 0.30 | 0,0,0 | frameDark |
| roofLampLens | plane | 0.28, 0.12 | 0, 3.185, 0.30 | 90,0,0 | lampEmissive |
| noticePlate | plane | 0.20, 0.14 | 1.25, 2.55, 0.20 | 0,-90,0 | dynNotice |
| fireExtinguisher | cylinder | 0.11 × 0.42 | 1.18, 1.44, -0.60 | 0,0,0 | extRed |

#### 6h. Material table

All `PBRMaterial` unless noted.

| id | base colour | metallic | roughness | notes |
|----|-------------|----------|-----------|-------|
| shellCream | `#C9C4B4` | 0.00 | 0.75 | melamine |
| shellGrey | `#9C9A93` | 0.00 | 0.70 | |
| floorRubber | `#1E2124` | 0.00 | 0.92 | ribbed bump texture |
| deskDark | `#2E3338` | 0.05 | 0.55 | |
| frameAlloy | `#4A4E52` | 0.35 | 0.40 | painted alloy |
| frameDark | `#26292C` | 0.30 | 0.50 | |
| glassScreen | `#FFFFFF` α 0.07 | 0.00 | 0.03 | + grime layer |
| chromeShaft | `#B8BCC0` | 0.90 | 0.20 | |
| bakelite | `#17191B` | 0.00 | 0.35 | |
| bezelDark | `#1A1C1E` | 0.60 | 0.30 | |
| moquette | `#23404F` | 0.00 | 0.95 | |
| visorDark | `#3A3630` | 0.00 | 0.85 | |
| rubberBlack | `#111214` | 0.00 | 0.95 | |
| needleOrange | `#FF7A18` | 0.00 | 0.40 | emissive 0.15 |
| needleRed | `#D42B1F` | 0.00 | 0.40 | |
| needleWhite | `#ECECEC` | 0.00 | 0.40 | |
| buttonRed | `#B4241C` | 0.00 | 0.45 | |
| buttonYellow | `#D6A31A` | 0.00 | 0.45 | |
| buttonBlack | `#141517` | 0.00 | 0.45 | |
| lampEmissive | `#FFF1D0` | 0.00 | 0.60 | emissive 1.6 |
| extRed | `#A81E14` | 0.10 | 0.45 | |

**Verification:**
- Every `id` unique, every `parent` resolves, no cycles.
- Driver eye point `(-0.58, 2.40, 0.00)` is inside the shell AABB and outside every solid AABB by ≥ 0.02 m.
- Eye has unobstructed line-of-sight to `(-0.58, 2.55, 40.0)` except through `glassL`/`glassR`.
- Screenshot regression at fixed seed / 12:00 / clear.

---

### Phase 7 — Live instruments

`CabInstrumentModel.ts` maps snapshot values to needle angles and lamp states.

| Instrument | Range | Sweep | Start angle | Source |
|------------|-------|-------|-------------|--------|
| Speedometer | 0–125 mph | 250° | -125° | `speedMps × 2.23694` |
| Brake pipe | 0–7 bar | 270° | -135° | derived from throttle sign |
| Main reservoir | 0–10 bar | 270° | -135° | fixed 8.5 bar unless emergency |
| Brake cylinder | 0–4 bar | 240° | -120° | brake lever position |
| Ammeter | -1000 to +2000 A | 260° | -130° | `throttle × 1800` |
| AWS sunflower | black ↔ segmented | - | - | toggles on approach to facility |

Gauge faces are drawn once into a 512×512 `DynamicTexture`. Needles are meshes rotated per frame.

**Verification:** unit tests for angle mapping at 0/25/50/75/100% plus clamping. E2E needle angle vs model output within 0.5°.

---

### Phase 8 — Scenery instancing + structures

- Use `SceneryGenerator.generateForChunk()` **unchanged**; it returns pure `SceneryObjectDef[]`.
- `SceneryInstanceBuilder` produces per-type `Float32Array` 16-float matrices with elevation from `getHeightAt()`.
- One low-poly prototype per `SceneryType`; render via `thinInstanceSetBuffer`.
- Draw radius per quality tier.
- Bridges/tunnels/cuts from `snapshot.path[].structure` as in Phase 3.

**Verification:** instance count equals `SceneryGenerator` output; each Y equals `getHeightAt(x, y)`; `thinInstanceTotal` within tier budget.

---

### Phase 9 — Shadows + post-FX

| Feature | Setting |
|---------|---------|
| CascadedShadowGenerator | 2048 map, 3 cascades, `shadowMaxZ 200`, `lambda 0.7`, PCF medium |
| Shadow casters | Rails, sleepers, near-ring scenery only. Never cab interior. |
| DefaultRenderingPipeline | `fxaaEnabled`, samples 1 |
| Bloom | threshold 0.85, weight 0.35, kernel 48, scale 0.5 |
| DoF | **focusDistance = 40000 (mm)** — note Babylon uses millimetres; `fStop 4.0`, `focalLength 45` |
| Chromatic aberration | amount 12 |
| Grain | intensity 6, animated (disabled in deterministic mode) |
| Motion blur | `MotionBlurPostProcess`, strength 0.6, samples 12, screen-based, **ultra tier only** |

**Verification:** e2e `snapshot().postFx` matches tier; screenshot regression per tier.

---

### Phase 10 — Weather + time of day

`CabWeatherModel` (pure): `hash(seed + ':' + floor(elapsedSecs / 600))` → `clear | overcast | rain | snow | fog`, biome-weighted.

| State | fogDensity | sun intensity | env intensity | particles (high) |
|-------|------------|---------------|---------------|------------------|
| clear | 0.00022 | 3.0 | 1.00 | 0 |
| overcast | 0.00055 | 1.1 | 0.70 | 0 |
| rain | 0.00120 | 0.8 | 0.55 | 2500 |
| snow | 0.00090 | 1.4 | 0.80 | 2500 |
| fog | 0.00350 | 0.6 | 0.45 | 0 |

- Particle emitter is a 30 × 20 × 30 m box parented to camera.
- Windscreen droplets: transparent plane 0.01 m in front of glass, alpha ramps up 1.8 s, resets after wiper pass.
- State transitions lerped over 20 s.

**Verification:** determinism test (same seed+tick ⇒ same state, 1000 samples); lerp monotonicity; screenshots per state in deterministic mode.

---

### Phase 11 — HUD, toggle, mobile, accessibility

- `CabViewToggleButton`: DOM button following `CompanyHud` pattern, visible only in `play` mode with a selected train, `data-testid`, `aria-label`.
- `CabHudOverlay`: speed, throttle/brake, next facility distance, weather, time, quality selector, exit button.
- Mobile: reuse existing `mobile:throttle` EventBus channel; no code changes.
- `prefers-reduced-motion`: ride motion × 0.15, grain off, motion blur off, DoF off.

**Verification:** unit tests with jsdom for both DOM components; e2e at 375×667.

---

### Phase 12 — Quality tiers + performance

Auto-select from 3-second FPS probe; manual override persists in `localStorage` under key `rail-sim-cab3d-prefs` only.

| Feature | low | medium | high | ultra |
|---------|-----|--------|------|-------|
| Hardware scaling | 0.65 | 0.80 | 1.00 | 1.00 |
| Shadow cascades | 0 | 2 @1024 | 3 @2048 | 4 @2048 |
| Terrain far ring | off | on | on | on |
| Scenery radius | 250 m | 450 m | 800 m | 1200 m |
| Sleepers | every 4th | every 2nd | all | all |
| Bloom / FXAA | off / on | on / on | on / on | on / on |
| DoF | off | off | on | on |
| Chromatic + grain | off | off | on | on |
| Motion blur | off | off | off | on |
| Weather particles | 0 | 800 | 2500 | 4000 |

Also: set `this.scene.setVisible(false)` on `WorldScene` and `EditorUIScene` while cab view is active; `update()` continues to run.

**Verification:**
- E2E asserts economy tick advances while cab view is active (critical).
- Budgets: high tier ≥ 45 fps and ≤ 220 draw calls; low tier ≥ 30 fps at 1080p.

---

### Phase 13 — Final gates and evidence

Run:

```powershell
npm test -- --runInBand
npx playwright test --retries=0
npm run benchmark:construction-drag
npm run benchmark:world-generation
npm run build
git diff --check
```

Plus:
- `dist/main.js` size within 2% of Phase 1 baseline.
- Manual playtest on 3 recorded seeds: build route, enter cab, drive full trip, toggle 10×, cycle tiers and weather, save/reload mid-trip. Verify cash and economy tick are byte-identical to a run with `CAB3D.ENABLED = false`.
- Update `README.md` controls table.
- Write `docs/superpowers/reviews/2026-07-26-cab-3d-view-evidence.md`.
- Create/append `AGENTS.md` with cab3d isolation rules and verification commands.

---

## 7. Common footguns

| Footgun | Prevention |
|---------|------------|
| `module: commonjs` kills webpack code splitting | Phase 1 verification requires `cab3d.*.chunk.js` to exist |
| Deep `@babylonjs/core/...` imports cause black screen | Mandate root-barrel imports; isolation test rejects deep paths |
| Babylon in Jest (no WebGL) | Renderer excluded from coverage; pure modules never import Babylon |
| DoF `focusDistance` is in millimetres | Comment in code + screenshot regression |
| Coordinate handedness / Y-Z confusion | Single `worldToBabylon()` function + eye-elevation e2e |
| Hiding Phaser scenes stops simulation | E2E asserts economy tick advances |
| Memory leak on repeated toggling | 20× toggle e2e + `engine.dispose()` mandate |

---

## 8. First implementation step

1. Write this file to `docs/superpowers/plans/2026-07-26-cab-3d-view-implementation.md`.
2. Begin **Phase 0**: create `src/cab3d/` tree, write isolation tests, prove they fail when broken.
3. Proceed through phases in order. Every phase must pass `npm test -- --runInBand` and `npm run build` before the next begins.
