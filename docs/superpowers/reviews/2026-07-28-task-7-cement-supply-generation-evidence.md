# Task 7: Cement Supply Generation Evidence

## Outcome

Generated blank worlds now guarantee a player-buildable Quarry to Cement Works
to Prefabrication Plant sequence. The generator first proves the selected
starter corridor and Prefab extension, then accepts the Quarry/Cement pair only
after replaying production construction analysis, sequential endpoint
directions, clearance, two topology charges, and the inclusive 180,000-pound
cap.

The accepted world remains blank: no tracks, junctions, stations, trains, or
services are prebuilt. The analysis witness is detached, deeply immutable, and
is not persisted.

## Bounded search decision

The canonical economy pool is one clipped 16 x 16 grid:

- 256 seeded candidate draws;
- half-span increased from 2,400 to 3,200 units around the Sawmill;
- relief, world-bound, and 1,000-unit facility-separation checks unchanged;
- Prefab ranked before mineral pairs;
- at most 256 full mineral-pair analyses per economy evaluation;
- separate deterministic site and market RNG streams.

With the original 12 opportunity attempts, the measured 3,200-unit pool
resolved 281/284 audited seeds. The remaining failures were `playtest-650`,
`playtest-783`, and `playtest-825`. After the span change, increasing only the
opportunity bound was measured incrementally. `playtest-825` was the last
permanent failure: it remained exhausted through attempt 24 and first succeeded
at attempt 26, so 26 is the smallest evidenced bound. No price, grant, terrain,
clearance, candidate-count, pair-analysis, or RNG rule changed.

## Stable production-browser evidence

Two consecutive Chromium 148 audits over `playtest-601` through
`playtest-884` produced the same exact work maxima:

- 284 evaluated, 284 resolved, 0 exhausted;
- maximum resolved attempt: 26;
- maximum economy evaluations: 81;
- maximum economy candidates: 20,736 cumulative;
- maximum Prefab analyses: 1,070 cumulative;
- maximum mineral-pair analyses: 1,381 cumulative;
- mineral-pair cap hits: 6 total, at most 1 in any seed;
- maximum joint work: 27,392 units;
- worst and slowest seed: `playtest-825`;
- slower maximum per-seed duration: 1,708 ms;
- slower full-audit duration: 50,996.6 ms.

The exact worst-case replay was deterministic and blank. Its measured costs
were 241,044 pounds for the selected starter corridor, 56,675 pounds for the
Prefab extension, and 165,674 pounds for both mineral links including topology.

## Review resolution

Independent review found that the `WorldManager` trust boundary validated only
the overall candidate count and could accept omitted, negative, fractional, or
over-cap Prefab and mineral-pair analysis counts from a custom economy port.
The correction uses one shared predicate at both successful-result trust sites
and the exhaustion-result guard. Prefab counts must be integers from 0 through
256, and mineral-pair counts must be integers from 0 through 256.

Strict TDD covered all four hostile value classes for both fields on both
successful and failed custom-port results: 16 focused assertions failed before
the correction and all 16 passed after it. Every rejection is fail-closed as
`world-validation-failed`, with no save attempt and no installed world.

## Verification status

- Cement analyzer unit suite: 11/11 tests passed.
- Review diagnostics matrix: 16/16 focused tests passed after the observed
  16/16 RED failure.
- Required focused gate: 100/100 tests passed across four unit/integration
  suites.
- Browser harness unit: 1/1 representative-seed test passed while separately
  asserting the unchanged default 601-to-884 audit range.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed with only the three pre-existing bundle-size warnings.
- Two full production-browser audits: 284/284 seeds resolved with identical
  exact structural maxima and sub-two-second per-seed runtime.
