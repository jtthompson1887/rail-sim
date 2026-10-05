# Agent Notes — Riverside milestone

## Active priority

Build **a railway scene you want to build in and watch**. Read `docs/CURRENT_STATE.md` first. This reset supersedes older release plans and completion gates.

One authored riverside region contains a town, mill, freight yard, passenger stations, two services, a shared-track bottleneck and one neighbourhood project. The 15–20-minute session is a playtest target. Deliver the illustrated overhead landscape, recognisable facilities, convincing trains, unified controls and restrained feedback in the actual running game. Additional content and concept studies wait.

## Work discipline

- Keep one active milestone and bounded tasks with distinct file ownership.
- End each work block with a playable build or concrete blocker. After two failed approaches, reassess.
- Preserve simulation unless a demonstrated player-visible defect requires a change. No new abstraction without a current use.
- Freeze migrations, native packaging and additional platform/compatibility architecture unless they block this experience. Prototype interfaces and development save formats may change; preserve old files without adding migration work.
- Keep `docs/CURRENT_STATE.md` short: objective, preview, evidence, blocker and next action. Detailed history belongs elsewhere.
- Presentation milestones require actual screenshots and interaction evidence. Enjoyment requires human playtests.

## Everyday verification

- `npm run check:fast`: compilation, relevant tests and critical simulation/current-save checks without coverage; target under three minutes.
- `npm run test:smoke`: short playable checks, including the authored riverside region.
- Extended coverage, legacy journeys, benchmarks and native packaging run only at deliberate stabilization points. Long manual-driving journeys must not block presentation work.
- Use clearly labelled valid fixtures close to the behaviour under test, and deterministic stepping for economic/routing assertions.
- Preserve checks for crashes, incorrect charges, cargo conservation and current-save corruption. Quarantining an unresolved test never means it passed.

## Recovery checkpoint

Commit `7f5f34f`, tag `codex/pre-riverside-reset-2026-10-05`, preserves the integrated source before this reset. Ignored builds, installers and logs remain on disk. The original owning checkout's staged physics work remains untouched.

## 3-D Cab View (`src/cab3d`)

### Isolation rules

All cab-view code is isolated under `src/cab3d` and must keep the existing game untouched:

- Only `src/cab3d/renderer/**` may import `@babylonjs/*`.
- Only `src/cab3d/adapters/**` may import `phaser` or `src/{managers,entities,scenes}`.
- Nothing in `src/cab3d/**` may import `SaveService`, `WorldManager`, `EconomySystem`, `CommandStack`, or `src/commands/**`.
- `src/scenes/WorldScene.ts` is the only file outside `src/cab3d` that may import `src/cab3d`, and it uses the barrel (`../cab3d`).
- No `WorldData`/schema/saved-state changes.

These rules are enforced by `tests/unit/Cab3dIsolation.test.ts` and `tests/unit/Cab3dPurity.test.ts`.

### Historical cab milestone verification (not the current presentation gate)

```powershell
npm test -- --runInBand
npm run build
```

Phase 1 build requirements:

- `dist/main.js` should stay within ~2% of the pre-cab baseline.
- `dist/cab3d.*.chunk.js` must exist and contain the Babylon bundle (well over 500 KB in this implementation).

### Useful details

- The cab renderer is lazy-loaded by `src/cab3d/CabViewHost.ts` via `import(/* webpackChunkName: "cab3d" */ './renderer/BabylonCabRenderer')`.
- `webpack.config.js` sets `optimization.splitChunks: false` so the lazy chunk stays together and keeps `main.js` small.
- `tsconfig.json` uses `module: esnext` so dynamic imports survive to webpack.
- `jest.config.js` excludes `src/cab3d/renderer/**/*.ts` from coverage and limits test discovery to `tests/unit` and `tests/integration`.
- Toggle key is `C` in play mode; controlled by `GameConfig.CAB3D.TOGGLE_KEY`.

### Historical Phase 13 final gates

When closing a cab3d milestone, also run:

```powershell
npx playwright test --retries=0
npm run benchmark:construction-drag
npm run benchmark:world-generation
git diff --check
```

If Playwright reports `ERR_CONNECTION_REFUSED`, the `webServer` in `playwright.config.ts` did not stay reachable. Pre-start the server with `npx serve dist -p 8080 -s --no-clipboard` and re-run `npx playwright test --retries=1`.

Record `dist/main.js` size and compare it to the Phase 1 baseline (or note when no prior baseline exists). The `dist/cab3d.*.chunk.js` lazy chunk should be present and well over 500 KB.
