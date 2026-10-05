import type Phaser from 'phaser';
import type { TrainDef, WorldData } from '../config/WorldData';
import { consistSpecification, getPoweredVehicleFamily } from '../region/VehicleRoster';
import { capacityForProduct, getFreightSet } from '../freight/FreightSetCatalog';
import { getProduct } from '../economy/ProductCatalog';
import { RailGraph } from '../simulation/RailGraph';
import {
  drawFleetBody, drawFleetBogie, drawFleetShadow, drawStationPlatform, drawStationShadow, FLEET_SHADOW_OFFSET,
} from '../presentation/FleetArt';

export type PoweredSilhouette = 'short-hood' | 'double-cab' | 'electric-box' | 'regional-unit' | 'commuter-unit' | 'heavy-six-axle';
export const POWERED_SILHOUETTES: Readonly<Record<string, PoweredSilhouette>> = {
  'diesel-shunter': 'short-hood', 'mixed-diesel': 'double-cab', 'electric-freight': 'electric-box',
  'regional-dmu': 'regional-unit', 'commuter-emu': 'commuter-unit', 'heavy-diesel': 'heavy-six-axle',
};
export interface FleetPartVisual {
  id: string;
  kind: 'powered' | 'wagon';
  silhouette: PoweredSilhouette | null;
  wagonFamilyId: string | null;
  length: number;
  offset: number;
  width: number;
  colour: number;
  productId: string | null;
  loadFraction: number;
  passenger: boolean;
  cabAtFront: boolean;
  cabAtRear: boolean;
}
export interface FleetVisualSpecification { trainId: string; familyId: string; totalLength: number; parts: FleetPartVisual[] }
export interface FleetPose { x: number; y: number; angle: number }
export interface FleetPartPose extends FleetPose { frontBogie: FleetPose; rearBogie: FleetPose }
/** Transient selected routes from the authoritative session, keyed by train ID. */
export type FleetRouteSnapshot = Readonly<Record<string, readonly string[]>>;

/** Interpolates completed poses only, using the shortest angular arc. */
export function interpolateFleetPartPose(from: FleetPartPose, to: FleetPartPose, fraction: number): FleetPartPose {
  const amount = Math.max(0, Math.min(1, fraction));
  const mix = (a: FleetPose, b: FleetPose): FleetPose => ({ x: a.x + (b.x - a.x) * amount, y: a.y + (b.y - a.y) * amount,
    angle: a.angle + Math.atan2(Math.sin(b.angle - a.angle), Math.cos(b.angle - a.angle)) * amount });
  return { ...mix(from, to), frontBogie: mix(from.frontBogie, to.frontBogie), rearBogie: mix(from.rearBogie, to.rearBogie) };
}

export function liveryColour(train: Pick<TrainDef, 'livery'>, companyColour?: string): number {
  const colour = /^#[0-9a-f]{6}$/i.test(train.livery ?? '') ? train.livery : /^#[0-9a-f]{6}$/i.test(companyColour ?? '') ? companyColour : '#278d9b';
  return Number.parseInt(colour!.slice(1), 16);
}

/** Pure snapshot mapping; the same aggregate composition is used by the authoritative simulation. */
export function fleetVisualSpecification(train: TrainDef, companyColour?: string): FleetVisualSpecification {
  const consist = consistSpecification(train);
  const family = consist.poweredFamily;
  const colour = liveryColour(train, companyColour);
  const totalLength = consist.totalLengthMetres * 10;
  const passenger = consist.passengerCapacity > 0;
  const partCount = Math.max(1, consist.poweredUnits);
  const gap = partCount > 1 ? 8 : consist.couplerGapMetres * 10;
  const poweredLength = consist.poweredLengthMetres * 10;
  const carLength = (poweredLength - gap * (partCount - 1)) / partCount;
  const poweredCentre = (totalLength - poweredLength) / 2;
  const parts: FleetPartVisual[] = Array.from({ length: partCount }, (_, i) => ({
    id: `${train.id}:powered:${i}`, kind: 'powered', silhouette: POWERED_SILHOUETTES[family.id], wagonFamilyId: null,
    length: carLength, offset: poweredCentre + poweredLength / 2 - carLength / 2 - i * (carLength + gap),
    width: family.id === 'diesel-shunter' ? 27 : 31, colour, productId: null, loadFraction: 0, passenger,
    cabAtFront: i === 0, cabAtRear: i === partCount - 1,
  }));
  if (consist.wagonFamilyId && consist.wagonLengthMetres > 0) {
    const product = train.cargo ? getProduct(train.cargo.productId) : undefined;
    const set = getFreightSet(train.freightSetId);
    const capacity = set && product ? capacityForProduct(set, product) : undefined;
    const loadFraction = capacity?.ok && capacity.capacityUnits > 0 ? Math.max(0, Math.min(1, (train.cargo?.units ?? 0) / capacity.capacityUnits)) : 0;
    parts.push({ id: `${train.id}:wagon`, kind: 'wagon', silhouette: null, wagonFamilyId: consist.wagonFamilyId,
      length: consist.wagonLengthMetres * 10, offset: -(poweredLength + gap) / 2, width: 30,
      colour, productId: train.cargo?.productId ?? null, loadFraction, passenger: consist.wagonFamilyId === 'passenger-coach', cabAtFront: false, cabAtRear: false });
  }
  return { trainId: train.id, familyId: family.id, totalLength, parts };
}

/** Arc-distance sampling never guesses a branch at an ambiguous turnout. */
export function sampleFleetPose(graph: RailGraph, train: TrainDef, offset: number, preferredTrackIds: readonly string[] = []): FleetPose | null {
  if (train.dynamics.mode === 'free-body') {
    const body = train.dynamics;
    return { x: body.x + Math.cos(body.angleRad) * offset, y: body.y + Math.sin(body.angleRad) * offset, angle: body.angleRad };
  }
  let track = graph.trackByUUID(train.dynamics.trackUUID);
  if (!track) return null;
  let distance = train.dynamics.distance;
  const forward = offset >= 0;
  let travelDirection: 1 | -1 = forward ? train.dynamics.direction : train.dynamics.direction === 1 ? -1 : 1;
  let remaining = Math.abs(offset);
  for (let crossings = 0; crossings < 32; crossings++) {
    const available = travelDirection === 1 ? track.index.length - distance : distance;
    if (remaining <= available + 1e-7) {
      distance += travelDirection * remaining;
      const pose = track.index.poseAtDistance(distance);
      const facing = forward ? travelDirection : -travelDirection;
      return { x: pose.point.x, y: pose.point.y, angle: Math.atan2(pose.tangent.y * facing, pose.tangent.x * facing) };
    }
    remaining -= available;
    const exit = travelDirection === 1 ? 'end' : 'start';
    const next = preferredTrackIds.map(id => graph.continuation(track!, exit, id)).find(candidate => candidate !== null) ?? graph.continuation(track, exit);
    if (!next) return null;
    track = graph.trackByUUID(next.track.getUUID());
    travelDirection = next.direction;
    distance = travelDirection === 1 ? 0 : track.index.length;
  }
  return null;
}

export function sampleFleetPartPose(graph: RailGraph, train: TrainDef, part: FleetPartVisual, preferredTrackIds: readonly string[] = []): FleetPartPose | null {
  const front = sampleFleetPose(graph, train, part.offset + part.length * 0.32, preferredTrackIds);
  const rear = sampleFleetPose(graph, train, part.offset - part.length * 0.32, preferredTrackIds);
  if (!front || !rear) return null;
  return { x: (front.x + rear.x) / 2, y: (front.y + rear.y) / 2, angle: Math.atan2(front.y - rear.y, front.x - rear.x), frontBogie: front, rearBogie: rear };
}

export function stationWaitingCounts(world: Pick<WorldData, 'stations' | 'management'>): Record<string, number> {
  const waiting: Record<string, number> = Object.fromEntries(world.stations.map(station => [station.id, 0]));
  for (const cohort of world.management?.passengers.cohorts ?? []) if (cohort.waitingAt !== null && Object.prototype.hasOwnProperty.call(waiting, cohort.waitingAt)) waiting[cohort.waitingAt] += cohort.count;
  return waiting;
}

interface RenderTrain {
  getUUID(): string;
  getMatterBody(): Phaser.Physics.Matter.Image;
  readonly selected?: boolean;
}
interface TrainPresentationPort { readonly trains: readonly RenderTrain[]; selectTrain?(trainId: string | null): void }
interface PartDisplay { signature: string; body: Phaser.GameObjects.Graphics; front: Phaser.GameObjects.Graphics; rear: Phaser.GameObjects.Graphics; shadow: Phaser.GameObjects.Graphics }
interface StationDisplay { platform: Phaser.GameObjects.Graphics; people: Phaser.GameObjects.Graphics; badge: Phaser.GameObjects.Text; shadow: Phaser.GameObjects.Graphics; signature: string }
interface PartMotion { from: FleetPartPose; target: FleetPartPose; changedAt: number; duration: number }

/** Read-only illustrated overhead fleet. Physics sprites stay alive, interactive, and cab-compatible. */
export class FleetPresentation {
  private graph: RailGraph | null = null;
  private graphKey = '';
  private readonly parts = new Map<string, PartDisplay>();
  private readonly stations = new Map<string, StationDisplay>();
  private readonly hiddenBodies = new Map<string, { body: Phaser.Physics.Matter.Image; alpha: number }>();
  private readonly trackHistory = new Map<string, string[]>();
  private readonly lastTracks = new Map<string, string>();
  private readonly motions = new Map<string, PartMotion>();
  private readonly selection: Phaser.GameObjects.Graphics;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene, private readonly trains: TrainPresentationPort) {
    this.selection = scene.add.graphics().setDepth(104);
  }

  update(world: WorldData, time: number, routes: FleetRouteSnapshot = {}): void {
    if (this.destroyed) return;
    const graphKey = `${world.id}:${world.constructionRevision}:${world.tracks.length}:${world.junctions.length}`;
    if (graphKey !== this.graphKey) { this.graph = new RailGraph(world.tracks, world.junctions); this.graphKey = graphKey; this.motions.clear(); }
    const graph = this.graph!;
    const visible = new Set<string>();
    const activeTrains = new Set<string>();
    this.selection.clear();
    const zoom = Math.max(0.1, this.scene.cameras.main.zoom || 1);
    for (const train of world.trains) {
      if (!getPoweredVehicleFamily(train.vehicleFamilyId ?? 'mixed-diesel')) continue;
      activeTrains.add(train.id);
      const runtime = this.trains.trains.find(item => item.getUUID() === train.id);
      const currentTrack = train.dynamics.mode === 'on-rail' ? train.dynamics.trackUUID : null;
      const previousTrack = this.lastTracks.get(train.id);
      if (currentTrack && previousTrack && previousTrack !== currentTrack) this.trackHistory.set(train.id, [previousTrack, ...(this.trackHistory.get(train.id) ?? []).filter(id => id !== previousTrack)].slice(0, 8));
      if (currentTrack) this.lastTracks.set(train.id, currentTrack);
      const preferred = [...(routes[train.id] ?? []), ...(this.trackHistory.get(train.id) ?? [])];
      const specification = fleetVisualSpecification(train, world.companyStyle?.colour);
      let drawn = 0;
      for (const part of specification.parts) {
        const sampledPose = sampleFleetPartPose(graph, train, part, preferred);
        if (!sampledPose) continue;
        const pose = this.smoothPose(part.id, sampledPose, time);
        visible.add(part.id);
        let display = this.parts.get(part.id);
        const signature = JSON.stringify(part);
        if (!display) {
          display = { signature: '', body: this.scene.add.graphics().setDepth(103), front: this.scene.add.graphics().setDepth(102), rear: this.scene.add.graphics().setDepth(102), shadow: this.scene.add.graphics().setDepth(101) };
          this.parts.set(part.id, display);
          if (this.trains.selectTrain) {
            display.body.setInteractive({ useHandCursor: true, hitArea: { x: 0, y: 0, width: 1, height: 1 },
              hitAreaCallback: (area: { x: number; y: number; width: number; height: number }, x: number, y: number) => x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height });
            display.body.on('pointerdown', (pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
              if (pointer.button !== 0) return;
              this.trains.selectTrain!(train.id); event.stopPropagation();
            });
          }
        }
        if (display.signature !== signature) {
          drawFleetBody(display.body, part); drawFleetShadow(display.shadow, part);
          drawFleetBogie(display.front, part.width, part.silhouette === 'heavy-six-axle' ? 3 : 2); drawFleetBogie(display.rear, part.width, part.silhouette === 'heavy-six-axle' ? 3 : 2);
          display.signature = signature;
        }
        display.body.setPosition(pose.x, pose.y).setRotation(pose.angle).setVisible(true);
        display.shadow.setPosition(pose.x + FLEET_SHADOW_OFFSET.x, pose.y + FLEET_SHADOW_OFFSET.y).setRotation(pose.angle).setVisible(true);
        if (display.body.input?.hitArea) {
          const height = Math.max(part.width + 10, 24 / zoom);
          Object.assign(display.body.input.hitArea, { x: -part.length / 2, y: -height / 2, width: part.length, height });
        }
        display.front.setPosition(pose.frontBogie.x, pose.frontBogie.y).setRotation(pose.frontBogie.angle).setVisible(true);
        display.rear.setPosition(pose.rearBogie.x, pose.rearBogie.y).setRotation(pose.rearBogie.angle).setVisible(true);
        drawn++;
        if (runtime?.selected) {
          this.selection.lineStyle(2 / zoom, 0x8cf2c6, 0.95);
          this.selection.strokeCircle(pose.x, pose.y, Math.max(22, part.width * 0.8));
        }
      }
      if (runtime && drawn > 0) {
        const body = runtime.getMatterBody();
        const previous = this.hiddenBodies.get(train.id);
        if (previous?.body !== body) {
          previous?.body.setAlpha(previous.alpha);
          this.hiddenBodies.set(train.id, { body, alpha: body.alpha ?? 1 });
        }
        body.setAlpha(0.001);
      } else this.restoreBody(train.id);
    }
    for (const [id, display] of this.parts) if (!visible.has(id)) { display.body.destroy(); display.front.destroy(); display.rear.destroy(); display.shadow.destroy(); this.parts.delete(id); this.motions.delete(id); }
    for (const id of this.hiddenBodies.keys()) if (!activeTrains.has(id)) this.restoreBody(id);
    for (const id of this.lastTracks.keys()) if (!activeTrains.has(id)) { this.trackHistory.delete(id); this.lastTracks.delete(id); }
    this.updateStations(world, time, zoom);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const display of this.parts.values()) { display.body.destroy(); display.front.destroy(); display.rear.destroy(); display.shadow.destroy(); }
    for (const display of this.stations.values()) { display.platform.destroy(); display.people.destroy(); display.badge.destroy(); display.shadow.destroy(); }
    for (const id of this.hiddenBodies.keys()) this.restoreBody(id);
    this.selection.destroy(); this.parts.clear(); this.stations.clear(); this.trackHistory.clear(); this.lastTracks.clear(); this.motions.clear(); this.graph = null;
  }

  private restoreBody(id: string): void { const hidden = this.hiddenBodies.get(id); if (hidden) { hidden.body.setAlpha(hidden.alpha); this.hiddenBodies.delete(id); } }

  private smoothPose(id: string, pose: FleetPartPose, time: number): FleetPartPose {
    let motion = this.motions.get(id);
    const angularChange = motion ? Math.abs(Math.atan2(Math.sin(pose.angle - motion.target.angle), Math.cos(pose.angle - motion.target.angle))) : 0;
    if (!motion || time < motion.changedAt || Math.hypot(pose.x - motion.target.x, pose.y - motion.target.y) > 200 || angularChange > Math.PI / 2) {
      motion = { from: pose, target: pose, changedAt: time, duration: 50 }; this.motions.set(id, motion); return pose;
    }
    if (pose.x !== motion.target.x || pose.y !== motion.target.y || pose.angle !== motion.target.angle) {
      const from = interpolateFleetPartPose(motion.from, motion.target, (time - motion.changedAt) / motion.duration);
      motion = { from, target: pose, changedAt: time, duration: Math.max(16, Math.min(50, time - motion.changedAt)) }; this.motions.set(id, motion);
    }
    return interpolateFleetPartPose(motion.from, motion.target, (time - motion.changedAt) / motion.duration);
  }

  private updateStations(world: WorldData, time: number, zoom: number): void {
    const active = new Set<string>();
    const waiting = stationWaitingCounts(world);
    for (const station of world.stations) {
      const track = this.graph!.trackByUUID(station.trackUUID);
      if (!track) continue;
      const pose = track.index.poseAtDistance(track.index.distanceAtParameter(station.trackT));
      const angle = Math.atan2(pose.tangent.y, pose.tangent.x);
      active.add(station.id);
      let display = this.stations.get(station.id);
      if (!display) {
        display = { platform: this.scene.add.graphics().setDepth(48), people: this.scene.add.graphics().setDepth(51), shadow: this.scene.add.graphics().setDepth(47), badge: this.scene.add.text(0, 0, '', { fontFamily: 'Verdana', fontSize: '11px', color: '#3b4b44', backgroundColor: '#f0e7cfed', padding: { x: 7, y: 3 } }).setOrigin(0.5, 0).setDepth(52), signature: '' };
        this.stations.set(station.id, display);
      }
      const length = (station.platformLengthMetres ?? 120) * 10;
      const colour = liveryColour({}, world.companyStyle?.colour);
      const signature = `${length}:${station.name}:${colour}`;
      if (signature !== display.signature) {
        drawStationPlatform(display.platform, length, colour); drawStationShadow(display.shadow, length);
        display.signature = signature;
      }
      display.platform.setPosition(pose.point.x, pose.point.y).setRotation(angle);
      display.shadow.setPosition(pose.point.x + FLEET_SHADOW_OFFSET.x, pose.point.y + FLEET_SHADOW_OFFSET.y).setRotation(angle);
      display.people.clear().setPosition(pose.point.x, pose.point.y).setRotation(angle);
      const count = waiting[station.id] ?? 0;
      for (let i = 0; i < Math.min(8, count); i++) {
        const x = -length * 0.33 + i * Math.min(20, length / 12) + Math.sin(time / 1_000 + i * 1.7) * 4;
        display.people.fillStyle(i % 2 ? 0xe9c676 : 0xc0dde3, 1).fillCircle(x, 34, 2.5).fillRect(x - 2, 37, 4, 6);
      }
      display.badge.setText(`${count} waiting`).setPosition(pose.point.x - pose.tangent.y * 58, pose.point.y + pose.tangent.x * 58).setScale(1 / zoom);
    }
    for (const [id, display] of this.stations) if (!active.has(id)) { display.platform.destroy(); display.people.destroy(); display.badge.destroy(); display.shadow.destroy(); this.stations.delete(id); }
  }
}
