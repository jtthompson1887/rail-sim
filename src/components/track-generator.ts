import Phaser from "phaser";
import Vector2 = Phaser.Math.Vector2;
import RailTrack from "./track";
import TrackManager from "./track-manager";

/**
 * Represents a track section with its control points
 */
interface TrackSection {
    start: Vector2;
    control1: Vector2;
    control2: Vector2;
    end: Vector2;
}

/**
 * Parameters for track generation
 */
interface TrackGeneratorParams {
    /** Random seed for consistent generation */
    seed: string;
    /** Minimum length of straight sections */
    minStraightLength: number;
    /** Maximum length of straight sections */
    maxStraightLength: number;
    /** Probability of creating a curve (0-1) */
    curveProbability: number;
    /** Minimum curve angle in degrees */
    minCurveAngle: number;
    /** Maximum curve angle in degrees */
    maxCurveAngle: number;
    /** How smooth the curves should be (0-1) */
    curveSmoothness: number;
}

export default class TrackGenerator {
    private scene: Phaser.Scene;
    private trackManager: TrackManager;
    private rng: Phaser.Math.RandomDataGenerator;
    private lastSection: TrackSection | null = null;

    constructor(scene: Phaser.Scene, trackManager: TrackManager, params: TrackGeneratorParams) {
        this.scene = scene;
        this.trackManager = trackManager;
        this.rng = new Phaser.Math.RandomDataGenerator([params.seed]);
    }

    /**
     * Creates a straight track section
     */
    createStraightSection(start: Vector2, length: number, angle: number): TrackSection {
        const end = new Vector2(
            start.x + Math.cos(angle) * length,
            start.y + Math.sin(angle) * length
        );

        // Calculate control points using the 1/6 rule from the original code
        // This ensures smooth transitions between sections
        const control1 = new Vector2(
            start.x + Math.cos(angle) * (length / 3),
            start.y + Math.sin(angle) * (length / 3)
        );
        const control2 = new Vector2(
            start.x + Math.cos(angle) * (length * 2/3),
            start.y + Math.sin(angle) * (length * 2/3)
        );

        return { start, control1, control2, end };
    }

    /**
     * Creates a curved track section
     */
    createCurvedSection(start: Vector2, length: number, startAngle: number, endAngle: number, smoothness: number): TrackSection {
        // Calculate end point
        const end = new Vector2(
            start.x + Math.cos(endAngle) * length,
            start.y + Math.sin(endAngle) * length
        );

        // Get the previous and next points for control point calculation
        const prev = new Vector2(
            start.x - Math.cos(startAngle) * length,
            start.y - Math.sin(startAngle) * length
        );

        const next = new Vector2(
            end.x + Math.cos(endAngle) * length,
            end.y + Math.sin(endAngle) * length
        );

        // Calculate control points using the 1/6 rule from the original code
        const control1 = new Vector2(
            start.x + (end.x - prev.x) / 6,
            start.y + (end.y - prev.y) / 6
        );

        const control2 = new Vector2(
            end.x - (next.x - start.x) / 6,
            end.y - (next.y - start.y) / 6
        );

        return { start, control1, control2, end };
    }

    /**
     * Adds a track section to the game
     */
    addSection(section: TrackSection): void {
        const track = new RailTrack(
            this.scene,
            section.start,
            section.control1,
            section.control2,
            section.end
        );
        this.trackManager.addTrack(track);
        this.lastSection = section;
    }

    /**
     * Gets the next track section based on the current state
     */
    getNextSection(params: TrackGeneratorParams): TrackSection {
        if (!this.lastSection) {
            // Create initial straight section if no previous section exists
            return this.createStraightSection(
                new Vector2(0, 0),
                this.rng.between(params.minStraightLength, params.maxStraightLength),
                0
            );
        }

        const isCurve = this.rng.frac() < params.curveProbability;
        const lastAngle = Math.atan2(
            this.lastSection.end.y - this.lastSection.control2.y,
            this.lastSection.end.x - this.lastSection.control2.x
        );

        if (isCurve) {
            const curveAngle = Phaser.Math.DegToRad(
                this.rng.between(params.minCurveAngle, params.maxCurveAngle) *
                (this.rng.frac() < 0.5 ? 1 : -1)
            );
            const length = this.rng.between(params.minStraightLength, params.maxStraightLength);
            
            return this.createCurvedSection(
                this.lastSection.end,
                length,
                lastAngle,
                lastAngle + curveAngle,
                params.curveSmoothness
            );
        } else {
            return this.createStraightSection(
                this.lastSection.end,
                this.rng.between(params.minStraightLength, params.maxStraightLength),
                lastAngle
            );
        }
    }

    /**
     * Generates multiple track sections
     */
    generateTrack(params: TrackGeneratorParams, numSections: number): void {
        for (let i = 0; i < numSections; i++) {
            const section = this.getNextSection(params);
            this.addSection(section);
        }
    }
}
