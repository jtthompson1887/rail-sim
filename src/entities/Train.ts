import Phaser from 'phaser';
import { PIDController } from '../utils/math';
import type RailTrack from './RailTrack';
import { applyForceToGameObject, matterScaling } from '../utils/physics';
import { GameConfig } from '../config/GameConfig';
import { EventBus } from '../services/EventBus';

interface TrainMatterImage extends Phaser.Physics.Matter.Image {
  parentTrain?: Train;
}

export default class Train extends Phaser.GameObjects.Container {
  private _trainBody!: TrainMatterImage;
  private texture: string;
  private readonly _pidControllerFront: PIDController;
  private readonly _pidControllerRear: PIDController;
  private _currentTrack: RailTrack | null = null;
  private _derailed: boolean = false;
  private _enginePower: number = 0;
  private _mass: number = GameConfig.TRAIN.DEFAULT_MASS;
  private _selected: boolean = false;
  private readonly uuid: string;
  private passengers: number = 0;
  readonly passengerCapacity: number = 20;
  public debugGraphics!: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene);
    this.scene = scene;
    this.scene.add.existing(this);
    this.texture = 'train1';
    this.uuid = crypto.randomUUID();
    this._pidControllerFront = new PIDController(GameConfig.PID.KP, GameConfig.PID.KI, GameConfig.PID.KD);
    this._pidControllerRear = new PIDController(GameConfig.PID.KP, GameConfig.PID.KI, GameConfig.PID.KD);
    this.setDepth(100);

    this._trainBody = scene.matter.add.image(x, y, this.texture, undefined) as TrainMatterImage;
    matterScaling(this._trainBody, GameConfig.TRAIN.SCALE_X, GameConfig.TRAIN.SCALE_Y);
    this._trainBody.setMass(this._mass);
    this._trainBody.setFrictionAir(GameConfig.PHYSICS.FRICTION_AIR);
    this._trainBody.setDepth(100);
    this.add(this._trainBody);

    const width = this._trainBody.displayWidth;
    const height = this._trainBody.displayHeight;
    this.setSize(width, height);

    this.setInteractive({ cursor: 'pointer' });
    this._trainBody.setInteractive({ cursor: 'pointer' });
    this._trainBody.parentTrain = this;

    this.debugGraphics = this.scene.add.graphics();
    this.debugGraphics.setDepth(1000);
  }

  update(time: number, delta: number): void {
    this.pidControllerRear.setCurrentDelta(Math.max(delta, 1));
    this.pidControllerFront.setCurrentDelta(Math.max(delta, 1));
    if (!this.derailed && this._enginePower !== 0) {
      const angle = this._trainBody.rotation;
      const forceMagnitude = this._enginePower;
      const forceVec = new Phaser.Math.Vector2(Math.cos(angle) * forceMagnitude, Math.sin(angle) * forceMagnitude);
      applyForceToGameObject(this._trainBody, forceVec);
    }
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
      this._trainBody.setTexture(this.texture);
      const angle = this._trainBody.angle;
      matterScaling(this._trainBody, GameConfig.TRAIN.DERAIL_SCALE, GameConfig.TRAIN.DERAIL_SCALE);
      this._trainBody.setMass(this._mass);
      this._trainBody.angle = angle;
      EventBus.emit('train:derailed', { trainId: this.uuid });
    }
    this._derailed = value;
  }

  get enginePower(): number {
    return this._enginePower;
  }

  set enginePower(value: number) {
    this._enginePower = value;
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
      this._trainBody.setTint(0x00ff00);
    } else {
      this._trainBody.clearTint();
    }
  }

  getMatterBody(): Phaser.Physics.Matter.Image {
    return this._trainBody;
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
   * Reset a derailed train back to its normal running state.
   * Restores texture, scale, mass, and zeroes velocity so the
   * TrackFlowSolver can guide the train back onto the track.
   */
  recover(): void {
    if (!this._derailed) return;
    this._derailed = false;
    this.texture = 'train1';
    this._trainBody.setTexture(this.texture);
    const angle = this._trainBody.angle;
    matterScaling(this._trainBody, GameConfig.TRAIN.SCALE_X, GameConfig.TRAIN.SCALE_Y);
    this._trainBody.setFrictionAir(GameConfig.PHYSICS.FRICTION_AIR);
    this._trainBody.setMass(this._mass);
    this._trainBody.angle = angle;
    this._trainBody.setVelocity(0, 0);
    this._trainBody.setAngularVelocity(0);
  }
}
