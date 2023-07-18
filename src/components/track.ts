import Phaser from "phaser";
import Vector2 = Phaser.Math.Vector2;
import Image = Phaser.GameObjects.Image;
import Path = Phaser.Curves.Path;


export default class RailTrack extends Phaser.GameObjects.Container {
    private texture1: string;
    private texture2: string;
    private railTrackWidth: number;
    private railTrackScale: number;
    private iterations: number;
    private totalDistance: number;
    private p0: Vector2;
    private p1: Vector2;
    private p2: Vector2;
    private tracksImages: Image[];
    private curve: Path;
    constructor(scene, p0, p1, p2) {
        super(scene);
        scene.add.existing(this);

        this.texture1 = 'ballast';
        this.texture2 = 'rail';
        this.railTrackWidth = 866 * 0.85; // Original width of the rail track texture
        this.railTrackScale = 0.05; // Scale factor to adjust the size

        this.tracksImages = [];
        this.updateTrackVectors(p0, p1, p2);
    }

    createTracks() {
        this.remove(this.tracksImages, true); // Remove any existing tracks

        // Layer 1 (texture1)
        for (let i = 0; i < this.iterations; i++) {
            this.createTrackSegment(this.texture1, i);
        }

        // Layer 2 (texture2)
        for (let i = 0; i < this.iterations; i++) {
            this.createTrackSegment(this.texture2, i);
        }
    }

    createTrackSegment(texture, i) {
        const t = i / this.iterations;
        const point = this.curve.getPoint(t);
        const nextPoint = this.curve.getPoint((i + 1) / this.iterations);
        const angle = Phaser.Math.Angle.BetweenPoints(point, nextPoint);

        const railTrack = this.scene.add.image(point.x, point.y, texture);
        railTrack.setOrigin(0, 0.5); // Set the origin to the left-center of the rail track sprite
        railTrack.setScale(this.railTrackScale);
        railTrack.rotation = angle;

        this.add(railTrack);
        this.tracksImages.push(railTrack);
    }

    updateTrackVectors(p0, p1, p2) {
        this.curve = new Phaser.Curves.Path(p0.x, p0.y).splineTo([p1.x, p1.y, p2.x, p2.y]);
        this.p0 = p0;
        this.p1 = p1;
        this.p2 = p2;
        this.totalDistance = this.curve.getLength();
        this.iterations = Math.ceil(this.totalDistance / (this.railTrackWidth * this.railTrackScale));

        this.createTracks(); // Recreate the tracks with the new vectors
    }

    getTrackAngle(object) {
        let t = this.getTrackPosition(object);
        // Get the tangent to the track at this position
        let tangent = this.curve.getTangent(t);

        // Calculate the angle of the tangent
        return Phaser.Math.RadToDeg(Math.atan2(tangent.y, tangent.x))
    }

    getTrackPoint(object) {
        // Get the position of the cart along the track
        let t = this.getTrackPosition(object);
        // Get the coordinates of this position on the track
        return this.curve.getPoint(t);
    }


    getTrackPosition(object) {
        // Number of points to sample along the Bézier curve
        let numSamples = 100;

        // Start with the closest distance being infinity
        let closestDistance = Infinity;

        // Start with the closest t being 0
        let closestT = 0;

        // Iterate over each sample
        for (let i = 0; i <= numSamples; i++) {
            // Calculate t for this sample
            let t = i / numSamples;

            // Get the point on the Bézier curve at this t value
            let point = this.curve.getPoint(t);

            // Calculate the distance from the cart to this point
            let distance = Phaser.Math.Distance.Between(object.body.position.x, object.body.position.y, point.x, point.y);

            // If this point is closer than the current closest point, update the closest distance and t value
            if (distance < closestDistance) {
                closestDistance = distance;
                closestT = t;
            }
        }

        // Return the t value of the closest point
        return closestT;
    }


    getCurvePath() {
        return this.curve;
    }
}

