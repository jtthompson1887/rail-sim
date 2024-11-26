import RailTrack from "./track";
import Junction from "./junction";
import GameObject = Phaser.GameObjects.GameObject;

export interface TrackNode extends GameObject {
    // Track connections - using protected properties to allow access in implementations
    protected?: {
        next?: TrackNode;
        previous?: TrackNode;
    };
    
    // Connection methods
    hasNext(): boolean;
    hasPrevious(): boolean;
    getNext(): TrackNode | undefined;
    getPrevious(): TrackNode | undefined;
    setNext(node: TrackNode | undefined): void;
    setPrevious(node: TrackNode | undefined): void;
    
    // Identification
    getUUID(): string;
    
    // Type checking
    isJunction(): this is Junction;
    isTrack(): this is RailTrack;
}
