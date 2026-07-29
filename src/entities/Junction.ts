import Phaser from 'phaser';
import { GameConfig } from '../config/GameConfig';
import { EventBus } from '../services/EventBus';
import RailTrack from './RailTrack';
import type { TrackNode } from './TrackNode';

export default class Junction extends Phaser.GameObjects.Container implements TrackNode {
  private mainTrack: RailTrack;
  private leftTrack: RailTrack;
  private rightTrack: RailTrack;
  private junctionPosition: number;
  private _branchState: 'left' | 'right' = 'right';
  private switched: boolean = false;
  private uuid: string;
  private hitArea: Phaser.GameObjects.Arc;
  protected trackConnections: {
    next?: TrackNode;
    previous?: TrackNode;
  } = {};

  constructor(scene: Phaser.Scene, mainTrack: RailTrack, leftTrack: RailTrack, rightTrack: RailTrack, position: number) {
    super(scene);
    this.scene.add.existing(this);
    this.mainTrack = mainTrack;
    this.leftTrack = leftTrack;
    this.rightTrack = rightTrack;
    this.junctionPosition = position;
    this.uuid = crypto.randomUUID();
    this.setDepth(1);

    const junctionPoint = mainTrack.getCurvePath().getPoint(position);
    this.setPosition(junctionPoint.x, junctionPoint.y);

    this.hitArea = scene.add.circle(0, 0, 10, 0xffff00, 0.5);
    this.add(this.hitArea);

    this.hitArea.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      this.toggle();
    });

    this.leftTrack.setAlpha(0.5);
    this.rightTrack.setAlpha(1);
  }

  get branchState(): 'left' | 'right' {
    return this._branchState;
  }

  set branchState(value: 'left' | 'right') {
    this._branchState = value;
    this.syncBranchVisuals();
  }

  getActiveTrack(): RailTrack {
    return this.mainTrack;
  }

  getActiveBranchTrack(): RailTrack {
    return this._branchState === 'left' ? this.leftTrack : this.rightTrack;
  }

  getInactiveBranchTrack(): RailTrack {
    return this._branchState === 'left' ? this.rightTrack : this.leftTrack;
  }

  getRoutedContinuation(fromTrack: RailTrack): RailTrack | null {
    if (fromTrack === this.mainTrack) return this.getActiveBranchTrack();
    if (fromTrack === this.leftTrack || fromTrack === this.rightTrack) return this.mainTrack;
    return null;
  }

  toggle(): void {
    this._branchState = this._branchState === 'left' ? 'right' : 'left';
    this.switched = true;
    this.syncBranchVisuals();

    EventBus.emit('junction:toggled', { junctionId: this.uuid, state: this._branchState });
  }

  getForceScale(track: RailTrack): number {
    if (track === this.mainTrack) {
      return 1;
    }
    if (track === this.getActiveBranchTrack()) {
      return 1;
    }
    if (track === this.getInactiveBranchTrack()) {
      return -1;
    }
    return 0;
  }

  getAllTracks(): RailTrack[] {
    return [this.mainTrack, this.leftTrack, this.rightTrack];
  }

  getUUID(): string {
    return this.uuid;
  }

  setUUID(uuid: string): void {
    this.uuid = uuid;
  }

  getMainTrack(): RailTrack {
    return this.mainTrack;
  }

  getLeftTrack(): RailTrack {
    return this.leftTrack;
  }

  getRightTrack(): RailTrack {
    return this.rightTrack;
  }

  getPosition(): number {
    return this.junctionPosition;
  }

  getBranchLength(): number {
    return GameConfig.JUNCTION.LENGTH;
  }

  isSwitched(): boolean {
    return this.switched;
  }

  private syncBranchVisuals(): void {
    this.leftTrack.setAlpha(this._branchState === 'left' ? 1 : 0.5);
    this.rightTrack.setAlpha(this._branchState === 'right' ? 1 : 0.5);
  }

  hasNext(): boolean {
    return this.trackConnections.next !== undefined;
  }

  hasPrevious(): boolean {
    return this.trackConnections.previous !== undefined;
  }

  getNext(): TrackNode | undefined {
    return this.trackConnections.next;
  }

  getPrevious(): TrackNode | undefined {
    return this.trackConnections.previous;
  }

  setNext(node: TrackNode | undefined): void {
    this.trackConnections.next = node;
  }

  setPrevious(node: TrackNode | undefined): void {
    this.trackConnections.previous = node;
  }

  isJunction(): this is Junction {
    return true;
  }

  isTrack(): this is RailTrack {
    return false;
  }
}
