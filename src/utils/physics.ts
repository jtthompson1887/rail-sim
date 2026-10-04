import Phaser from "phaser";
import {BodyType} from "matter";

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
        restitution: body.restitution,
        frictionAir: body.frictionAir,
    };

    // Remove the old body from the Matter world
    matterWorld.remove(gameObject.body);

    // Add a new rectangle body to the Matter world with the new dimensions
    const newBody = matterWorld.scene.matter.bodies.rectangle(
        gameObject.x, gameObject.y, newWidth, newHeight);

    newBody.isStatic = bodyOptions.isStatic;
    newBody.friction = bodyOptions.friction;
    newBody.restitution = bodyOptions.restitution;
    newBody.frictionAir = bodyOptions.frictionAir;
    newBody.force.x = 0;
    newBody.force.y = 0;

    // Update the Phaser game object to use the new body
    gameObject.setExistingBody(newBody);

}
