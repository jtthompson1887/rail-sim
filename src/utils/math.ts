import Phaser from "phaser";
import Vector2 = Phaser.Math.Vector2;

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

export function qVec(x=0, y=0) {
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

export function toBezierPoints(points: Vector2[]): Array<{ cp: Vector2, to: Vector2 }> {
    const bezierPoints: Array<{ cp: Vector2, to: Vector2 }> = [];

    // Add the starting point
    bezierPoints.push({ cp: points[0].clone(), to: points[0].clone() });

    for (let i = 0; i < points.length - 2; i++) {
        const p0 = points[i];
        const p1 = points[i + 1];
        const p2 = points[i + 2];

        const mid1 = midPoint(p0, p1);
        const mid2 = midPoint(p1, p2);

        bezierPoints.push({ cp: mid1, to: p1 });
        bezierPoints.push({ cp: mid2, to: p2 });
    }

    // Add the ending point
    const lastPoint = points[points.length - 1];
    bezierPoints.push({ cp: lastPoint.clone(), to: lastPoint.clone() });

    return bezierPoints;
}

export function toCubicBezierPoints(points: Vector2[]): Array<{ cp1: Vector2, cp2: Vector2, to: Vector2 }> {
    const bezierPoints: Array<{ cp1: Vector2, cp2: Vector2, to: Vector2 }> = [];

    for (let i = 0; i < points.length - 1; i++) {
        const p0 = (i === 0) ? points[i] : points[i - 1];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = (i === points.length - 2) ? points[i + 1] : points[i + 2];

        const cp1 = new Vector2(
            p1.x + (p2.x - p0.x) / 6,
            p1.y + (p2.y - p0.y) / 6,
        );

        const cp2 = new Vector2(
            p2.x - (p3.x - p1.x) / 6,
            p2.y - (p3.y - p1.y) / 6,
        );

        bezierPoints.push({ cp1, cp2, to: p2 });
    }

    return bezierPoints;
}

// export function toCubicBezierPoints(points: Vector2[]): Array<{ cp1: Vector2, cp2: Vector2, to: Vector2 }> {
//     const bezierPoints: Array<{ cp1: Vector2, cp2: Vector2, to: Vector2 }> = [];
//
//     for (let i = 0; i < points.length - 3; i++) {
//         const p0 = i === 0 ? points[i] : points[i - 1];
//         const p1 = points[i];
//         const p2 = points[i + 1];
//         const p3 = points[i + 2];
//
//         const cp1 = new Vector2(
//             p1.x + (p2.x - p0.x) / 6,
//             p1.y + (p2.y - p0.y) / 6,
//         );
//
//         const cp2 = new Vector2(
//             p2.x - (p3.x - p1.x) / 6,
//             p2.y - (p3.y - p1.y) / 6,
//         );
//
//         bezierPoints.push({ cp1, cp2, to: p2 });
//     }
//
//     return bezierPoints;
// }


function midPoint(p0: Vector2, p1: Vector2): Vector2 {
    return new Vector2(
        (p0.x + p1.x) / 2,
        (p0.y + p1.y) / 2
    );
}

export class PIDController {
    private kp: number;
    private ki: number;
    private kd: number;
    private previousError: number;
    private integral: number;
    constructor(kp = 0.1, ki = 0.01, kd = 0.1) {
        this.kp = kp;
        this.ki = ki;
        this.kd = kd;
        this.previousError = 0;
        this.integral = 0;
    }

    calculate(error, deltaTime) {
        // Proportional term
        let p = this.kp * error;

        // Integral term
        this.integral += error * deltaTime;
        let i = this.ki * this.integral;

        // Derivative term
        let d = this.kd * (error - this.previousError) / deltaTime;

        // Remember this error for the next deltaTime
        this.previousError = error;

        // Return the combined force
        return p + i + d;
    }
}





