import Phaser from "phaser";
import Train from "./train";
import type TrackManager from "./track-manager";
import TrackFlowSolver from "./track-flow-solver";

interface Bounds {
    min: { x: number; y: number };
    max: { x: number; y: number };
    corners: Array<{ x: number; y: number }>;
}

export class TrainManager {
    private scene: Phaser.Scene;
    private _selectedTrain: Train | null = null;
    trains: Train[] = [];
    private trackManager: TrackManager;
    private cameraController: any;

    constructor(scene: Phaser.Scene, trackManager: TrackManager, cameraController: any) {
        this.scene = scene;
        this.trackManager = trackManager;
        this.cameraController = cameraController;
    }

    createInitialTrain(): Train {
        let train = new Train(this.scene, 0, 500);
        train.getMatterBody().angle = 90;
        this.trains.push(train);
        return train;
    }

    handleTrainClick(train: Train, pointer: Phaser.Input.Pointer): void {
        if (pointer.button === 0) { // Left click
            console.log('Train clicked directly!');
            // Deselect previous train if any
            if (this._selectedTrain) {
                console.log('Deselecting previous train');
                this._selectedTrain.selected = false;
            }
            // Select this train
            console.log('Selecting new train');
            train.selected = true;
            this._selectedTrain = train;
            console.log('Train selection complete:', {
                selected: train.selected,
                enginePower: train.enginePower,
                hasBody: train.getMatterBody() ? 'yes' : 'no'
            });
            this.cameraController.startFollow(train.getMatterBody());
        }
    }

    deselectTrain(): void {
        if (this._selectedTrain) {
            this._selectedTrain.selected = false;
            this._selectedTrain = null;
            this.cameraController.stopFollow();
        }
    }

    get selectedTrain(): Train | null {
        return this._selectedTrain;
    }

    getBounds(trainBody: Phaser.Physics.Matter.Sprite): Bounds | null {
        if (!trainBody) return null;
        
        const width = trainBody.displayWidth;
        const height = trainBody.displayHeight;
        const x = trainBody.x;
        const y = trainBody.y;
        const angle = trainBody.angle * (Math.PI / 180); // Convert to radians
        
        // Calculate rotated corners
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const halfWidth = width / 2;
        const halfHeight = height / 2;
        
        // Calculate all four corners
        const corners = [
            { // Top Left
                x: x + (-halfWidth * cos - halfHeight * sin),
                y: y + (-halfWidth * sin + halfHeight * cos)
            },
            { // Top Right
                x: x + (halfWidth * cos - halfHeight * sin),
                y: y + (halfWidth * sin + halfHeight * cos)
            },
            { // Bottom Right
                x: x + (halfWidth * cos + halfHeight * sin),
                y: y + (halfWidth * sin - halfHeight * cos)
            },
            { // Bottom Left
                x: x + (-halfWidth * cos + halfHeight * sin),
                y: y + (-halfWidth * sin - halfHeight * cos)
            }
        ];
        
        // Find min and max points
        const bounds = corners.reduce((acc, corner) => ({
            min: {
                x: Math.min(acc.min.x, corner.x),
                y: Math.min(acc.min.y, corner.y)
            },
            max: {
                x: Math.max(acc.max.x, corner.x),
                y: Math.max(acc.max.y, corner.y)
            }
        }), {
            min: { x: corners[0].x, y: corners[0].y },
            max: { x: corners[0].x, y: corners[0].y }
        });

        return {
            min: bounds.min,
            max: bounds.max,
            corners: corners  // Return corners for debug visualization
        };
    }

    update(time: number, delta: number): void {
        // Update all trains and apply track forces
        for (const train of this.trains) {
            train.update(time, delta);
            const trackFlowSolver = new TrackFlowSolver(this.trackManager, train);
            trackFlowSolver.applyTrackFlowForces();
        }
    }
}
