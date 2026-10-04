import Phaser from 'phaser';
import { PlaceTrackCommand } from '../../commands/PlaceTrackCommand';
import { GameConfig } from '../../config/GameConfig';
import {
  deriveConstructionGuidance,
} from '../../freight/ConstructionGuidance';
import type TrackManager from '../../managers/TrackManager';
import { WorldManager } from '../../managers/WorldManager';
import { EventBus } from '../../services/EventBus';
import type { CommandStack } from '../CommandStack';
import type {
  ConstructionInputAnchor,
  ConstructionPreview,
  ConstructionService,
} from '../ConstructionService';
import type { SnapResult, SnapSystem } from '../SnapSystem';
import {
  DRAFT_HANDLE_TARGET_PX,
  draftHandlePoint,
  isDirectionHandle,
  rotateDraftHandle,
  type TrackCurveControls,
  type TrackDraftHandle,
  type TrackDraftIntent,
} from '../TrackDraft';
import {
  ConstructionPreviewOverlay,
  type ConstructionPreviewModel,
  type ConstructionToolPhase,
} from '../../ui/ConstructionPreviewOverlay';
import type { IEditorTool } from './IEditorTool';

interface PreviewOverlay {
  render(model: ConstructionPreviewModel): void;
  clear(): void;
  destroy(): void;
}

interface PreviewCache {
  readonly key: string;
  readonly preview: ConstructionPreview;
}

interface DraftState {
  readonly start: SnapResult;
  readonly end: SnapResult;
  readonly controls?: TrackCurveControls;
}

function semanticAnchor(anchor: SnapResult): string {
  const outward = anchor.outward
    ? `${anchor.outward.x},${anchor.outward.y}`
    : '';
  return [
    anchor.x,
    anchor.y,
    anchor.type,
    anchor.trackUUID ?? '',
    anchor.endpoint ?? '',
    outward,
    anchor.open ?? '',
  ].join(':');
}

function outwardFromGeometry(
  geometry: ConstructionPreview['proposal']['geometry'],
): { x: number; y: number } {
  const dx = geometry.p3.x - geometry.p2.x;
  const dy = geometry.p3.y - geometry.p2.y;
  const length = Math.hypot(dx, dy);
  return length > 0
    ? { x: dx / length, y: dy / length }
    : { x: 1, y: 0 };
}

function nearestStarterWaypoint(
  worldX: number,
  worldY: number,
): Readonly<{ x: number; y: number }> {
  const corridors = WorldManager.world?.starterOpportunity?.corridors ?? [];
  const radius = GameConfig.WORLD.SNAP_GRID_SIZE * 0.25;
  const candidates: Array<{
    point: Readonly<{ x: number; y: number }>;
    distance: number;
  }> = [];
  for (const corridor of corridors) {
    for (const point of corridor.waypoints) {
      const distance = Math.hypot(point.x - worldX, point.y - worldY);
      if (distance <= radius) candidates.push({ point, distance });
    }
  }
  candidates.sort((left, right) => left.distance - right.distance
      || left.point.x - right.point.x
      || left.point.y - right.point.y);
  return candidates[0]?.point ?? { x: worldX, y: worldY };
}

/**
 * Terrain-aware placement state machine. Pointer movement produces one cached
 * immutable preview; review confirms only its stored quote via CommandStack.
 */
export class PlaceTrackTool implements IEditorTool {
  private currentPhase: ConstructionToolPhase = 'idle';
  private start: SnapResult | null = null;
  private end: SnapResult | null = null;
  private controls: TrackCurveControls | undefined;
  private selectedHandle: TrackDraftHandle | null = null;
  private readonly draftHistory: DraftState[] = [];
  private gestureBefore: DraftState | null = null;
  private gestureOrigin: { x: number; y: number } | null = null;
  private gestureMoved = false;
  private currentPreview: ConstructionPreview | null = null;
  private currentModel: ConstructionPreviewModel | null = null;
  private cache: PreviewCache | null = null;
  private pendingUUID: string | null = null;
  private activePointerId: number | null = null;
  private lastHintKey = '';
  private readonly shapeIntentHandler = (intent: TrackDraftIntent) => this.adjustDraft(intent);

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly trackManager: TrackManager,
    private readonly snapSystem: SnapSystem,
    private readonly constructionService: ConstructionService,
    private readonly commandStack: CommandStack,
    private readonly overlay: PreviewOverlay = new ConstructionPreviewOverlay(scene),
  ) {
    EventBus.on('construction:shape-intent', this.shapeIntentHandler);
  }

  get phase(): ConstructionToolPhase {
    return this.currentPhase;
  }

  get startAnchor(): SnapResult | null {
    return this.start;
  }

  get previewModel(): ConstructionPreviewModel | null {
    return this.currentModel;
  }

  activate(): void {}

  deactivate(): void {
    this.resetToIdle();
  }

  cancel(): void {
    this.resetToIdle();
  }

  wantsPointerButton(button: number): boolean {
    return button === 0 || button === 2;
  }

  onPointerDown(
    worldX: number,
    worldY: number,
    pointer: Phaser.Input.Pointer,
  ): void {
    if (pointer.button === 2 || pointer.rightButtonDown()) {
      this.backstep();
      return;
    }
    if (pointer.button !== 0) return;
    if (this.currentPhase === 'review') {
      if (this.gestureBefore) return;
      const hit = this.hitHandle(worldX, worldY);
      if (hit) this.selectedHandle = hit;
      if (!this.selectedHandle) return;
      this.gestureBefore = this.captureDraft();
      this.gestureOrigin = { x: worldX, y: worldY };
      this.gestureMoved = false;
      this.activePointerId = Number.isFinite(pointer.id) ? pointer.id : null;
      if (!hit) {
        this.moveHandle(worldX, worldY);
        this.gestureMoved = true;
      }
      this.publishModel(this.currentModel?.stale ?? false);
      return;
    }
    if (this.currentPhase !== 'idle') return;

    this.start = this.snapConstructionPoint(worldX, worldY);
    this.pendingUUID = crypto.randomUUID();
    this.activePointerId = Number.isFinite(pointer.id) ? pointer.id : null;
    this.setPhase('dragging');
  }

  onPointerMove(
    worldX: number,
    worldY: number,
    pointer: Phaser.Input.Pointer,
  ): void {
    if (this.currentPhase === 'review') {
      if (!this.gestureBefore || !this.selectedHandle) return;
      if (this.activePointerId !== null && pointer.id !== this.activePointerId) return;
      const zoom = this.scene.cameras?.main?.zoom || 1;
      if (!this.gestureMoved && this.gestureOrigin
        && Math.hypot(worldX - this.gestureOrigin.x, worldY - this.gestureOrigin.y) * zoom < 3) return;
      this.gestureMoved = true;
      this.moveHandle(worldX, worldY);
      return;
    }
    if (this.currentPhase !== 'dragging' && this.currentPhase !== 'chained') return;
    if (this.activePointerId !== null && pointer.id !== this.activePointerId) return;
    if (!this.start || !this.pendingUUID) return;

    this.end = this.snapConstructionPoint(worldX, worldY);
    this.refreshPreview();
  }

  private refreshPreview(): void {
    if (!this.start || !this.end || !this.pendingUUID) return;
    const key = this.previewKey(this.start, this.end, this.pendingUUID);
    let preview: ConstructionPreview | null;
    if (this.cache?.key === key) {
      preview = this.cache.preview;
    } else {
      const startInput = this.serviceAnchor(this.start);
      const endInput = this.serviceAnchor(this.end);
      preview = startInput && endInput
        ? this.constructionService.createPreview(
          startInput,
          endInput,
          this.pendingUUID,
          ...(this.controls ? [this.controls] : []),
        )
        : null;
      if (preview) this.cache = { key, preview };
    }
    if (!preview) {
      if (this.currentPhase === 'review' && this.currentPreview) {
        this.cache = null;
        this.publishModel(true);
        return;
      }
      this.currentPreview = null;
      this.currentModel = null;
      this.overlay.clear();
      this.dispatchPreview();
      this.dispatchHint('error', 'Construction preview is unavailable — move the endpoint.');
      return;
    }
    this.currentPreview = preview;
    this.publishModel(false);
  }

  onPointerUp(
    worldX: number,
    worldY: number,
    pointer: Phaser.Input.Pointer,
  ): void {
    if (this.currentPhase === 'review' && this.gestureBefore) {
      if (pointer.button !== 0
        || (this.activePointerId !== null && pointer.id !== this.activePointerId)) return;
      if (this.gestureMoved) this.moveHandle(worldX, worldY);
      const before = this.gestureBefore;
      this.clearGesture();
      if (this.gestureChanged(before)) this.rememberDraft(before);
      this.publishModel(this.currentModel?.stale ?? false);
      return;
    }
    if (pointer.button !== 0) return;
    if (this.currentPhase !== 'dragging' && this.currentPhase !== 'chained') return;
    if (this.activePointerId !== null && pointer.id !== this.activePointerId) return;
    this.onPointerMove(worldX, worldY, pointer);
    this.activePointerId = null;
    if (!this.currentPreview) {
      this.resetToIdle();
      return;
    }
    this.setPhase('review');
    this.publishModel(false);
  }

  onPointerCancel(pointer: Phaser.Input.Pointer): void {
    if (this.activePointerId === null || pointer.id !== this.activePointerId) return;
    if (this.gestureBefore) {
      const before = this.gestureBefore;
      this.clearGesture();
      this.restoreDraft(before);
      return;
    }
    this.resetToIdle();
  }

  onKeyDown(event: KeyboardEvent): void {
    if (this.currentPhase === 'review' && !this.gestureBefore
      && event.code === 'Backspace') {
      this.adjustDraft({ action: 'undo' });
      event.preventDefault?.();
      return;
    }
    if (event.code === 'Enter' || event.code === 'Space') {
      this.confirm();
      return;
    }
    if (event.code === 'Escape') this.cancel();
  }

  update(_delta: number): void {}

  confirm(): boolean {
    const model = this.currentModel;
    const preview = this.currentPreview;
    if (this.currentPhase !== 'review'
      || !model?.canConfirm
      || !!this.gestureBefore
      || !preview?.quote) return false;

    const command = new PlaceTrackCommand(
      this.scene,
      this.trackManager,
      this.constructionService,
      preview.quote,
    );
    if (!this.commandStack.push(command)) {
      this.publishModel(true);
      return false;
    }

    this.setPhase('committed');
    this.publishModel(false);
    EventBus.emit('track:placed', { trackUUID: preview.quote.newTrackUUID });
    this.beginChain(preview);
    return true;
  }

  backstep(): void {
    if (this.currentPhase === 'review') {
      if (this.gestureBefore) {
        const before = this.gestureBefore;
        this.clearGesture();
        this.restoreDraft(before);
      }
      this.selectedHandle = null;
      this.controls = undefined;
      this.draftHistory.length = 0;
      this.setPhase('dragging');
      this.refreshPreview();
      this.publishModel(false);
      return;
    }
    if (this.currentPhase === 'dragging' || this.currentPhase === 'chained') {
      this.resetToIdle();
    }
  }

  destroy(): void {
    EventBus.off('construction:shape-intent', this.shapeIntentHandler);
    this.overlay.destroy();
    this.currentPreview = null;
    this.currentModel = null;
    this.cache = null;
  }

  private beginChain(preview: ConstructionPreview): void {
    const quote = preview.quote!;
    const geometry = quote.proposal.geometry;
    const endWasConnected = quote.predictedConnections.some(
      (connection) => connection.newEndpoint === 'end',
    );
    if (endWasConnected) {
      this.resetToIdle();
      return;
    }

    const liveTrack = this.trackManager.getTrack?.(quote.newTrackUUID);
    if (liveTrack && this.trackManager.endpointHasConnection(liveTrack, false)) {
      this.resetToIdle();
      return;
    }
    const canonicalEndpoint = liveTrack
      ? this.snapConstructionPoint(geometry.p3.x, geometry.p3.y)
      : null;
    if (liveTrack && (
      canonicalEndpoint?.type !== 'endpoint'
      || canonicalEndpoint.trackUUID !== quote.newTrackUUID
      || canonicalEndpoint.endpoint !== 'end'
      || canonicalEndpoint.open !== true
    )) {
      this.resetToIdle();
      return;
    }
    const curveTangent = liveTrack?.getCurvePath().getTangent(1);
    const outward = curveTangent
      ? { x: curveTangent.x, y: curveTangent.y }
      : outwardFromGeometry(geometry);
    this.start = canonicalEndpoint ?? {
        x: geometry.p3.x,
        y: geometry.p3.y,
        snapped: true,
        type: 'endpoint',
        trackUUID: quote.newTrackUUID,
        endpoint: 'end',
        outward,
        open: true,
      };
    this.pendingUUID = crypto.randomUUID();
    this.end = null;
    this.controls = undefined;
    this.selectedHandle = null;
    this.draftHistory.length = 0;
    this.clearGesture();
    this.currentPreview = null;
    this.currentModel = null;
    this.cache = null;
    this.activePointerId = null;
    this.overlay.clear();
    this.setPhase('chained');
    this.dispatchPreview();
    this.dispatchHint('ok', '');
  }

  private publishModel(stale: boolean): void {
    const preview = this.currentPreview;
    const world = WorldManager.world;
    if (!preview || !world) return;
    const guidance = deriveConstructionGuidance(world);
    const cash = world.company.cash;
    const affordable = preview.affordable !== false
      && Number.isSafeInteger(cash)
      && (cash as number) >= preview.totalCost;
    const engineeringReady = !stale
      && preview.proposal.valid
      && affordable
      && preview.quote !== null;
    const canConfirm = engineeringReady && this.currentPhase === 'review' && !this.gestureBefore;
    let message = '';
    if (stale) {
      message = 'Route changed — move the endpoint to refresh the quote.';
    } else if (!preview.proposal.valid) {
      message = preview.proposal.remedy;
    } else if (!affordable) {
      message = preview.proposal.structures.some(({ type }) => type === 'tunnel')
        ? 'Tunnel section exceeds your cash.'
        : 'This section exceeds your cash — shorten or simplify the route.';
    } else if (preview.status === 'endpoint-unavailable') {
      message = preview.message;
    } else if (engineeringReady && this.currentPhase === 'review') {
      message = this.gestureBefore
        ? 'Release to finish adjusting this draft.'
        : 'Shape the direction handles, then press Build or Enter.';
    } else if (
      engineeringReady
      && (this.currentPhase === 'dragging' || this.currentPhase === 'chained')
    ) {
      message = 'Release to review this section.';
    }
    const actions: ConstructionPreviewModel['actions'] = Object.freeze([
      ...(canConfirm ? ['confirm' as const] : []),
      'backstep' as const,
      'cancel' as const,
    ]);
    this.currentModel = Object.freeze({
      phase: this.currentPhase,
      proposal: preview.proposal,
      predictedConnections: preview.predictedConnections,
      engineeringSubtotal: preview.proposal.costs.total,
      topologyCost: preview.topologyCost,
      totalCost: preview.totalCost,
      cashBefore: preview.cashBefore,
      cashAfter: preview.cashAfter,
      structureLengths: Object.freeze({ ...preview.proposal.structureLengths }),
      affordable,
      canConfirm,
      stale,
      message,
      actions,
      guidance,
      breachesReserve:
        affordable && preview.cashAfter < guidance.reserve,
      draft: Object.freeze({
        selectedHandle: this.selectedHandle,
        startDirectionLocked: !!preview.startAnchor.endpoint,
        endDirectionLocked: !!preview.endAnchor.endpoint,
        canUndo: this.draftHistory.length > 0 && !this.gestureBefore,
      }),
    });
    this.overlay.render(this.currentModel);
    this.dispatchPreview();
    // Task 7's construction inspector is the single visible owner of this
    // decision/remedy. Clear the legacy canvas hint to avoid duplicate advice.
    this.dispatchHint('ok', '');
  }

  private setPhase(phase: ConstructionToolPhase): void {
    this.currentPhase = phase;
  }

  private resetToIdle(): void {
    this.currentPhase = 'idle';
    this.start = null;
    this.end = null;
    this.controls = undefined;
    this.selectedHandle = null;
    this.draftHistory.length = 0;
    this.clearGesture();
    this.currentPreview = null;
    this.currentModel = null;
    this.cache = null;
    this.pendingUUID = null;
    this.activePointerId = null;
    this.overlay.clear();
    this.dispatchPreview();
    this.dispatchHint('ok', '');
  }

  private snapConstructionPoint(worldX: number, worldY: number): SnapResult {
    const planned = nearestStarterWaypoint(worldX, worldY);
    const snap = this.snapSystem as SnapSystem & {
      snapConstructionPoint?: (
        x: number,
        y: number,
        excluded?: string[],
      ) => SnapResult;
    };
    return snap.snapConstructionPoint
      ? snap.snapConstructionPoint(planned.x, planned.y)
      : snap.snapPoint(planned.x, planned.y);
  }

  private previewKey(
    start: SnapResult,
    end: SnapResult,
    pendingUUID: string,
  ): string {
    const world = WorldManager.world;
    return [
      pendingUUID,
      semanticAnchor(start),
      semanticAnchor(end),
      this.controls ? JSON.stringify(this.controls) : 'automatic',
      this.snapSystem.endpointEnabled,
      this.snapSystem.gridEnabled,
      this.snapSystem.gridSize,
      this.snapSystem.snapRadius,
      world?.constructionRevision ?? 'none',
      world?.company.cash ?? 'none',
    ].join('|');
  }

  /** Shape controls are independent of money, live tracks, and construction undo. */
  adjustDraft(intent: TrackDraftIntent): void {
    if (this.currentPhase !== 'review' || this.gestureBefore || !this.currentPreview) return;
    if (intent.action === 'select') {
      this.selectedHandle = intent.handle;
      this.publishModel(this.currentModel?.stale ?? false);
      return;
    }
    if (intent.action === 'undo') {
      const previous = this.draftHistory.pop();
      if (previous) this.restoreDraft(previous);
      return;
    }
    const before = this.captureDraft();
    if (!before) return;
    if (intent.action === 'reset') {
      this.controls = undefined;
      this.selectedHandle = null;
      this.cache = null;
      this.rememberDraft(before);
      this.refreshPreview();
      return;
    }
    const handle = this.selectedHandle;
    if (!handle || !isDirectionHandle(handle)) return;
    const start = handle === 'start-direction';
    const locked = start ? this.currentPreview.startAnchor.endpoint : this.currentPreview.endAnchor.endpoint;
    if (intent.action === 'rotate' && (locked || !Number.isFinite(intent.degrees))) return;
    if (intent.action === 'reach' && (!Number.isFinite(intent.factor) || intent.factor <= 0)) return;
    const geometry = this.currentPreview.proposal.geometry;
    const anchor = start ? geometry.p0 : geometry.p3;
    const point = start ? geometry.p1 : geometry.p2;
    const requested = intent.action === 'rotate'
      ? rotateDraftHandle(anchor, point, intent.degrees)
      : {
        x: anchor.x + (point.x - anchor.x) * intent.factor,
        y: anchor.y + (point.y - anchor.y) * intent.factor,
      };
    this.rememberDraft(before);
    this.moveHandle(requested.x, requested.y);
  }

  private hitHandle(x: number, y: number): TrackDraftHandle | null {
    if (!this.currentPreview) return null;
    const geometry = this.currentPreview.proposal.geometry;
    const zoom = this.scene.cameras?.main?.zoom || 1;
    const handles: TrackDraftHandle[] = ['start-direction', 'end-direction', 'start', 'end'];
    return handles.map((handle) => {
      const point = draftHandlePoint(geometry, handle);
      return { handle, distance: Math.hypot(point.x - x, point.y - y) * zoom };
    }).filter(({ distance }) => distance <= DRAFT_HANDLE_TARGET_PX)
      .sort((left, right) => left.distance - right.distance)[0]?.handle ?? null;
  }

  private moveHandle(x: number, y: number): void {
    if (!this.selectedHandle || !this.currentPreview || !this.start || !this.end) return;
    const geometry = this.currentPreview.proposal.geometry;
    const p1 = { ...geometry.p1 };
    const p2 = { ...geometry.p2 };
    if (this.selectedHandle === 'start-direction') {
      p1.x = x;
      p1.y = y;
    } else if (this.selectedHandle === 'end-direction') {
      p2.x = x;
      p2.y = y;
    } else if (this.selectedHandle === 'start') {
      this.start = this.snapConstructionPoint(x, y);
      p1.x += this.start.x - geometry.p0.x;
      p1.y += this.start.y - geometry.p0.y;
    } else {
      this.end = this.snapConstructionPoint(x, y);
      p2.x += this.end.x - geometry.p3.x;
      p2.y += this.end.y - geometry.p3.y;
    }
    this.controls = { p1, p2 };
    this.refreshPreview();
  }

  private captureDraft(): DraftState | null {
    if (!this.start || !this.end) return null;
    return {
      start: { ...this.start, ...(this.start.outward ? { outward: { ...this.start.outward } } : {}) },
      end: { ...this.end, ...(this.end.outward ? { outward: { ...this.end.outward } } : {}) },
      controls: this.controls ? { p1: { ...this.controls.p1 }, p2: { ...this.controls.p2 } } : undefined,
    };
  }

  private gestureChanged(before: DraftState): boolean {
    return JSON.stringify(before) !== JSON.stringify(this.captureDraft());
  }

  private rememberDraft(before: DraftState): void {
    this.draftHistory.push(before);
    if (this.draftHistory.length > 40) this.draftHistory.shift();
  }

  private restoreDraft(before: DraftState): void {
    this.start = before.start;
    this.end = before.end;
    this.controls = before.controls;
    this.cache = null;
    this.refreshPreview();
  }

  private clearGesture(): void {
    this.gestureBefore = null;
    this.gestureOrigin = null;
    this.gestureMoved = false;
    this.activePointerId = null;
  }

  private serviceAnchor(anchor: SnapResult): ConstructionInputAnchor | null {
    if (anchor.type === 'midpoint') return null;
    if (anchor.type === 'endpoint') {
      if (!anchor.trackUUID || !anchor.endpoint
        || !anchor.outward || typeof anchor.open !== 'boolean') return null;
      return {
        x: anchor.x,
        y: anchor.y,
        snapped: true,
        type: 'endpoint',
        trackUUID: anchor.trackUUID,
        endpoint: anchor.endpoint,
        outward: { ...anchor.outward },
        open: anchor.open,
      };
    }
    return anchor.type === 'grid'
      ? {
        x: anchor.x,
        y: anchor.y,
        snapped: true,
        type: 'grid',
      }
      : {
        x: anchor.x,
        y: anchor.y,
        snapped: false,
        type: 'none',
      };
  }

  private dispatchPreview(): void {
    EventBus.emit('construction:preview', {
      phase: this.currentPhase,
      preview: this.currentModel,
    });
  }

  private dispatchHint(
    state: 'ok' | 'warning' | 'error',
    message: string,
  ): void {
    const key = `${state}:${message}`;
    if (key === this.lastHintKey) return;
    this.lastHintKey = key;
    EventBus.emit('ui:validation-hint', { state, message });
  }
}
