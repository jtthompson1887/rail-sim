import Phaser from 'phaser';
import { PIDController } from '../utils/math';
import type RailTrack from './RailTrack';
import { matterScaling } from '../utils/physics';
import { GameConfig } from '../config/GameConfig';
import { EventBus } from '../services/EventBus';
import type { IVehicle, VehicleType } from '../config/VehicleTypes';

interface CarriageMatterImage extends Phaser.Physics.Matter.Image {
  parentCarriage?: Carriage;
}

export default class Carriage extends Phaser.GameObjects.Container implements IVehicle {
  private _carriageBody!: CarriageMatterImage;
  private texture: string;
  private readonly _pidControllerFront: PIDController;
  private readonly _pidControllerRear: PIDController;
  private _currentTrack: RailTrack | null = null;
  private _derailed: boolean = false;
  private _mass: number = GameConfig.TRAIN.DEFAULT_MASS * 0.8;
  private _selected: boolean = false;
  private readonly uuid: string;
  private passengers: number = 0;
  readonly vehicleType: VehicleType = 'passenger-carriage';
  readonly passengerCapacity: number = 40;
  public debugGraphics!: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, x: number, y: number, id?: string) {
    super(scene);
    this.scene = scene;
    this.scene.add.existing(this);
    this.texture = 'train1';
    this.uuid = id ?? crypto.randomUUID();
    this._pidControllerFront = new PIDController(GameConfig.PID.KP, GameConfig.PID.KI, GameConfig.PID.KD);
    this._pidControllerRear = new PIDController(GameConfig.PID.KP, GameConfig.PID.KI, GameConfig.PID.KD);
    this.setDepth(100);

    this._carriageBody = scene.matter.add.image(x, y, this.texture, undefined) as CarriageMatterImage;
    matterScaling(this._carriageBody, GameConfig.TRAIN.SCALE_X, GameConfig.TRAIN.SCALE_Y);
    this._carriageBody.setMass(this._mass);
    this._carriageBody.setFrictionAir(GameConfig.PHYSICS.FRICTION_AIR);
    this._carriageBody.setDepth(100);
    this.add(this._carriageBody);

    const width = this._carriageBody.displayWidth;
    const height = this._carriageBody.displayHeight;
    this.setSize(width, height);

    this.setInteractive({ cursor: 'pointer' });
    this._carriageBody.setInteractive({ cursor: 'pointer' });
    this._carriageBody.parentCarriage = this;

    this.debugGraphics = this.scene.add.graphics();
    this.debugGraphics.setDepth(1000);
  }

  update(time: number, delta: number): void {
    this.pidControllerRear.setCurrentDelta(Math.max(delta, 1));
    this.pidControllerFront.setCurrentDelta(Math.max(delta, 1));
    // Carriages have no self-propulsion; TrackFlowSolver handles alignment
  }

  getUUID(): string {
    return this.uuid;
  }

  get derailed(): boolean {
    return this._derailed;
  }

  set derailed(value: boolean) {
    if (value && !this._derailed) {
      this.texture = 'train2';
      this._carriageBody.setTexture(this.texture);
      const angle = this._carriageBody.angle;
      matterScaling(this._carriageBody, GameConfig.TRAIN.DERAIL_SCALE, GameConfig.TRAIN.DERAIL_SCALE);
      this._carriageBody.setMass(this._mass);
      this._carriageBody.angle = angle;
      EventBus.emit('carriage:derailed', { carriageId: this.uuid });
    }
    this._derailed = value;
  }

  get enginePower(): number {
    return 0;
  }

  set enginePower(_value: number) {
    // Carriages have no engine power
  }

  get currentTrack(): RailTrack | null {
    return this._currentTrack;
  }

  set currentTrack(value: RailTrack | null) {
    this._currentTrack = value;
  }

  get selected(): boolean {
    return this._selected;
  }

  set selected(value: boolean) {
    this._selected = value;
    if (value) {
      this._carriageBody.setTint(0x00ff00);
    } else {
      this._carriageBody.clearTint();
    }
  }

  getMatterBody(): Phaser.Physics.Matter.Image {
    return this._carriageBody;
  }

  get pidControllerFront(): PIDController {
    return this._pidControllerFront;
  }

  get pidControllerRear(): PIDController {
    return this._pidControllerRear;
  }

  getPassengerCount(): number {
    return this.passengers;
  }

  boardPassengers(count: number): number {
    const accepted = Math.min(this.passengerCapacity - this.passengers, count);
    this.passengers += accepted;
    return accepted;
  }

  unloadPassengers(): number {
    const delivered = this.passengers;
    this.passengers = 0;
    return delivered;
  }

  /**
   * Reset a derailed carriage back to its normal running state.
   * Restores texture, scale, mass, and zeroes velocity so the
   * TrackFlowSolver can guide the carriage back onto the track.
   */
  recover(): void {
    if (!this._derailed) return;
    this._derailed = false;
    this.texture = 'train1';
    this._carriageBody.setTexture(this.texture);
    const angle = this._carriageBody.angle;
    matterScaling(this._carriageBody, GameConfig.TRAIN.SCALE_X, GameConfig.TRAIN.SCALE_Y);
    this._carriageBody.setFrictionAir(GameConfig.PHYSICS.FRICTION_AIR);
    this._carriageBody.setMass(this._mass);
    this._carriageBody.setAngle(angle);
    this._carriageBody.setVelocity(0, 0);
    this._carriageBody.setAngularVelocity(0);
    const body = this._carriageBody.body as any;
    if (body?.force) {
      body.force.x = 0;
      body.force.y = 0;
    }
  }
}
