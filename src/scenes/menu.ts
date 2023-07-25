import Phaser from 'phaser';
import Background from "../components/background";
import RailTrack from "../components/track";
import {projectVector, qVec, toBezierPoints, toCubicBezierPoints} from "../utils/math";
import Train from "../components/train";
import {guideForceTowardsPoint} from "../utils/physics";
import TrackFlowSolver from "../components/track-flow-solver";
import {CameraController} from "../components/camera-controller";

export default class MenuScene extends Phaser.Scene {
    private railTracks: RailTrack[] = [];
    private trains: Train[] = [];
    private camControl: CameraController;
    constructor() {
        super({ key: 'MenuScene' });
    }

    preload() {

    }

    create() {


        //this.add.tileSprite(0, 0, 1920, 1080, 'grassbackground').setOrigin(0, 0).setTileScale(0.1, 0.1).setFlipY(Phaser.Math.Between(0, 1));
        let bg = new Background(this, 20, 20)
        let trackPoints = [
            // qVec(200, 800),
            // qVec(600, 800),
            // qVec(1000, 700),
            // qVec(2040, 800),
            // qVec(2640, 1100),
            // qVec(2640, 1500),
            // qVec(2440, 1900),
            // qVec(1800, 2000)

            //
            // qVec(200, 800),
            // qVec(400, 800),
            // qVec(600, 1000),
            // qVec(800, 1200),
            // qVec(1000, 1200),


            qVec(20000.0, 10000.0),
            qVec(18660.25403784439, 15000.0),
            qVec(15000.0, 18660.25403784439),
            qVec(10000.0, 20000.0),
            qVec(5000.000000000002, 18660.25403784439),
            qVec(1339.7459621556136, 15000.0),
            qVec(0.0, 10000.000000000002),
            qVec(1339.7459621556136, 4999.999999999999),
            qVec(4999.999999999995, 1339.7459621556154),
            qVec(9999.999999999998, 0.0),
            qVec(15000.0, 1339.7459621556136),
            qVec(18660.254037844385, 4999.999999999995),
            qVec(20000.0, 10000.0),
            qVec(18660.25403784439, 15000.0),
        ];

        let bezierPoints = toCubicBezierPoints(trackPoints);

        for (let i = 1; i < bezierPoints.length; i++) {
            let lastPoint = bezierPoints[i-1];
            let currentPoint = bezierPoints[i];
            this.railTracks.push(new RailTrack(this, lastPoint.to, currentPoint.cp1, currentPoint.cp2, currentPoint.to));
        }

        this.camControl = new CameraController(this)

        let train1 = new Train(this, 20000, 10090);
        let train2 = new Train(this, 0, 10090);
        this.camControl.startFollow(train2.getMatterBody());
        train2.getMatterBody().angle = 0;
        train1.getMatterBody().angle = 0;
        this.trains.push(train1);
        this.trains.push(train2);



        // Set the camera to show a smaller portion of the tilemap, creating the appearance of repetition

        // @ts-ignore
        this.add.text(100, 300, 'Rail Sim', { fontSize: '164px', fill: '#fff', fontFamily: 'Verdana' })
            .setScrollFactor(0);

        // @ts-ignore
        this.add.text(100, 500, 'Start', { fontSize: '64px', fill: '#fff', fontFamily: 'Verdana' })
            .setScrollFactor(0)
            .setInteractive()
            .on('pointerdown', () => this.startGame());
    }

    update(time:number, delta:number) {

        this.camControl.update(time, delta)

        for (let train of this.trains) {
            let trackFlowSolver = new TrackFlowSolver(this.railTracks, train)
            trackFlowSolver.applyTrackFlowForces()
            train.update(time, delta);
        }
    }

    startGame() {
        this.scene.start('GameScene');
    }
}
