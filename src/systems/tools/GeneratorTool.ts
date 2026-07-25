import Phaser from 'phaser';
import type { IEditorTool } from './IEditorTool';
import RailTrack from '../../entities/RailTrack';
import TrackManager from '../../managers/TrackManager';
import TrackGenerator from '../TrackGenerator';
import { WorldManager } from '../../managers/WorldManager';
import { SnapSystem } from '../SnapSystem';
import { TerrainValidator } from '../TerrainValidator';
import { TrackSerializer } from '../../utils/TrackSerializer';
import { EventBus } from '../../services/EventBus';
import { GameConfig } from '../../config/GameConfig';
import type EditorUIScene from '../../scenes/EditorUIScene';

/**
 * GeneratorTool – click to generate a procedural track sequence from a point.
 * Snaps to nearby endpoints using SnapSystem.
 */
export class GeneratorTool implements IEditorTool {
  private scene: Phaser.Scene;
  private trackManager: TrackManager;
  private snapSystem: SnapSystem;
  private terrainValidator: TerrainValidator;
  private editorUISceneKey: string;
  private anchor: Phaser.Math.Vector2 | null = null;
  private ghostGraphics: Phaser.GameObjects.Graphics;

  constructor(
    scene: Phaser.Scene,
    trackManager: TrackManager,
    snapSystem: SnapSystem,
    terrainValidator: TerrainValidator,
    editorUISceneKey: string = 'EditorUIScene',
  ) {
    this.scene = scene;
    this.trackManager = trackManager;
    this.snapSystem = snapSystem;
    this.terrainValidator = terrainValidator;
    this.editorUISceneKey = editorUISceneKey;
    this.ghostGraphics = scene.add.graphics().setDepth(598);
  }

  activate(): void {
    this.anchor = null;
    this.drawAnchor();
  }
  deactivate(): void {
    EventBus.emit('ui:validation-hint', { state: 'ok', message: '' });
    this.anchor = null;
    this.ghostGraphics.clear();
  }
  cancel(): void {
    this.anchor = null;
    this.ghostGraphics.clear();
  }
  wantsPointerButton(button: number): boolean {
    return button === 0; // Only left button
  }

  onPointerDown(worldX: number, worldY: number, _pointer: Phaser.Input.Pointer): void {
    // Set anchor on first click, run generation on second click at same location
    if (!this.anchor) {
      const snapped = this.snapSystem.snapPoint(worldX, worldY);
      this.anchor = new Phaser.Math.Vector2(snapped.x, snapped.y);
      this.drawAnchor();
      EventBus.emit('ui:toast', { message: 'Generation anchor set — click Generate button or click again to generate', type: 'info' });
    } else {
      // Second click runs generation at the anchor point
      this.runFromAnchor();
    }
  }

  private drawAnchor(): void {
    this.ghostGraphics.clear();
    if (this.anchor) {
      this.ghostGraphics.fillStyle(0x4ad5ff, 0.9);
      this.ghostGraphics.fillCircle(this.anchor.x, this.anchor.y, 8);
      this.ghostGraphics.lineStyle(2, 0x4ad5ff, 0.6);
      this.ghostGraphics.strokeCircle(this.anchor.x, this.anchor.y, 16);
    }
  }

  /** Run the generator using the stored anchor point (called by UI button). */
  runFromAnchor(): void {
    if (!this.anchor) {
      EventBus.emit('ui:toast', { message: 'Click on the map to set a generation anchor first', type: 'error' });
      return;
    }
    this.runGeneratorAt(this.anchor.x, this.anchor.y);
    // Clear anchor after generation
    this.anchor = null;
    this.ghostGraphics.clear();
  }

  onPointerMove(_worldX: number, _worldY: number, _pointer: Phaser.Input.Pointer): void {}
  onPointerUp(_worldX: number, _worldY: number, _pointer: Phaser.Input.Pointer): void {}
  onKeyDown(_event: KeyboardEvent): void {}
  update(_delta: number): void {}
  destroy(): void {
    this.ghostGraphics.destroy();
  }

  runGeneratorAt(wx: number, wy: number): void {
    const editorUI = this.scene.scene.get(this.editorUISceneKey) as EditorUIScene | null;
    const params = editorUI?.getGeneratorParams() ?? {
      sections: GameConfig.GENERATION.MAIN.SECTIONS,
      minLength: GameConfig.GENERATION.MAIN.MIN_LENGTH,
      maxLength: GameConfig.GENERATION.MAIN.MAX_LENGTH,
      curveProbability: GameConfig.GENERATION.MAIN.CURVE_PROB,
      minCurveAngle: GameConfig.GENERATION.MAIN.MIN_ANGLE,
      maxCurveAngle: GameConfig.GENERATION.MAIN.MAX_ANGLE,
    };
    const generator = new TrackGenerator(
      this.scene,
      this.trackManager,
      WorldManager.world?.generationConfig.seed,
    );

    // Check if near an existing endpoint — use SnapSystem for consistency
    const snapped = this.snapSystem.snapPoint(wx, wy);
    const SNAP_DIST = 120;
    let tracks: RailTrack[] = [];
    let continuedFromEndpoint = false;

    const allTracks = this.trackManager.getAllTracks();
    for (const track of allTracks) {
      const curve = track.getCurvePath();
      const start = curve.getStartPoint();
      const end = curve.getEndPoint();
      if (Phaser.Math.Distance.Between(snapped.x, snapped.y, start.x, start.y) < SNAP_DIST ||
          Phaser.Math.Distance.Between(snapped.x, snapped.y, end.x, end.y) < SNAP_DIST) {
        const isStart = Phaser.Math.Distance.Between(snapped.x, snapped.y, start.x, start.y) <
                        Phaser.Math.Distance.Between(snapped.x, snapped.y, end.x, end.y);
        const nearPt = isStart ? start : end;
        const farPt = isStart ? end : start;
        const angle = Math.atan2(nearPt.y - farPt.y, nearPt.x - farPt.x);
        tracks = generator.generateTracks({
          startPoint: new Phaser.Math.Vector2(nearPt.x, nearPt.y),
          startAngle: angle,
          sections: params.sections,
          minLength: params.minLength,
          maxLength: params.maxLength,
          curveProbability: params.curveProbability,
          minCurveAngle: params.minCurveAngle,
          maxCurveAngle: params.maxCurveAngle,
          smoothness: GameConfig.GENERATION.MAIN.SMOOTHNESS,
        });
        continuedFromEndpoint = true;
        break;
      }
    }

    if (!continuedFromEndpoint) {
      tracks = generator.generateTracks({
        startPoint: new Phaser.Math.Vector2(snapped.x, snapped.y),
        startAngle: Phaser.Math.DegToRad(90),
        sections: params.sections,
        minLength: params.minLength,
        maxLength: params.maxLength,
        curveProbability: params.curveProbability,
        minCurveAngle: params.minCurveAngle,
        maxCurveAngle: params.maxCurveAngle,
        smoothness: GameConfig.GENERATION.MAIN.SMOOTHNESS,
      });
    }

    // Validate all generated tracks before committing any
    const validTracks: RailTrack[] = [];
    const invalidTracks: { track: RailTrack; reason: string; reasonCode: string }[] = [];

    for (const track of tracks) {
      const cps = track.getControlPoints();
      // Use the 4-point form with full curvature validation
      const result = this.terrainValidator.canPlaceTrack(cps.p0, cps.p1, cps.p2, cps.p3, 20, null);
      if (result.valid) {
        track.setConstructionData(
          result.verticalProfile,
          result.structures,
          result.costs.total,
        );
        track.updateTrackVectors(cps.p0, cps.p1, cps.p2, cps.p3);
        validTracks.push(track);
      } else {
        invalidTracks.push({
          track,
          reason: result.remedy,
          reasonCode: result.reasonCode,
        });
      }
    }

    // Remove invalid tracks from TrackManager (they were added during generation)
    for (const { track } of invalidTracks) {
      this.trackManager.removeTrack(track.getUUID());
    }

    // Commit valid tracks to WorldManager
    for (const track of validTracks) {
      WorldManager.addTrackDef(TrackSerializer.toTrackDef(track));
    }

    // Build validation summary with specific reasons
    const invalidCount = invalidTracks.length;
    const reasonCounts = new Map<string, number>();
    for (const { reasonCode } of invalidTracks) {
      reasonCounts.set(reasonCode, (reasonCounts.get(reasonCode) || 0) + 1);
    }

    EventBus.emit('ui:toolbar-save-state', { state: 'unsaved' });

    // Build detailed message
    let message: string;
    if (invalidCount === 0) {
      message = `Generated ${validTracks.length} tracks`;
    } else {
      const reasonSummary = Array.from(reasonCounts.entries())
        .map(([code, count]) => {
          const labels: Record<string, string> = {
            grade: 'too steep',
            clearance: 'clearance blocked',
            curvature: 'too tight',
            misaligned: 'misaligned',
          };
          return `${count} ${labels[code] || code}`;
        })
        .join(', ');
      message = `Generated ${validTracks.length} tracks (${invalidCount} blocked: ${reasonSummary})`;
    }

    EventBus.emit('ui:validation-hint', {
      state: invalidCount > 0 ? 'warning' : 'ok',
      message: invalidCount > 0
        ? `${invalidCount} section(s) failed: ${Array.from(reasonCounts.keys()).join(', ')}`
        : '',
    });
    EventBus.emit('ui:toast', { message, type: invalidCount > 0 ? 'warning' : 'success' });
  }
}
