# Rail Sim: Full Game Design and Long-Term Roadmap

**Date:** 2026-07-25  
**Status:** Approved direction; implementation planning pending  
**Product benchmark:** The legibility, construction satisfaction, escalating challenge, and emergent stories of *RollerCoaster Tycoon*, expressed through a modern railway and supply-chain simulation.

## 1. Product vision

Rail Sim is a railway tycoon game about reading a landscape and an economy, building a network, and watching that network become a living industrial system.

The player should repeatedly experience five pleasures:

1. **Plan:** notice an opportunity in terrain, local supply, demand, or a contract.
2. **Build:** draw a railway that feels physical, understandable, and satisfying.
3. **Watch:** see trains, cargo, industries, towns, money, and problems move visibly through the world.
4. **Diagnose:** understand why a service is profitable, delayed, blocked, or underused.
5. **Improve:** make a small change that produces an obvious operational or financial improvement.

The finished game must support large networks moving hundreds of product and material types through multi-stage, multi-input supply chains. The first releases will expose a much smaller catalogue, but the simulation and content format must not assume that only one chain exists.

The game is not primarily a track editor, a manual train-driving game, or a spreadsheet. Construction, direct driving, and financial reports all support the central fantasy: building a railway company whose network makes a regional economy work.

## 2. Design principles

### 2.1 RollerCoaster Tycoon feeling

The intended comparison is experiential rather than cosmetic:

- Construction is immediate, tactile, and constrained by the world.
- Simulation state is visible on the map rather than hidden in reports.
- Players can pause, inspect, experiment, undo recoverable mistakes, and improve gradually.
- Every failure has a traceable cause and an actionable remedy.
- Generated worlds create pressure through budgets, geography, deadlines, service quality, and growth.
- The world has charm: facilities animate, towns react, trains have readable states, and achievements feel celebratory.
- Optimisation matters, but the interface teaches before it punishes.
- A world remains enjoyable after its current milestone or contract is complete.

### 2.2 YAGNI with a scalable destination

Each milestone adds the smallest complete game loop needed at that stage. Generic definitions are justified where the final requirement already demands scale:

- Products and recipes are data, not hard-coded conditionals.
- Simulation systems operate on generic inventories, recipes, quotes, and contracts.
- Only products, wagon classes, market behaviours, and UI views needed by current progression stages are implemented.
- Advanced finance, research, multiplayer, corporate ownership, and microscopic citizen simulation are excluded until the railway loop proves they are needed.

### 2.3 Legibility before realism

Rules should be plausible and internally consistent, but clarity wins over hidden realism. The player should be able to answer:

- What is waiting here?
- What does this facility need?
- What will this train carry next?
- Why did this price change?
- Why can or cannot this track be built?
- What did this decision cost?
- What is preventing the contract from succeeding?

### 2.4 Challenge through interacting constraints

Difficulty comes from understandable trade-offs:

- Short, steep routes versus long, affordable routes.
- Cheap capacity now versus scalable capacity later.
- Spot-market opportunity versus reliable contracts.
- Fast trains versus running cost and congestion.
- Serving one profitable customer versus enabling a larger supply chain.
- Growth versus liquidity.

Challenge must not depend on opaque randomness, excessive clicking, or waiting without decisions.

## 3. Player experience

### 3.1 Core session loop

1. Survey the map, industries, towns, market opportunities, and objectives.
2. Inspect terrain and compare candidate routes.
3. Build track, stations, depots, and supporting infrastructure.
4. Purchase a suitable train and assign a service.
5. Watch loading, routing, processing, unloading, income, and costs.
6. Respond to bottlenecks, changing demand, incidents, and new contracts.
7. Expand into longer chains and a wider region.
8. Complete contracts and company milestones, then keep expanding the same world or generate a harder one.

### 3.2 Time and control

- Pause, 1×, 2×, and 4× simulation speeds.
- Construction can occur while paused.
- Manual driving remains an optional direct-control activity and recovery tool.
- Normal commercial operation uses services, stops, cargo rules, and schedules.
- Alerts never steal camera control. They identify the issue and offer a direct route to inspect it.

### 3.3 Feedback

- Cargo icons and quantities visibly transfer at facilities.
- Trains show destination, load, delay, and problem status at a glance.
- Construction previews show geometry, grade, structure type, validity, and live cost.
- Revenue and major expenses appear in restrained map feedback and in the ledger.
- Industries visibly idle, work, fill, and starve.
- Objectives show progress, deadline risk, and the next actionable constraint.
- Successful deliveries, new profitable services, company milestones, and recoveries receive distinct audio-visual feedback.

## 4. World and map generation

### 4.1 Deterministic worlds

Every world is generated from a seed and persists all player changes. A saved world contains terrain settings, industry placement, towns, markets, tracks, structures, vehicles, services, contracts, economy state, and financial history.

### 4.2 Terrain generation

Maps combine:

- Elevation with ridges, valleys, passes, basins, and coast or river opportunities.
- Biomes that affect appearance and resource suitability.
- Water, cliffs, forests, settlements, and resource deposits.
- A hierarchy of terrain detail: strategic landforms at map scale and readable local slopes at construction scale.

Generation must guarantee:

- No black gaps at supported zoom levels.
- A navigable camera start.
- At least one feasible early-game route.
- Industries placed on usable footprints.
- Resource producers placed where their inputs make sense.
- Consumers and processors separated enough to require transport.
- At least two meaningfully different route options for the first generated opportunity.

After generation, a validator checks world bounds, facility reachability, viable corridors, first-opportunity feasibility, and initial budget sufficiency. Invalid seeds are regenerated deterministically with a bounded retry count.

### 4.3 Industry placement

Facilities are placed according to:

- Resource suitability.
- Distance from conflicting or dependent facilities.
- Access to towns, ports, and buildable corridors.
- The generated region's economy and resource graph.
- Regional economic identity.

The generator creates an economic graph first, then places that graph into geography. This ensures the map is both plausible and playable.

## 5. Track construction and terrain interaction

### 5.1 Drawing workflow

The primary track tool is click-drag-place:

1. Start from open terrain or snap to an existing compatible endpoint.
2. Drag to set the endpoint.
3. Adjust curvature with a clear handle or automatic tangent.
4. Review a live preview.
5. Place with one confirmation when valid.
6. Continue drawing from the new endpoint.

Escape cancels, right-click steps back, and undo remains available after placement.

### 5.2 Construction preview

The preview communicates:

- Green: valid and ordinary construction.
- Amber: valid but expensive, slow, or structurally unusual.
- Red: invalid, with one primary explanation.
- Segment length and minimum curve radius.
- Maximum gradient and the location of the steepest section.
- Ground, cutting, embankment, bridge, or tunnel portions.
- Itemised and total cost.
- Affordable or unaffordable state.
- Snapped connections and expected junction creation.

The player may compare a direct engineered route with a longer terrain-following route before spending money.

### 5.3 Vertical alignment

Track has an explicit elevation profile rather than a single average elevation. The first implementation may derive this profile automatically from terrain and endpoint constraints. Later milestones add editable vertical control points only if playtesting shows they improve decisions more than they add friction.

Constraints include:

- Maximum gradient by track and vehicle class.
- Smooth transitions between grades.
- Clearance over terrain and water.
- Tunnel cover.
- Bridge pier and span constraints.
- Junction alignment.

### 5.4 Construction cost

Track price is calculated from visible components:

`base track + curvature premium + earthworks + bridge + tunnel + junction + demolition`

Terrain does not merely reject construction; it creates choices. Moderate slopes increase earthworks cost. Severe obstacles suggest a tunnel, bridge, or reroute. Invalid placement messages must describe a remedy.

## 6. Railway operations

### 6.1 Trains and consists

The long-term train model supports:

- Locomotives with power, speed, running cost, compatibility, and reliability.
- Wagons with cargo classes, mass, volume, loading rate, and capacity.
- Player-built consists.
- Train length affecting platforms, junction clearance, acceleration, and capacity.
- Mixed consists only where a service rule explicitly permits them.

The first playable freight milestone may purchase a locomotive-and-wagon set as one unit. Consist editing follows after scheduled services are stable.

### 6.2 Services

A service defines:

- Ordered stops.
- At each stop: load rules, unload rules, minimum/maximum wait, and departure condition.
- Allowed products or product groups.
- Repetition and optional timetable.
- Assigned train.

The service editor starts with a small set of understandable rules:

- Load available.
- Load up to target.
- Unload accepted cargo.
- Wait for full load.
- Depart after maximum wait.

Conditional routing, priorities, and advanced timetables are added only when network scale requires them.

### 6.3 Routing and signalling

Operations progress in stages:

1. Reliable movement across connected track.
2. Automated traversal of a service route.
3. Block occupancy and simple signals.
4. Junction reservations and conflict resolution.
5. Multiple trains, congestion, passing loops, and capacity planning.
6. Advanced signalling only when mature networks need it.

Derailment and recovery must be deterministic, understandable, and non-destructive. A recover action returns a vehicle to valid track at a clear financial or time cost rather than leaving a save unusable.

## 7. Products, cargo, and supply chains

### 7.1 Data-driven catalogue

A product definition contains only fields required by simulation and UI:

- Stable identifier and display name.
- Category and cargo class.
- Unit label, unit mass, and unit volume.
- Base reference price.
- Storage and loading characteristics.
- Optional perishability when the active product catalogue uses it.

Product categories eventually cover:

- Agricultural inputs and food.
- Forestry and paper.
- Minerals and construction.
- Fuels, chemicals, and energy equipment.
- Metals and manufactured components.
- Vehicles, machinery, electronics, and consumer goods.
- Waste, recycling, mail, and containerised mixed goods.

Hundreds of products are added as data after the generic flow is proven. The UI groups and filters them by category, route relevance, contract relevance, and recent activity so scale does not become clutter.

### 7.2 Generic recipes

A recipe supports:

- Multiple inputs.
- Multiple outputs and optional by-products.
- Cycle time.
- Batch size.
- Operating cost.
- Facility capacity.
- Optional enabling requirements introduced by content, such as power or labour availability.

Facilities may offer more than one recipe, but early worlds keep choices limited and explicit.

### 7.3 Inventories

Every facility inventory records quantity, reserved quantity, capacity, recent inflow, recent outflow, and target stock. Loading and unloading are physical, rate-limited operations.

Cargo remains identified while in transit. Simulation never creates goods merely because a train arrived. Every finished product traces back to produced or imported inputs.

### 7.4 Long-term supply-chain scale

The intended mature game includes networks such as:

- Iron ore + coal → steel → machine parts + electronics → vehicles.
- Grain + fertiliser + packaging → food products → regional distribution.
- Crude oil → fuels + petrochemicals → plastics → consumer goods.
- Timber + chemicals → pulp → paper + packaging.
- Lithium + nickel + processed chemicals → cells → battery packs → electric vehicles.
- Construction aggregates + cement + steel + timber → regional building supply.

Ports and interchanges connect the playable region to global imports and exports. They provide finite capacity and market access, not infinite free sources or sinks.

## 8. Modern economy

### 8.1 Economic layers

The economy has three connected layers:

1. **Facility economy:** inventory pressure, production capacity, input affordability, output demand, and transport availability.
2. **Regional economy:** town growth, sector demand, labour and energy conditions, and local shortages or surpluses.
3. **Global economy:** benchmark prices, broad sector cycles, import/export demand, and occasional announced shocks.

The player interacts with all three primarily through rail decisions.

### 8.2 Pricing

Prices are derived, not arbitrary:

`local quote = global reference × regional demand × inventory pressure × quality/contract modifier`

Each multiplier has a bounded range and an explanation in the UI. Price history shows trend and the main causes of change.

Spot prices create opportunity. Contracts create predictable revenue in exchange for volume, punctuality, or exclusivity requirements.

### 8.3 Facility behaviour

Facilities:

- Produce only when inputs, storage, and operating conditions allow.
- Slow or stop when outputs cannot move.
- Display current blockers.
- Offer or accept contracts based on expected supply and demand.
- Expand capacity after sustained profitable throughput in later milestones.
- May close only under advanced economy settings, with long warnings and recovery options.

Towns and commercial consumers translate delivered goods into growth and further demand. Growth creates new traffic instead of being a decorative score.

### 8.4 Global market

Ports and external interchanges:

- Publish import and export quotes.
- Have handling charges and throughput limits.
- Reflect global sector indices.
- Provide a pressure valve for regional surpluses and shortages.
- Never outperform a well-designed local chain in every circumstance.

Global shocks are announced, time-bounded, and explain their affected products. Randomness uses the world seed so generated economies remain reproducible and testable.

### 8.5 Company finance

The company tracks:

- Cash.
- Construction capital expenditure.
- Vehicle and infrastructure purchases.
- Sales and contract income.
- Fuel or energy, staffing abstraction, maintenance, access, and handling costs.
- Penalties and recovery costs.
- Period profit and loss.
- Cash-flow history.
- Asset value only when loans or company valuation require it.

The first milestone uses cash, revenue, capital expenditure, running cost, and profit/loss. Loans, interest, taxes, depreciation, and bonds are later difficulty tools, not initial complexity.

## 9. Objectives, challenge, and progression

### 9.1 Generated-world structure

Every new game starts in a freshly generated world:

- The player chooses a seed or accepts a random one.
- Terrain, resources, towns, industries, prices, and opportunities are generated.
- No track, train, service, or player-owned facility is prebuilt.
- The camera opens on the region with an empty railway company and a readable first opportunity.
- The player chooses the route and builds every part of the railway.

World creation exposes a few meaningful settings:

- Terrain difficulty.
- Starting capital.
- Economy volatility.
- Region size.
- Optional guided start.

There is no traditional sequence of pre-made scenario maps. A future challenge mode may prescribe a seed, starting rules, or objective, but it still starts with no prebuilt railway and never hands the player a solved or partly solved world.

### 9.2 Dynamic contracts and company milestones

Generated facilities, towns, and markets offer contracts based on real shortages, surpluses, expansion plans, and global opportunities. Contracts combine:

- Delivery volume.
- Deadline.
- Profit or cash-reserve requirement.
- Service reliability.
- Network coverage.
- Industry or town growth.
- Capacity under difficult terrain or congestion.

Company milestones provide long-term direction without ending the world:

- First profitable route.
- First processed product.
- First multi-input manufacturer supplied.
- First global export.
- Sustained service reliability.
- Regional network coverage.
- Company valuation and throughput tiers.

Milestones may award company rating, small financial bonuses, cosmetic recognition, or access to larger contracts. They do not gate basic construction tools needed to recover from mistakes.

### 9.3 Organic difficulty curve

1. **First connection:** the generator guarantees at least one simple source-to-consumer or source-to-processor opportunity and a forgiving budget.
2. **Processing:** new contracts encourage a source, processor, consumer, and useful return flow.
3. **Multi-input manufacturing:** the economy creates demand that requires synchronising two or more feeder routes.
4. **Network capacity:** several services begin sharing constrained infrastructure.
5. **Regional company:** the player balances contracts, growth, market cycles, and capital.
6. **Mature economy:** difficult terrain, narrow margins, congestion, global trade, and long supply chains interact.

Progress is driven by what the player builds and what the generated economy needs. Harder world settings add interacting constraints rather than hiding information or inflating numbers.

### 9.4 First-world progression

The first complete economy starts small and grows in the player's generated world.

Initial opportunity:

- A nearby producer, such as a managed forest.
- A processor, such as a sawmill.
- A town or trade interchange that buys the processed output.
- No prebuilt connection or vehicle.

After the player completes a few profitable deliveries, generated contracts reveal or strengthen adjacent chains:

- Quarry → limestone aggregate.
- Cement works: limestone aggregate → cement.
- Port/interchange: imports steel at a global quote and exports surpluses.
- Prefabrication plant: structural timber + cement + steel → building modules.
- Growing towns consume building modules and translate them into visible growth.

This progression begins with one understandable material flow, then proves parallel feeder routes, a three-input recipe, a global connection, constrained local inventories, construction cost, operating cost, and final demand. It is not a scripted map: facility locations and route choices come from the generated world.

Suggested early milestones:

- Build the company's first valid route.
- Complete the first profitable delivery.
- Supply a processor continuously.
- Deliver the first building modules.
- Remain solvent.
- Reach positive rolling profit and a service-reliability target.

Exact quantities, prices, timing, and generated distances are tuning data determined through automated simulation and playtesting, not fixed in architecture.

## 10. User interface and experience

### 10.1 Screen hierarchy

The world remains the primary screen.

- **Top bar:** cash, current profit trend, date, demand indicator, pause/speed.
- **Left build palette:** track, structures, stations, vehicles, demolish, overlays.
- **Right inspector:** selected train, track, facility, service, contract, or town.
- **Goals card:** collapsible milestone, contract progress, and deadline risk.
- **Bottom notification stack:** recent events and actionable warnings.

Management views open as focused panels rather than replacing the world:

- Company and P&L.
- Contracts.
- Products and market.
- Services.
- Network problems.

### 10.2 Information layers

Overlays answer one question at a time:

- Terrain and grade.
- Construction cost.
- Industry inputs and outputs.
- Cargo flow.
- Local prices and unmet demand.
- Track utilisation and congestion.
- Service profitability.

Colours are redundant with icons, labels, and patterns. Keyboard, mouse, and touch targets remain accessible at supported resolutions.

### 10.3 Onboarding

An optional guided start teaches by doing in the player's generated world:

- Contextual prompts appear only when the relevant action becomes possible.
- A valid next action is highlighted without forcing a single solution.
- Tooltips explain consequences and controls.
- Early errors are recoverable.
- Prompts stop once the player demonstrates the action.

Guidance never places track, buys vehicles, or makes route decisions for the player. There is no separate manual required to establish the first profitable service.

## 11. Technical architecture

### 11.1 Authoritative experience

`WorldScene` becomes the complete persistent game. Build and Operate modes use the same world and simulation. Existing terrain, track, editor, vehicle, and save systems are retained and improved.

The existing scripted `GameScene` remains legacy prototype content until the generated-world experience replaces it. No new economic architecture is added to it.

### 11.2 Domain boundaries

Gameplay logic is implemented as small, testable systems:

- `ConstructionEconomy`: estimates, affordability, purchases, and refunds.
- `ProductCatalog`: product definitions and cargo compatibility.
- `IndustrySystem`: recipes, inventories, and facility ticks.
- `CargoSystem`: reservations, loading, transit, and unloading.
- `MarketSystem`: local quotes, regional factors, global indices, and histories.
- `ServiceSystem`: stops, cargo rules, assignments, and service state.
- `ContractSystem`: offers, acceptance, progress, rewards, deadlines, and ratings.
- `FinanceLedger`: categorised transactions, cash, P&L, and trends.
- `ProgressionSystem`: generated opportunities, company milestones, world difficulty, and long-term goals.

Systems use explicit calls and serialisable state. The event bus carries UI notifications and lifecycle signals, not hidden authoritative state transitions.

### 11.3 Simulation time

- Rendering and train physics continue per frame.
- Economic systems advance on a fixed simulation tick.
- Long calculations are bounded and distributed.
- Deterministic time, seeded randomness, and pure pricing/recipe functions make generated economies reproducible.
- Off-screen presentation may be simplified, but economic and routing outcomes remain consistent.

### 11.4 Persistence

`WorldData` gains an explicit schema version and backward migrations. Persisted state includes:

- Company and ledger summary.
- Facilities and inventories.
- Product reservations and train cargo.
- Services and assignments.
- Markets and demand indices.
- Contracts, milestones, and world-progression state.
- Simulation clock.

Migrations are additive and tested against representative old saves.

### 11.5 Content format

Products, recipes, facilities, vehicles, world presets, contracts, and market sectors use typed data definitions. Invalid references and impossible recipes fail validation during development.

Content data is not a modding API in the initial game. A public modding surface is deferred until formats stabilise.

## 12. Error handling and recovery

- Invalid placement shows one primary cause and a remedy.
- Failed purchases do not partially mutate state.
- Cargo transfers are transactional.
- Missing content references produce a safe load failure with a useful message.
- Save migration is validated before replacing the last known-good save.
- Autosave uses rolling recovery slots once the world simulation becomes stateful.
- Trains can be recovered to valid track for a visible cost.
- Impossible contracts cannot be generated.
- Economy calculations clamp invalid values and surface development diagnostics without player-facing log spam.

## 13. Quality and testing

### 13.1 Automated coverage

- Unit tests for pure economy, pricing, recipe, construction-cost, cargo, contract, and migration logic.
- Integration tests for source → train → processor → train → consumer material conservation.
- Deterministic generated-world tests proving the first opportunity is achievable with the starting budget.
- Regression tests for terrain streaming, track placement, junctions, saving, routing, and vehicle recovery.
- End-to-end tests for world creation, route construction, purchasing a train, completing a delivery, saving, and reloading.
- Performance checks for simulation ticks, route finding, chunk streaming, and UI responsiveness at milestone-specific network sizes.

Tests must validate conservation of goods and money. No product or cash may appear without a defined transaction.

### 13.2 Manual and visual validation

Each playable milestone is checked for:

- Clear first action.
- Readable track preview at common zoom levels.
- No hidden route-blocking terrain.
- Objective and economy causality.
- Recoverable common mistakes.
- Keyboard, mouse, and touch usability where supported.
- Stable play across a representative session.
- Understandable failure and satisfying success.

### 13.3 Tuning

Balance values live in world-preset or content data. A deterministic headless simulation estimates feasibility, throughput, and cash-flow ranges. Human playtesting remains authoritative for fun, pacing, and legibility.

## 14. Delivery roadmap

Every milestone ends in a playable, tested, committed, and published build. Later work may refine earlier systems, but no milestone exists only to create unused infrastructure.

### Milestone 0: Stabilise the current prototype

Outcome: a clean, trustworthy baseline.

- Review and retain the existing carriage, terrain, UI, and recovery work.
- Remove temporary per-frame diagnostics and test artefacts.
- Correct stale terrain-streaming expectations.
- Fix genuine regressions discovered by the full test suite.
- Build and run critical browser flows.
- Commit the stabilised baseline.
- Establish Sites hosting and publish the baseline.

### Milestone 1: Satisfying map and track construction

Outcome: building a route across terrain is understandable and enjoyable.

- Validate deterministic map generation and feasible facility corridors.
- Add the live track preview with grade, structure, validity, and itemised cost.
- Implement construction affordability and transactions.
- Improve snapping, continuation, cancellation, undo, and error guidance.
- Persist construction state.
- Publish and playtest the construction loop.

### Milestone 2: First generated freight economy

Outcome: a new generated world grows from its first simple freight route into the construction-supply chain.

- Add the product catalogue, six initial materials, generic recipes, and inventories.
- Generate the initial producer, processor, consumer, and feasible route choices; introduce adjacent facilities through economic progression.
- Add freight capacity, compatible loading, unloading, and visible transfer.
- Add local quotes, a bounded global construction-sector index, and port trade.
- Add cash, operating costs, ledger, P&L, dynamic contracts, and company milestones.
- Deliver building modules through the complete chain.
- Publish and tune until the loop is legible and fun.

### Milestone 3: Automated railway company

Outcome: the player manages services rather than manually driving every shipment.

- Add service creation and stop rules.
- Add automated routing and dependable route execution.
- Introduce locomotive-and-wagon consist editing.
- Add simple block signalling and train reservations.
- Add train/service profitability and problem diagnostics.
- Grow the generated economy until the player must synchronise two inputs and avoid congestion.

### Milestone 4: Regional economy and growth

Outcome: the network changes the region and creates new opportunities.

- Add multiple towns, demand sectors, and growth.
- Add a broader product and industry catalogue.
- Add facility expansion and clearly signalled production responses.
- Add regional shortages, surpluses, contracts, and bounded global shocks.
- Add larger maps, multiple interchanges, and meaningful network capacity.
- Add medium-difficulty world presets and richer procedural regions.

### Milestone 5: Deep operations and company challenge

Outcome: mature networks remain challenging.

- Add maintenance and reliability where they create operational choices.
- Add depot and replacement workflows.
- Add loans and interest for world presets that need capital pressure.
- Add advanced signals, priorities, and timetables only as required by congestion.
- Add expert terrain, capacity, turnaround, and market presets.
- Improve reporting without turning play into spreadsheet management.

### Milestone 6: Content scale and final polish

Outcome: the full game supports diverse, long-lived economies.

- Expand toward hundreds of products through validated data packs.
- Add product search, filtering, grouping, relevance, and flow visualisation.
- Add diverse regions, biomes, sectors, vehicles, and long-term company arcs.
- Optimise assets, loading, simulation, and routing for target-scale saves.
- Complete audio, animation, accessibility, tutorials, generated-world pacing, and difficulty tuning.
- Run save-compatibility, long-session, performance, and completion audits.

## 15. Commit and publishing policy

- Commit after each coherent, verified behaviour.
- Keep refactors separate from features unless the refactor is required for that feature.
- Never commit temporary diagnostics, generated test output, credentials, or broken builds.
- Preserve unrelated user changes.
- Publish a Sites build at the end of each playable milestone and at meaningful progress checkpoints.
- The public progress build must identify its milestone and known limitations without exposing development internals.

## 16. Completion criteria

The goal is complete only when evidence shows:

- The UI and interaction are polished across the complete core loop.
- Generated maps are reliable, readable, varied, and contain feasible early opportunities.
- Track construction across sloped terrain is understandable, flexible, and costed.
- Trains reliably move materials through complex, multi-input supply chains.
- Products and recipes scale as data toward hundreds of types.
- Construction, vehicles, operations, contracts, and markets affect company finances.
- Local facility conditions, regional demand, and global trade interact visibly.
- Generated worlds, contracts, and company milestones are challenging, achievable, replayable, and enjoyable.
- Sandbox play remains meaningful after objectives.
- Saves migrate safely.
- Automated, visual, performance, and long-session verification cover the delivered scope.
- The final verified build is published with Sites.
