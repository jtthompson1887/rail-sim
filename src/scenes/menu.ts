import Phaser from 'phaser';
import Background from "../components/background";
import RailTrack from "../components/track";
import {qVec} from "../utils/math";
import Train from "../components/train";
import TrackFlowSolver from "../components/track-flow-solver";
import {CameraController} from "../components/camera-controller";

export default class MenuScene extends Phaser.Scene {
    private railTracks: RailTrack[] = [];
    private trains: Train[] = [];
    private camControl?: CameraController;

    constructor() {
        super({ key: 'MenuScene' });
    }

    preload() {

    }

    create() {
        const { width, height } = this.scale;

        const bg = new Background(this, 20, 20);
        bg.setDepth(-20);

        this.railTracks = [];
        this.trains = [];

        const circleCenter = qVec(width * 0.32, height * 0.52);
        const trackRadius = Math.min(width, height) * 0.32;
        const circleSegments = 16;
        const trackPoints: Phaser.Math.Vector2[] = [];

        for (let i = 0; i < circleSegments; i++) {
            const angle = Phaser.Math.DegToRad((360 / circleSegments) * i);
            trackPoints.push(qVec(
                circleCenter.x + Math.cos(angle) * trackRadius,
                circleCenter.y + Math.sin(angle) * trackRadius
            ));
        }

        for (let i = 0; i < circleSegments; i++) {
            const prev = trackPoints[(i - 1 + circleSegments) % circleSegments];
            const current = trackPoints[i];
            const next = trackPoints[(i + 1) % circleSegments];
            const afterNext = trackPoints[(i + 2) % circleSegments];

            const cp1 = qVec(
                current.x + (next.x - prev.x) / 6,
                current.y + (next.y - prev.y) / 6
            );

            const cp2 = qVec(
                next.x - (afterNext.x - current.x) / 6,
                next.y - (afterNext.y - current.y) / 6
            );

            this.railTracks.push(new RailTrack(this, current, cp1, cp2, next));
        }

        this.cameras.main.setBounds(0, 0, width, height);
        this.cameras.main.setZoom(1);
        this.cameras.main.centerOn(circleCenter.x, circleCenter.y);

        this.camControl = new CameraController(this);
        this.camControl.stopFollow();

        const menuTrain = new Train(this, circleCenter.x + trackRadius, circleCenter.y);
        const trainBody = menuTrain.getMatterBody();
        if (trainBody) {
            const firstTrack = this.railTracks[0];
            const startPoint = firstTrack.getCurvePath().getPoint(0);
            trainBody.setPosition(startPoint.x, startPoint.y);
            menuTrain.currentTrack = firstTrack;
            const tangentAngle = firstTrack.getTrackAngle(trainBody);
            trainBody.setAngle(tangentAngle);
            trainBody.setFrictionAir(0.015);
        }
        menuTrain.enginePower = 40;
        this.trains.push(menuTrain);

        const panelWidth = width * 0.42;
        const panelHeight = height * 0.72;
        const panelX = width * 0.72;
        const panelY = height * 0.5;

        const panel = this.add.rectangle(panelX, panelY, panelWidth, panelHeight, 0x031626, 0.82)
            .setStrokeStyle(4, 0xffffff, 0.2)
            .setScrollFactor(0)
            .setDepth(100);

        this.add.rectangle(panelX, panelY - panelHeight * 0.36, panelWidth * 0.6, 6, 0x4ad5ff, 0.45)
            .setScrollFactor(0)
            .setDepth(101);

        const contentTop = panelY - panelHeight * 0.38;
        const contentLeft = panelX - panelWidth * 0.44;
        const contentWidth = panelWidth * 0.88;
        let currentY = contentTop;

        const title = this.add.text(panelX, currentY, 'Rail Sim', {
            fontFamily: 'Verdana',
            fontSize: '82px',
            fontStyle: 'bold',
            color: '#ffffff'
        })
            .setOrigin(0.5, 0)
            .setShadow(0, 6, 'rgba(0,0,0,0.6)', 8)
            .setScrollFactor(0)
            .setDepth(101);

        currentY += title.height + 20;

        const subtitle = this.add.text(panelX, currentY, 'Keep the rail network flowing smoothly', {
            fontFamily: 'Verdana',
            fontSize: '30px',
            color: '#d2e6ff',
            align: 'center',
            wordWrap: { width: contentWidth }
        })
            .setOrigin(0.5, 0)
            .setScrollFactor(0)
            .setDepth(101);

        currentY += subtitle.height + 36;

        const highlights = this.add.text(contentLeft, currentY,
            'Highlights\n' +
            '• Design scenic routes and manage complex junctions\n' +
            '• Balance speed, safety, and passenger demand\n' +
            '• Upgrade engines to conquer tougher schedules', {
                fontFamily: 'Verdana',
                fontSize: '26px',
                color: '#ffffff',
                lineSpacing: 10,
                wordWrap: { width: contentWidth }
            })
            .setOrigin(0, 0)
            .setScrollFactor(0)
            .setDepth(101);

        currentY += highlights.height + 28;

        const controls = this.add.text(contentLeft, currentY,
            'Controls\n' +
            '• Arrow Keys / WASD – Move the camera\n' +
            '• Mouse Wheel – Adjust zoom\n' +
            '• Click – Manage junctions', {
                fontFamily: 'Verdana',
                fontSize: '24px',
                color: '#c9dcff',
                lineSpacing: 8,
                wordWrap: { width: contentWidth }
            })
            .setOrigin(0, 0)
            .setScrollFactor(0)
            .setDepth(101);

        currentY += controls.height + 42;

        const buttonWidth = panelWidth * 0.6;
        const buttonHeight = 90;
        const startButtonY = currentY + buttonHeight / 2;

        const startButton = this.add.rectangle(panelX, startButtonY, buttonWidth, buttonHeight, 0xffffff, 0.12)
            .setStrokeStyle(3, 0xffffff, 0.6)
            .setScrollFactor(0)
            .setDepth(101)
            .setInteractive({ useHandCursor: true })
            .on('pointerdown', () => this.startGame());

        startButton.on('pointerover', () => startButton.setFillStyle(0xffffff, 0.22));
        startButton.on('pointerout', () => startButton.setFillStyle(0xffffff, 0.12));

        this.add.text(startButton.x, startButton.y, 'Start Shift', {
            fontFamily: 'Verdana',
            fontSize: '48px',
            fontStyle: 'bold',
            color: '#ffffff'
        })
            .setOrigin(0.5)
            .setScrollFactor(0)
            .setDepth(102);

        const shortcutText = this.add.text(panelX, startButtonY + buttonHeight * 0.75, 'Press SPACE or ENTER to begin', {
            fontFamily: 'Verdana',
            fontSize: '26px',
            color: '#9fc0ff'
        })
            .setOrigin(0.5)
            .setScrollFactor(0)
            .setDepth(101);

        const tipY = shortcutText.y + shortcutText.height + 26;
        this.add.text(panelX, tipY, 'Tip: mind the curves—too much speed can derail your line!', {
            fontFamily: 'Verdana',
            fontSize: '24px',
            color: '#7fb8ff',
            align: 'center',
            wordWrap: { width: panelWidth * 0.85 }
        })
            .setOrigin(0.5)
            .setScrollFactor(0)
            .setDepth(101);

        this.input.keyboard.once('keydown-SPACE', () => this.startGame());
        this.input.keyboard.once('keydown-ENTER', () => this.startGame());
    }

    update(time:number, delta:number) {
        this.camControl?.update(time, delta);

        for (let train of this.trains) {
            train.update(time, delta);
            const trackFlowSolver = new TrackFlowSolver(this.railTracks, train);
            trackFlowSolver.applyTrackFlowForces();
        }
    }

    startGame() {
        this.scene.start('GameScene');
    }
}
