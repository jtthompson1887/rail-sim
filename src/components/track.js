import Phaser from "phaser";


export default class RailTrack extends Phaser.GameObjects.Container {
    constructor(scene, p0, p1, p2) {
        super(scene);
        scene.add.existing(this);

        this.texture1 = 'ballast';
        this.texture2 = 'rail';
        this.railTrackWidth = 866 * 0.85; // Original width of the rail track texture
        this.railTrackScale = 0.05; // Scale factor to adjust the size

        this.updateTrackVectors(p0, p1, p2);
    }

    createTracks() {
        this.removeAll(true); // Remove any existing tracks

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
    }

    updateTrackVectors(p0, p1, p2) {
        this.curve = new Phaser.Curves.Path(p0.x, p0.y).splineTo([p1.x, p1.y, p2.x, p2.y]);
        this.totalDistance = this.curve.getLength();
        this.iterations = Math.ceil(this.totalDistance / (this.railTrackWidth * this.railTrackScale));

        this.createTracks(); // Recreate the tracks with the new vectors
    }

    getCurvePath() {
        return this.curve;
    }
}

