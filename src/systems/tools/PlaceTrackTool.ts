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
  private currentPreview: ConstructionPreview | null = null;
  private currentModel: ConstructionPreviewModel | null = null;
  private cache: PreviewCache | null = null;
  private pendingUUID: string | null = null;
  private activePointerId: number | null = null;
  private suppressNextPointerUp = false;
  private lastHintKey = '';

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly trackManager: TrackManager,
    private readonly snapSystem: SnapSystem,
    private readonly constructionService: ConstructionService,
    private readonly commandStack: CommandStack,
    private readonly overlay: PreviewOverlay = new ConstructionPreviewOverlay(scene),
  ) {}

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
      this.suppressNextPointerUp = true;
      this.confirm();
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
    if (this.currentPhase !== 'dragging' && this.currentPhase !== 'chained') return;
    if (this.activePointerId !== null && pointer.id !== this.activePointerId) return;
    if (!this.start || !this.pendingUUID) return;

    const end = this.snapConstructionPoint(worldX, worldY);
    const key = this.previewKey(this.start, end, this.pendingUUID);
    let preview: ConstructionPreview | null;
    if (this.cache?.key === key) {
      preview = this.cache.preview;
    } else {
      const startInput = this.serviceAnchor(this.start);
      const endInput = this.serviceAnchor(end);
      preview = startInput && endInput
        ? this.constructionService.createPreview(
          startInput,
          endInput,
          this.pendingUUID,
        )
        : null;
      if (preview) this.cache = { key, preview };
    }
    if (!preview) {
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
    if (this.suppressNextPointerUp) {
      this.suppressNextPointerUp = false;
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
    this.resetToIdle();
  }

  onKeyDown(event: KeyboardEvent): void {
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
      this.setPhase('dragging');
      this.publishModel(false);
      return;
    }
    if (this.currentPhase === 'dragging' || this.currentPhase === 'chained') {
      this.resetToIdle();
    }
  }

  destroy(): void {
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
    const canConfirm = engineeringReady && this.currentPhase === 'review';
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
      message = 'Click or press Enter to build this section.';
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
    this.currentPreview = null;
    this.currentModel = null;
    this.cache = null;
    this.pendingUUID = null;
    this.activePointerId = null;
    this.suppressNextPointerUp = false;
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
      this.snapSystem.endpointEnabled,
      this.snapSystem.gridEnabled,
      this.snapSystem.gridSize,
      this.snapSystem.snapRadius,
      world?.constructionRevision ?? 'none',
      world?.company.cash ?? 'none',
    ].join('|');
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
