import Phaser from "phaser";
import {PIDController} from "../utils/math";
import type RailTrack from "./track";
import {matterScaling} from "../utils/physics";

// Extend the MatterImage type to include our custom property
interface TrainMatterImage extends Phaser.Physics.Matter.Image {
    parentTrain?: Train;
}

export default class Train extends Phaser.GameObjects.Container {
    private _trainBody: TrainMatterImage;
    private texture: string;
    private readonly _pidController: PIDController = new PIDController();
    private _currentTrack: RailTrack | null = null;
    private _derailed: boolean = false;
    private _enginePower: number = 0;
    private _selected: boolean = false;
    public debugGraphics: Phaser.GameObjects.Graphics;

    constructor(scene: Phaser.Scene, x: number, y: number) {
        super(scene);
        this.scene = scene;
        this.scene.add.existing(this);
        this.texture = 'train1';
        
        // Set container depth to be above tracks
        this.setDepth(100);
        
        try {
            this._trainBody = scene.matter.add.image(x, y, this.texture, null) as TrainMatterImage;
            if (!this._trainBody) {
                console.error('Failed to create train body');
                return;
            }
            
            matterScaling(this._trainBody, 0.15, 0.15);
            this._trainBody.setMass(1000);
            // Set train body to appear above tracks with even higher depth
            this._trainBody.setDepth(100);
            this.add(this._trainBody);

            // Set container size to match the train body
            const width = this._trainBody.displayWidth;
            const height = this._trainBody.displayHeight;
            this.setSize(width, height);

            // Make both the container and body interactive
            this.setInteractive({ cursor: 'pointer' });
            this._trainBody.setInteractive({ cursor: 'pointer' });
            
            // Store a reference back to the train on the body
            this._trainBody.parentTrain = this;

            this.debugGraphics = this.scene.add.graphics();
            // Set debug graphics depth to be above everything
            this.debugGraphics.setDepth(1000);
        } catch (error) {
            console.error('Error creating train:', error);
        }
    }

    update(time: number, delta: number) {
        this.pidController.setCurrentDelta(delta);
        if (!this.derailed && this._trainBody && this._enginePower !== 0) {
            const angle = this._trainBody.angle * (Math.PI / 180); // Convert to radians
            const force = this._enginePower * 0.1; // Scale down the force
            const vx = Math.cos(angle) * force;
            const vy = Math.sin(angle) * force;
            
            if (this._enginePower !== 0) {
                console.log('Applying velocity:', {
                    enginePower: this._enginePower,
                    angle: this._trainBody.angle,
                    velocity: { x: vx, y: vy }
                });
            }
            
            this._trainBody.setVelocity(vx, vy);
        }
    }

    get derailed(): boolean {
        return this._derailed;
    }

    set derailed(value: boolean) {
        if (value && this._trainBody) {
            this.texture = 'train2';
            this._trainBody.setTexture(this.texture);
        }
        this._derailed = value;
    }

    get enginePower(): number {
        return this._enginePower;
    }

    set enginePower(value: number) {
        if (this._enginePower !== value) {
            console.log('Engine power changed:', {
                old: this._enginePower,
                new: value
            });
        }
        this._enginePower = value;
    }

    get currentTrack(): RailTrack | null {
        return this._currentTrack;
    }

    set currentTrack(value: RailTrack | null) {
        this._currentTrack = value;
    }

    get selected(): boolean {
        return this._selected;
    }

    set selected(value: boolean) {
        this._selected = value;
        if (this._trainBody) {
            if (value) {
                this._trainBody.setTint(0x00ff00);
            } else {
                this._trainBody.clearTint();
            }
        } else {
            console.error('No train body available for tinting');
        }
    }

    getMatterBody(): Phaser.Physics.Matter.Image | null {
        return this._trainBody;
    }

    get pidController(): PIDController {
        return this._pidController;
    }
}