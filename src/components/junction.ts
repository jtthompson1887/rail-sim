import Phaser from "phaser";
import RailTrack from "./track";
import Vector2 = Phaser.Math.Vector2;

export default class Junction extends Phaser.GameObjects.Container {
    private mainTrack: RailTrack;
    private leftTrack: RailTrack;
    private rightTrack: RailTrack;
    private junctionPosition: number;  // Position along main track (0-1)
    private _branchState: 'left' | 'right' = 'right';
    private switched: boolean = false;
    private readonly uuid: string;
    private hitArea: Phaser.GameObjects.Arc;

    constructor(scene: Phaser.Scene, mainTrack: RailTrack, leftTrack: RailTrack, rightTrack: RailTrack, position: number) {
        super(scene);
        this.scene.add.existing(this);
        this.mainTrack = mainTrack;
        this.leftTrack = leftTrack;
        this.rightTrack = rightTrack;
        this.junctionPosition = position;
        this.uuid = crypto.randomUUID();
        this.setDepth(1); // Above tracks, below trains

        // Get the junction point position
        const junctionPoint = mainTrack.getCurvePath().getPoint(position);
        this.setPosition(junctionPoint.x, junctionPoint.y);

        // Create a visible hit area
        this.hitArea = scene.add.circle(0, 0, 10, 0xffff00, 0.5);
        this.add(this.hitArea);

        // Make the junction interactive
        this.hitArea.setInteractive({ useHandCursor: true })
            .on('pointerdown', () => {
                this.toggle();
            });
    }

    get branchState(): 'left' | 'right' {
        return this._branchState;
    }

    set branchState(value: 'left' | 'right') {
        this._branchState = value;
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

    toggle() {
        this._branchState = this._branchState === 'left' ? 'right' : 'left';
        
        // Update track visibilities based on active state
        if (this._branchState === 'left') {
            this.leftTrack.setAlpha(1);
            this.rightTrack.setAlpha(0.5);
        } else {
            this.leftTrack.setAlpha(0.5);
            this.rightTrack.setAlpha(1);
        }
    }

    getForceScale(track: RailTrack): number {
        if (track === this.mainTrack) {
            return 1; // Main track is always active with full force
        }
        if (track === this.getActiveBranchTrack()) {
            return 1; // Active branch track pulls
        }
        if (track === this.getInactiveBranchTrack()) {
            return -1; // Inactive branch track repels
        }
        return 0; // Not part of this junction
    }

    getAllTracks(): RailTrack[] {
        return [this.mainTrack, this.leftTrack, this.rightTrack];
    }

    getUUID(): string {
        return this.uuid;
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

    isSwitched(): boolean {
        return this.switched;
    }
}
