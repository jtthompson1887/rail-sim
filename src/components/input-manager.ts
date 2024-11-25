import Phaser from "phaser";
import type Train from "./train";

export class InputManager {
    private scene: Phaser.Scene;
    private wKey: Phaser.Input.Keyboard.Key;
    private sKey: Phaser.Input.Keyboard.Key;
    private clickedGameObject: boolean = false;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.setupKeyboardControls();
    }

    setupKeyboardControls() {
        this.wKey = this.scene.input.keyboard.addKey('W');
        this.sKey = this.scene.input.keyboard.addKey('S');
        console.log('Keyboard setup:', {
            wKey: this.wKey ? 'created' : 'null',
            sKey: this.sKey ? 'created' : 'null'
        });
    }

    setupClickHandling(trainManager: any) {
        // Listen for clicks on any game object
        this.scene.input.on('gameobjectdown', (pointer: Phaser.Input.Pointer, gameObject: any) => {
            console.log('Clicked game object type:', gameObject.type);
            this.clickedGameObject = true;
            
            // Check if we clicked a train or train body
            let clickedTrain = null;
            if (gameObject.parentTrain) {
                clickedTrain = gameObject.parentTrain;
            } else if (trainManager.trains.includes(gameObject)) {
                clickedTrain = gameObject;
            }
            
            if (clickedTrain) {
                console.log('Found clicked train!');
                trainManager.handleTrainClick(clickedTrain, pointer);
            }
        });

        // Setup background click handling
        this.scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            // Convert screen coordinates to world coordinates
            const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
            console.log('Click at:', {
                pointer: pointer,
                world: worldPoint,
                clickedObject: this.clickedGameObject
            });

            if (pointer.middleButtonDown()) {
                console.log('Middle mouse button - camera pan');
            } else if (pointer.button === 0 && !this.clickedGameObject) {
                console.log('Background clicked - deselecting train');
                trainManager.deselectTrain();
            }
            
            // Reset the flag for next frame
            this.clickedGameObject = false;
        });
    }

    handleTrainMovement(selectedTrain: Train | null) {
        if (!selectedTrain) return;

        let oldPower = selectedTrain.enginePower;
        if (this.wKey && this.wKey.isDown) {
            selectedTrain.enginePower = 10.0;
            if (oldPower !== 10.0) {
                console.log('Setting engine power to 10.0');
            }
        } else if (this.sKey && this.sKey.isDown) {
            selectedTrain.enginePower = -10.0;
            if (oldPower !== -10.0) {
                console.log('Setting engine power to -10.0');
            }
        } else {
            selectedTrain.enginePower = 0;
        }
    }
}
