# Milestone 2E Regional Construction Supply Design

## Goal

Complete the first generated construction-supply economy as one playable
regional network:

1. extend one open end of the existing railway to Port Interchange;
2. use an existing General Flatbed Set to load 60 tonnes of imported steel;
3. deliver the complete steel consignment profitably to Prefabrication Plant;
4. watch the first exact multi-input batch progress alongside the six arriving
   steel batches, consuming 8 t timber, 8 t cement, and 6 t steel to produce
   four Building Modules;
5. extend the other open end of the railway to Town Construction Market;
6. load all four modules into the same type of flatbed;
7. deliver the complete module consignment profitably to the town.

The completed state is:

`Regional construction supplied · Network ready to automate`

The generated world remains a blank sandbox. Generation may place facilities
and prove possible construction, but it never places track, junctions,
stations, trains, services, or solved routes for the player.

## Standing Approval and Scope

This slice implements the already approved full-game design and its Milestone
2 construction-supply outcome. The user has delegated detailed design choices
and explicitly asked the agent to proceed without repeated approval questions.
It supersedes Milestone 2D's provisional handoff that suggested shipping the
steel leg before module delivery. The audits found no independent authority
boundary between those legs: the same flatbed, cargo transaction, recipe,
objective, and generated spine carry both. Completing them together avoids a
narrow intermediate release while preserving every M2D deferral outside this
capstone.

Three approaches were considered:

1. **Complete regional capstone using the existing railway and flatbed
   (selected).** Port and Town extend the two guaranteed open ends of the
   Forest–Prefab–Quarry network. This turns all earlier construction into one
   long railway, reuses owned rolling stock, preserves the operating reserve,
   and completes the first three-input chain in one satisfying milestone.
2. **Steel-only milestone followed by module delivery.** This gives a quick
   factory-start payoff, but it deliberately stops before the approved
   Milestone 2 outcome and adds another publication/review cycle without a new
   architectural boundary. It is too narrow.
3. **New steel/module train and two direct Prefab stubs.** This adds a vehicle,
   purchase policy, capital requirement, and two more approaches into the
   already busy Prefab throat. It is less affordable and creates mechanics the
   current loop does not need.

Continuous port replenishment, wholesale acquisition costs, port handling,
town consumption/growth, contracts, services, and automatic routing are
separate authority and gameplay decisions. They remain later work rather than
being partially simulated here.

## Player Experience

Milestone 2E begins when the profitable cement delivery is complete. The goal
card advances to **Regional construction supply**:

1. **Connect Port Interchange** — connect Port to the existing regional
   railway.
2. **Deliver 60 t steel profitably** — load one complete General Flatbed Set
   at Port and unload it at Prefabrication Plant with positive trip profit.
3. **Assemble 4 Building Modules** — run the six-tick module recipe once.
4. **Connect Town Construction Market** — connect Town to the existing
   regional railway.
5. **Deliver 4 modules profitably** — move one complete module consignment
   from Prefabrication Plant to Town with positive trip profit.

Cargo unload precedes recipe processing in each economy tick. Steel arrives in
six ten-tonne batches, so assembly begins when the first batch makes all three
inputs available and completes on the same committed tick as the sixth steel
batch. The steel-delivery and assembly steps may therefore complete together.
The UI shows `Working n / 6 ticks` throughout the overlapping unload rather
than imposing an artificial second wait.

The player is not required to buy a fourth freight set. General Flatbed Set
becomes genuinely general:

- 60 t Logs;
- 60 t Structural Timber;
- 60 t Steel;
- 4 Building Modules.

Its mass limit remains 60,000 kg. Its volume limit increases from 96,000 L to
100,000 L so one set carries the exact four-module output of one assembly
cycle. Its £90,000 purchase price and £20 active-tick running cost do not
change.

The existing train may be driven across the connected network. If the player
buys another flatbed, the existing provenance-bound purchase flow remains
valid because the mature regional railway connects its source and destination
components. This milestone does not add a cargo picker or consist editor.

### Facility feedback

Boundary facilities must no longer look like inert factories:

- Port status is **Imported steel available** while stock remains and
  **Steel import stock depleted** when empty.
- Port says **Offers Steel**, shows current imported stock, and explains that
  availability is finite in this milestone.
- Town status is **Buying Building Modules** while it has capacity and
  **Construction market supplied** when full.
- Town says **Buys Building Modules** and shows its receiving quote.
- Prefabrication continues to show the exact recipe:
  `8 t Structural Timber + 8 t Cement + 6 t Steel → 4 Building Modules ·
  6 ticks`.
- Waiting-state copy names the genuinely missing inputs.

Every quote and capacity uses the product's real unit. Building Modules render
as `module` or `modules`, never tonnes or generic units.

Delivery feedback names the product, destination, revenue, running cost, and
trip profit or loss. A loss still earns the correct local-market revenue but
does not complete a profitable-delivery step.

## Economy and Balance

Existing product and recipe authority remains unchanged:

| Product | Base price | Cargo class |
| --- | ---: | --- |
| Steel | £650/t | flatbed |
| Building Modules | £6,000/module | flatbed |

`module-assembly` remains:

| Input/output | Quantity |
| --- | ---: |
| Structural Timber input | 8 t |
| Cement input | 8 t |
| Steel input | 6 t |
| Building Modules output | 4 modules |
| Cycle time | 6 economy ticks |

One 60-tonne steel delivery supports ten recipe cycles if the other two inputs
exist. The preceding milestones leave enough timber and cement for the first
batch, which gives an immediate visible payoff after steel arrives.

Port's opening 120 tonnes of steel is finite imported stock. This milestone
does not create steel from nothing during runtime and does not charge an
unreported acquisition cost. The bounded global construction index, regional
demand, and destination inventory pressure continue to determine local
receiving prices visibly. The later port-trade slice will add replenishment and
landed costs together so trip and company profit cannot disagree.

At the legally lowest market factors, a full 60-tonne steel delivery to an
empty Prefab grosses £31,990 and four modules delivered to an empty Town gross
£21,216. Both real journeys must remain profitable after the unchanged
£20-per-active-tick running cost on accepted playtest seeds.

No new grant is added. The two regional extensions together cost no more than
£60,000. The conservative prior path leaves £81,000 even when the player owns
two optional flatbeds, preserving the £20,000 operating reserve:

`£81,000 - £60,000 = £21,000`

The cap is a generation contract, not a scenario subsidy. Price, recipe,
vehicle cost, and operating cost may not be relaxed to rescue failing
generation fixtures.

## Cargo Boundary Rules

`FacilityCargoRules` gains only the two boundary cases required by current
content:

- a `port` facility may load an `imported-material` product present in its
  inventory even without an active recipe;
- a `town-consumer` facility may accept a `finished-good` product declared in
  its inventory even without an active recipe.

All existing compatibility, capacity, reservation, facility-radius, stopped
train, transactional transfer, quote, and batch rules remain in force.

Port loading reduces authoritative steel inventory in ten-unit batches. Town
unloading increases authoritative module inventory and posts delivery revenue
from the destination's pre-batch quote. There is no automatic port import,
town consumption, export, or second revenue posting.

## Authority and Persistence

Schema 10 is a clean break because the user confirmed there is no existing
player data to migrate. `FreightProgressDef` adds:

```ts
profitableSteelDeliveryCompleted: boolean;
profitableBuildingModuleDeliveryCompleted: boolean;
```

The steel latch changes only when:

- the cargo is Steel;
- it was loaded as one complete 60-unit General Flatbed consignment;
- it unloads completely at Prefabrication Plant;
- revenue minus active running cost is positive.

The module latch uses the equivalent rules for one complete four-module
General Flatbed consignment unloading at Town Construction Market.

Partial loads, wrong destinations, incompatible sets, and zero/negative trip
profit never latch progress. Latches, inventory, cargo, trip statistics,
ledger entries, and cash commit or reject together through
`WorldManager.applyOperationsBatch`.

First-module production uses one explicit non-double-counting fact:

```ts
profitableSteelDeliveryCompleted && (
  profitableBuildingModuleDeliveryCompleted
  || prefabModules + moduleCargoOnTrains + townModules >= 4
)
```

Automatic town consumption is out of scope, so every produced module remains
in exactly one of Prefab inventory, train cargo, or Town inventory. The formula
never adds flow counters to current stock and therefore cannot double-count a
module. When the last steel batch completes a profitable 60-tonne delivery and
the sixth assembly tick also completes, the steel and assembly steps may become
complete together in the same committed operations transaction. The final
delivery latch is the durable objective-completion authority.

Malformed schema-10 progress, train cargo, boundary facilities, or generated
economy data fail closed without partial mutation.

## Generated Map Contract

Generation keeps the earlier railway as a single deliberate regional spine:

`Port — Quarry — Cement Works — Prefabrication — Sawmill — Forest — Town`

The order may be mirrored, but Port and Town always extend opposite open ends
of the already guaranteed Forest–Prefab–Quarry construction.

A pure `RegionalConstructionOpportunity` analyzer:

1. replays the selected starter corridor;
2. replays the Sawmill-to-Prefab extension;
3. replays both cement-supply legs;
4. derives the open Forest and Quarry endpoint positions and outward vectors;
5. assigns Port to the Quarry-side open endpoint and Town to the Forest-side
   open endpoint;
6. analyzes the Port extension with the production construction
   analyzer and one endpoint connection;
7. protects the entire existing spine plus the Port extension;
8. analyzes the Town extension and its endpoint connection;
9. rejects crossings, overlaps, invalid grades, invalid structures,
   clearance failures, and segments beyond production limits;
10. requires combined regional extension cost no greater than £60,000;
11. measures both complete freight paths with the canonical construction curve
    sampler and applies the profitability witness below;
12. returns a detached, immutable, non-persisted witness.

The player may build a different legal solution. The witness proves
possibility only.

World economy placement selects Port and Town only after a cement pair is
valid. It ranks Port candidates from the Quarry end and Town candidates from
the Forest end by geometric lower-bound cost and performs at most 32 full
regional-pair analyses per economy evaluation. It reuses the
construction-analysis cache and rejects the economy candidate if no regional
witness exists.

Generated profitability uses an achievable reference operating plan, not a
promise that every driving style earns money:

```ts
referenceActiveTicks =
  Math.ceil(sampledFreightPathLength / 20) + 60;
```

Twenty world units per second is below the safe 24–54 range already exercised
by real keyboard playtests. Sixty ticks cover acceleration, braking, and
reversal. At the minimum legal gross values and £20 active-tick cost:

- Port-to-Prefab steel requires `referenceActiveTicks <= 1_599`;
- Prefab-to-Town modules requires `referenceActiveTicks <= 1_060`.

The witness rejects a generated economy that exceeds either bound. A player
can still make a loss by driving inefficiently; the contract proves a safe
profitable run exists. The 284-seed audit independently recomputes sampled
lengths, reference ticks, minimum gross, running cost, and positive margin.

Generated-economy validation independently replays the regional analyzer.
Diagnostics expose regional analyses and witness cost. The exact 284-seed
browser audit must resolve every seed deterministically, with no exhausted
seed, and preserve the strict two-second per-world production-browser budget.
No test may weaken that budget or replace production analysis with a cheaper
surrogate.

Worlds still start with zero player tracks, junctions, stations, trains, or
services.

## UI and Interaction

`FreightObjective` adds a fourth objective ID and the five ordered steps.
Exactly one incomplete step is current. Achieved steps never regress after
save/reload.

`ConstructionGuidance` adds:

- `steel` phase: **Extend the Quarry end to Port Interchange**;
- `modules` phase: **Extend the Forest end to Town Construction Market**;
- achieved phase: **Regional construction supplied · Network ready to
  automate**.

Guidance reserves one General Flatbed purchase only if the world somehow has
none, plus the existing £20,000 operating reserve. It never reserves a train
the player already owns. The copy identifies the guaranteed affordable
solution while leaving the player free to build any other legal connection.

The vehicle panel lists Steel and Building Modules on General Flatbed Set and
shows `60 t Steel` and `4 modules` capacity without adding another card.

Facility and train inspectors remain scrollable, input-safe, and mutually
exclusive on desktop, portrait mobile, and landscape mobile. The Town quote
uses `/ module`; full-load copy uses `4 modules`; the train inspector uses
product-specific units. Transfer progress uses the real transfer target:
module loading/unloading renders `Batch 4 / 4 modules`, never `4 / 10`.

The objective celebration fires once per world and objective in the current
page session. Save/reload or scene recreation cannot replay it.

## Error Handling

- Port with no steel reports depleted imported stock rather than a generic
  source-empty mystery.
- Town with no capacity reports its module storage is full.
- A flatbed carrying one product cannot silently switch products mid-load.
- A failed batch, ledger post, progress validation, or operations transaction
  leaves company, inventory, cargo, progress, and revisions unchanged.
- Construction previews retain their exact cost, structure, grade,
  affordability, topology, and reserve explanations.
- Generated worlds that cannot satisfy all prior and regional construction
  witnesses are rejected within explicit bounds.

## Testing and Acceptance

### Unit and integration

- Flatbed content validation proves all four compatible products and exact
  capacities: 60 logs, 60 timber, 60 steel, 4 modules.
- Boundary cargo-rule tests prove Port loading and Town acceptance while
  unrelated recipe-less facilities remain ineligible.
- Cargo tests prove complete/partial steel and module transfers, wrong
  destinations, losses, atomic rollback, and both progress latches.
- Schema, clone, persistence, operations-batch, and presentation tests cover
  every schema-10 field and product-specific unit.
- A complete integration journey constructs through public commands, reuses a
  real flatbed, unloads 60 steel across six ticks while the six recipe ticks
  overlap, proves the final steel batch and first four-module output commit
  together, moves four modules, saves/reloads between phases, and reconciles
  all products and every cash mutation.
- Regional analyzer/generator tests prove the Port/Quarry and Town/Forest
  assignments, clearance, topology charges, the £60,000 boundary, both
  profitability bounds, the 32-analysis cap, deterministic replay, and
  fail-closed invalid data.

### Browser

At least one fixed-seed primary journey must use:

- a newly generated blank world;
- real pointer construction at both outer endpoints;
- the public train flow and real keyboard driving;
- authoritative economy ticks for steel unloading and module assembly;
- real save/reload;
- visible objective, facility, market-factor, unit, revenue, cost, and profit
  feedback;
- a profitable full steel delivery and profitable full four-module delivery.

A second journey proves a loss is explained and does not latch progress. A
mobile journey proves Port/Town inspection, objective, construction, cargo,
and controls remain reachable and input-safe.

No browser test may inject track, cash, inventory, cargo, recipe progress,
profit, or objective latches. Named test-only time advancement may advance the
same public fixed-tick authority without mutating its result.

### Performance and regression

- The exact 284-seed production-browser audit remains under 2,000 ms per world.
- Construction drag remains p95 no greater than 16 ms for 500 proposals.
- The economy benchmark grows to 16 trains across logs, timber, limestone,
  cement, steel, and modules; 500 measured ticks remain p95 no greater than
  16 ms with a stable deterministic 600-tick hash.
- Production webpack exposes no privileged mutation surface.
- TypeScript, production build, test-control build, full Jest coverage, and
  the complete one-worker Playwright suite pass before publication.

## YAGNI Deferrals

Milestone 2E does not add:

- scenarios or premade worlds;
- a new train, wagon, consist editor, cargo picker, service, schedule, signal,
  route finder, or automatic driving;
- continuous port imports, wholesale acquisition, port handling charges,
  exports, town consumption, visual town growth, or global shocks;
- contracts, deadlines, ratings, loans, tax, depreciation, maintenance, or
  reliability;
- generic industry graphs, public modding, facility construction, expansion,
  closure, or relocation;
- migration code for nonexistent user saves.

The next slice may add dynamic port trade and repeatable construction demand
only after this finite imported-steel/module loop is proven fun, honest, and
stable. Milestone 3 then adds services and automation when the complete
regional chain makes manual operation meaningfully burdensome.

## Publication

After independent generation, economy, architecture, and UX review:

1. run the complete acceptance matrix;
2. commit the evidence record;
3. rerun the complete gate set at the exact evidence commit;
4. push that exact source state to the existing private Sites project;
5. save and privately deploy the version;
6. open the production URL and smoke-test menu, blank-world creation, the four
   flatbed products, objective progression, units, and absence of privileged
   globals.
