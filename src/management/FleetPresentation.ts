import type Phaser from 'phaser';
import type { TrainDef, WorldData } from '../config/WorldData';
import { consistSpecification, getPoweredVehicleFamily } from '../region/VehicleRoster';
import { capacityForProduct, getFreightSet } from '../freight/FreightSetCatalog';
import { getProduct } from '../economy/ProductCatalog';
import { RailGraph } from '../simulation/RailGraph';

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
interface PartDisplay { signature: string; body: Phaser.GameObjects.Graphics; front: Phaser.GameObjects.Graphics; rear: Phaser.GameObjects.Graphics }
interface StationDisplay { platform: Phaser.GameObjects.Graphics; people: Phaser.GameObjects.Graphics; badge: Phaser.GameObjects.Text; signature: string }
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
          display = { signature: '', body: this.scene.add.graphics().setDepth(103), front: this.scene.add.graphics().setDepth(102), rear: this.scene.add.graphics().setDepth(102) };
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
          this.drawPart(display.body, part);
          this.drawBogie(display.front, part.width, part.silhouette === 'heavy-six-axle' ? 3 : 2); this.drawBogie(display.rear, part.width, part.silhouette === 'heavy-six-axle' ? 3 : 2);
          display.signature = signature;
        }
        display.body.setPosition(pose.x, pose.y).setRotation(pose.angle).setVisible(true);
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
    for (const [id, display] of this.parts) if (!visible.has(id)) { display.body.destroy(); display.front.destroy(); display.rear.destroy(); this.parts.delete(id); this.motions.delete(id); }
    for (const id of this.hiddenBodies.keys()) if (!activeTrains.has(id)) this.restoreBody(id);
    for (const id of this.lastTracks.keys()) if (!activeTrains.has(id)) { this.trackHistory.delete(id); this.lastTracks.delete(id); }
    this.updateStations(world, time, zoom);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const display of this.parts.values()) { display.body.destroy(); display.front.destroy(); display.rear.destroy(); }
    for (const display of this.stations.values()) { display.platform.destroy(); display.people.destroy(); display.badge.destroy(); }
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

  private drawBogie(graphics: Phaser.GameObjects.Graphics, width: number, axles: number): void {
    graphics.clear();
    const half = axles === 3 ? 14 : 10;
    graphics.fillStyle(0x0b1c23, 1).fillRoundedRect(-half, -width / 2 - 2, half * 2, width + 4, 3);
    graphics.fillStyle(0x77868a, 1);
    for (const x of axles === 3 ? [-11, -1, 9] : [-7, 5]) { graphics.fillRect(x, -width / 2 - 3, 3, 5); graphics.fillRect(x, width / 2 - 2, 3, 5); }
  }

  private drawPart(g: Phaser.GameObjects.Graphics, part: FleetPartVisual): void {
    g.clear();
    const length = part.length, width = part.width, left = -length / 2;
    g.fillStyle(0x000000, 0.25).fillRoundedRect(left + 4, -width / 2 + 5, length, width, 7);
    g.fillStyle(0x18323b, 1).fillRoundedRect(left, -width / 2 + 2, length, width - 4, 4);
    g.fillStyle(part.kind === 'powered' ? part.colour : 0x697c80, 1).fillRoundedRect(left, -width / 2, length, width, part.passenger ? 9 : 4);
    g.lineStyle(1.5, 0xcbd8d7, 0.6).strokeRoundedRect(left, -width / 2, length, width, part.passenger ? 9 : 4);
    if (part.kind === 'wagon') { this.drawWagon(g, part); g.fillStyle(0xe25d52, 1).fillCircle(left + 2, -7, 2).fillCircle(left + 2, 7, 2); return; }
    if (part.passenger) {
      g.fillStyle(0xe7e4d5, 1).fillRoundedRect(left + 6, -width * 0.25, length - 12, width * 0.5, 6);
      g.fillStyle(0x17394b, 1);
      for (let x = left + 24; x < length / 2 - 20; x += 19) { g.fillRect(x, -width / 2 + 1, 12, 4); g.fillRect(x, width / 2 - 5, 12, 4); }
      g.fillStyle(0xabc0c2, 1);
      for (const x of [-length * 0.24, length * 0.2]) g.fillRoundedRect(x - 9, -7, 18, 14, 3);
      g.fillStyle(0xf4c459, 1);
      if (part.cabAtFront) g.fillRoundedRect(length / 2 - 13, -width / 2 + 2, 11, width - 4, 4);
      if (part.cabAtRear) g.fillRoundedRect(left + 2, -width / 2 + 2, 11, width - 4, 4);
      g.fillStyle(0x123242, 1);
      if (part.cabAtFront) g.fillRect(length / 2 - 16, -9, 5, 18);
      if (part.cabAtRear) g.fillRect(left + 11, -9, 5, 18);
      if (part.silhouette === 'commuter-unit') this.drawPantograph(g, 0, width);
    } else if (part.silhouette === 'short-hood') {
      g.fillStyle(0xe0ded1, 1).fillRoundedRect(left + 8, -width / 2 + 1, length * 0.3, width - 2, 3);
      g.fillStyle(0x103447, 1).fillRect(left + length * 0.33, -10, 5, 20);
      g.fillStyle(0x18555c, 1).fillRoundedRect(-length * 0.07, -width * 0.32, length * 0.47, width * 0.64, 3);
      g.fillStyle(0x101f24, 1).fillCircle(length * 0.15, 0, 5);
      this.drawNoses(g, length, width, true);
    } else {
      g.fillStyle(part.silhouette === 'electric-box' ? 0xcbd4ce : 0xd8dacb, 1).fillRoundedRect(left + 19, -width * 0.31, length - 38, width * 0.62, 4);
      this.drawNoses(g, length, width, false);
      g.fillStyle(0x163342, 1).fillRect(left + 14, -11, 5, 22).fillRect(length / 2 - 19, -11, 5, 22);
      if (part.silhouette === 'electric-box') {
        this.drawPantograph(g, -length * 0.22, width); this.drawPantograph(g, length * 0.22, width);
        g.lineStyle(2, 0xb25134, 1).lineBetween(-length * 0.18, 0, length * 0.18, 0);
      } else {
        const fans = part.silhouette === 'heavy-six-axle' ? 3 : 2;
        for (let i = 0; i < fans; i++) { const x = (i - (fans - 1) / 2) * 24; g.fillStyle(0x203b41, 1).fillCircle(x, 0, 8); g.lineStyle(1.5, 0x95a8a3, 1).lineBetween(x - 6, 0, x + 6, 0).lineBetween(x, -6, x, 6); }
        if (part.silhouette === 'heavy-six-axle') { g.fillStyle(0x10313a, 1); for (let x = left + 30; x < length / 2 - 24; x += 9) { g.fillRect(x, -width / 2 + 2, 5, 4); g.fillRect(x, width / 2 - 6, 5, 4); } }
      }
    }
    if (part.cabAtFront) g.fillStyle(0xfff4bf, 1).fillCircle(length / 2 - 2, -7, 2).fillCircle(length / 2 - 2, 7, 2);
    if (part.passenger && part.cabAtRear) g.fillStyle(0xe25d52, 1).fillCircle(left + 2, -7, 1.5).fillCircle(left + 2, 7, 1.5);
  }

  private drawNoses(g: Phaser.GameObjects.Graphics, length: number, width: number, stripes: boolean): void {
    g.fillStyle(0xf4c459, 1).fillRect(length / 2 - 12, -width / 2 + 1, 10, width - 2);
    if (stripes) { g.lineStyle(2.5, 0x243f45, 1); for (const y of [-8, 0, 8]) g.lineBetween(length / 2 - 12, y - 4, length / 2 - 3, y + 4); }
    else g.fillRect(-length / 2 + 2, -width / 2 + 1, 10, width - 2);
  }

  private drawPantograph(g: Phaser.GameObjects.Graphics, x: number, width: number): void {
    g.lineStyle(2, 0x344b52, 1).lineBetween(x - 9, 0, x, -width * 0.27).lineBetween(x, -width * 0.27, x + 9, 0).lineBetween(x + 9, 0, x, width * 0.27).lineBetween(x, width * 0.27, x - 9, 0);
    g.lineStyle(2, 0xc87b58, 1).lineBetween(x - 6, -width * 0.33, x + 6, -width * 0.33);
  }

  private drawWagon(g: Phaser.GameObjects.Graphics, part: FleetPartVisual): void {
    const length = part.length, width = part.width, left = -length / 2;
    g.fillStyle(0x304850, 1).fillRoundedRect(left + 6, -width / 2 + 4, length - 12, width - 8, 2);
    if (part.wagonFamilyId === 'covered-hopper') {
      g.fillStyle(0xd4d5c5, 1).fillRoundedRect(left + 8, -width / 2 + 4, length - 16, width - 8, 7);
      for (const x of [-length / 4, 0, length / 4]) { g.fillStyle(0x7b8c89, 1).fillCircle(x, 0, 7); g.lineStyle(1, 0xf1f1df, 1).strokeCircle(x, 0, 5); }
    } else if (part.wagonFamilyId === 'covered-van' || part.wagonFamilyId === 'passenger-coach') {
      g.fillStyle(0xe1ddcc, 1).fillRoundedRect(left + 6, -width / 2 + 3, length - 12, width - 6, 3);
      g.lineStyle(1.5, 0xa4b0aa, 0.8); for (let x = left + 16; x < length / 2 - 8; x += 14) g.lineBetween(x, -width / 2 + 5, x, width / 2 - 5);
      g.fillStyle(part.colour, 1).fillRect(left + 8, width / 2 - 5, length - 16, 3);
    } else if (part.wagonFamilyId === 'bulk-hopper') {
      g.lineStyle(3, 0xa6b6af, 1).strokeRect(left + 6, -width / 2 + 4, length - 12, width - 8);
      if (part.loadFraction > 0) {
        const colour = part.productId === 'grain' ? 0xd8b55b : part.productId === 'scrap' ? 0x809a9d : 0xc3c4b9;
        g.fillStyle(colour, 1).fillRoundedRect(left + 11, -width / 2 + 8, (length - 22) * part.loadFraction, width - 16, 2);
        g.lineStyle(2, 0x344d54, 0.6); for (let x = left + 15; x < left + 11 + (length - 22) * part.loadFraction; x += 13) g.lineBetween(x, -4, x + 6, 4);
      }
    } else {
      g.lineStyle(1.5, 0x8b9890, 1); for (let x = left + 10; x < length / 2; x += 16) g.lineBetween(x, -10, x, 10);
      if (part.loadFraction > 0) {
        const loadLength = (length - 24) * part.loadFraction;
        if (part.productId === 'building-modules') {
          g.fillStyle(0xe3d8b7, 1).fillRoundedRect(left + 12, -12, Math.max(16, loadLength), 24, 2);
          g.fillStyle(0x426778, 1); for (let x = left + 19; x < left + 10 + loadLength; x += 22) g.fillRect(x, -6, 10, 5);
        } else {
          const colour = part.productId === 'steel' ? 0x98adb4 : part.productId === 'structural-timber' ? 0xd9b87d : 0x9c6943;
          g.fillStyle(colour, 1);
          for (const y of [-8, 0, 8]) g.fillRoundedRect(left + 12, y - 3, Math.max(10, loadLength), 6, part.productId === 'logs' ? 3 : 0);
          g.lineStyle(2, 0xd6cc9c, 0.95).lineBetween(-length * 0.25, -12, -length * 0.25, 12).lineBetween(length * 0.25, -12, length * 0.25, 12);
        }
      }
    }
    // A restrained load stripe communicates sealed cargo without pretending the roof is transparent.
    if (part.loadFraction > 0 && ['covered-hopper', 'covered-van'].includes(part.wagonFamilyId ?? '')) g.fillStyle(0xd4ad53, 1).fillRect(left + 12, -width / 2 + 2, (length - 24) * part.loadFraction, 3);
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
        display = { platform: this.scene.add.graphics().setDepth(48), people: this.scene.add.graphics().setDepth(51), badge: this.scene.add.text(0, 0, '', { fontFamily: 'Verdana', fontSize: '12px', color: '#fff8dd', backgroundColor: '#153746e8', padding: { x: 7, y: 4 } }).setOrigin(0.5, 0).setDepth(52), signature: '' };
        this.stations.set(station.id, display);
      }
      const length = (station.platformLengthMetres ?? 120) * 10;
      const signature = `${length}:${station.name}`;
      if (signature !== display.signature) {
        display.platform.clear().fillStyle(0x849391, 1).fillRoundedRect(-length / 2, 21, length, 28, 4);
        display.platform.lineStyle(2, 0xf0d37d, 1).lineBetween(-length / 2 + 4, 23, length / 2 - 4, 23);
        display.platform.fillStyle(0x284d59, 1).fillRoundedRect(-36, 29, 72, 16, 2);
        display.signature = signature;
      }
      display.platform.setPosition(pose.point.x, pose.point.y).setRotation(angle);
      display.people.clear().setPosition(pose.point.x, pose.point.y).setRotation(angle);
      const count = waiting[station.id] ?? 0;
      for (let i = 0; i < Math.min(8, count); i++) {
        const x = -length * 0.33 + i * Math.min(20, length / 12) + Math.sin(time / 1_000 + i * 1.7) * 4;
        display.people.fillStyle(i % 2 ? 0xe9c676 : 0xc0dde3, 1).fillCircle(x, 34, 2.5).fillRect(x - 2, 37, 4, 6);
      }
      display.badge.setText(`${count} waiting`).setPosition(pose.point.x - pose.tangent.y * 58, pose.point.y + pose.tangent.x * 58).setScale(1 / zoom);
    }
    for (const [id, display] of this.stations) if (!active.has(id)) { display.platform.destroy(); display.people.destroy(); display.badge.destroy(); this.stations.delete(id); }
  }
}
