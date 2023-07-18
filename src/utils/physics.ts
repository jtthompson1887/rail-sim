import {PIDController, qVec} from "./math";
import Phaser from "phaser";


export function guideForceTowardsPoint(target, p0 : Phaser.Math.Vector2, pidController?: PIDController) {
    // Calculate the vector from the cart to the track
    let position = target.body.position;
    let forceVector = qVec().copy(p0).subtract(position)

    let forceConstant = 0.0008;
    // Normalize and scale the force vector based on distance
    forceVector.normalize().scale(target.body.mass * forceConstant * forceVector.length());


    // Apply the force
    applyForceToGameObject(target, forceVector)
}

export function applyForceToGameObject(gameObject, forceVector: Phaser.Math.Vector2) {
    // Apply the force to the Matter.js body
    gameObject.body.force.x += forceVector.x;
    gameObject.body.force.y += forceVector.y;
}