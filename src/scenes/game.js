import Phaser from 'phaser';

export default class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
    }

    create() {

// Create a curve
        let p0 = new Phaser.Math.Vector2(200, 200);
        let p1 = new Phaser.Math.Vector2(500, 450);
        let p2 = new Phaser.Math.Vector2(220, 200);
        let curve = new Phaser.Curves.Path(p0.x, p0.y).splineTo([p1.x, p1.y, p2.x, p2.y]);


// In the create method
        const totalDistance = curve.getLength();
        const railTrackWidth = 866*0.85; // Original width of the rail track texture
        const railTrackScale = 0.05; // Scale factor to adjust the size

        const iterations = Math.ceil(totalDistance / (railTrackWidth * railTrackScale));

        for (let i = 0; i < iterations; i++) {
            const t = i / iterations;
            const point = curve.getPoint(t);
            const nextPoint = curve.getPoint((i + 1) / iterations);
            const angle = Phaser.Math.Angle.BetweenPoints(point, nextPoint);

            const railTrack = this.add.image(point.x, point.y, 'ballast');
            railTrack.setOrigin(0, 0.5); // Set the origin to the left-center of the rail track sprite
            railTrack.setScale(railTrackScale);
            railTrack.rotation = angle;
        }

        for (let i = 0; i < iterations; i++) {
            const t = i / iterations;
            const point = curve.getPoint(t);
            const nextPoint = curve.getPoint((i + 1) / iterations);
            const angle = Phaser.Math.Angle.BetweenPoints(point, nextPoint);

            const railTrack = this.add.image(point.x, point.y, 'rail');
            railTrack.setOrigin(0, 0.5); // Set the origin to the left-center of the rail track sprite
            railTrack.setScale(railTrackScale);
            railTrack.rotation = angle;
        }
    }


    update() {
        // Game loop. You can create movement and game logic here.

    }
}
