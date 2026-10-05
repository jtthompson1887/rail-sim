# Design a railway. Rehearse it. Transform a region.

> Historical implementation record. The riverside reset in `../CURRENT_STATE.md` is the active priority. The long legacy regional journey remains unresolved; its latest run was deliberately stopped. Native packaging, migration work and exhaustive legacy gates are frozen during the presentation milestone.

Implementation status for the integrated development slice, 5 October 2026.
This is not a claim that the complete release plan or its player-experience
targets have been achieved.

## Foundation and preservation

- Working branch: `codex/design-rehearse-transform`.
- Committed foundation: `codex/full-game` at
  `f92ff272a3405ae0b849f5b166633af98e92cc34`.
- The staged train-dynamics changes from the owning checkout were copied as a
  binary patch into this isolated checkout. The owning checkout and its index
  were left untouched. The copied work retains arc-length movement, bogies,
  consists, braking, gradients, derailments, collisions and schema-11 dynamics.
- Existing schema-10 and schema-11 worlds are migrated rather than routinely
  rejected. Original imported and migrated payloads are retained.

## What can be played

New regions choose river lowlands, coastal hills or mountain valleys and
standard, expert or sandbox settings. They start paused. Open **Railway** to:

1. Sketch an industry connection or a fitted passing loop in **Plans**, or
   capture the existing freeform construction preview. Freeform previews have
   adjustable endpoints and direction handles, tap placement, angle/approach
   controls and shape undo before purchase.
2. Add platforms, trains and services to a detached draft; see the complete
   quote and its first actionable engineering blocker before commitment.
3. Buy one of six diesel/electric powered families in **Fleet** and select its
   stops in **Services**. Trains load, travel, stop, unload and reverse without
   driving. Set wait time, interval, offset and priority.
4. Run at 1×, 2× or 4×, independently of construction mode. Route, track,
   junction, supply, platform and traction blockers have explanatory remedies.
5. Rehearse the current railway or a proposed change in a detached worker.
   Ghost samples, deliveries, costs and waiting are compared alongside explicit
   demand assumptions. Two alternatives can be saved. Rehearsal never installs
   its economy, cargo, development progress or train poses into the live world.
   Runs finish after a complete service cycle or the bounded time cap, so
   aggregate totals may span different simulated durations. The 80–120% demand
   band is illustrative; it is not a calibrated or separately simulated forecast.
6. Accept neighbourhood, factory, harbour, visitor and recycling projects.
   Authoritative delivery and arrival events complete them, award grants once,
   change production/demand, and add buildings clear of live and reserved rails.
   Passenger arrivals must reach a platform within 120 metres of the project;
   nearby arrivals work without an explicit station binding.
7. Rename the company, recolour trains, and export/import local blueprints and
   worlds. Draft undo/redo is separate from used-infrastructure transactions.
   Importing a duplicate world preserves its own saved design alternatives
   under the new world identity.

The construction chain remains, alongside grain → flour → food and scrap →
steel: ten products in total. Passenger groups have destinations, capacity,
waiting and transfers. Six powered families have distinct
procedural silhouettes, freight loads and articulated passenger units.

Compatible legacy worlds retain their original construction and driving flow
until the player explicitly enables regional play. In regional play, unassigned
trains park and service trains own their movement. Optional manual driving that
shares regional reservations is still an outstanding integration task.

## Simulation and transaction ownership

`src/simulation` owns plain-data graph queries, fixed stepping, services,
reservations, economics and rehearsal. It imports neither Phaser nor Babylon.
`WorldManager` validates detached results before installation and retains the
live world identity required by existing construction commands.

Construction quotes are issued against current state, checked for tampering,
revalidated at purchase, and consumed once. Mixed drafts commit track, turnouts,
platforms, fleet and service definitions atomically. Cargo conservation and
ledger traceability use the existing authoritative economy systems.

Reservations currently protect whole route sections and explicit turnouts.
Passing-loop detours are supported; this is a conservative first operating
model. Shorter signal blocks, editable signals, timetable recovery and more
complex station approaches require further work and playtesting.

The isolated Babylon cab remains lazy-loaded behind its existing barrel and
adapters. Management state lives outside `src/cab3d`.

## Offline native shells and persistence

- Electron serves locally packaged assets over a secure private protocol with
  a sandboxed renderer, no renderer Node access, and a narrow file-storage IPC.
- Capacitor Android/iOS projects use app-private filesystem storage, landscape
  orientation and application lifecycle events.
- The browser development build uses asynchronous IndexedDB storage. Legacy
  localStorage saves are migrated while their original payload is retained.
- Saves use checksummed alternating slots, two bounded backups, serialized
  snapshot writes and recovery from interrupted or corrupt copies. A storage
  failure cannot acknowledge a successful save or silently replace the last
  valid copy. Newer unknown formats remain protected.
- Backgrounding pauses and saves; reopening does not simulate offline time.
  Windows closing waits for the save acknowledgement and remains open on failure.
- Export/import is explicit and portable; importing a duplicate creates a new
  world identity rather than replacing the current world.

Portable JSON world/blueprint formats and browser import/export are implemented.
Android/iOS document transfer needs native export/share integration and device
verification; app-private saving is separate from document transfer.

Use `npm run native:desktop` for development, `npm run native:windows` for the
Windows installer build, and `npm run native:sync` before opening Android/iOS.
This Windows host lacks the Android SDK/JDK, Xcode and physical phones. Native
project generation is not evidence of device acceptance.

## Verification

Run the required checks from the repository root:

```powershell
npm test -- --runInBand
npm run build
npx playwright test --retries=0
npm run benchmark:construction-drag
npm run benchmark:world-generation
npm run benchmark:train-physics
npm run benchmark:train-physics-browser
npm run benchmark:rehearsal
npm run test:native
git diff --check
```

`tests/e2e/regional-game.test.ts` exercises the actual new mouse workflow:
autonomous delivery, isolated worker rehearsal and durable reload. Its touch
case covers creation, project acceptance and panel layout. The signature-loop
integration test covers neighbourhood completion through real service events;
these browser cases do not assert service profitability. Older acceptance tests
use a compile-gated legacy-world factory to
retain their original scenario scope; production exposes no such factory.
Native smoke testing uses the packaged protocol and durable files.

Observed browser views: [autonomous railway on desktop](screenshots/regional-railway-desktop.png)
and [projects on a landscape phone](screenshots/regional-projects-phone.png).
The final UI checks verify that cash/time match authoritative state and that
the management controls clear the finance HUD after phone resizing.
Regional touch tests also exercise the clock, resizing, durable reload and
opting a legacy world into regional play. Legacy throttle controls disappear
when automation takes ownership; they remain available in legacy worlds.

The rehearsal benchmark covers 50 active services on a 2,000-segment graph. It
does not measure rendering, 500-vehicle consists, reference-device frame rates
or thermal behaviour. No historical pre-cab baseline was available here.

Measured on this Windows 11 / Ryzen 9 7900X development host:

| Check | Observed result |
| --- | --- |
| Complete Jest run | Final frozen source: 183 suites / 2,501 tests passed; measured 97.15% line coverage in `full-game-jest-source-frozen.log` |
| Complete browser run | 54 of 56 cases passed in `full-game-playwright-accepted.log`; the portrait freight case subsequently passed its targeted rerun, and the corrected long regional journey is being rerun separately |
| Final presentation follow-up | 117 tests passed covering scene guards, panel, shared simulation and the signature loop; panel tests also rerun after responsive layout changes |
| Final input and rehearsal follow-up | 38 input/camera tests and 23 shared-session/rehearsal tests passed after their corresponding source corrections |
| Final HUD follow-up | 32 HUD/input tests passed, including legacy/regional control ownership and resize cleanup |
| Regional browser follow-up | Four mouse/touch cases passed with no retries after the final HUD change, including clock control, resize, legacy opt-in and durable reload |
| Project catchment | 48 domain tests passed, including bound/default local services, remote-arrival rejection, rehearsal isolation, grant-once behaviour and durable reload |
| Duplicate import and project UI | 55 tests passed across save durability, saved alternatives, controller and panel suites after the corresponding fixes |
| Local passenger browser journey | Real track/platform/fleet/service controls produce nearby housing arrivals; remote stations are excluded and progress survives reload, with no premature grant |
| Portrait freight follow-up | The full 375×667 structural-timber journey passed without retries: anchored construction, two log deliveries, timber delivery, safe parking and exact durable reload |
| TypeScript | `npx tsc --noEmit` passed |
| Signature-loop integration | Materials and passenger arrivals complete a neighbourhood, alter demand, award one grant, and survive durable reload |
| Construction drag | 500 samples; p95 0.30 ms against the 16 ms gate |
| World generation | All 284 seeds 601–884 resolved; worst generation 1,643.5 ms against the 2,000 ms gate; deterministic replay |
| Physics corpus | 940 ms standard corpus; 1,210 ms 100-car diagnostic stress case |
| Browser physics | Safe curve, mixed power and 40-car cases remain finite and replay deterministically; no bogie alignment errors |
| Rehearsal | 50 services / 2,000 segments / 10 simulated seconds in approximately 2.2 seconds |
| Electron | Source and packaged-ASAR smoke tests passed public construction, worker loading, save, close and relaunch |
| Windows package | Unsigned x64 NSIS installer built; actual installer installation and clean-machine acceptance remain open |
| Whitespace | `git diff --check` passed |

Production bundles measured after the current implementation: `main.js`
1,758,568 bytes; `rehearsal-worker.js` 103,524 bytes; lazy
`cab3d.42f9818ade59bab1f914.chunk.js` 7,077,268 bytes; lazy
`mobile-platform.62864416e7430fa8d696.chunk.js` 10,734 bytes. The build passes with
Webpack's size warnings. These are current sizes, not evidence of a comparison
with an unavailable pre-cab baseline.

The final development installer is
`releases/review-build/Rail Sim Setup 1.0.0.exe` (181,674,287 bytes), SHA-256
`82f101fa6b74289c27b34f07ecbcaf95af5a390a6292a670ca733b0c316818e7`.
Its packaged application passed the public construction/save/close/reopen smoke
test, and ASAR client/worker hashes match the isolated production build.
It is not signed or a store-ready release.

The last packaged smoke run passed on its first attempt, including public
construction, the rehearsal worker, durable save acknowledgement, close and
relaunch. An earlier build's hidden test window missed the creation picker while
resizing; visible-window resize acceptance remains open.

## Active milestone and remaining work

The integrated signature slice is the active software milestone. Its automated
workflow checks are complemented by outstanding observed human playtests.
Platform acceptance remains open until real devices pass build/save/transfer,
suspend/resume, cab, memory and thermal checks.

For the next human playtest, separate fresh-world learning from development in
a prepared railway. Allow ten unassisted minutes to establish revenue in a
Standard lowlands region with seed `playtest-884`; record delivery revenue and
operating profit separately. Assistance after ten minutes must be marked as
assisted. The observed automated route is Managed Forest → Sawmill through
Plans, Fleet and Services.

Then test draft recovery, two complete design alternatives, a stopped
passenger train and neighbourhood development. A prepared world must be built
through ordinary play, have affordable validated alternatives and legitimately
produced materials, and be imported through Company. A 46-metre D2 Regional
Unit at a 30-metre platform provides a readable diagnostic; the current remedy
is a new sufficiently long platform and a recreated service. There is no
existing-platform extension button or service-stop editor.

Accept Homes by the Railway before its deliveries, then observe 16 modules,
60 local passenger arrivals, new buildings, a single £30,000 grant and the
25% passenger-demand increase. Ask what the player would change next; offer
ten optional minutes of continued play. Record whether they distinguish
engineering results from the illustrative demand band. Fresh-world onboarding
and prepared-world development results must remain separate: a complete
fresh Standard housing loop within 60 minutes has not yet been demonstrated.

Before claiming the complete professional game, remaining work includes:

- Shared regional rules for optional manual driving, finer signalling,
  reservation overlays and robust player-led deadlock recovery.
- A full consist/depot editor and purchasable locomotive-hauled passenger
  coaches. Five unpowered families exist in the roster, but the first depot
  models a representative freight wagon or complete DMU/EMU unit.
- Elevation editing and curve handles within saved mixed plans; freeform
  single-section previews already have curve controls. Parallel tracks,
  crossovers, fitted station approaches, scenery brushes and sandbox terrain
  sculpting remain to be built.
- Explicit financial restructuring, optional project deadlines, sustained
  reliability requirements and balancing the region's 6–10-hour development
  arc. Current project progress uses delivery/arrival totals.
- A guided introduction, remappable controls, scalable UI text, complete
  redundant icon cues, reduced motion and separate music/effects controls.
- Passenger demand sensitivity to waiting and total journey time, including
  service frequency, and distinct commuter/leisure demand peaks.
- Original consistent industry animation, characterful train/industry audio,
  restrained completion celebrations and broader visual polish.
- Signed installers, store assets, support diagnostics and platform release
  preparation.
- At least 24 separately analysed human playtests, 100 aggregate soak hours,
  50-train/500-vehicle/2,000-segment rendered benchmarks, and physical Android
  and iPhone acceptance. Automated tests do not establish enjoyment or ranking.

Revise the signature slice if its playtest gates fail before extending content.
Do not infer release readiness from a feature count or a successful browser run.

## Next development phase: illustrated overhead presentation

The next phase follows completion of this functional verification line. The
chosen direction is a rich illustrated overhead world with detailed trains and
landscapes. The current presentation remains prototype quality; the simulation
and platform checks above do not establish visual quality.

The [next-phase implementation brief](visual-direction/README.md) defines the
playable reference scene, asset contract, renderer/UI touchpoints and review
evidence for this overhaul.

[Initial visual reference](visual-direction/illustrated-overhead-v2.png), with
its [generation/edit prompt](visual-direction/illustrated-overhead-v2-prompt.txt),
explores a coherent landscape and calmer interface. It is generated concept
art, not an implemented screenshot or usable sprite atlas. Its remaining tilted
facades and dense texture should be simplified for roof-first overhead assets
and mobile legibility. The original concept and prompt are retained alongside it.

Begin with one playable riverside scene: a market town, brick mill, working
freight yard, passenger station, passing loop and developing neighbourhood.
Build it from reusable presentation assets and ordinary world data so the
improvements also work in generated regions. Use coherent overhead roofs,
restrained natural colours, textured ground, believable scale, continuous
railway geometry and consistent soft directional shadows.

The next tasks, in implementation order, are:

1. Establish shared visual tokens, an asset manifest with dimensions/pivots and
   zoom variants, and explicit ground, shadow, infrastructure, building, train
   and diagnostic layers. Measure the current scene at desktop and landscape
   phone sizes before adding detail.
2. Unify `CompanyHud`, `ManagementPanel`, `EditorToolbar` and `HUDScene` around
   one company/time bar, contextual inspector and task-based construction tools.
   Collapsible phone panels must preserve useful space for actual construction.
3. Rebuild `TerrainChunk`, `SceneryObject` and their chunk presentation with
   smoother ground shading, composed woods, field boundaries, riverbanks and
   lanes. Replace randomly rotated side-view tree symbols with overhead trees.
4. Give `FacilityView` and regional outcomes recognisable building groups,
   loading areas, stockpiles, roads and restrained working animation. Keep
   railway footprints and reserved plans clear; present actual project state.
5. Replace the mixed photographic track treatment in `RailTrackRenderer` with
   coherent illustrated ballast, sleepers, turnouts, bridge decks, portals and
   electrification. Keep engineering previews and route diagnostics readable.
6. Upgrade `FleetPresentation` materials, station detail, livery and visible
   loads while preserving authoritative poses, bogie alignment and interpolation.

Judge the playable scene at close, normal and regional zoom before extending
the asset roster. Required evidence includes distinguishable vehicles and
facilities, clear construction/diagnostic overlays, attractive idle footage,
observed mouse and touch use, and separately measured rendering performance.
Use locally packaged atlases, cached ground chunks and pooled effects; reduce
visual detail by device without changing simulation or save compatibility.
Continue to enforce cab isolation and persistence regression gates.
