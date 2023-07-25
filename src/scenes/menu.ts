import Phaser from 'phaser';
import Background from "../components/background";
import RailTrack from "../components/track";
import {projectVector, qVec} from "../utils/math";
import Train from "../components/train";
import {guideForceTowardsPoint} from "../utils/physics";
import TrackFlowSolver from "../components/track-flow-solver";
import {CameraController} from "../components/camera-controller";

export default class MenuScene extends Phaser.Scene {
    private railTrack1: RailTrack;
    private railTrack2: RailTrack;
    private train: Train;
    private train2: Train;
    private camControl: CameraController;
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

        this.camControl = new CameraController(this)

        this.railTrack1 = new RailTrack(this, a, b, c)
        this.railTrack2 = new RailTrack(this, c, d, e)

        this.train = new Train(this, 100, 800);
        this.train2 = new Train(this, 1890, 793);
        this.train2.getMatterBody().angle = -165;



        // Set the camera to show a smaller portion of the tilemap, creating the appearance of repetition

        // @ts-ignore
        this.add.text(400, 300, 'Rail Sim', { fontSize: '164px', fill: '#fff', fontFamily: 'Verdana' });

        // @ts-ignore
        this.add.text(400, 500, 'Start', { fontSize: '64px', fill: '#fff', fontFamily: 'Verdana' })
            .setInteractive()
            .on('pointerdown', () => this.startGame());
    }

    update(time:number, delta:number) {

        this.camControl.update(time, delta)

        let trackFlowSolver = new TrackFlowSolver([this.railTrack1, this.railTrack2], this.train)
        let trackFlowSolver2 = new TrackFlowSolver([this.railTrack1, this.railTrack2], this.train2)
        trackFlowSolver.applyTrackFlowForces()
        trackFlowSolver2.applyTrackFlowForces()
        if (!this.train.derailed && Math.min(this.train.getMatterBody().getVelocity().x, this.train.getMatterBody().getVelocity().y) < 0.001)
            this.train.getMatterBody().thrust(0.15)
        if (!this.train2.derailed && Math.min(this.train2.getMatterBody().getVelocity().x, this.train2.getMatterBody().getVelocity().y) < 0.001)
            this.train2.getMatterBody().thrust(0.05)
    }

    startGame() {
        this.scene.start('GameScene');
    }
}
