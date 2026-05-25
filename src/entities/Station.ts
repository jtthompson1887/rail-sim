import Phaser from 'phaser';
import type RailTrack from './RailTrack';
import { EventBus } from '../services/EventBus';
import type { StationDef } from '../config/LevelData';

export class Station extends Phaser.GameObjects.Container {
  readonly stationId: string;
  readonly stationName: string;
  private waitingPassengers: number = 0;
  private spawnRate: number;
  private spawnAccumulator: number = 0;
  private track: RailTrack;
  private trackT: number;
  private label: Phaser.GameObjects.Text;
  private passengerBadge: Phaser.GameObjects.Text;
  private marker: Phaser.GameObjects.Arc;

  constructor(scene: Phaser.Scene, def: StationDef, track: RailTrack) {
    const pos = track.getCurvePath().getPoint(def.trackT);
    super(scene, pos.x, pos.y);
    this.stationId = def.id;
    this.stationName = def.name;
    this.spawnRate = def.passengerSpawnRate;
    this.track = track;
    this.trackT = def.trackT;

    scene.add.existing(this);
    this.setDepth(50);

    this.marker = scene.add.circle(0, 0, 16, 0xffd700, 1);
    this.marker.setStrokeStyle(3, 0xffffff, 1);
    this.add(this.marker);

    this.label = scene.add.text(0, -28, def.name, {
      fontFamily: 'Verdana', fontSize: '18px', color: '#ffffff',
      backgroundColor: '#00000088', padding: { x: 6, y: 2 },
    }).setOrigin(0.5, 1);
    this.add(this.label);

    this.passengerBadge = scene.add.text(20, -20, '0', {
      fontFamily: 'Verdana', fontSize: '14px', color: '#111111',
      backgroundColor: '#ffd700', padding: { x: 4, y: 2 },
    }).setOrigin(0, 1);
    this.add(this.passengerBadge);
  }

  update(delta: number): void {
    this.spawnAccumulator += (delta / 1000) * this.spawnRate;
    const spawned = Math.floor(this.spawnAccumulator);
    if (spawned > 0) {
      this.waitingPassengers += spawned;
      this.spawnAccumulator -= spawned;
      this.passengerBadge.setText(String(this.waitingPassengers));
    }
  }

  boardPassengers(capacity: number): number {
    const boarded = Math.min(this.waitingPassengers, capacity);
    this.waitingPassengers -= boarded;
    this.passengerBadge.setText(String(this.waitingPassengers));
    if (boarded > 0) {
      EventBus.emit('passenger:boarded', { stationId: this.stationId, count: boarded });
    }
    return boarded;
  }

  deliverPassengers(count: number): void {
    if (count > 0) {
      EventBus.emit('passenger:delivered', { stationId: this.stationId, count });
    }
  }

  getWaiting(): number { return this.waitingPassengers; }
  getTrack(): RailTrack { return this.track; }
  getTrackT(): number { return this.trackT; }
}
