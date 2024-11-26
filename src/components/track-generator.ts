import Phaser from "phaser";
import Vector2 = Phaser.Math.Vector2;
import RailTrack from "./track";
import TrackManager from "./track-manager";

/**
 * Represents a track section with its control points and additional metadata
 */
interface TrackSection {
    start: Vector2;
    control1: Vector2;
    control2: Vector2;
    end: Vector2;
    startTangent?: Vector2;  // Direction vector at start point
    endTangent?: Vector2;    // Direction vector at end point
}

/**
 * Parameters for track generation
 */
interface TrackGeneratorParams {
    minLength: number;
    maxLength: number;
    curveProbability: number;
    minCurveAngle: number;
    maxCurveAngle: number;
    smoothness: number;
}

export default class TrackGenerator {
    private scene: Phaser.Scene;
    private trackManager: TrackManager;
    private rng: Phaser.Math.RandomDataGenerator;
    private lastTrack: RailTrack | null = null;

    constructor(scene: Phaser.Scene, trackManager: TrackManager, seed?: string) {
        this.scene = scene;
        this.trackManager = trackManager;
        this.rng = new Phaser.Math.RandomDataGenerator([seed || Date.now().toString()]);
    }

    /**
     * Generates a sequence of tracks starting from a given point or the end of the last track
     */
    generateTracks(params: {
        startPoint?: Vector2,
        startAngle?: number,
        sections: number,
        minLength?: number,
        maxLength?: number,
        curveProbability?: number,
        minCurveAngle?: number,
        maxCurveAngle?: number,
        smoothness?: number
    }): RailTrack[] {
        const tracks: RailTrack[] = [];
        let currentPoint: Vector2;
        let currentAngle: number;

        // Use provided start point/angle or get from last track
        if (params.startPoint && params.startAngle !== undefined) {
            currentPoint = params.startPoint.clone();
            currentAngle = params.startAngle;
        } else if (this.lastTrack) {
            const endPoint = this.lastTrack.getCurvePath().getEndPoint();
            currentPoint = new Vector2(endPoint.x, endPoint.y);
            const endTangent = this.lastTrack.getCurvePath().getTangent(1);
            currentAngle = Math.atan2(endTangent.y, endTangent.x);
        } else {
            throw new Error("Must provide startPoint and startAngle if no previous track exists");
        }

        // Default parameters
        const {
            sections,
            minLength = 300,
            maxLength = 600,
            curveProbability = 0.4,
            minCurveAngle = 15,
            maxCurveAngle = 45,
            smoothness = 0.8
        } = params;

        for (let i = 0; i < sections; i++) {
            const length = this.rng.between(minLength, maxLength);
            let track: RailTrack;

            if (this.rng.frac() < curveProbability) {
                // Create curved section
                const curveAngle = Phaser.Math.DegToRad(
                    this.rng.between(minCurveAngle, maxCurveAngle) * 
                    (this.rng.frac() < 0.5 ? -1 : 1)
                );

                const endAngle = currentAngle + curveAngle;
                const radius = length / (2 * Math.sin(Math.abs(curveAngle) / 2));
                const center = new Vector2(
                    currentPoint.x + radius * Math.cos(currentAngle + Math.PI/2 * Math.sign(curveAngle)),
                    currentPoint.y + radius * Math.sin(currentAngle + Math.PI/2 * Math.sign(curveAngle))
                );

                const end = new Vector2(
                    center.x + radius * Math.cos(endAngle - Math.PI/2 * Math.sign(curveAngle)),
                    center.y + radius * Math.sin(endAngle - Math.PI/2 * Math.sign(curveAngle))
                );

                const controlLength = (length / 3) * smoothness;
                const control1 = new Vector2(
                    currentPoint.x + Math.cos(currentAngle) * controlLength,
                    currentPoint.y + Math.sin(currentAngle) * controlLength
                );
                const control2 = new Vector2(
                    end.x - Math.cos(endAngle) * controlLength,
                    end.y - Math.sin(endAngle) * controlLength
                );

                track = new RailTrack(this.scene, currentPoint, control1, control2, end);
                currentAngle = endAngle;
            } else {
                // Create straight section
                const end = new Vector2(
                    currentPoint.x + Math.cos(currentAngle) * length,
                    currentPoint.y + Math.sin(currentAngle) * length
                );

                const control1 = new Vector2(
                    currentPoint.x + Math.cos(currentAngle) * (length / 3),
                    currentPoint.y + Math.sin(currentAngle) * (length / 3)
                );
                const control2 = new Vector2(
                    currentPoint.x + Math.cos(currentAngle) * (length * 2/3),
                    currentPoint.y + Math.sin(currentAngle) * (length * 2/3)
                );

                track = new RailTrack(this.scene, currentPoint, control1, control2, end);
            }

            this.trackManager.addTrack(track);
            tracks.push(track);
            this.lastTrack = track;

            // Update current point for next section
            const endPoint = track.getCurvePath().getEndPoint();
            currentPoint = new Vector2(endPoint.x, endPoint.y);
        }

        return tracks;
    }

    /**
     * Generates tracks continuing from a junction's branch
     */
    continueFromTrack(track: RailTrack, sections: number, params?: Partial<TrackGeneratorParams>): RailTrack[] {
        const endPoint = track.getCurvePath().getEndPoint();
        const endTangent = track.getCurvePath().getTangent(1);
        const endAngle = Math.atan2(endTangent.y, endTangent.x);

        return this.generateTracks({
            startPoint: new Vector2(endPoint.x, endPoint.y),
            startAngle: endAngle,
            sections,
            ...params
        });
    }
}
