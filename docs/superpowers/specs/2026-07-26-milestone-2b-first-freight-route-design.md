# Milestone 2B: First Profitable Freight Route

**Status:** Approved under the standing instruction to proceed with the full
game goal.

**Date:** 2026-07-26

## Purpose

Milestone 2B turns the generated construction sandbox into the first complete
railway-management loop:

1. choose and build an affordable terrain-aware forest-to-sawmill route;
2. buy one preconfigured timber freight train;
3. load logs at the Managed Forest;
4. drive the train manually to the Sawmill;
5. unload for delivery revenue while paying operating costs;
6. see whether the route is operating-profitably;
7. repeat the cycle and preserve it through save/reload.

The world remains a blank generated sandbox. It creates no player track, train,
station, service, solved route, scenario, or contract.

## Player Experience

### First-route objective

A compact, non-scenario objective card guides the first organic freight route:

1. **Connect the route** — connect Managed Forest and Sawmill rail access.
2. **Buy the train** — purchase and place a Timber Freight Set inside Managed
   Forest rail access.
3. **Load logs** — stop until the train reaches 60/60 tonnes.
4. **Deliver logs** — stop inside Sawmill rail access and deliver cargo.
5. **Run profitably** — complete a delivery whose revenue exceeds the running
   cost accumulated since the previous delivery.

The card derives intermediate steps from persisted railway/economy state. A
root `FirstRouteProgressDef` owns the world-level
`profitableDeliveryCompleted` latch so completion survives later demolition or
train deletion. It is not a scenario, does not prebuild anything, gives no cash
reward, and never blocks sandbox play. Completion produces one celebration per
runtime session and remains visible as achieved.

### Build phase

The existing direct-versus-detour opportunity remains the central construction
decision. Its prompt adds:

> Connect Managed Forest to Sawmill. Keep £110,000 for a timber train and
> operating reserve.

Generated worlds must guarantee that the cheapest valid starter corridor plus
£90,000 train purchase plus £20,000 reserve fits within the £1,000,000 starting
cash. The sandbox may still let the player overspend; the construction
inspector warns when a confirmed build would breach the reserve.

Once track endpoints reach both facility access rings and the live track graph
contains a path between them, the map and objective card communicate that the
route is ready for a train. Two disconnected endpoint stubs never count as a
connected route.

### Train purchase

Milestone 2B exposes exactly one freight-set SKU. The player may buy multiple
instances when cash and valid placement allow it:

| Field | Value |
| --- | --- |
| ID | `timber-freight-set` |
| Display name | Timber Freight Set |
| Purchase price | £90,000 |
| Payload mass | 60,000 kg |
| Payload volume | 96,000 litres |
| Compatible products | `logs` |
| Running cost | £20 per active fixed tick |

Product capacity is derived from the product catalogue:

```text
min(
  floor(payloadMassKg / product.unitMassKg),
  floor(payloadVolumeLitres / product.unitVolumeLitres)
)
```

For logs this is exactly 60 units, displayed as 60 tonnes.

The vehicle panel shows the price, capacity, compatible cargo, running rate,
cash after purchase, and affordability. Placement is valid only on player track
inside Managed Forest rail access. The purchase confirmation creates the live
train, persisted definition, and `vehicle-capex` ledger entry atomically. A
failed purchase leaves no live or persisted train and reports the exact cause.

One purchased set is one logical train and one physics follower. Its visual
container may depict a locomotive and fixed timber wagons, but Milestone 2B
does not create separately simulated or persisted carriages.

### Operate phase

The selected-train inspector shows:

- Timber Freight Set name;
- throttle/direction and stopped/moving/derailed state;
- cargo, such as `Logs 40 / 60 t`;
- nearest eligible facility;
- transfer state and exact blocker;
- loading or unloading batch progress;
- revenue, running cost, and operating profit for the current trip;
- the completed previous delivery's revenue, running cost, and profit;
- lifetime delivered tonnes, revenue, running cost, and operating profit.

W/S remains the manual forward/reverse control. Automatic transfer occurs only
on the existing one-second fixed economy tick when the train:

- is in Operate mode;
- is on track and not derailed;
- has zero throttle;
- is moving at no more than 2 world units per second;
- has its centre inside a facility's persisted rail-access radius.

The stopped-speed boundary is inclusive: exactly 2 counts as stopped and any
higher speed does not. The system first finds physical access rings containing
the train, then filters for facilities eligible for the requested load or
unload. The nearest eligible facility wins; facility ID breaks a distance tie.
If no contained facility is eligible, the nearest contained physical facility
supplies the exact cargo blocker. If no ring contains the train, the nearest
relevant source or destination supplies the “move inside” remedy.

At Managed Forest a train that is empty or already carrying logs, and remains
below capacity, loads up to 10 available, unreserved log units per tick. At
Sawmill a train carrying logs unloads up to 10 units per tick or the available
destination capacity, whichever is smaller. Movement interrupts future batches
without reverting completed ones.

Loading conserves goods from forest inventory to train cargo. Unloading
conserves goods from train cargo to sawmill inventory and posts revenue for only
the accepted quantity. The destination's pre-batch local log quote determines
each batch's unit delivery payment, so a six-batch unload responds to rising
Sawmill inventory pressure instead of locking one quote for the whole delivery.
There is no commodity purchase charge at the forest: the company is paid for
haulage by the receiving industry.

The Sawmill visibly transitions from `Needs logs` to working once its recipe
can run.

### Operating costs and profitability

Each purchased set has a £20 running cost for a fixed tick in which it is
powered or moving. A stopped, zero-throttle train costs nothing. A derailed
train costs nothing until recovered.

All active-train costs in one fixed tick are summed into one
`train-running-cost` ledger entry, keeping ledger growth bounded when later
milestones add many trains. Each active train receives exactly its own set's
integer cost in persisted trip/lifetime statistics; no division or remainder
allocation is needed.

If cash cannot cover the tick's running cost, every affected train is stopped,
no unpaid cost is posted, and the inspector explains the cash blocker.

The company HUD adds a compact last-24-tick operating summary. At economy tick
`t`, the inclusive window is `max(0, t - 23)` through `t`. Presentation refresh
occurs after the complete current-tick operations batch, so same-tick entries
are included:

- delivery revenue;
- running expenses;
- operating profit;
- capital expenditure;
- cash flow.

Vehicle and track purchases are capital expenditure. They affect cash flow but
not operating profit. The first-route objective uses delivery revenue minus
running cost since the prior delivery, not cash flow, so construction spending
does not make an otherwise profitable service appear operationally unprofitable.

At the validated local-quote bounds, batch-by-batch repricing makes a full
60-tonne load gross roughly £5,290–£7,930 before concurrent Sawmill processing.
Fixed-seed playtests must tune speed and running cost so every valid starter
route has positive operating margin and the first delivery takes roughly two
to four minutes after purchase.

## Architecture

### Aggregate freight set

`FreightSetCatalog` is immutable validated content. A definition contains:

```ts
interface FreightSetDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly compatibleProductIds: readonly string[];
  readonly payloadMassKg: number;
  readonly payloadVolumeLitres: number;
  readonly purchasePrice: number;
  readonly runningCostPerActiveTick: number;
}
```

`capacityForProduct(set, product)` returns an integer capacity or a typed
incompatibility result. Capacity is never persisted.

### Schema 7 clean break

There is no migration or compatibility path because there is no existing player
data. Schema 7 rejects schema 6 saves with the existing “Start a new world”
action.

`TrainDef` becomes freight-authoritative:

```ts
interface TrainCargoDef {
  productId: string;
  units: number;
  originFacilityId: string;
}

interface TrainOperationsDef {
  currentTripRevenue: number;
  currentTripRunningCost: number;
  lastTripRevenue: number;
  lastTripRunningCost: number;
  lifetimeDeliveredUnits: number;
  lifetimeRevenue: number;
  lifetimeRunningCost: number;
}

interface TrainDef {
  id: string;
  freightSetId: string;
  trackUUID: string;
  trackT: number;
  facing: 1 | -1;
  cargo: TrainCargoDef | null;
  operations: TrainOperationsDef;
}

interface FirstRouteProgressDef {
  objectiveVersion: 1;
  profitableDeliveryCompleted: boolean;
}
```

`WorldData.firstRouteProgress` stores this object beside `economy` and
`trains`. Schema validation requires the exact version and a boolean latch.

Reload places every train on its referenced track at `trackT`, facing the
persisted direction, stopped. Derailed position/velocity persistence is
deliberately deferred; existing free re-rail remains the recovery path.

World schema validation requires:

- schema version 7 and no legacy `type` or `passengers`;
- unique non-empty train IDs;
- known freight-set IDs;
- referenced track, product, and origin facility IDs;
- finite `trackT` in `[0, 1]`;
- cargo units as positive safe integers within derived capacity;
- compatible cargo product;
- all operation totals as non-negative safe integers;
- lifetime totals greater than or equal to every current/last trip total;
- cargo `null` when there are no carried units.

The current trip begins immediately after a complete unload. Empty-return and
loaded-outbound running costs therefore belong to the next delivery. When the
last onboard unit unloads at Sawmill, the system adds the final revenue batch,
copies current trip totals into the last-trip fields, sets
`FirstRouteProgressDef.profitableDeliveryCompleted` if revenue exceeded cost,
and resets the current trip fields to zero for the following cycle.

`economyRevision` becomes `operationsRevision`. The invariant remains:

```text
revision = constructionRevision + operationsRevision
```

Construction batches increment construction revision. Purchases, transfers,
running costs, industry ticks, train statistics, and their company effects
increment operations revision.

### One authoritative operations batch

`WorldManager.applyOperationsBatch(expectedRevision, mutate)` clones company,
economy, trains, and first-route progress, applies a pure mutation, validates
the complete candidate, increments root/operations revisions once, and installs
all four domains together. Rejection leaves every domain and revision
unchanged.

This boundary is used for:

- freight-set purchase;
- each fixed-tick load/unload batch;
- delivery revenue;
- aggregated running costs;
- industry and market ticks;
- objective/statistic updates coupled to those events.

The persisted `WorldData.trains` array owns freight set, cargo, and financial
statistics. Live `Train` objects own physics and presentation only.
`TrainSerializer` merges runtime location/facing into an existing authoritative
definition and must never reconstruct or overwrite cargo/economics.

`RailAccessConnectivity` is a pure track-graph query. It identifies track
endpoints within each facility access ring and proves that at least one endpoint
pair belongs to the same connected component. Route-ready presentation,
objective progress, and valid train placement consume the same result.

### Cargo orchestration

A pure `CargoSystem` consumes:

- authoritative train/facility/company state;
- immutable catalogues and local quote functions;
- runtime train snapshots containing position, speed, throttle, derailment,
  and track identity.

It returns one immutable proposed operations result per fixed tick. It never
touches Phaser objects, localStorage, or the EventBus.

`EconomySystem` remains the one-second fixed-step orchestrator. Within each tick:

1. resolve stopped-train transfers in stable train-ID order;
2. calculate and post one aggregate running-cost entry;
3. advance facility recipes and boundary production;
4. drift the market;
5. install one atomic operations batch;
6. refresh map, train, facility, objective, and company presentation.

A train performs at most one load or unload batch per fixed tick.
Catch-up may commit up to the existing four fixed ticks in order. The scene
requests one save of the final authoritative catch-up state, not one
localStorage write per individual tick.
If localStorage persistence fails after an in-memory batch commits, the live
world and train remain authoritative, the HUD reports `Unsaved`, and the exact
state retries through the existing save path. A persistence failure never
silently reverses or duplicates an economic transaction.

## UI and Interaction

### Build mode

- Existing construction inspector retains exact terrain/cost detail.
- Cash-after-build below £110,000 produces an amber reserve warning, not a hard
  rejection.
- The vehicle panel contains one polished Timber Freight Set purchase card.
- Valid placement highlights player track inside Managed Forest access.
- Invalid placement gives one exact remedy: no track, outside access,
  disconnected route, insufficient cash, or duplicate purchase gesture.

### Operate mode

- Facility and train selection remain mutually exclusive.
- The train inspector replaces legacy passenger controls.
- Transfer progress uses textual quantities and a progress bar; colour is not
  the sole state cue.
- Mobile 375×667 keeps HUD, objective card, and inspector within the viewport.
- Keyboard input is ignored when focus is within any inspector/control.
- A full delivery produces a visible cash pulse and concise toast without
  interrupting driving.

### Exact blocker copy

- `Stop the train to transfer cargo`
- `Move inside Managed Forest rail access`
- `Move inside Sawmill rail access`
- `Waiting for logs`
- `Timber set is full`
- `Sawmill input storage is full`
- `Cargo is not accepted here`
- `Insufficient cash for running costs`
- `Re-rail the train before operating`

## Failure and Recovery

- **Stale purchase/operations revision:** reject with no live or world mutation,
  refresh the quote, and ask the player to retry.
- **Live spawn failure:** leave cash/world untouched.
- **World batch rejection:** remove the provisional spawned train and leave
  cash/world/revisions untouched.
- **Save failure after commit:** retain the purchased live/world train and
  ledger entry, report `Unsaved`, and retry the same authoritative state
  without reposting the purchase.
- **Partial destination capacity:** unload only accepted units, pay only for
  them, and retain the remainder onboard.
- **Source exhaustion:** retain completed loaded units and wait for production.
- **Movement during transfer:** completed batches remain; future batches stop.
- **Derailment:** cargo is retained; existing free recovery returns the stopped
  aggregate train to track.
- **Running-cost insolvency:** stop the train before an unpaid tick and explain
  the blocker. Resale, loans, and paid rescue are deferred.
- **Save/reload:** preserve exact cargo, trip/lifetime totals, economy tick,
  cash, ledger, facilities, and authoritative train location.

## Testing and Acceptance

### Unit and integration

- catalogue validation and exact log capacity;
- schema 7 strictness, cross-references, unique IDs, and legacy rejection;
- authoritative definition → live train → merged definition round-trip;
- atomic purchase success, insufficient cash, stale revision, duplicate ID,
  live failure, install failure, and save retry;
- stopped/radius/mode/derailment/throttle guards;
- deterministic overlapping-access choice;
- 10-unit partial load/unload, full source/destination, reserved inventory,
  incompatible cargo, and capacity clamps;
- goods conservation across facility → train → facility;
- exact delivery quote, revenue, aggregate cost, cash, ledger, and P&L;
- running-cost insolvency rollback;
- at-most-one transfer per train per tick;
- save/reload mid-load, in transit, mid-unload, after delivery, and after
  recovery;
- construction regression and revision/undo history invalidation.

### Browser acceptance

Across at least three generated seeds, deterministic browser cases collectively
prove:

- zero initial player railway assets;
- cheapest corridor + set + £20,000 reserve affordability;
- route construction to both access rings;
- atomic £90,000 purchase and placement;
- automatic 60-tonne loading while stopped;
- no transfer while moving or outside access;
- manual forest-to-sawmill trip;
- exact partial/final unload payments;
- sawmill starts processing delivered logs;
- positive first-delivery operating margin;
- three repeatable cycles using controlled fixed-tick advancement;
- exact save/reload at multiple route phases;
- derail/re-rail with cargo retained;
- desktop and 375×667 input-safe layouts.

One desktop seed additionally performs a real-time first trip with actual
keyboard throttle and physics, using a timeout sized for the validated
two-to-four-minute target. The remaining seeds use controlled fixed-tick and
runtime-position harnesses to cover economics, repetition, persistence, and
mobile behavior without multiplying the real-time wait. A manual generated
playtest repeats the real-time trip on at least three seeds before publication.

The complete unit/integration, no-retry Playwright, construction/world-generation
performance, production build, hygiene, independent review, and exact Sites
publication gates remain mandatory.

## Explicit YAGNI Deferrals

Milestone 2B does not add:

- scenarios or prebuilt worlds;
- contracts, deadlines, bonuses, or cargo purchasing;
- stations, services, schedules, or automatic routing;
- physical couplers, consist editing, or separately simulated wagons;
- multiple freight sets or locomotive choice;
- cargo classes beyond the explicit compatibility list;
- signals, pathfinding, maintenance, fuel, or paid recovery;
- resale, loans, taxes, depreciation, or bankruptcy;
- facility/town growth or global economic shocks;
- parallel aggregate/cement/steel/module player flows.

Those remain later milestones. Milestone 2B succeeds when the one timber route
is clear, tactile, repeatable, profitable, and durable.
