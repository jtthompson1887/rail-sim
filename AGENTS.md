# Agent Notes

## 3-D Cab View (`src/cab3d`)

### Isolation rules

All cab-view code is isolated under `src/cab3d` and must keep the existing game untouched:

- Only `src/cab3d/renderer/**` may import `@babylonjs/*`.
- Only `src/cab3d/adapters/**` may import `phaser` or `src/{managers,entities,scenes}`.
- Nothing in `src/cab3d/**` may import `SaveService`, `WorldManager`, `EconomySystem`, `CommandStack`, or `src/commands/**`.
- `src/scenes/WorldScene.ts` is the only file outside `src/cab3d` that may import `src/cab3d`, and it uses the barrel (`../cab3d`).
- No `WorldData`/schema/saved-state changes.

These rules are enforced by `tests/unit/Cab3dIsolation.test.ts` and `tests/unit/Cab3dPurity.test.ts`.

### Verification commands

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

### Phase 13 final gates

When closing a cab3d milestone, also run:

```powershell
npx playwright test --retries=0
npm run benchmark:construction-drag
npm run benchmark:world-generation
git diff --check
```

Record `dist/main.js` size and compare it to the Phase 1 baseline (or note when no prior baseline exists). The `dist/cab3d.*.chunk.js` lazy chunk should be present and well over 500 KB.
