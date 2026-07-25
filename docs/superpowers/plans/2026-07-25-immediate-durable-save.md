# Immediate Durable Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every successful construction command immediately, expose an accessible retry action, and require deliberate Delete presses.

**Architecture:** `WorldScene` owns a pure save-and-report method used by command changes and manual retry. `EditorToolbar` owns a native retry button, while periodic train synchronization remains isolated to the safety save.

**Tech Stack:** TypeScript, Phaser 3, Jest/jsdom, Playwright.

## Global Constraints

- Immediate and manual saves call `WorldManager.save()` without train synchronization or revision mutation.
- Persistence failure preserves live command state and the prior stored snapshot; it never rolls back.
- Do not modify Task9 evidence files or add mobile coverage.

---

### Task 1: Deliberate Delete Key Confirmation

**Files:**
- Modify: `tests/unit/WorldSceneEditorGuards.test.ts`
- Modify: `tests/unit/PlaceVehicleTool.test.ts`
- Modify: `src/scenes/WorldScene.ts`
- Modify: `src/systems/tools/PlaceVehicleTool.ts`

**Interfaces:**
- Consumes: `KeyboardEvent.repeat`
- Produces: `ui:delete-request` only for non-repeat Delete keydowns

- [ ] **Step 1: Write the failing regression**

Add a test that sends one non-repeat Delete, one repeat Delete, and a second
non-repeat Delete. Assert exactly two `ui:delete-request` events and no command
or selection mutation.

- [ ] **Step 2: Run the focused test and verify RED**

Run `npx jest tests/unit/WorldSceneEditorGuards.test.ts --runInBand --coverage=false`.
Expected: three requests are observed because repeat is not guarded.

- [ ] **Step 3: Implement the minimal repeat guard**

Handle Delete only when `event.repeat !== true`, preserving all existing exact
UUID request behavior.

- [ ] **Step 4: Re-run the focused test and verify GREEN**

Run the same Jest command. Expected: pass.

### Task 2: Pure Immediate Persistence

**Files:**
- Modify: `tests/unit/WorldSceneEditorGuards.test.ts`
- Modify: `src/scenes/WorldScene.ts`

**Interfaces:**
- Consumes: successful `CommandStack.onChange`
- Produces: `saving` then `saved`/`unsaved` toolbar and company states

- [ ] **Step 1: Write failing success and failure tests**

Cover push/undo/redo notifications, event ordering, no train serialization,
unchanged revision/cash, prior stored snapshot preservation on injected save
failure, no saved event, and retained live command result.

- [ ] **Step 2: Run focused tests and verify RED**

Run `npx jest tests/unit/WorldSceneEditorGuards.test.ts --runInBand --coverage=false`.
Expected: command changes report unsaved without calling persistence.

- [ ] **Step 3: Implement the pure reporting path**

Add a `saveWorldAndReport()` method that emits saving, invokes
`WorldManager.save()`, then emits saved or unsaved and the failure toast. Route
command changes, Retry Save, and Ctrl+S through it. Keep train synchronization
only in the periodic/create-mode safety path. When vehicle placement clears a
present CommandStack, suppress its legacy direct unsaved event so it cannot
overwrite the callback's authoritative persistence result.

- [ ] **Step 4: Re-run focused tests and verify GREEN**

Run the same Jest command. Expected: pass.

### Task 3: Accessible Retry Save Control

**Files:**
- Modify: `tests/unit/EditorToolbar.test.ts`
- Modify: `src/ui/EditorToolbar.ts`

**Interfaces:**
- Consumes: `setSaveIndicator('unsaved' | 'saving' | 'saved')`
- Produces: native `button[data-testid="editor-retry-save"]` and `editor:save`

- [ ] **Step 1: Write failing input and lifecycle tests**

Assert the button is labelled `Retry Save`, emits `editor:save` when clicked,
is hidden outside unsaved state or toolbar visibility, and is removed on
destroy.

- [ ] **Step 2: Run focused tests and verify RED**

Run `npx jest tests/unit/EditorToolbar.test.ts --runInBand --coverage=false`.
Expected: the retry button is absent.

- [ ] **Step 3: Implement the native retry button**

Create and style the DOM button in the toolbar constructor, update its display
from save/visibility state, stop pointer propagation, emit `editor:save` on
click, and remove it on destroy.

- [ ] **Step 4: Re-run focused tests and verify GREEN**

Run the same Jest command. Expected: pass.

### Task 4: Verification and Delivery

**Files:**
- Modify: `tests/e2e/construction-loop.test.ts`
- Modify only files listed above plus this approved design and plan.

**Interfaces:**
- Produces: verified commit `fix: persist construction edits immediately`

- [ ] **Step 1: Add browser durability evidence**

Inject one deterministic world-storage write failure before confirming a real
construction quote. Assert the live track/cash result remains, the prior raw
snapshot is unchanged, HUD state is unsaved, and Retry Save is visible. Restore
storage, click Retry Save, then reload and compare the exact persisted
construction result.

- [ ] **Step 2: Run focused Jest serially**

Run the modified unit suites with `--runInBand --coverage=false`.

- [ ] **Step 3: Run full Jest serially**

Run `npm test -- --runInBand`.

- [ ] **Step 4: Build and run relevant Playwright serially**

Run `npm run build`, then
`npx playwright test tests/e2e/construction-loop.test.ts --workers=1`.

- [ ] **Step 5: Review and commit**

Run `git diff --check`, verify Task9 evidence files are untouched, and commit
all scoped files with `fix: persist construction edits immediately`.
