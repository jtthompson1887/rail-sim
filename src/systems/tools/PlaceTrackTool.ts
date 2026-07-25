import Phaser from 'phaser';
import type { IEditorTool } from './IEditorTool';
import RailTrack from '../../entities/RailTrack';
import TrackManager from '../../managers/TrackManager';
import { WorldManager } from '../../managers/WorldManager';
import { SnapSystem } from '../SnapSystem';
import { TerrainValidator } from '../TerrainValidator';
import { TrackSerializer } from '../../utils/TrackSerializer';
import { EventBus } from '../../services/EventBus';
import {
  deriveAutomaticCubic,
  type TrackGeometryDef,
} from '../TrackGeometry';
import type { ConstructionProposal } from '../ConstructionAnalyzer';

function hasMajorStructure(proposal: ConstructionProposal): boolean {
  return proposal.structures.some(
    (interval) => interval.type === 'bridge' || interval.type === 'tunnel',
  );
}

function validationHintState(
  proposal: ConstructionProposal,
): 'ok' | 'warning' | 'error' {
  if (!proposal.valid) return 'error';
  return hasMajorStructure(proposal) ? 'warning' : 'ok';
}

function proposalMessage(proposal: ConstructionProposal): string {
  if (!proposal.valid) return proposal.remedy;
  if (proposal.structures.some((interval) => interval.type === 'tunnel')) {
    return 'Tunnel engineering included.';
  }
  if (proposal.structures.some((interval) => interval.type === 'bridge')) {
    return 'Bridge engineering included.';
  }
  return '';
}

function vectors(def: TrackGeometryDef): {
  p0: Phaser.Math.Vector2;
  p1: Phaser.Math.Vector2;
  p2: Phaser.Math.Vector2;
  p3: Phaser.Math.Vector2;
} {
  return {
    p0: new Phaser.Math.Vector2(def.p0.x, def.p0.y),
    p1: new Phaser.Math.Vector2(def.p1.x, def.p1.y),
    p2: new Phaser.Math.Vector2(def.p2.x, def.p2.y),
    p3: new Phaser.Math.Vector2(def.p3.x, def.p3.y),
  };
}

/**
 * Two-click pre-Task-6 placement path. Every committed track is built from
 * the exact ConstructionProposal returned by TerrainValidator.
 */
export class PlaceTrackTool implements IEditorTool {
  private scene: Phaser.Scene;
  private trackManager: TrackManager;
  private snapSystem: SnapSystem;
  private terrainValidator: TerrainValidator;
  private ghostGraphics: Phaser.GameObjects.Graphics;
  private placeAnchor: Phaser.Math.Vector2 | null = null;

  constructor(
    scene: Phaser.Scene,
    trackManager: TrackManager,
    snapSystem: SnapSystem,
    terrainValidator: TerrainValidator,
  ) {
    this.scene = scene;
    this.trackManager = trackManager;
    this.snapSystem = snapSystem;
    this.terrainValidator = terrainValidator;
    this.ghostGraphics = scene.add.graphics().setDepth(598);
  }

  activate(): void {}

  deactivate(): void {
    this.cancel();
  }

  cancel(): void {
    this.placeAnchor = null;
    this.ghostGraphics.clear();
    EventBus.emit('ui:validation-hint', { state: 'ok', message: '' });
  }

  wantsPointerButton(button: number): boolean {
    return button === 0;
  }

  onPointerDown(worldX: number, worldY: number, _pointer: Phaser.Input.Pointer): void {
    if (!this.placeAnchor) {
      const snapped = this.snapSystem.snapPoint(worldX, worldY);
      this.placeAnchor = new Phaser.Math.Vector2(snapped.x, snapped.y);
      this.drawAnchor(snapped.x, snapped.y, 0x4ad5ff);
      return;
    }

    const proposal = this.analyse(worldX, worldY);
    if (!proposal.valid) {
      EventBus.emit('ui:toast', {
        message: `Cannot place track: ${proposal.remedy}`,
        type: 'error',
      });
      EventBus.emit('ui:validation-hint', {
        state: 'error',
        message: proposal.remedy,
      });
    } else {
      const controls = vectors(proposal.geometry);
      const track = new RailTrack(
        this.scene,
        controls.p0,
        controls.p1,
        controls.p2,
        controls.p3,
      );
      track.setConstructionData(
        proposal.verticalProfile,
        proposal.structures,
        proposal.costs.total,
      );
      this.trackManager.addTrack(track);
      WorldManager.addTrackDef(TrackSerializer.toTrackDef(track));
      EventBus.emit('ui:toolbar-save-state', { state: 'unsaved' });
      EventBus.emit('ui:validation-hint', {
        state: validationHintState(proposal),
        message: proposalMessage(proposal),
      });
      EventBus.emit('ui:toast', { message: 'Track placed', type: 'success' });
    }

    this.placeAnchor = new Phaser.Math.Vector2(worldX, worldY);
    this.drawAnchor(worldX, worldY, 0x4ad5ff);
  }

  onPointerMove(worldX: number, worldY: number, _pointer: Phaser.Input.Pointer): void {
    if (!this.placeAnchor) return;
    const proposal = this.analyse(worldX, worldY);
    const colour = proposal.valid
      ? (hasMajorStructure(proposal) ? 0xffcc00 : 0x00ff88)
      : 0xff4444;

    this.ghostGraphics.clear();
    this.ghostGraphics.fillStyle(colour, 0.9);
    this.ghostGraphics.fillCircle(this.placeAnchor.x, this.placeAnchor.y, 6);
    this.ghostGraphics.lineStyle(2, colour, 0.6);
    this.ghostGraphics.beginPath();
    this.ghostGraphics.moveTo(this.placeAnchor.x, this.placeAnchor.y);
    this.ghostGraphics.lineTo(worldX, worldY);
    this.ghostGraphics.strokePath();
    this.ghostGraphics.fillStyle(colour, 0.7);
    this.ghostGraphics.fillCircle(worldX, worldY, 4);

    EventBus.emit('ui:validation-hint', {
      state: validationHintState(proposal),
      message: proposalMessage(proposal),
    });
  }

  private analyse(worldX: number, worldY: number): ConstructionProposal {
    const geometry = deriveAutomaticCubic({
      start: this.placeAnchor!,
      end: { x: worldX, y: worldY },
    });
    const controls = vectors(geometry);
    return this.terrainValidator.canPlaceTrack(
      controls.p0,
      controls.p1,
      controls.p2,
      controls.p3,
      20,
      this.trackManager,
    );
  }

  private drawAnchor(x: number, y: number, colour: number): void {
    this.ghostGraphics.clear();
    this.ghostGraphics.fillStyle(colour, 0.9);
    this.ghostGraphics.fillCircle(x, y, 6);
  }

  onPointerUp(
    _worldX: number,
    _worldY: number,
    _pointer: Phaser.Input.Pointer,
  ): void {}

  onKeyDown(_event: KeyboardEvent): void {}

  update(_delta: number): void {}

  destroy(): void {
    this.ghostGraphics.destroy();
  }
}
