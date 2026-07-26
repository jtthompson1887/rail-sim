# Startup Save-State Handoff Design

## Problem

`WorldScene` currently queues `EditorUIScene` before applying its initial mode.
Create-mode activation performs a synchronous safety save and emits save/error
events before the queued editor UI starts listening. The later launch data also
hardcodes `saved`, hiding a startup failure and its retry action.

## Architecture

`WorldScene` will apply the initial create/play mode before launching
`EditorUIScene`. It will retain the completed save outcome in
`lastReportedSaveState` and retain one concrete `saveErrorMessage` when an
attempt fails.

After initial mode application, `WorldScene` launches `EditorUIScene` with an
explicit snapshot:

- `visible`: whether startup mode is create;
- `companyCash`: current authoritative cash;
- `saveState`: the completed initial save state;
- `saveErrorMessage`: the pending startup failure message, if any.

This explicit handoff avoids global EventBus replay semantics and avoids making
the UI query WorldScene or WorldManager.

## Editor UI Consumption

`EditorUIScene` applies the initial save state to both `EditorToolbar` and
`CompanyHud` during `create()`. An unsaved state therefore exposes the native
Retry Save button immediately.

After `EditorToolbar` has subscribed to toast events, `EditorUIScene` emits the
concrete startup error once and clears its local copy. Repeated lifecycle calls
or subsequent retry events cannot replay that startup message.

## Mode Preservation

Create startup remains visible and performs its initial synchronized safety
save before UI launch. Play startup does not run a create save and launches the
editor UI hidden with the current saved state.

## Verification

WorldScene tests prove launch happens after the initial outcome and carries
success/failure/play snapshots. EditorUIScene and toolbar integration tests
prove initial unsaved state exposes Retry Save, initial success does not, the
startup error is emitted once, and listeners are not duplicated. Full Jest,
production build, and the construction-loop Playwright suite run serially.
