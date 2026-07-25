# Immediate Durable Save Design

## Scope

Construction command changes must become durable immediately without altering
the command result. A held Delete key must not satisfy both steps of deletion
confirmation. An unsaved state must expose a native accessible Retry Save
control.

## Architecture

`CommandStack` remains persistence-agnostic. `WorldScene` owns persistence
reporting through one pure save path that calls `WorldManager.save()` and emits
`saving` followed by `saved` or `unsaved` to both the toolbar and company HUD.
The command-stack change callback invokes this path after every successful
push, undo, redo, or record notification.

Out-of-stack vehicle placement already clears CommandStack to invalidate stale
construction history. When that stack is present, the tool delegates save
status to the same callback and does not overwrite a successful save with a
stale `unsaved` event.

Retry Save and Ctrl+S use the same pure path. They never synchronize live train
objects into the world, so they do not mutate trains, cash, or revision. The
60-second safety save and create-mode transition retain the existing train
synchronization behavior.

`WorldScene` tracks the last reported save state. The periodic safety save is
skipped when state is already `saved`; after a failed immediate save it remains
eligible to retry.

## Interaction and Accessibility

`EditorToolbar` retains its canvas save label and owns a native DOM `button`
labelled `Retry Save`. The button is displayed only while visible and unsaved.
Native click, touch, Enter, and Space behavior emits `editor:save`. The toolbar
removes the button and its listeners during destruction.

Repeated Delete keydown events (`KeyboardEvent.repeat === true`) are ignored.
Two distinct non-repeat keydowns still emit two exact review requests.

## Failure Contract

Persistence failure does not undo or roll back the command. The live world,
revision, and cash remain at the command result. `SaveService` keeps its
transactional behavior, leaving the prior stored snapshot byte-for-byte
unchanged. No saved state event is emitted, and a clear error toast is shown.

## Verification

Focused tests cover key repeat handling, push/undo/redo persistence, failure
snapshot preservation, no train synchronization or revision drift, periodic
retry suppression, and Retry Save input/lifecycle behavior. Full Jest,
production build, and relevant construction Playwright scenarios run serially.
The browser construction loop injects one deterministic storage write failure
around a real command, proves the live/durable divergence and accessible retry
state, then retries and reloads the exact construction result.
