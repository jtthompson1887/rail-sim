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
import { TrackGraphRouteResolver } from '../physics/RouteCursor';
import { createDerailmentHazardState } from '../physics/DerailmentEvaluator';
import type { OnRailVehicleState } from '../physics/RailVehicleModel';
import { TRAIN_PHYSICS_CONFIG } from '../physics/TrainPhysicsConfig';
import { TrainDynamicsAdapter } from '../systems/TrainDynamicsAdapter';
import type { PersistedVehicleDynamics } from '../config/WorldData';

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
  private accumulatorSeconds = 0;
  private dynamicsDirty = true;
  private topologySignature = '';
  private mostRecentConsistId: string | null = null;

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
    if (this._selectedTrain && this._selectedTrain !== train) {
      this._selectedTrain.selected = false;
    }
    train.selected = true;
    this._selectedTrain = train;
    EventBus.emit('train:selected', { trainId: train.getUUID() });
    this.cameraController.startFollow(train.getMatterBody());
  }

  /**
   * Programmatically select a train and start the camera following it.
   * Unlike handleTrainClick this does not require a pointer event, so it
   * can be called when entering play mode to auto-follow the first train.
   */
  selectTrain(train: Train): void {
    if (this._selectedTrain && this._selectedTrain !== train) {
      this._selectedTrain.selected = false;
    }
    train.selected = true;
    this._selectedTrain = train;
    EventBus.emit('train:selected', { trainId: train.getUUID() });
    this.cameraController.startFollow(train.getMatterBody());
  }

  deselectTrain(): void {
    if (this._selectedTrain) {
      this._selectedTrain.selected = false;
      this._selectedTrain = null;
      EventBus.emit('train:deselected', {});
      this.cameraController.stopFollow();
    }
  }

  get selectedTrain(): Train | null {
    return this._selectedTrain;
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

  restoreVehicleDynamics(
    vehicle: IVehicle,
    dynamics: PersistedVehicleDynamics,
  ): void {
    vehicle.persistedDynamics = { ...dynamics };
    const body = vehicle.getMatterBody();
    if (dynamics.mode === 'free-body') {
      vehicle.currentTrack = null;
      vehicle.derailed = true;
      body.setPosition(dynamics.x, dynamics.y);
      body.setAngle(dynamics.angleRad * 180 / Math.PI);
      body.setVelocity(dynamics.velocityX, dynamics.velocityY);
      body.setAngularVelocity(dynamics.angularVelocityRadPerSec);
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

  update(time: number, delta: number): void {
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
          const prior = priorStates.get(vehicle.getUUID());
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
    this.dynamicsDirty = false;
  }

  private allVehicles(): IVehicle[] {
    return [...this.trains, ...this.carriages];
  }
}
