# Milestone 1 construction evidence

**Reviewed source:** `91513e1`

This record closes the terrain-aware construction milestone. It does not claim
the wider freight-economy goal is complete.

## Automated verification

All commands were run on Windows 11 from a clean `codex/full-game` worktree.

| Gate | Result |
| --- | --- |
| `npm test -- --runInBand` | 72 suites and 928 tests passed; 95.49% line coverage |
| Construction analysis benchmark inside Jest | 500 proposals; p95 1.035 ms against the 8 ms local target |
| `npx playwright test --retries=0` | 29 browser tests passed with zero retries |
| `npm run benchmark:construction-drag` | 500 samples; p95 0.4000000059604645 ms against the 16 ms target |
| `npm run benchmark:world-generation` | `playtest-884`; attempt 12 of 12; 79.6000000089407 ms against the 2,000 ms target; deterministic replay passed |
| `npm run build` | Production build passed; existing bundle and source-texture size warnings remain |
| `git diff --check` | Passed |
| `rg -n "console\.(log\|debug)" src tests` | No matches |

Browser timing evidence was captured with Chromium 148.0.7778.96 on an AMD
Ryzen 9 7900X 12-Core Processor. The portable gates remain deterministic
operation caps: 96 construction samples, 12 generation attempts, and 256 site
candidates per attempt.

## Fixed-seed construction playtest

The automated browser playtest covers three deliberately different decisions:

- `playtest-078`: a cheaper, low-earthworks alignment;
- `playtest-134`: rolling terrain with visible earthworks;
- `playtest-049`: a tunnel-versus-bridge trade-off and mobile unaffordability.

The complete construction loop also verifies snapping, chained placement,
step-back/cancel, itemised cost and engineering feedback, exact cash debit,
undo/refund, redo, immediate durable save, injected save failure and Retry Save,
and reload with identical geometry, structures, and cash.

Manual inspection of the freshly built output confirmed:

- a new generated world begins with terrain, two planning sites, and survey
  corridors, but no prebuilt player railway or train;
- the recommended overview keeps both sites, corridor guidance, and labels
  readable without placing railway for the player;
- built track follows the selected route cleanly and remains legible over the
  terrain;
- the fixed minimap contains and centres the built route;
- the company cash and saved-state indicator survive a reload;
- the full-screen desktop shell has no page scrollbars or clipped controls.

The first-load phone path is additionally exercised at 375 by 667 pixels. Its
initial zoom is inside the same bounds used by wheel and pinch input, and the
first zoom step remains continuous.

## Review record

Independent reviews during implementation found and corrected Important issues
in construction clearance, topology pricing, durable-save retry, bounded curve
sampling, hidden curvature extrema, minimap geometry/input capture, and
small-screen survey presentation.

The correction range `882b2e8..91513e1` was independently re-reviewed with no
open Critical or Important findings. The reviewer also reran 64 focused tests
across minimap, UI input, camera, and opportunity presentation.

Minor YAGNI deferrals:

- schema validation does not yet enforce globally unique track UUIDs or every
  relational reference;
- persisted junction restoration remains deferred while the junction editor is
  disabled and generated blank worlds contain no junctions;
- legacy source textures and the main bundle are large enough to trigger
  Webpack performance warnings.

The user confirmed there is no existing player data. Schema changes therefore
remain an intentional clean break: unsupported saves ask the player to start a
new world, and no migration layer is included.

## Publication

The reviewed source is published only after the complete milestone-wide review
has no open Critical or Important findings. The opaque Sites version and
production URL are recorded in the final handoff and Sites deployment history
so that this source file does not need a post-deployment commit.
