# Milestone 2C: Structural Timber Link

**Status:** Approved under the standing instruction to proceed with the full
game goal.

**Date:** 2026-07-27

## Purpose

Milestone 2C extends the first profitable freight route into the first genuine
processing chain:

1. haul logs from the Managed Forest to the Sawmill;
2. let the Sawmill process logs into structural timber;
3. build a generated, terrain-feasible extension to the Prefabrication Plant;
4. use the same flatbed train to load structural timber;
5. deliver the processed material profitably to the Prefabrication Plant;
6. preserve the railway, cargo, finances, and objective through save/reload.

This is the next playable link in the approved construction economy:

```text
Managed Forest --logs--> Sawmill --structural timber--> Prefabrication Plant
```

The Prefabrication Plant then visibly waits for cement and steel. Those inputs,
port trade, building-module production, and the final town delivery are the
next construction-chain slices. This milestone does not invent a temporary raw
timber consumer that would be removed later.

The generated world remains a blank sandbox. It contains industries and an
affordable opportunity, but creates no player track, train, station, solved
route, schedule, service, signal, or scenario.

## Design Decision

Three approaches were considered:

1. **Recommended: reuse a product-compatible flatbed set and extend to the
   Prefabrication Plant.** This reflects real rolling-stock compatibility,
   exercises the existing generic recipe system, and becomes part of the final
   construction chain.
2. Deliver structural timber to the Town Construction Market. This makes a
   tidy source-to-consumer loop, but contradicts the approved economy in which
   the town consumes finished building modules. It would create throwaway
   content.
3. Add a separate structural-timber train or jump directly to automated
   services. A second timber-only SKU does not represent a distinct wagon
   class, while schedules require routing, reservations, recovery, and
   signalling that belong together in Milestone 3.

Approach 1 is the smallest coherent increment that advances the final game.

## Player Experience

### Objective transition

The existing compact objective card becomes a freight-progression card with
two sequential objectives. It never blocks sandbox play.

The first objective remains:

1. Connect Managed Forest to Sawmill.
2. Buy the flatbed train.
3. Load logs.
4. Deliver logs.
5. Complete a profitable log delivery.

When the profitable log delivery completes:

- the first objective remains durably achieved;
- a one-time **Regional Development Grant** of **£250,000** is posted to the
  company ledger as `contract-bonus`;
- the card celebrates the milestone once per runtime session;
- the card advances to **Extend the timber chain**.

The second objective contains four outcome-oriented steps:

1. **Produce structural timber** — the Sawmill has produced structural timber.
2. **Connect the Prefabrication Plant** — live player track connects Sawmill
   and Prefabrication Plant rail access.
3. **Load structural timber** — a compatible flatbed carries structural
   timber.
4. **Deliver profitably** — a completed structural-timber delivery to the
   Prefabrication Plant earns more than that train's running cost for the trip.

Intermediate steps derive from authoritative world state. Durable completion
and grant latches live in root freight progress so demolition, train deletion,
consumption, or reload cannot regress an achieved objective or duplicate the
grant. Before the second objective is achieved, its derived intermediate steps
may regress if the player removes the connecting track, unloads or deletes the
train, or exhausts Sawmill output. This is intentional feedback about the
current railway, not a hidden per-step mission ledger.

After the second objective completes, the card remains visibly achieved and
the Prefabrication Plant explains that cement and steel are the next missing
inputs. A single celebration reports the product, destination, revenue, and
operating profit.

### Construction challenge

The generated Prefabrication Plant must be:

- on a flat, valid industry footprint;
- separated from every other facility by the existing minimum distance;
- reachable from the Sawmill by at least one valid direct terrain-aware
  construction analysis;
- close enough that the witness track plus the £20,000 operating reserve fits
  inside the £250,000 development grant;
- selected by a deterministic, bounded seeded search.

The witness is a generation acceptance proof, not player infrastructure. It is
not persisted as track, rendered as a solved line, or forced on the player.
The player may choose any valid geometry and may overspend, but the objective
copy makes the grant's purpose clear.

The exact generated affordability requirement is:

```text
extension witness construction total
  + £36,000 Sawmill access-link allowance
  + £20,000 operating reserve
  <= £250,000 development grant
```

The witness construction total includes its track, earthworks, bridge, tunnel,
and endpoint topology costs. It runs from the Sawmill rail-access centre to the
Prefabrication Plant rail-access centre. The access-link allowance bounds a
320-unit connection from an arbitrary first-route endpoint already accepted
inside the Sawmill access ring at the maximum base-plus-tunnel unit rate. This
proves one affordable connected build plan; it does not claim that every
player-chosen alignment is affordable.

The other secondary industries remain generated blank-world destinations.
Their full dependency-aware placement is added only as each link becomes
playable.

### Train and cargo

Schema 8 exposes one currently purchasable set:

| Field | Value |
| --- | --- |
| ID | `flatbed-freight-set` |
| Display name | General Flatbed Set |
| Purchase price | £90,000 |
| Payload mass | 60,000 kg |
| Payload volume | 96,000 litres |
| Compatible products | `logs`, `structural-timber` |
| Running cost | £20 per active fixed tick |

Both current products are 1,000 kg per unit, so the set holds 60 units of
either. Capacity continues to be computed from catalogue mass and volume,
rather than hard-coded in cargo logic or UI.

Existing worlds and IDs do not require migration: there is no user data.
Schema 7 is rejected with the existing “Start a new world” action.

The purchase workflow remains one preconfigured set. A new wagon catalogue,
consist editor, cargo selector, and additional purchase card are unnecessary
for this link. The existing train can complete both legs.

### Automatic transfer rules

Transfer still occurs once per one-second fixed economy tick only while the
train is in Operate mode, stopped, re-railed, and inside a facility's
rail-access radius.

Cargo eligibility becomes catalogue-driven:

- an empty compatible train may load a product that is an output of the
  facility's active recipe and is available above reservations;
- a loaded train may unload where its product is an input of the destination's
  active recipe and `capacity - quantity` is positive;
- the current freight set must be compatible with the product;
- one train carries one homogeneous product from one loading origin;
- trains are processed by train ID and contained facilities by distance then
  facility ID;
- within one loading facility, active-recipe output order is authoritative,
  with product ID only as a defensive fallback for duplicate ordering data;
- at most one transfer batch occurs for a train on a tick;
- inventory, cargo, cash, ledger, train statistics, grant, and progression
  commit in the existing single operations transaction.

The current pay-on-delivery rule remains: both raw and processed material
deliveries earn the destination's pre-transfer local quote. This is deliberately
simple and visible. Input acquisition costs, internal transfer pricing, and
contract-specific pricing are deferred until the full P&L/contract slice.

The first-route latch is tightened so only a profitable completed logs delivery
to the Sawmill achieves it. The second latch requires a profitable completed
structural-timber delivery to the Prefabrication Plant.

### Feedback and inspectors

Cargo status becomes product/facility-aware rather than embedding Forest,
Sawmill, logs, or “60 tonnes” in the simulation layer. The simulation emits a
stable blocker code plus the relevant product and facility IDs. Presentation
resolves catalogue display names and unit labels.

The blocker codes, in precedence order, are:

1. `not-operating`;
2. `derailed`;
3. `train-moving`;
4. `unknown-freight-set`;
5. `incompatible-product`;
6. `outside-eligible-facility`;
7. `source-empty`;
8. `train-full`;
9. `destination-full`;
10. `product-not-accepted`;
11. `insufficient-running-cash`.

`idle` is a transfer state, not a blocker. A status includes the chosen
`productId` and `facilityId` when known, so presentation never parses text to
recover domain data.

The selected-train inspector shows:

- the General Flatbed Set;
- `Logs`, `Structural timber`, or `Empty`;
- capacity in the product's actual unit;
- the nearest eligible source or destination;
- an exact loading, unloading, storage, compatibility, movement, derailment,
  or cash blocker;
- current-trip, last-delivery, and lifetime revenue, running cost, and
  operating profit.

The company HUD labels its existing rolling summary **Last 24 ticks**. Stable
selectors expose current-trip, last-delivery, and lifetime train profit. A full
accounts screen is not needed for this milestone.

The rolling company summary separates:

- delivery revenue;
- contract/development bonuses;
- train running expenses;
- **railway operating profit = delivery revenue - running expenses**;
- capital expenditure;
- total cash flow, which includes bonuses and capital expenditure.

The £250,000 grant therefore cannot make an unprofitable railway appear
operating-profitable.

The facility inspector already presents generic inventories and recipe status.
It must clearly show:

- Sawmill log input and structural-timber output;
- Prefabrication Plant structural timber received;
- the remaining cement and steel blockers after the timber delivery;
- local product quote context without implying that the global construction
  index is a separate currency.

### Selecting among several trains

This milestone continues to permit multiple purchased trains. When train
selection changes, the previously selected train's throttle is set to neutral
before control transfers. `selectTrain(trainId | null)` remains a synchronous
selection operation with no invented failure result; unknown IDs select
nothing after neutralising the previously controlled train. This prevents an
unseen train from continuing under stale player input.

Safe concurrent movement on a shared component is not implied. The acceptance
journey uses one manually controlled train. Automated routing, junction
decisions, reservations, signals, schedules, and shared-line conflict handling
remain Milestone 3.

## Authoritative Data

The root schema becomes version 8 and deliberately rejects version 7.

```ts
export interface FreightProgressDef {
  readonly progressVersion: 1;
  profitableLogDeliveryCompleted: boolean;
  developmentGrantAwarded: boolean;
  profitableStructuralTimberDeliveryCompleted: boolean;
}

export interface WorldData {
  readonly schemaVersion: 8;
  // ...
  freightProgress: FreightProgressDef;
}
```

`firstRouteProgress` and `FirstRouteProgressDef` are removed rather than
preserving an obsolete parallel authority. Economy data remains version 1
because this slice changes no facility inventory shape or catalogue record.

Grant posting and its latch happen in the same operations batch. The following
invariant must always hold:

```text
developmentGrantAwarded
  iff exactly one forward contract-bonus ledger entry exists with
      referenceId "regional-development-grant:v1"
```

The ledger remains the financial authority; the progress flag is the
idempotency latch.

A completed delivery event adds `productId` and `units` so UI and tests never
infer a product from a train type:

```ts
export interface FreightDeliveryEvent {
  readonly trainId: string;
  readonly productId: ProductId;
  readonly units: number;
  readonly destinationFacilityId: FacilityId;
  readonly tick: number;
  readonly revenue: number;
  readonly runningCost: number;
  readonly operatingProfit: number;
}
```

No catalogue, recipe, quote, cargo status, or generation witness becomes a
second mutable authority.

## Tick Order

The authoritative fixed-tick order remains:

1. increment economy tick;
2. merge current train runtime snapshots;
3. propose cargo transfers, delivery revenue, objective latches, and any
   one-time development grant;
4. post active-train running costs;
5. advance facility recipes in stable facility-ID order;
6. advance the market;
7. commit once through `applyOperationsBatch`;
8. publish presentation events only after successful commit.

This means logs unloaded on a tick may contribute to Sawmill processing on that
same tick, but newly completed structural timber cannot load until a later
tick. Delivery requires throttle zero and speed at or below the stop threshold,
so its transfer tick is not an active-running tick and adds no omitted final
running charge. The ordering and this attribution are frozen in tests.

## Failure Behaviour

- An incompatible product never enters a train.
- A full destination inventory never loses cargo or pays revenue. Existing
  `reservedQuantity` protects source stock from outbound loading; it is not a
  reservation of inbound capacity.
- An empty source never creates cargo.
- An invalid recipe or missing catalogue reference produces a stable blocker,
  not partial mutation.
- A stale operations revision leaves cargo, inventories, company cash, ledger,
  statistics, progress, and runtime unchanged.
- A failed grant post does not set the grant latch.
- The grant cannot post twice after additional deliveries or reload.
- Selecting another train or no train neutralises the previously selected
  train before the selection changes.
- A generation search that cannot place an affordable, valid Prefabrication
  Plant fails with bounded diagnostics; it never silently emits an unwinnable
  world.

## Verification

### Unit and integration

- catalogue validation and 60-unit capacity for both compatible products;
- generic source/output and destination/input cargo rules;
- deterministic selection and one transfer per train per tick;
- incompatible, empty, full, reserved, moving, derailed, and insufficient-cash
  blockers;
- exact conservation across source, train, destination, and recipe batches;
- delivery product/units, quote freshness, cash, ledger, trip, and lifetime
  statistics;
- first and second objective specificity and durable latches;
- exactly-once £250,000 grant posting and reload behaviour;
- rolling P&L that excludes the grant from railway operating profit while
  including it in bonus income and cash flow;
- schema-8 round-trip and deliberate schema-7 rejection;
- same-seed replay, different-seed variation, bounded failure, terrain-valid
  Sawmill-to-Prefabrication Plant witness, and grant affordability;
- stale-revision rollback across every mutated aggregate;
- selection changes neutralise the previous train;
- save/reload during logs loading, log delivery, recipe processing, structural
  timber loading, transit, unloading, and achieved progression.

### Browser acceptance

Across at least three generated seeds, including a 375×667 viewport:

1. create a blank world with no player track or train;
2. build and profitably operate the first log route with real W/S control;
3. observe exactly one development grant and the objective transition;
4. build a player-chosen Sawmill-to-Prefabrication Plant extension;
5. wait for structural timber production;
6. load structural timber into the compatible flatbed;
7. drive and unload it at the Prefabrication Plant;
8. pause at deterministic checkpoints and observe positive trip profit,
   combined company P&L, conserved facility/cargo stocks, and the achieved
   objective;
9. reload and confirm all authoritative state persists;
10. confirm no uncaught errors, viewport overflow, hidden critical controls, or
    privileged test globals in production.

Because recipes continue while the game runs, browser stock assertions use
paused checkpoints and conservation relationships rather than wall-clock
quantities: logs removed equal logs delivered, processed, or carrying;
structural timber produced equals stored, delivered, or carrying; and
Prefabrication Plant inflow equals delivered timber at the checkpoint.

Generation remains below the existing two-second browser benchmark budget.
The fixed-tick economy benchmark uses seven facilities and twelve trains, 100
warm-up updates, then 500 measured one-tick updates; its p95 stays below 16 ms
in the existing Node/Jest performance environment. The production-security gate
builds without `testControls`, runs the existing webpack/test-control guards,
and confirms that the production page exposes none of the privileged browser
harness globals.

## YAGNI Boundary

Milestone 2C does not add:

- town consumption of raw timber;
- quarry, cement, steel, port, or building-module freight activation;
- new wagon classes or a rolling-stock catalogue UI;
- mixed cargo, wagon-level consists, cargo selection, or transfer schedules;
- services, waypoints, routing, reservations, signalling, or shared-line AI;
- contract offers, deadlines, penalties, loans, or a generic mission engine;
- a full accounts screen, per-product cost accounting, or internal transfer
  prices;
- town growth, facility upgrades, alternate recipes, or product expansion;
- save migration;
- scenarios or prebuilt worlds.

The next construction-chain slice adds the real bulk and covered wagon classes
with quarry-to-cement processing. Port steel, prefab assembly, building modules
to town, full P&L, and generated construction contracts then complete Milestone
2 before automated company operations begin.

## Acceptance

Milestone 2C is complete only when:

- a new generated blank world guarantees an affordable terrain-valid
  Sawmill-to-Prefabrication Plant opportunity without prebuilt infrastructure;
- the first profitable log delivery posts exactly one development grant;
- the same flatbed set loads and carries both logs and structural timber;
- Sawmill processing and Prefabrication Plant delivery conserve goods and
  money through the authoritative fixed-tick transaction;
- the compact objective, inspectors, map feedback, and P&L copy remain clear on
  desktop and mobile;
- achievement survives reload and cannot be forged by another product or
  destination;
- focused, full, performance, browser, build, and production-security gates
  pass;
- the exact verified commit is deployed through Sites and smoke-tested.

Rejecting schema 7 is an explicitly accepted destructive compatibility policy:
the user confirmed that the deployed prototype has no existing user data that
must be preserved.
