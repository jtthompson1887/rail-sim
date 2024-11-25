import Phaser from 'phaser';
import RailTrack from "../components/track";
import {isCurveTight, qVec, toCubicBezierPoints} from "../utils/math";
import Train from "../components/train";
import {CameraController} from "../components/camera-controller";
import TrackFlowSolver from "../components/track-flow-solver";
import {InputManager} from "../components/input-manager";
import {TrainManager} from "../components/train-manager";

export default class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
        this.selectedTrain = null;
        this.trains = [];
        this.railTracks = [];
    }

    preload() {
        this.load.image('train1', 'assets/train1.png');
    }

    create() {
        // Create track points for a circular track
        let trackPoints = [
            qVec(2000.0, 1000.0),
            qVec(1866.025403784439, 1500.0),
            qVec(1500.0, 1866.025403784439),
            qVec(1000.0, 2000.0),
            qVec(500.000000000002, 1866.025403784439),
            qVec(133.97459621556136, 1500.0),
            qVec(0.0, 1000.000000000002),
            qVec(133.97459621556136, 499.9999999999999),
            qVec(499.9999999999995, 133.97459621556154),
            qVec(999.9999999999998, 0.0),
            qVec(1500.0, 133.97459621556136),
            qVec(1866.0254037844385, 499.9999999999995),
            qVec(2000.0, 1000.0),
            qVec(1866.025403784439, 1500.0),
        ];

        // Convert track points to bezier curves
        let bezierPoints = toCubicBezierPoints(trackPoints);

        // Create rail tracks
        for (let i = 1; i < bezierPoints.length; i++) {
            let lastPoint = bezierPoints[i-1];
            let currentPoint = bezierPoints[i];
            this.railTracks.push(new RailTrack(this, lastPoint.to, currentPoint.cp1, currentPoint.cp2, currentPoint.to));
        }

        // Create debug graphics
        this.debugGraphics = this.add.graphics()
            .setDepth(1);   // Low depth for game layer
        
        // Create UI camera for debug info
        this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);
        this.uiCamera.setScroll(0, 0);
        this.uiCamera.setZoom(1);
        
        // Add debug text for coordinates (attached to UI camera)
        this.coordsText = this.add.text(16, 16, '', { 
            fontSize: '16px', 
            fill: '#fff',
            backgroundColor: '#000000',
            padding: { x: 10, y: 5 },
            fixedWidth: 300
        })
        .setDepth(1000)    // High depth for UI layer
        .setScrollFactor(0)
        .setAlpha(0.8);    // Slightly transparent

        // Initialize camera controller
        this.cameraController = new CameraController(this);

        // Initialize train manager
        this.trainManager = new TrainManager(this, this.railTracks, this.cameraController);
        
        this.trainManager.createInitialTrain();
        
        this.inputManager = new InputManager(this);
        this.inputManager.setupClickHandling(this.trainManager);

        // Configure cameras
        this.uiCamera.ignore([this.debugGraphics, ...this.railTracks, ...this.trainManager.trains]);
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
