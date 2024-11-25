import Phaser from "phaser";
import Train from "./train";
import type TrackManager from "./track-manager";
import TrackFlowSolver from "./track-flow-solver";

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

    createInitialTrain() {
        let train = new Train(this.scene, 0, 1000);
        train.getMatterBody().angle = 90;
        this.trains.push(train);
        return train;
    }

    handleTrainClick(train: Train, pointer: Phaser.Input.Pointer) {
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

    deselectTrain() {
        if (this._selectedTrain) {
            this._selectedTrain.selected = false;
            this._selectedTrain = null;
            this.cameraController.stopFollow();
        }
    }

    get selectedTrain(): Train | null {
        return this._selectedTrain;
    }

    update(time: number, delta: number) {
        // Update all trains and apply track forces
        for (const train of this.trains) {
            train.update(time, delta);
            const trackFlowSolver = new TrackFlowSolver(this.trackManager, train);
            trackFlowSolver.applyTrackFlowForces();
        }
    }
}
