# Milestone 2D Cement Supply Chain Design

## Goal

Turn the generated Quarry, Cement Works, and Prefabrication Plant into the
second complete player-built industrial chain:

1. build Quarry → Cement Works;
2. buy and operate a 120-tonne aggregate hopper train;
3. deliver one full profitable limestone consignment;
4. process exactly 120 tonnes of limestone into 80 tonnes of cement;
5. build Cement Works → Prefabrication Plant;
6. buy and operate an 80-tonne covered cement train;
7. deliver one full profitable cement consignment.

The completed state is `Cement secured · Prefabrication awaits steel`.
Steel, port trade, module delivery, services, signals, schedules, consists,
contracts, loans, and scenarios remain later work.

## Player Experience

Milestone 2D starts only after the structural-timber link is profitable. The
world is still a blank generated sandbox: generation places industries and
proves possible routes, but creates no player track, junction, train, station,
service, or solved connection.

The objective card advances through one coherent `Cement supply chain`
objective:

1. Connect Quarry to Cement Works.
2. Buy an Aggregate Hopper Set.
3. Deliver 120 t limestone profitably.
4. Produce 80 t cement.
5. Connect Cement Works to Prefabrication Plant.
6. Buy a Covered Cement Set.
7. Deliver 80 t cement profitably.

The vehicle panel exposes three deliberate choices:

- General Flatbed Set: logs and structural timber;
- Aggregate Hopper Set: limestone aggregate only;
- Covered Cement Set: cement only.

Selecting a set starts its own placement policy. The placement preview names
the required source and destination, verifies that the selected track belongs
to the connected route, faces the new train toward its first destination, and
never reuses a quote from a different set.

Facility inspection makes processing understandable: it shows the active
recipe, `Working n / 4 ticks`, required inputs, output stock, and the current
receiving quote. Delivery feedback always names product, destination, revenue,
and trip profit. Unprofitable trips still earn their correct market revenue but
render as a loss and do not advance a profitable-delivery step.

## Economy and Balance

Existing content remains authoritative:

- Quarry extracts 10 t limestone every 4 economy ticks.
- Cement Works consumes 12 t limestone and produces 8 t cement every 4 ticks.
- Limestone base price remains £45/t.
- Cement base price remains £130/t.
- Every unload remains a 10-unit batch priced from the destination's
  pre-batch inventory and current market state.

New rolling stock:

| Set | Cargo class | Payload | Price | Active cost |
| --- | --- | ---: | ---: | ---: |
| Aggregate Hopper Set | bulk | 120,000 kg / 75,000 L | £110,000 | £20/tick |
| Covered Cement Set | covered | 80,000 kg / 64,000 L | £105,000 | £22/tick |

Those payloads derive exactly 120 limestone units and 80 cement units from the
existing product mass and volume definitions. One full limestone trip feeds
ten kiln cycles, producing exactly one full cement train.

No second development grant is added. Instead, new-world capital is bounded:

- starter corridor: at most £400,000;
- optional two General Flatbed Sets: £180,000;
- existing regional grant: £250,000;
- Sawmill → Prefab extension: at most £194,000;
- combined mineral links: at most £180,000;
- aggregate and cement trains: £215,000.

From £1,000,000 this conservative path leaves £81,000 before positive
operating margins. The cap is a generation rule, not a scenario subsidy.

At the legally lowest market quote, the 120-tonne limestone trip grosses at
least £4,200. Generated/playtested mineral routes must keep its active movement
at or below 180 charged ticks, leaving positive trip profit at £20/tick.
The 80-tonne cement trip has a much larger price margin but must also be proven
profitable on accepted seeds.

## Authority and Persistence

Schema 9 is a clean break. There is no migration because the user confirmed
there is no existing player data to preserve.

`FreightProgressDef` remains inside the root operations transaction and adds:

```ts
profitableLimestoneDeliveryCompleted: boolean;
profitableCementDeliveryCompleted: boolean;
```

The limestone latch changes only when a complete 120-unit consignment:

- was loaded by an Aggregate Hopper Set;
- is limestone aggregate;
- unloads completely at Cement Works;
- has positive trip operating profit.

The cement latch uses the equivalent conditions for an 80-unit Covered Cement
Set unloading cement at Prefabrication Plant.

Partial loads, wrong destinations, incompatible stock, and zero/negative trip
profit never latch progress. Latches, inventories, cargo, trip statistics,
cash, and ledger entries commit or reject together through the existing
`applyOperationsBatch` boundary.

Production progress is derived from authoritative stock and recent flow. Before
steel reaches Prefab, cement cannot be consumed by module assembly, so the
total cement held by Cement Works, trains, and Prefab is an honest durable
production fact. The final delivery latch remains the permanent completion
authority.

## Generated Map Contract

Generation must prove construction without constructing anything.

A new pure `CementSupplyOpportunity` analysis validates the planned order:

1. Quarry → Cement Works;
2. Cement Works → Prefabrication Plant.

It uses the same construction analyzer, canonical grid, terrain profile,
grade, structures, topology charges, endpoint outward vectors, and clearance
rules used by player construction. The two proposals may meet only at the
declared Cement Works endpoint and must remain clear of the selected starter
corridor and the guaranteed Sawmill → Prefab extension.

World economy placement becomes deterministic and bounded:

- place Prefab using the existing extension guarantee;
- choose Cement Works and Quarry as a feasible pair;
- require combined mineral construction cost ≤ £180,000;
- place port and town only after the chain pair is fixed;
- replay the same analysis during generated-economy validation.

The 284-seed audit remains exact, deterministic, and under the two-second
browser budget. Any cap adjustment must be justified by a permanent failing
seed and measured worst-case result; it must not be replaced with extra cash or
inflated prices.

## Construction and Purchase Guidance

Construction guidance is derived from freight progress and owned rolling
stock:

- before first log profit: connect Forest → Sawmill and retain £110,000;
- before structural timber profit: connect Sawmill → Prefab and retain the
  operating reserve;
- before limestone profit: connect Quarry → Cement Works and retain the prices
  of unowned aggregate/covered sets plus the operating reserve;
- before cement profit: connect Cement Works → Prefab and retain the price of
  any unowned covered set plus the operating reserve.

The warning is advisory, never a sandbox lock. It replaces the current
permanent Forest/timber sentence and always reports the current cash-after
build.

Purchase routing is explicit content, not inferred from cargo compatibility:

```text
flatbed-freight-set: managed-forest → sawmill
aggregate-hopper-set: quarry → cement-works
covered-cement-set: cement-works → prefabrication-plant
```

Unknown set IDs fail closed. Route policies do not create a generic rolling
stock marketplace.

## Failure Handling

- A set switch clears the prior quote and confirmation state.
- A quote is bound to set, source, destination, track, topology, and root
  revision.
- Forged, stale, consumed, or cross-set quotes reject without spawning or
  charging.
- Live spawn/place failure compensates exactly as in Milestone 2C.
- Save failure leaves the committed world authoritative, reports `Unsaved`,
  and retries without duplicating cargo, revenue, progress, or capex.
- Generation exhaustion leaves no partial world.
- Production builds expose no browser test authority.

## YAGNI Boundary

Milestone 2D deliberately does not add:

- prebuilt routes, scenarios, contracts, deadlines, or cash rewards;
- cargo pickers, mixed loads, train consists, wagon editing, or automatic
  routing;
- stations, timetables, services, signals, pathfinding, or dispatching;
- fuel, maintenance, depreciation, loans, taxes, bankruptcy, or resale;
- port imports, global trade, steel hauling, module delivery, or town growth;
- a generic industry graph, contract marketplace, or mission engine.

Each of those remains possible after the cement chain proves the existing
atomic freight model with multiple cargo classes and parallel trains.

## Acceptance

Milestone 2D is accepted only when:

- every generated world remains blank of player infrastructure;
- starter construction is ≤ £400,000 and the two mineral links are jointly
  terrain-valid and ≤ £180,000 across the audited seeds;
- the three immutable freight sets have exact cargo-class compatibility,
  capacities, prices, and running costs;
- set-specific purchase placement is connected, correctly faced, atomic, and
  input-safe on desktop and mobile;
- one full profitable 120 t limestone trip and forty kiln ticks produce exactly
  80 t cement without quantity or cash drift;
- one full profitable 80 t cement trip reaches Prefab;
- objective, construction, purchase, facility, train, delivery, and P&L UI all
  explain the current state and loss cases;
- schema 9 persistence survives loading, transit, processing, unloading,
  derail/re-rail, achievement, and save retry;
- mixed flatbed/bulk/covered economy ticks retain deterministic p95 < 16 ms;
- full Jest, no-retry Playwright, generation/construction benchmarks, build,
  production-control, independent-review, and exact Sites deployment gates
  pass.

