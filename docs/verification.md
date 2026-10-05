# Verification

Use the fast check while changing the game. Browser smoke is a separate playable check. Historical journeys, full coverage, performance and native checks are explicit extended work.

## Fast check

```powershell
npm run check:fast
npm run check:fast -- tests/unit/TrainSerializer.test.ts tests/unit/PlaywrightConfig.test.ts
```

The command runs `tsc --noEmit`, then a small Jest selection without coverage. A shared 180-second budget fails with an incomplete-verification message if exceeded. Additional arguments must be existing unit, integration or physics test file paths; they are added to the critical selection.

The critical selection covers:

- Cab-view import isolation and pure calculations.
- Collision detection and crash transitions.
- Ledger integrity, cargo conservation and running costs.
- Current `SaveRepository` write ordering, corruption recovery and durable reload.
- Current autonomous `SimulationSession` services, reservations, money and cargo.

For a larger focused unit run, use `npm test -- --runInBand tests/unit/YourChange.test.ts`. Default Jest discovery covers unit, integration and physics tests without coverage; performance tests use the extended config.

## Playable browser smoke

```powershell
npm run test:smoke -- --list
npm run test:smoke -- --retries=0
```

`test:smoke` and `test:e2e` use `playwright.smoke.config.ts`. Bare `npx playwright test` uses the same focused `*riverside*.test.ts` selection. Generated-region and broader mobile scenarios remain in the explicit extended suite. Smoke has no automatic retries and excludes the historical journey files listed below.

The browser command builds test-controlled source before starting its server unless `PLAYWRIGHT_REUSE_BUILD=1` is explicitly set. `PLAYWRIGHT_PORT` is validated and defaults to 41719. Use an unused dedicated port when a preview is already running:

```powershell
$env:PLAYWRIGHT_PORT = '41749'
npm run test:smoke -- --retries=0
```

Discovery with `--list` starts no game, build or server. A discovery pass confirms selection and loading, not browser behavior.

## Extended checks

Run these only when the change or an explicit request needs them:

| Command | Scope |
| --- | --- |
| `npm run test:coverage` | Full Jest coverage, including performance tests, with the existing 85% line threshold. |
| `npm run test:e2e:extended` | Broader browser checks, excluding historical manual freight journeys. |
| `npm run test:e2e:legacy` | Historical freight journeys and their associated legacy UI cases. |
| `npm run test:native` | Native Electron smoke. |
| `npm run benchmark:construction-drag` | Construction pointer performance. |
| `npm run benchmark:world-generation` | World generation performance. |
| `npm run benchmark:train-physics` | Explicit train physics performance checks. |
| `npm run benchmark:rehearsal` | Explicit rehearsal performance checks. |

`playwright.legacy.config.ts` quarantines these files without moving their shared helpers:

- `tests/e2e/first-freight-route.test.ts`
- `tests/e2e/structural-timber-link.test.ts`
- `tests/e2e/cement-supply-chain.test.ts`
- `tests/e2e/regional-construction-supply.test.ts`

The long regional chain also carries the `@legacy` title marker. These scenarios can take tens of minutes; the regional chain has a 70-minute limit. They are excluded from the default and extended browser selections and have no automatic retries.

## Recorded evidence at the October 2026 reset

### Brookford timetable and presentation follow-up

The focused command `npm run check:fast -- tests/unit/RiversideFeedback.test.ts tests/unit/RailwayControllerProject.test.ts tests/unit/ManagementPanel.test.ts tests/integration/ServiceTimetableEditing.test.ts` passed **13 suites / 251 tests in 35.8 seconds**, including TypeScript, without coverage. This checks live timetable edits with cargo and passengers aboard, unchanged money and trip history, departure slots, current save/reload, validation failures, notice dismissal and the critical simulation checks. A separate agent run of timetable integration plus the existing session suite passed 27 tests.

`PLAYWRIGHT_REUSE_BUILD=1 PLAYWRIGHT_PORT=41761 npm run test:smoke -- tests/e2e/riverside.test.ts --retries=0` passed **4/4 cases in 2.1 minutes** on the test-controls build. This includes exact construction charges, earned development and its new notice, camera focus, timetable edits with unchanged train/cargo and company state, save/reopen, relief purchase and 844×390 touch editing/menu navigation. The later close-up correction has **3 passing placement tests**, including built tracks, reserved draft tracks, water and parcel corners. Test-controls compilation after that correction passed in **33.5 seconds**, with the existing bundle-size warnings.

Close-up inspection identified a housing parcel covering an existing road. The corrected authored extension is east of the town, linked to its eastern lane, and avoids built/reserved railway and water. Its enlarged roofs, internal lanes and gardens match the established houses. The final targeted `draw, recover` browser rerun passed in **47.9 seconds** after the visual correction; saved evidence includes `brookford-homes-closeup.png`, `brookford-timetable.png`, `brookford-train-closeup.png` and the refreshed overview/touch images.

The final ordinary production build passed in **38.9 seconds** and was reopened in the in-app browser at port 41719, with Brookford paused and ready. `dist/client/main.js` is **1,847,548 bytes**; the isolated lazy cab chunk is **7,077,268 bytes**. Existing asset/entry size warnings remain. Whitespace checks pass. Concurrent menu/fleet work in the shared checkout was preserved; this record claims only the checks listed here.

A bounded deterministic comparison changed only Valley local's interval to 140 seconds, offset to 65 seconds and priority to 1. Over 600 simulated seconds, combined waiting fell from **511.1s to 404.8s**, while passenger return trips fell from **4 to 3** and fare revenue from **£3,432 to £3,366**. Housing completed at 436s rather than 505s. This is one valid operational trade-off in the authored starting scenario; defaults remain unchanged. It is not a guarantee under later demand or track changes.

Human enjoyment and physical-device performance remain unverified. The native/compatibility freeze and optional unresolved legacy suite remain in place.

### Initial reset build

The integrated Riverside fast check passed in **38.0 seconds**, including TypeScript and **17 suites / 287 tests**, without coverage. This selection adds the authored region, presentation, management and menu tests to the critical checks. Source changes after that run were a small inspector wording/spacing fix and browser-suite selection.

Final critical/UI/config verification passed in **26.9 seconds**, **11 suites / 235 tests**, after the menu-return correction. The focused browser suite passed **3/3 cases in 1.2 minutes** on the final source: mouse construction/cancellation, exact charges, real service progression, blockage inspection, neighbourhood completion, save/reopen, relief-line purchase, landscape touch and returning to the menu. Deterministic session stepping avoids the long manual journey. Screenshots are saved in `docs/riverside/evidence/`. Physical-device testing and human enjoyment remain unverified.

The final ordinary `npm run build` passed in **34.1 seconds**. Current `dist/client/main.js` is **1,823,720 bytes**; the isolated lazy Babylon chunk remains **7,077,268 bytes**. Webpack reports its existing asset/entry size warnings. No current before/after FPS claim is made and the old cab milestone's percentage budget is not this presentation milestone's gate.

`npm run check:fast -- tests/unit/PlaywrightConfig.test.ts` passed in **23.3 seconds**: TypeScript 4.0 seconds, Jest 19.3 seconds, **10 suites and 230 tests passed**, no coverage. The added config test demonstrates relevant-test arguments alongside the nine critical suites.

Browser discovery before the new Riverside test was added listed **4 smoke tests in 2 files**, **45 extended tests in 11 files**, and **16 optional legacy tests in 4 files**. These are discovery counts; no browser, full-coverage, legacy or native run was performed for this configuration change.

The historical regional freight acceptance remains **unresolved**. One prior normal-clock run failed after 20.1 minutes when the manual driver stopped too late on a Cement Works detour. Its revised run was interrupted by the user's reset, so it has no completed passing result. Quarantining that journey preserves its assertions and history; it does not convert the cancellation into a pass or make it a required inner-loop gate.
