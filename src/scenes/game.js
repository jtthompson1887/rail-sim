import Phaser from 'phaser';
import RailTrack from "../components/track";
import {isCurveTight} from "../utils/math";

export default class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
    }

    create() {
        let p2 = new Phaser.Math.Vector2(200, 450);
        let p1 = new Phaser.Math.Vector2(700, 200);
        let p0 = new Phaser.Math.Vector2(1600, 450);
        let p3 = new Phaser.Math.Vector2(1800, 200);
        this.railTrack = new RailTrack(this, p0, p1, p2, p3);

        this.variableToOscillate = 0;
        this.isIncreasing = true;
        this.oscillationSpeed = 0.1;
    }


    update(time, delta) {
        // Game loop. You can create movement and game logic here.
        if (this.isIncreasing) {
            this.variableToOscillate += this.oscillationSpeed * delta;
            if (this.variableToOscillate >= 800) {
                this.variableToOscillate = 800;
                this.isIncreasing = false;
            }
        } else {
            this.variableToOscillate -= this.oscillationSpeed * delta;
            if (this.variableToOscillate <= 200) {
                this.variableToOscillate = 200;
                this.isIncreasing = true;
            }
        }

        let p0 = new Phaser.Math.Vector2(this.variableToOscillate, 200);
        let p1 = new Phaser.Math.Vector2(700, 450);
        let p2 = new Phaser.Math.Vector2(1600, 200);
        let p3 = new Phaser.Math.Vector2(1800, 200);
        if (isCurveTight(p0, p1, p2, -50))
            console.log("tight")
        if (isCurveTight(p1, p2, p3, -50))
            console.log("tight")
        this.railTrack.updateTrackVectors(p0, p1, p2, p3)

    }
}
