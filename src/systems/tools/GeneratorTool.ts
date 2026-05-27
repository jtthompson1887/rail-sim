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
  }

  activate(): void {}
  deactivate(): void {
    EventBus.emit('ui:validation-hint', { state: 'ok', message: '' });
  }

  onPointerDown(worldX: number, worldY: number, _pointer: Phaser.Input.Pointer): void {
    this.runGeneratorAt(worldX, worldY);
  }

  onPointerMove(_worldX: number, _worldY: number, _pointer: Phaser.Input.Pointer): void {}
  onPointerUp(_worldX: number, _worldY: number, _pointer: Phaser.Input.Pointer): void {}
  onKeyDown(_event: KeyboardEvent): void {}
  update(_delta: number): void {}
  destroy(): void {}

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
    const generator = new TrackGenerator(this.scene, this.trackManager, WorldManager.world?.seed);

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

    // Generated tracks are already in TrackManager, so skip alignment here to
    // avoid each new track finding itself as a neighbouring endpoint.
    const validTracks: RailTrack[] = [];
    let invalidCount = 0;
    for (const track of tracks) {
      const cps = track.getControlPoints();
      const result = this.terrainValidator.canPlaceTrack(cps.p0, cps.p1, cps.p2, cps.p3, 20, null);
      if (result.valid) {
        track.isTunnel = result.requiresTunnel;
        track.elevation = result.averageElevation;
        track.updateTrackVectors(cps.p0, cps.p1, cps.p2, cps.p3);
        WorldManager.addTrackDef(TrackSerializer.toTrackDef(track));
        validTracks.push(track);
      } else {
        invalidCount++;
        this.trackManager.removeTrack(track.getUUID());
      }
    }

    EventBus.emit('ui:toolbar-save-state', { state: 'unsaved' });
    const msg = invalidCount > 0
      ? `Generated ${validTracks.length} tracks (${invalidCount} blocked by terrain)`
      : `Generated ${validTracks.length} tracks`;
    EventBus.emit('ui:validation-hint', {
      state: invalidCount > 0 ? 'warning' : 'ok',
      message: invalidCount > 0 ? `${invalidCount} generated section(s) failed validation` : '',
    });
    EventBus.emit('ui:toast', { message: msg, type: invalidCount > 0 ? 'warning' : 'success' });
  }
}
