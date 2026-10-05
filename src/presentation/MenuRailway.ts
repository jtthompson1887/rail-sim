import type Phaser from 'phaser';
import type { WorldData } from '../config/WorldData';
import { GameConfig } from '../config/GameConfig';
import { TerrainGenerator } from '../systems/TerrainGenerator';
import { TerrainChunk } from '../entities/TerrainChunk';
import { SceneryObject } from '../entities/SceneryObject';
import { FleetPresentation } from '../management/FleetPresentation';
import { SimulationSession } from '../simulation/SimulationSession';
import { createRiversideRegion, RIVERSIDE_SEED } from '../region/RiversideRegion';
import { TrackArcLengthIndex } from '../physics/TrackArcLengthIndex';
import { buildFacilityInspection } from '../economy/FacilityPresentation';
import { drawRiversideVillage } from './RiversidePresentation';
import { drawIllustratedTrack } from './TrackArt';
import { drawFacilityArt, facilityArtKey } from './FacilityArt';
import { drawNeighbourhood } from './NeighbourhoodArt';
import { resolveTransformationFootprints } from '../region/RegionalProjects';

/** A detached, real service simulation. No WorldManager, save or UI event writes. */
export function createMenuRailwaySession(world = createRiversideRegion()): SimulationSession {
  const session = new SimulationSession(world);
  session.setSpeed(1);
  // Start mid-operation so the title opens with trains already travelling.
  for (let i = 0; i < 80; i++) { session.advance(1000); session.drainEvents(); }
  session.setSpeed(2);
  return session;
}

/** Uses exactly the same landscape, track, industry and fleet drawing as play. */
export class MenuRailway {
  private readonly session = createMenuRailwaySession();
  private world: WorldData = this.session.snapshot();
  private readonly terrain = new TerrainGenerator(RIVERSIDE_SEED, 'lowlands');
  private readonly chunks = new Map<string, TerrainChunk>();
  private readonly fleet: FleetPresentation;
  private readonly facilities: Array<{ id: string; key: string; ground: Phaser.GameObjects.Graphics; roofs: Phaser.GameObjects.Graphics }> = [];
  private readonly development: Phaser.GameObjects.Graphics;
  private developmentCount = -1;
  private elapsedMs = 0;
  private paused = false;
  private destroyed = false;
  private readonly resizeHandler = () => this.resize();

  constructor(private readonly scene: Phaser.Scene) {
    this.fleet = new FleetPresentation(scene, { trains: [] });
    this.development = scene.add.graphics().setDepth(15);
    drawRiversideVillage(scene);
    for (const scenery of this.world.scenery) new SceneryObject(scene, scenery);
    for (const track of this.world.tracks) {
      drawIllustratedTrack(scene.add.graphics().setDepth(0), new TrackArcLengthIndex(track, 4));
    }
    for (const facility of this.world.economy.facilities) {
      this.facilities.push({ id: facility.id, key: '', ground: scene.add.graphics().setDepth(-15), roofs: scene.add.graphics().setDepth(32) });
    }
    this.resize();
    this.updateBuildings();
    this.fleet.update(this.world, 0, this.session.presentationRoutes());
    scene.scale.on('resize', this.resizeHandler);
  }

  setPaused(paused: boolean): void { this.paused = paused; }

  update(deltaMs: number): void {
    if (this.destroyed || this.paused) return;
    const delta = Math.min(Math.max(deltaMs, 0), 100);
    this.elapsedMs += delta;
    const advanced = this.session.advance(delta);
    if (advanced.changed) {
      this.world = this.session.snapshot();
      this.session.drainEvents();
      this.updateBuildings();
    }
    this.fleet.update(this.world, this.elapsedMs, this.session.presentationRoutes());
  }

  /** Read-only acceptance evidence; exposed by MenuScene only in test builds. */
  frame() {
    return { clockSeconds: this.session.clockSeconds, paused: this.paused, trains: this.session.getTrainSnapshots() };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.scale.off('resize', this.resizeHandler);
    this.fleet.destroy();
    for (const chunk of this.chunks.values()) chunk.destroy();
    this.chunks.clear();
    // Remaining graphics/scenery belong to this Phaser scene and its shutdown.
  }

  private resize(): void {
    const { width, height } = this.scene.scale;
    const portrait = width <= 600 || (width <= 700 && height > 520);
    const viewHeight = portrait ? height * .44 : height;
    const zoom = portrait ? Math.min(width / 2100, viewHeight / 1900)
      : Math.min(width / 4000, height / (height <= 520 ? 1900 : 2400));
    const centreX = portrait ? 4550 : 4500 - width * .18 / zoom;
    const centreY = height <= 520 || portrait ? 2050 : 1800;
    this.scene.cameras.main.setViewport(0, 0, width, viewHeight).setZoom(zoom).centerOn(centreX, centreY);
    this.scene.cameras.main.setBackgroundColor('#9aab7d');
    // Only bake visible chunks. The menu camera cannot pan beyond this framing.
    const size = GameConfig.WORLD.CHUNK_SIZE;
    const left = Math.floor((centreX - width / zoom / 2) / size);
    const right = Math.floor((centreX + width / zoom / 2) / size);
    const top = Math.floor((centreY - viewHeight / zoom / 2) / size);
    const bottom = Math.floor((centreY + viewHeight / zoom / 2) / size);
    const needed = new Set<string>();
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const key = `${x}:${y}`;
      needed.add(key);
      if (!this.chunks.has(key)) this.chunks.set(key, new TerrainChunk(this.scene, x * size, y * size, this.terrain, 'temperate'));
    }
    for (const [key, chunk] of this.chunks) if (!needed.has(key)) { chunk.destroy(); this.chunks.delete(key); }
    this.fleet.update(this.world, this.elapsedMs, this.session.presentationRoutes());
  }

  private updateBuildings(): void {
    for (const display of this.facilities) {
      const facility = this.world.economy.facilities.find(item => item.id === display.id)!;
      const inspection = buildFacilityInspection(this.world, display.id, true);
      if (!inspection) continue;
      const key = facilityArtKey(inspection);
      if (key !== display.key) {
        drawFacilityArt(display.ground, display.roofs, inspection, facility.x, facility.y);
        display.key = key;
      }
    }
    const count = this.world.region?.transformations.length ?? 0;
    if (count !== this.developmentCount) {
      this.developmentCount = count;
      this.development.clear();
      if (this.world.region) for (const footprint of resolveTransformationFootprints(
        this.world.region, this.world.tracks, [],
        f => [[0, 0], [f.radius, 0], [-f.radius, 0], [0, f.radius], [0, -f.radius]]
          .every(([x, y]) => this.terrain.getHeightAt(f.x + x, f.y + y) >= 0),
      )) drawNeighbourhood(this.development, footprint);
    }
  }
}
