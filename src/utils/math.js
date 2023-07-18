import Phaser from "phaser";

export function projectVector(p0, p1, length) {
    const p0p1 = new Phaser.Math.Vector2().copy(p1).subtract(p0);
    const distance = p0p1.length();

    if (distance === 0) {
        // If magnitude is zero or length is zero, return p1
        return new Phaser.Math.Vector2(p1.x, p1.y);
    }

    const normalizedDirection = new Phaser.Math.Vector2().copy(p0p1).normalize();
    const projection = new Phaser.Math.Vector2().copy(normalizedDirection).scale(length);
    let result = new Phaser.Math.Vector2().copy(p1).add(projection);

    console.log(
        Phaser.Math.RadToDeg(Phaser.Math.Angle.BetweenPoints(p0, p1)),
        Phaser.Math.RadToDeg(Phaser.Math.Angle.BetweenPoints(p1, result))
    );

    return result;
}

export function qVec(x, y) {
    return new Phaser.Math.Vector2(x, y);
}

export function isCurveTight(p0, p1, p2, tightnessThreshold, interval = 0.05) {
    const steps = Math.floor(1 / interval);

    let prevTangent = calculateTangent(p0, p1, p2, 0);

    for (let i = 1; i <= steps; i++) {
        const t = i * interval;
        const tangent = calculateTangent(p0, p1, p2, t);

        if (isNaN(tangent.x) || isNaN(tangent.y)) {
            console.error('NaN detected', {p0, p1, p2, t, tangent});
            return false;
        }

        // Calculate angle between previous tangent and current one, convert to degrees
        let angleChange = Phaser.Math.RadToDeg(Phaser.Math.Angle.BetweenPoints(prevTangent, tangent));

        if (angleChange > tightnessThreshold) {
            console.log(angleChange);
            return true;
        }

        prevTangent = tangent;
    }

    return false;
}

function calculateTangent(p0, p1, p2, t) {
    const tangent = new Phaser.Math.Vector2();

    const oneMinusT = 1 - t;

    tangent.x = 2 * oneMinusT * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
    tangent.y = 2 * oneMinusT * (p1.y - p0.y) + 2 * t * (p2.y - p1.y);

    tangent.normalize(); // we normalize because we're interested in direction, not magnitude

    return tangent;  // return the vector, not its length
}




