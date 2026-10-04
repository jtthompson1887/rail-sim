import Phaser from 'phaser';
import Train from '../entities/Train';
import Carriage from '../entities/Carriage';
import type TrackManager from './TrackManager';
import { CameraController } from '../systems/CameraController';
import { GameStateManager } from './GameStateManager';
import { EventBus } from '../services/EventBus';
import { GameConfig } from '../config/GameConfig';
import {
  getRailVehicleDefinition,
  type ITrackFollower,
  type IVehicle,
} from '../config/VehicleTypes';
import type RailTrack from '../entities/RailTrack';
import { TrackGraphRouteResolver } from '../physics/adapters/TrackGraphRouteResolver';
import { createDerailmentHazardState } from '../physics/DerailmentEvaluator';
import type { OnRailVehicleState } from '../physics/RailVehicleModel';
import { TRAIN_PHYSICS_CONFIG } from '../physics/TrainPhysicsConfig';
import { TrainDynamicsAdapter } from '../systems/TrainDynamicsAdapter';
import type { PersistedVehicleDynamics } from '../config/WorldData';
import { detectRailCollisions } from '../physics/RailCollisionDetector';
import { createCrashTransition } from '../physics/CrashTransition';
import type { SimulationTrainSnapshot } from '../simulation/SimulationTypes';

interface Bounds {
  min: { x: number; y: number };
  max: { x: number; y: number };
  corners: Array<{ x: number; y: number }>;
}

/** Shared snap-and-reset transition for recovering any derailed vehicle. */
export function recoverDerailedFollowerOnTrack(
  follower: ITrackFollower,
  track: RailTrack,
): void {
  const body = follower.getMatterBody();
  const snappedPoint = track.getTrackPoint(body);
  const snappedAngle = track.getTrackAngle(body);
  body.setPosition(snappedPoint.x, snappedPoint.y);
  body.setAngle(snappedAngle);
  follower.currentTrack = track;
  follower.recover();
  follower.enginePower = 0;
}

export class TrainManager {
  private scene: Phaser.Scene;
  private _selectedTrain: Train | null = null;
  trains: Train[] = [];
  private trackManager: TrackManager;
  private cameraController: CameraController;
  carriages: Carriage[] = [];
  private readonly dynamicsAdapters = new Map<string, TrainDynamicsAdapter>();
  private readonly vehicleConsists = new Map<string, { consistId: string; order: number }>();
  private readonly restoredVehicleIds = new Set<string>();
  private accumulatorSeconds = 0;
  private dynamicsDirty = true;
  private topologySignature = '';
  private mostRecentConsistId: string | null = null;
  private fixedTick = 0;
  private managedTrainIds = new Set<string>();

  /** Map from Matter body game objects back to their owning vehicle (Train or Carriage). */
  static readonly bodyToTrain: WeakMap<Phaser.GameObjects.GameObject, ITrackFollower> = new WeakMap();

  constructor(scene: Phaser.Scene, trackManager: TrackManager, cameraController: CameraController) {
    this.scene = scene;
    this.trackManager = trackManager;
    this.cameraController = cameraController;
  }

  createInitialTrain(id?: string): Train {
    const train = new Train(this.scene, 0, 500, id);
    train.getMatterBody().angle = 90;
    this.trains.push(train);
    const consistId = `consist-${train.getUUID()}`;
    this.vehicleConsists.set(train.getUUID(), { consistId, order: 0 });
    this.mostRecentConsistId = consistId;
    this.dynamicsDirty = true;
    TrainManager.bodyToTrain.set(train.getMatterBody(), train);
    GameStateManager.setActiveTrains(this.trains.length);
    return train;
  }

  createFreightTrain(id: string, freightSetId: string): Train {
    const train = new Train(this.scene, 0, 500, id, freightSetId);
    train.getMatterBody().angle = 90;
    this.trains.push(train);
    const consistId = `consist-${train.getUUID()}`;
    this.vehicleConsists.set(train.getUUID(), { consistId, order: 0 });
    this.mostRecentConsistId = consistId;
    this.dynamicsDirty = true;
    TrainManager.bodyToTrain.set(train.getMatterBody(), train);
    GameStateManager.setActiveTrains(this.trains.length);
    return train;
  }

  placeFreightTrain(
    train: Train,
    trackUUID: string,
    trackT: number,
    facing: 1 | -1,
  ): boolean {
    if (this.trains.indexOf(train) === -1
      || train.freightSetId === null
      || !Number.isFinite(trackT)
      || trackT < 0
      || trackT > 1
      || (facing !== 1 && facing !== -1)) return false;
    const track = this.trackManager.getTrack(trackUUID);
    if (!track) return false;
    try {
      const body = train.getMatterBody();
      const point = track.getCurvePath().getPoint(trackT);
      body.setPosition(point.x, point.y);
      train.currentTrack = track;
      body.setAngle(
        track.getTrackAngle(body) + (facing === -1 ? 180 : 0),
      );
      train.enginePower = 0;
      body.setVelocity(0, 0);
      body.setAngularVelocity(0);
      const distance = track.getArcLengthIndex().distanceForPoint(point);
      const consist = this.vehicleConsists.get(train.getUUID()) ?? {
        consistId: `consist-${train.getUUID()}`,
        order: 0,
      };
      train.persistedDynamics = {
        mode: 'on-rail',
        trackUUID,
        distance,
        direction: facing,
        speedMps: 0,
        consistId: consist.consistId,
        consistOrder: consist.order,
      };
      this.dynamicsDirty = true;
      return true;
    } catch {
      return false;
    }
  }

  removeFreightTrain(trainId: string): boolean {
    const index = this.trains.findIndex(
      (train) => train.getUUID() === trainId
        && train.freightSetId !== null,
    );
    if (index === -1) return false;

    const train = this.trains[index];
    if (this._selectedTrain === train) this.deselectTrain();
    this.trains.splice(index, 1);
    this.vehicleConsists.delete(train.getUUID());
    this.dynamicsDirty = true;
    const body = train.getMatterBody();
    TrainManager.bodyToTrain.delete(body);
    body.destroy();
    train.destroy();
    GameStateManager.setActiveTrains(this.trains.length);
    return true;
  }

  stopFreightTrains(trainIds: readonly string[]): void {
    const requested = new Set(trainIds);
    for (const train of this.trains) {
      if (train.freightSetId !== null
        && requested.has(train.getUUID())) train.enginePower = 0;
    }
  }

  createCarriage(id?: string): Carriage {
    const carriage = new Carriage(this.scene, 0, 500, id);
    carriage.getMatterBody().angle = 90;
    this.carriages.push(carriage);
    const consistId = this.mostRecentConsistId ?? `consist-${carriage.getUUID()}`;
    const order = Array.from(this.vehicleConsists.values())
      .filter((assignment) => assignment.consistId === consistId)
      .length;
    this.vehicleConsists.set(carriage.getUUID(), { consistId, order });
    this.dynamicsDirty = true;
    TrainManager.bodyToTrain.set(carriage.getMatterBody(), carriage);
    return carriage;
  }

  handleTrainClick(train: Train, pointer: Phaser.Input.Pointer): void {
    if (pointer.button !== 0) return;
    this.selectTrain(train.getUUID());
  }

  /**
   * Programmatically select a train and start the camera following it.
   * Unlike handleTrainClick this does not require a pointer event, so it
   * can be called when entering play mode to auto-follow the first train.
   */
  selectTrain(trainId: string | null): void {
    const train = trainId === null
      ? null
      : this.trains.find((candidate) => candidate.getUUID() === trainId)
        ?? null;
    if (train === this._selectedTrain) return;

    const releasedSelection = this._selectedTrain !== null;
    if (releasedSelection) this.releaseSelectedTrain();

    if (train) {
      train.selected = true;
      this._selectedTrain = train;
      this.cameraController.startFollow(train.getMatterBody());
      EventBus.emit('train:selected', { trainId: train.getUUID() });
    } else if (releasedSelection) {
      EventBus.emit('train:deselected', {});
    }
  }

  deselectTrain(): void {
    if (!this._selectedTrain) return;
    this.releaseSelectedTrain();
    EventBus.emit('train:deselected', {});
  }

  get selectedTrain(): Train | null {
    return this._selectedTrain;
  }

  stopTrainImmediately(train: Train): void {
    if (this.managedTrainIds.has(train.getUUID())) return;
    const assignment = this.vehicleConsists.get(train.getUUID());
    const adapter = assignment && this.dynamicsAdapters.get(assignment.consistId);
    if (adapter) adapter.stopImmediately();
    else if (train.persistedDynamics?.mode === 'on-rail') {
      this.restoreVehicleDynamics(train, { ...train.persistedDynamics, speedMps: 0 });
    }
    train.enginePower = 0;
  }

  private releaseSelectedTrain(): void {
    if (!this._selectedTrain) return;
    this._selectedTrain.enginePower = 0;
    this._selectedTrain.selected = false;
    this._selectedTrain = null;
    this.cameraController.stopFollow();
  }

  tryRecoverDerailedTrain(follower: ITrackFollower): boolean {
    if (!follower.derailed) return false;
    const trainBody = follower.getMatterBody();
    const closestTrack = this.trackManager.getClosestTrack(
      { x: trainBody.x, y: trainBody.y },
      Math.max(GameConfig.TRACK.MAX_CLOSE_DISTANCE, 120),
      follower.currentTrack ?? undefined,
    );
    if (!closestTrack) {
      return false;
    }

    recoverDerailedFollowerOnTrack(follower, closestTrack);
    this.dynamicsDirty = true;
    return true;
  }

  assignVehicleToConsist(vehicle: IVehicle, consistId: string, order: number): void {
    this.vehicleConsists.set(vehicle.getUUID(), { consistId, order });
    this.mostRecentConsistId = consistId;
    this.dynamicsDirty = true;
  }

  getDynamicsAdapter(consistId: string): TrainDynamicsAdapter | undefined {
    return this.dynamicsAdapters.get(consistId);
  }

  /** The pure session owns these trains; manual physics must never advance them again. */
  setManagedTrainIds(trainIds: ReadonlySet<string>): void {
    const changed = this.managedTrainIds.size !== trainIds.size
      || [...trainIds].some((id) => !this.managedTrainIds.has(id));
    if (!changed) return;
    const previouslyManaged = this.managedTrainIds;
    this.managedTrainIds = new Set(trainIds);
    this.dynamicsDirty = true;
    for (const train of this.trains) {
      if (this.managedTrainIds.has(train.getUUID()) || previouslyManaged.has(train.getUUID())) train.enginePower = 0;
      if (previouslyManaged.has(train.getUUID()) && !this.managedTrainIds.has(train.getUUID()) && train.persistedDynamics?.mode === 'on-rail') {
        train.persistedDynamics.speedMps = 0;
      }
    }
  }

  applyManagedSnapshots(snapshots: readonly SimulationTrainSnapshot[]): void {
    const byId = new Map(snapshots.map((snapshot) => [snapshot.trainId, snapshot]));
    for (const train of this.trains) {
      if (!this.managedTrainIds.has(train.getUUID())) continue;
      const snapshot = byId.get(train.getUUID());
      const track = snapshot && this.trackManager.getTrack(snapshot.trackUUID);
      if (!snapshot || !track) continue;
      const body = train.getMatterBody();
      train.enginePower = 0;
      train.currentTrack = snapshot.derailed ? null : track;
      train.derailed = snapshot.derailed === true;
      body.setPosition(snapshot.x, snapshot.y);
      body.setAngle(snapshot.angleRad * 180 / Math.PI);
      body.setVelocity(0, 0);
      body.setAngularVelocity(0);
      (body.body as any).isStatic = true;
      const assignment = this.vehicleConsists.get(train.getUUID()) ?? { consistId: `consist-${train.getUUID()}`, order: 0 };
      if (!snapshot.derailed) train.persistedDynamics = { mode: 'on-rail', trackUUID: snapshot.trackUUID, distance: snapshot.distance,
        direction: snapshot.facing, speedMps: snapshot.speedMps, consistId: assignment.consistId, consistOrder: assignment.order };
    }
  }

  restoreVehicleDynamics(
    vehicle: IVehicle,
    dynamics: PersistedVehicleDynamics,
  ): void {
    vehicle.persistedDynamics = { ...dynamics };
    this.restoredVehicleIds.add(vehicle.getUUID());
    const body = vehicle.getMatterBody();
    if (dynamics.mode === 'free-body') {
      vehicle.currentTrack = null;
      vehicle.derailed = true;
      body.setPosition(dynamics.x, dynamics.y);
      body.setAngle(dynamics.angleRad * 180 / Math.PI);
      const velocityScale = TRAIN_PHYSICS_CONFIG.worldUnitsPerMetre / 60;
      body.setVelocity(dynamics.velocityX * velocityScale, dynamics.velocityY * velocityScale);
      body.setAngularVelocity(dynamics.angularVelocityRadPerSec / 60);
      (body.body as any).isStatic = false;
      this.dynamicsDirty = true;
      return;
    }

    const track = this.trackManager.getTrack(dynamics.trackUUID);
    if (!track) return;
    const pose = track.getArcLengthIndex().poseAtDistance(dynamics.distance);
    vehicle.currentTrack = track;
    vehicle.derailed = false;
    body.setPosition(pose.point.x, pose.point.y);
    const directionAngle = dynamics.direction === 1 ? 0 : Math.PI;
    body.setAngle((Math.atan2(pose.tangent.y, pose.tangent.x) + directionAngle) * 180 / Math.PI);
    this.vehicleConsists.set(vehicle.getUUID(), {
      consistId: dynamics.consistId,
      order: dynamics.consistOrder,
    });
    this.mostRecentConsistId = dynamics.consistId;
    this.dynamicsDirty = true;
  }

  getBounds(trainBody: Phaser.Physics.Matter.Sprite): Bounds | null {
    if (!trainBody) return null;

    const width = trainBody.displayWidth;
    const height = trainBody.displayHeight;
    const x = trainBody.x;
    const y = trainBody.y;
    const angle = trainBody.angle * (Math.PI / 180);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const halfWidth = width / 2;
    const halfHeight = height / 2;

    const corners = [
      { x: x + (-halfWidth * cos - halfHeight * sin), y: y + (-halfWidth * sin + halfHeight * cos) },
      { x: x + (halfWidth * cos - halfHeight * sin), y: y + (halfWidth * sin + halfHeight * cos) },
      { x: x + (halfWidth * cos + halfHeight * sin), y: y + (halfWidth * sin - halfHeight * cos) },
      { x: x + (-halfWidth * cos + halfHeight * sin), y: y + (-halfWidth * sin - halfHeight * cos) }
    ];

    const bounds = corners.reduce((acc, corner) => ({
      min: { x: Math.min(acc.min.x, corner.x), y: Math.min(acc.min.y, corner.y) },
      max: { x: Math.max(acc.max.x, corner.x), y: Math.max(acc.max.y, corner.y) }
    }), {
      min: { x: corners[0].x, y: corners[0].y },
      max: { x: corners[0].x, y: corners[0].y }
    });

    return { min: bounds.min, max: bounds.max, corners };
  }

  update(
    time: number,
    delta: number,
    operationsLockedTrainIds: ReadonlySet<string> = new Set(),
  ): void {
    void time;
    for (const train of this.trains) {
      if (this.managedTrainIds.has(train.getUUID()) || (train.freightSetId !== null
        && operationsLockedTrainIds.has(train.getUUID()))) {
        train.enginePower = 0;
      }
    }
    const signature = [
      ...this.trackManager.tracks.map((track) => track.getUUID()),
      ...this.trackManager.junctions.map((junction) => junction.getUUID()),
    ].sort().join('|');
    if (signature !== this.topologySignature) {
      this.topologySignature = signature;
      this.dynamicsDirty = true;
    }
    if (this.dynamicsDirty) this.rebuildDynamicsAdapters();

    this.accumulatorSeconds += Math.min(Math.max(delta, 0) / 1000, 0.25);
    while (this.accumulatorSeconds >= TRAIN_PHYSICS_CONFIG.fixedStepSeconds) {
      this.dynamicsAdapters.forEach((adapter) => {
        adapter.fixedUpdate(TRAIN_PHYSICS_CONFIG.fixedStepSeconds);
      });
      this.fixedTick += 1;
      this.dispatchRailCollisions();
      this.accumulatorSeconds -= TRAIN_PHYSICS_CONFIG.fixedStepSeconds;
    }
    const alpha = this.accumulatorSeconds / TRAIN_PHYSICS_CONFIG.fixedStepSeconds;
    this.dynamicsAdapters.forEach((adapter) => adapter.render(alpha));
    GameStateManager.setActiveTrains(this.trains.length);
  }

  private rebuildDynamicsAdapters(): void {
    const priorStates = new Map<string, OnRailVehicleState>();
    this.dynamicsAdapters.forEach((adapter) => {
      adapter.getConsistState().vehicles.forEach((state) => priorStates.set(state.vehicleId, state));
    });
    this.dynamicsAdapters.clear();
    const resolver = new TrackGraphRouteResolver(
      this.trackManager.tracks,
      this.trackManager.junctions,
    );
    const grouped = new Map<string, IVehicle[]>();
    for (const vehicle of this.allVehicles()) {
      if (this.managedTrainIds.has(vehicle.getUUID())) continue;
      if (vehicle.derailed || !vehicle.currentTrack) continue;
      const assignment = this.vehicleConsists.get(vehicle.getUUID()) ?? {
        consistId: `consist-${vehicle.getUUID()}`,
        order: 0,
      };
      const list = grouped.get(assignment.consistId) ?? [];
      list.push(vehicle);
      grouped.set(assignment.consistId, list);
    }

    grouped.forEach((vehicles, consistId) => {
      const bindings = vehicles
        .map((vehicle) => {
          const definition = getRailVehicleDefinition(vehicle.vehicleType);
          if (!definition || !vehicle.currentTrack) return null;
          const assignment = this.vehicleConsists.get(vehicle.getUUID())!;
          const track = vehicle.currentTrack;
          const body = vehicle.getMatterBody();
          const persisted = vehicle.persistedDynamics?.mode === 'on-rail'
            ? vehicle.persistedDynamics
            : null;
          const prior = this.restoredVehicleIds.has(vehicle.getUUID()) ? undefined : priorStates.get(vehicle.getUUID());
          const distance = track.getArcLengthIndex().distanceForPoint({ x: body.x, y: body.y });
          const pose = track.getArcLengthIndex().poseAtDistance(distance);
          const heading = { x: Math.cos(body.rotation), y: Math.sin(body.rotation) };
          const direction = heading.x * pose.tangent.x + heading.y * pose.tangent.y >= 0
            ? 1 as const
            : -1 as const;
          return {
            vehicle,
            definition,
            order: assignment.order,
            state: prior ?? {
              mode: 'on-rail' as const,
              vehicleId: vehicle.getUUID(),
              centre: {
                trackUUID: persisted?.trackUUID ?? track.getUUID(),
                distance: persisted?.distance ?? distance,
                direction: persisted?.direction ?? direction,
              },
              speedMps: persisted?.speedMps ?? 0,
              hazard: createDerailmentHazardState(vehicle.getUUID()),
            },
          };
        })
        .filter((binding): binding is NonNullable<typeof binding> => binding !== null);
      if (bindings.length > 0) {
        this.dynamicsAdapters.set(consistId, new TrainDynamicsAdapter({
          consistId,
          resolver,
          bindings,
        }));
      }
    });
    this.restoredVehicleIds.clear();
    this.dynamicsDirty = false;
  }

  private allVehicles(): IVehicle[] {
    return [...this.trains, ...this.carriages];
  }

  private dispatchRailCollisions(): void {
    const adapters = [...this.dynamicsAdapters.values()];
    const vehicles = adapters.reduce(
      (all, adapter) => all.concat(adapter.getRailCollisionVehicles()),
      [] as ReturnType<TrainDynamicsAdapter['getRailCollisionVehicles']>,
    );
    if (vehicles.length < 2) return;
    const previousPoses = new Map(
      adapters.reduce<Array<[string, ReturnType<TrainDynamicsAdapter['getPreviousRailPoses']> extends ReadonlyMap<string, infer Pose> ? Pose : never]>>(
        (all, adapter) => all.concat([...adapter.getPreviousRailPoses().entries()]),
        [],
      ),
    );
    const currentPoses = new Map(
      adapters.reduce<Array<[string, ReturnType<TrainDynamicsAdapter['getCurrentRailPoses']> extends ReadonlyMap<string, infer Pose> ? Pose : never]>>(
        (all, adapter) => all.concat([...adapter.getCurrentRailPoses().entries()]),
        [],
      ),
    );
    const collisions = detectRailCollisions(
      vehicles,
      previousPoses,
      currentPoses,
      TRAIN_PHYSICS_CONFIG.fixedStepSeconds,
    );
    for (const collision of collisions) {
      const involved = [collision.vehicleAId, collision.vehicleBId]
        .map((vehicleId) => adapters
          .map((adapter) => adapter.getCrashTransitionVehicle(vehicleId))
          .find((vehicle) => vehicle !== null) ?? null)
        .filter((vehicle): vehicle is NonNullable<typeof vehicle> => vehicle !== null);
      if (involved.length !== 2) continue;
      const transition = createCrashTransition(involved, collision, this.fixedTick);
      transition.freeBodies.forEach((freeBody, index) => {
        const owner = adapters.find((adapter) => adapter.hasVehicle(freeBody.vehicleId));
        owner?.transitionToFreeBody(freeBody, transition.incident, index === 0);
      });
    }
  }
}
