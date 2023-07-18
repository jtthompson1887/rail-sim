import Phaser from 'phaser';
import Background from "../components/background";
import RailTrack from "../components/track";
import {projectVector, qVec} from "../utils/math";
import Train from "../components/train";
import {guideForceTowardsPoint} from "../utils/physics";

export default class MenuScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MenuScene' });
    }

    preload() {

    }

    create() {


        //this.add.tileSprite(0, 0, 1920, 1080, 'grassbackground').setOrigin(0, 0).setTileScale(0.1, 0.1).setFlipY(Phaser.Math.Between(0, 1));
        let bg = new Background(this, 20, 20)
        let a = qVec(0, 800);
        let b = qVec(400, 800);
        let c = qVec(800, 700);
        let d = projectVector(b, c, b.distance(c))
        let e = qVec(1940, 800)
        this.railTrack1 = new RailTrack(this, a, b, c)
        let railTrack2 = new RailTrack(this, c, d, e)

        this.train = new Train(this, 0, 800);



        // Set the camera to show a smaller portion of the tilemap, creating the appearance of repetition

        this.add.text(400, 300, 'Rail Sim', { fontSize: '164px', fill: '#fff', fontFamily: 'Verdana' });

        this.add.text(400, 500, 'Start', { fontSize: '64px', fill: '#fff', fontFamily: 'Verdana' })
            .setInteractive()
            .on('pointerdown', () => this.startGame());
    }

    update() {
        let trackPoint = this.railTrack1.getTrackPoint(this.train.getMatterBody());
        guideForceTowardsPoint(this.train.getMatterBody(), trackPoint)

        let rotation = this.railTrack1.getTrackAngle(this.train.getMatterBody());
        this.train.getMatterBody().setAngle(rotation)
        this.train.getMatterBody().thrust(0.05)
    }

    startGame() {
        this.scene.start('GameScene');
    }
}
