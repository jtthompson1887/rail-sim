# Startup Save-State Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure the editor overlay starts from the completed initial save outcome and immediately exposes startup save failures.

**Architecture:** `WorldScene` applies initial mode before launching `EditorUIScene`, then passes a value snapshot containing visibility, cash, save state, and one pending error message. `EditorUIScene` applies that snapshot to the real toolbar/HUD and consumes the error exactly once.

**Tech Stack:** TypeScript, Phaser 3, Jest/jsdom, Playwright.

## Global Constraints

- Do not add EventBus replay/history behavior.
- Clear the pending startup error in WorldScene immediately after first launch handoff.
- Preserve hidden editor UI for play-mode startup.
- Do not duplicate toast listeners or startup error display.

---

### Task 1: Capture the Completed Initial Outcome

**Files:**
- Modify: `tests/unit/WorldSceneEditorGuards.test.ts`
- Modify: `src/scenes/WorldScene.ts`

**Interfaces:**
- Consumes: `lastReportedSaveState`, current company cash, initial world mode
- Produces: EditorUIScene launch data with `saveErrorMessage?: string`

- [x] **Step 1: Write failing startup launch tests**

Test successful create startup, failed create startup, and play startup. Assert
initial mode application precedes UI launch; launch data contains exact
visibility/cash/save state/error; failure message is cleared after handoff.

- [x] **Step 2: Run focused WorldScene tests and verify RED**

Run `npx jest tests/unit/WorldSceneEditorGuards.test.ts --runInBand --coverage=false`.
Expected: launch data remains hardcoded `saved` and precedes initial save.

- [x] **Step 3: Implement minimal ordering and capture**

Retain a pending concrete save error when `saveAndReport()` fails. Move editor
launch after initial mode application, pass the completed snapshot, and clear
the pending error immediately after `scene.launch`.

- [x] **Step 4: Re-run focused WorldScene tests and verify GREEN**

Run the same Jest command. Expected: pass.

### Task 2: Consume Startup State Once

**Files:**
- Modify: `tests/unit/EditorUIScene.test.ts`
- Modify: `tests/unit/EditorToolbar.test.ts`
- Modify: `src/scenes/EditorUIScene.ts`

**Interfaces:**
- Consumes: launch snapshot `{ visible, companyCash, saveState, saveErrorMessage? }`
- Produces: initial toolbar/HUD state, Retry Save visibility, one error toast

- [x] **Step 1: Write failing UI integration tests**

Use the real `EditorToolbar` and DOM retry control where practical. Assert
startup unsaved state shows Retry Save, success hides it, the concrete error is
emitted once after toolbar construction, a second consumption cannot replay it,
and play startup remains hidden.

- [x] **Step 2: Run focused UI tests and verify RED**

Run `npx jest tests/unit/EditorUIScene.test.ts tests/unit/EditorToolbar.test.ts --runInBand --coverage=false`.
Expected: toolbar is still initialized as saved and no startup error is consumed.

- [x] **Step 3: Implement minimal snapshot application**

Store the optional message in `init()`. In `create()`, call
`toolbar.setSaveIndicator(initialSaveState)`, initialize HUD state, apply
visibility, emit the message after toolbar construction, and clear it before or
immediately after emission.

- [x] **Step 4: Re-run focused UI tests and verify GREEN**

Run the same Jest command. Expected: pass without duplicate listeners or toast.

### Task 3: Verification and Delivery

**Files:**
- Modify only files above plus the approved design and this plan.

**Interfaces:**
- Produces: verified commit `fix: surface startup save failures`

- [x] **Step 1: Run focused tests serially**

Run all modified unit suites with `--runInBand --coverage=false`.

- [x] **Step 2: Run full Jest serially**

Run `npm test -- --runInBand`.

- [x] **Step 3: Build and run relevant E2E serially**

Run `npm run build`, then
`npx playwright test tests/e2e/construction-loop.test.ts --workers=1`.

- [x] **Step 4: Review and commit**

Run `git diff --check`, confirm only scoped files changed, and commit with
`fix: surface startup save failures`.
