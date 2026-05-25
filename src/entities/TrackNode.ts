import type RailTrack from './RailTrack';
import type Junction from './Junction';
type GameObject = Phaser.GameObjects.GameObject;

export interface TrackNode extends GameObject {
  protected?: {
    next?: TrackNode;
    previous?: TrackNode;
  };

  hasNext(): boolean;
  hasPrevious(): boolean;
  getNext(): TrackNode | undefined;
  getPrevious(): TrackNode | undefined;
  setNext(node: TrackNode | undefined): void;
  setPrevious(node: TrackNode | undefined): void;
  getUUID(): string;
  isJunction(): this is Junction;
  isTrack(): this is RailTrack;
}
