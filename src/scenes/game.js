import Phaser from 'phaser';
import RailTrack from "../components/track";
import {isCurveTight, qVec, toCubicBezierPoints} from "../utils/math";
import Train from "../components/train";
import {CameraController} from "../components/camera-controller";
import TrackFlowSolver from "../components/track-flow-solver";
import {InputManager} from "../components/input-manager";
import {TrainManager} from "../components/train-manager";
import TrackManager from "../components/track-manager";
import TrackGenerator from "../components/track-generator";
import Junction from "../components/junction";

export default class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
        this.selectedTrain = null;
        this.trains = [];
        this.trackManager = null;
    }

    preload() {
        this.load.image('train1', 'assets/train1.png');
    }

    create() {
        this.trackManager = new TrackManager(this);

        // Initialize camera controller
        this.cameraController = new CameraController(this);

        // Initialize train manager
        this.trainManager = new TrainManager(this, this.trackManager, this.cameraController);
        
        // Create initial train at (0, 1000)
        const train = this.trainManager.createInitialTrain();

        // Create a single main track
        const trackParams = {
            seed: Date.now().toString(),
            minStraightLength: 800,
            maxStraightLength: 800,
            curveProbability: 0,
            minCurveAngle: 0,
            maxCurveAngle: 0,
            curveSmoothness: 1.0,
        };

        const generator = new TrackGenerator(this, this.trackManager, trackParams);
        
        // Create straight main track starting at train's position
        const mainTrack = generator.createStraightSection(
            new Phaser.Math.Vector2(train.x, train.y),
            800,  // Main track length
            Phaser.Math.DegToRad(90)  // Straight up
        );
        generator.addSection(mainTrack);

        // Create a junction at the end of the main track
        const tracks = this.trackManager.getAllTracks();
        if (tracks.length > 0) {
            const mainTrackObj = tracks[0];
            const junction = this.trackManager.createJunction(mainTrackObj.getUUID(), 1.0); // At the end of main track
        }

        // Initialize input manager
        this.inputManager = new InputManager(this);
        this.inputManager.setupClickHandling(this.trainManager);

        // Create debug graphics
        this.debugGraphics = this.add.graphics()
            .setDepth(1);
        
        // Create UI camera for debug info
        this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);
        this.uiCamera.setScroll(0, 0);
        this.uiCamera.setZoom(1);
        
        // Add debug text for coordinates
        this.coordsText = this.add.text(16, 16, '', { 
            fontSize: '16px', 
            fill: '#fff',
            backgroundColor: '#000000',
            padding: { x: 10, y: 5 },
            fixedWidth: 300
        })
        .setDepth(1000)
        .setScrollFactor(0)
        .setAlpha(0.8);

        // Configure cameras
        this.uiCamera.ignore([this.debugGraphics, ...this.trackManager.tracks, ...this.trainManager.trains]);
        this.cameras.main.ignore(this.coordsText);

        // Set initial camera position and zoom
        this.cameras.main.scrollX = -400;
        this.cameras.main.scrollY = 600;
        this.cameras.main.zoom = 0.5;
    }

    getBounds(trainBody) {
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

    update(time, delta) {
        // Update train movement based on input
        this.inputManager.handleTrainMovement(this.trainManager.selectedTrain);
        
        // Update train physics and track following
        this.trainManager.update(time, delta);
        
        // Update camera controls
        this.cameraController.update(time, delta);

        // Debug visualization
        this.debugGraphics.clear();
        
        for (const train of this.trainManager.trains) {
            const trainBody = train.getMatterBody();
            if (trainBody) {
                const bounds = this.getBounds(trainBody);
                if (bounds) {
                    // Draw rotated rectangle using corners
                    this.debugGraphics.lineStyle(2, 0xff0000);
                    this.debugGraphics.beginPath();
                    this.debugGraphics.moveTo(bounds.corners[0].x, bounds.corners[0].y);
                    for (let i = 1; i < bounds.corners.length; i++) {
                        this.debugGraphics.lineTo(bounds.corners[i].x, bounds.corners[i].y);
                    }
                    this.debugGraphics.lineTo(bounds.corners[0].x, bounds.corners[0].y);
                    this.debugGraphics.strokePath();
                    
                    // Draw center point
                    this.debugGraphics.lineStyle(2, 0x0000ff);
                    this.debugGraphics.strokeCircle(trainBody.x, trainBody.y, 3);
                }
            }
        }

        // Update debug info
        const mainCam = this.cameras.main;
        const mouseWorldX = this.input.mousePointer.x / mainCam.zoom + mainCam.scrollX;
        const mouseWorldY = this.input.mousePointer.y / mainCam.zoom + mainCam.scrollY;
        
        let debugText = 
            `Camera: (${Math.floor(mainCam.scrollX)}, ${Math.floor(mainCam.scrollY)})\n` +
            `Zoom: ${mainCam.zoom.toFixed(2)}\n` +
            `Mouse World: (${Math.floor(mouseWorldX)}, ${Math.floor(mouseWorldY)})\n` +
            `Train: (${Math.floor(this.trainManager.trains[0].getMatterBody().x)}, ${Math.floor(this.trainManager.trains[0].getMatterBody().y)})`;

        // Add engine power debug info
        if (this.trainManager.selectedTrain) {
            debugText += `\nEngine Power: ${this.trainManager.selectedTrain.enginePower.toFixed(2)}`;
        }
        
        this.coordsText.setText(debugText);
    }
}
