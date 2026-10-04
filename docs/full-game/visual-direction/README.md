# Illustrated overhead implementation brief

Build one attractive, playable riverside railway before extending the asset
roster. The chosen direction is a rich illustrated overhead world with detailed
trains and landscapes. This brief defines the next implementation phase; it
does not record completed visual work or an approved final design.

The [revised concept](illustrated-overhead-v2.png) and its
[prompt](illustrated-overhead-v2-prompt.txt) explore colour, composition and mood.
They are illustrative images, not game screenshots or usable sprite atlases.
The current-chat layout prototype explores a desktop inspector and a landscape
phone command deck with static example figures. Its schematic backdrop and
local interactions provide layout evidence, not operating simulation, device
acceptance or approval. Retain the [original concept](illustrated-overhead-v1.png)
for comparison.

The [roof-first asset study](roof-first-asset-study-v1.png), with its
[exact prompt](roof-first-asset-study-v1-prompt.txt), explores the stricter
overhead camera on locomotive roofs, wagon loads, industrial buildings,
platforms and tree crowns. Its transparency is real, but soft halos, dense
texture and approximate vehicle/industrial proportions still need authored
cleanup. It is a camera/material reference, not an atlas ready for the game.

## One playable scene

Use an ordinary saved river-lowlands world containing a market town, brick-built
sawmill, freight yard, passenger station, river crossing and passing loop. Run a
timber freight service alongside a regional passenger service. Connect a nearby
housing project so legitimate deliveries and passenger arrivals create the
neighbourhood and subsequent demand. Establish the railway through existing
construction and service commands; export its save as the review fixture.

The scene must support building another connection, inspecting a stopped
train, comparing drafts and watching development. Include working and paused
states, empty and loaded wagons, and the neighbourhood before and after
completion. Choose a suitable generated seed after inspecting actual geography;
do not assume `playtest-884` guarantees the desired riverside composition.
Presentation improvements must also work in other generated worlds.

## Visual language and asset contract

Use roof-first overhead assets with consistent perspective, readable silhouettes
and restrained texture. Roads, roofs and ground form quiet areas around the
railway. Combine muted fields, darker woodland, soft blue-grey water, brick and
slate buildings, cream interface surfaces and a restrained company colour.
Distinguish shunters, freight locomotives and passenger units through shape and
roof equipment. Avoid tilted facades, photographic ballast and dense texture
that hides curves or platforms.

Preserve the existing ten-world-units-per-metre scale. Record physical lengths,
widths and platform dimensions; never enlarge art by changing train dynamics or
engineering limits. Use one world-space lighting direction aligned with terrain
shading. Rotating a vehicle or tree must not rotate its shadow direction. Keep
shadows separate from bodies, soft enough to preserve track contrast.

Create a presentation-only asset manifest before importing atlases. Each entry
needs a stable key, original-source provenance, atlas frame, pixel dimensions,
physical footprint, normalized pivot, forward axis, attachment anchors, tintable
livery mask, animation frames, draw layer and zoom variants. Vehicles use a
centre pivot and positive-X forward axis; stations and industries need explicit
platform/rail-access anchors. Trees use ground-footprint centres. Preserve
existing saved coordinates and interaction ownership.

Place train bodies at their sampled physical pose, including the midpoint of
the two bogies on curves. The saved rail cursor can differ from that midpoint;
artwork must not snap the body back onto the curve or change persistence.

Centralize relative layers: ground/water; lanes and ground decals; structural
shadows; ballast/rails/bridges/platforms; roofs and canopies; vehicle shadows,
bogies and bodies; draft/ghost/engineering overlays; selection/labels; interface.
Document exceptions for bridge decks and tunnel portals. Replace unrestricted
scenery `y * 0.1` depth with deliberate overhead layering. Provide close variants
with roof equipment and loads, normal variants emphasizing silhouettes, and
regional variants with simplified textures and selected-object labels. Choose
switches from measured screen size, with hysteresis to prevent zoom flicker.

## Ordered implementation tasks

1. **Establish the reference and asset pipeline.** Add shared presentation tokens,
   layer definitions and the manifest beside existing presentation code. Load
   locally packaged atlases through `src/scenes/PreloadScene.ts`; existing images
   live in `src/assets/images`, copied by `webpack.config.js`. Exit: the review
   save, camera bookmarks and baseline captures are reproducible; assets load
   offline with documented pivots and no missing textures.

2. **Consolidate the interface.** Update `src/ui/CompanyHud.ts`,
   `src/ui/ManagementPanel.ts`, `src/ui/EditorToolbar.ts` and
   `src/scenes/HUDScene.ts`. Keep one company/time bar and contextual inspector,
   with Build, Services, Projects and Plans as primary tasks; Fleet, Stations and
   Company remain discoverable. Preserve action ports, keyboard shortcuts,
   disabled-tool explanations, exact quotes and save errors. Exit: a player can
   select, construct, inspect, pause and save with mouse or touch; DOM chrome
   never intercepts an intended world placement.

3. **Rebuild the landscape.** Update `src/entities/TerrainChunk.ts`,
   `src/entities/SceneryObject.ts`, `src/systems/TerrainChunkManager.ts` and
   `src/managers/SceneryManager.ts`. Cache ground composition and stream composed
   woodland, banks, boundaries and lanes without changing terrain generation.
   Exit: camera movement exposes no gaps or chunk seams; trees read overhead;
   construction and reserved railway footprints remain clear.

4. **Make the railway and town coherent.** Replace mixed photographic strips in
   `src/entities/RailTrackRenderer.ts` with continuous illustrated trackwork.
   Replace persistent facility rings in `src/entities/FacilityView.ts` with
   recognizable buildings, stockpiles and selected-access overlays, retaining
   inspection DTOs from `src/economy/FacilityPresentation.ts`. Refine regional
   outcome drawing in `src/management/RailwayController.ts`. Exit: turnouts,
   crossings, portals and loading areas remain legible; project changes match
   authoritative progress and protect operating infrastructure.

5. **Finish trains, platforms and restrained motion.** Upgrade
   `src/management/FleetPresentation.ts`, including its managed station rendering;
   keep `src/entities/Station.ts` compatible with legacy play. Preserve sampled
   poses, bogie alignment, interpolation and selection. Add visible load states
   and pooled effects driven by inspection snapshots. Exit: consists follow
   curves without gaps or sliding, station crowds reflect authoritative passenger
   counts, and pausing live operation freezes live operational animation.

## Layout and review evidence

Desktop targets a 16:10 workspace, represented by 1024 × 640. At 844 × 390,
landscape phones use a compact company/clock bar, task dock and collapsed
selection strip; expanded context replaces the map within the available height.
Keep at least 44-pixel essential touch targets, readable unscaled text and
120% text support. Narrow chat previews reflow vertically; that is not evidence
of phone acceptance. Test real construction space, focus retention, safe areas,
keyboard avoidance and portrait-to-landscape transitions in the game.

Capture matching before/after screenshots at bookmarked close, normal and
regional views, recording actual camera values. Include desktop and phone,
selected/idle states, a construction preview, a stopped-train diagnostic and
project completion. Record idle, running and pan/zoom footage. Compare frame
times, input latency, draw calls, texture memory, heap and chunk counts on the
same hardware and save. Existing physics/construction benchmarks are not a
rendering baseline. Report measured deltas before accepting more detail;
physical Android/iPhone memory and thermal testing remains a prerequisite.

Keep game rules, costs, transactions, saves and migration unchanged. Continue
required regression checks and cab purity/isolation tests; management art stays
outside `src/cab3d`, Babylon remains renderer-only and lazy-loaded. Missing
prerequisites are the composed review save, production-ready original atlases,
recorded rendering baseline and physical Android/iPhone devices.
