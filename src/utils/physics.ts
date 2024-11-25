import {PIDController, qVec} from "./math";
import Phaser from "phaser";
import GameObject = Phaser.GameObjects.GameObject;
import Vector2 = Phaser.Math.Vector2;
import MatterBody = Phaser.Types.Physics.Matter.MatterBody;
import {BodyType, Vector} from "matter";


export function guideForceTowardsPoint(gameObject :GameObject, p0 : Phaser.Math.Vector2, pidController?: PIDController) : Vector2 {
    // Calculate the vector from the cart to the track
    let position = gameObject.body.position;
    let forceVector = qVec().copy(p0).subtract(position)

    let forceConstant = 0.0020; // Reduced from 0.0008/0.0020 to make the force gentler
    // Normalize and scale the force vector based on distance
    forceVector.normalize().scale(gameObject.body.mass * forceConstant * forceVector.length());

    if (pidController) {
        let error = forceVector.length()
        let newMagnitude = pidController.calculate(error)
        let multiplier = newMagnitude / error;
        forceVector = forceVector.scale(multiplier)
    }

    return forceVector;

}

export function matterScaling(gameObject: Phaser.Physics.Matter.Image, newScaleX: number, newScaleY: number): void {
    // Scale the Phaser game object
    gameObject.setScale(newScaleX, newScaleY);

    // Get the scene's Matter world
    const matterWorld = gameObject.scene.matter.world;

    // Calculate the new dimensions
    const newWidth = gameObject.displayWidth;
    const newHeight = gameObject.displayHeight;


    const body: BodyType  = gameObject.body as BodyType;

    // Define the new body options, copying properties from the old body if necessary
    const bodyOptions = {
        isStatic: body.isStatic,
        friction: body.friction,
        restitution: body.restitution
    };

    // Remove the old body from the Matter world
    matterWorld.remove(gameObject.body);

    // Add a new rectangle body to the Matter world with the new dimensions
    const newBody = matterWorld.scene.matter.bodies.rectangle(
        gameObject.x, gameObject.y, newWidth, newHeight);

    newBody.isStatic = bodyOptions.isStatic;
    newBody.friction = bodyOptions.friction;
    newBody.restitution = bodyOptions.restitution;

    // Update the Phaser game object to use the new body
    gameObject.setExistingBody(newBody);

    // Reset the origin if necessary
    //gameObject.setOrigin(0.5, 0.5);
}


export function limitForceToLateralApplication(gameObject : Phaser.Physics.Matter.Image, forceVector :Vector2) {
    // Get the train's forward direction vector (normalized)
    let forwardDirection = new Phaser.Math.Vector2(Math.cos(gameObject.angle), Math.sin(gameObject.angle)).normalize();
    
    // Calculate lateral direction (perpendicular to forward direction)
    let lateralDirection = new Phaser.Math.Vector2(-forwardDirection.y, forwardDirection.x);
    
    // Project the force only onto the lateral direction
    // This ensures we only get the sideways component and completely ignore any forward/backward force
    let lateralComponent = forceVector.dot(lateralDirection);
    
    // Return a force vector that only acts perpendicular to the train's direction
    return new Phaser.Math.Vector2(
        lateralDirection.x * lateralComponent,
        lateralDirection.y * lateralComponent
    );
}

export function applyForceToGameObject(gameObject, forceVector: Phaser.Math.Vector2) {
    // Apply the force to the Matter.js body
    gameObject.body.force.x += forceVector.x;
    gameObject.body.force.y += forceVector.y;
}