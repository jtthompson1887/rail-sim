# Editable rail drafts

Draw a section with the existing placement tool, then shape it before pressing **Build** (or Enter). The two direction handles control the start and finish independently. Rotating a handle changes the direction; moving it farther from its endpoint gives that approach more reach. Moving the endpoint preserves its handle offset and applies normal endpoint snapping.

On touch, tap a direction handle to select it, then tap its new position. The construction panel also offers start/finish selection, 5-degree angle adjustments, and shorter/longer approaches. Joined directions remain aligned with the existing railway; their approach length can still change. Clicking the preview never spends money.

**Undo shape** (Backspace) reverses draft adjustments without touching construction transactions. **Reset shape** restores the automatic curve and can itself be undone. Pointer cancellation restores the shape from before the interrupted gesture. Build, Back, and Cancel remain explicit actions.

All edited geometry goes through `ConstructionService` for engineering, terrain, clearance, affordability, and immutable quote validation. Self-crossing curves are rejected with an actionable remedy. Built geometry and charges come from that exact quote. Handles and history are transient editor state; save schemas and cab code are unchanged.

This freeform tool edits single sections. Guide-point drawing modes, continuous routes and parallel tracks remain subsequent work; the separate Plans workflow already offers a fitted passing loop.

Verification: `TrackDraftPlacement.test.ts`, the existing placement/service/inspector/overlay unit suites, and `tests/e2e/track-draft.test.ts` cover mouse and emulated touch. Browser emulation does not substitute for physical-device playtesting.

## First-slice verification, 5 October 2026

- 72 focused unit checks passed, including the cab isolation/purity gates and keyboard protection for collapsible panels.
- The full regression run began before the final edits: 2,518 of 2,520 tests passed with 97% line coverage. Its two failures exercised earlier cached curve/overlay code; a fresh run of both affected suites passed all 19 checks.
- Five Playwright checks passed: mouse handle editing, touch controls, construction undo/redo and reload, interrupted-save recovery, and affordability rejection.
- Production webpack build passed with existing asset-size warnings. The isolated preview build has a 1,773,626-byte `main.js` and a separate 7,077,268-byte cab chunk. No verified pre-cab baseline is available for a percentage comparison.
- The existing construction-drag browser benchmark, with isolated output, measured 1.2 ms at the 95th percentile over 500 samples against its 16 ms target.
- Whitespace checks passed for the changed tracked files.

The side-task preview uses port 41739 and `test-results/rail-placement-build/client`; it does not replace the main development build.
