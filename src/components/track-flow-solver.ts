import RailTrack from "./track";
import type Train from "./train";
import {applyForceToGameObject, guideForceTowardsPoint, limitForceToLateralApplication} from "../utils/physics";
import {PIDController} from "../utils/math";
import TrackManager from "./track-manager";
import Vector2 = Phaser.Math.Vector2;

export default class TrackFlowSolver {
    private trackProvider: TrackManager | RailTrack[];
    private train: Train;
    private debugArrow: Phaser.GameObjects.Graphics;

    constructor(trackProvider: TrackManager | RailTrack[], train: Train) {
        this.trackProvider = trackProvider;
        this.train = train;
        
        // Create debug graphics and store it on the train to persist between frames
        if (!this.train.debugGraphics) {
            this.train.debugGraphics = this.train.scene.add.graphics();
            this.train.debugGraphics.setDepth(1000); // Set depth once when creating
        }
        this.debugArrow = this.train.debugGraphics;
        
        if (train.derailed) {
            train.currentTrack = null;
            return;
        }

        if (train.currentTrack === null) {
            train.currentTrack = this.getClosestRailTrack();
        }

        // Update current track with limit
        const closestTrack = this.getClosestRailTrack(100);
        if (closestTrack) {
            train.currentTrack = closestTrack;
        }
    }

    private isTrackManager(provider: TrackManager | RailTrack[]): provider is TrackManager {
        return 'getClosestTrack' in provider;
    }

    getClosestRailTrack(limit: number = 0): RailTrack | null {
        let trainBody = this.train.getMatterBody();
        let trainPosition = trainBody.body.position;

        if (this.isTrackManager(this.trackProvider)) {
            // Get junctions for current track if we're on one
            if (this.train.currentTrack) {
                const junctions = this.trackProvider.getJunctionsForTrack(this.train.currentTrack);
                for (const junction of junctions) {
                    // If we're near a junction point, use the junction's active track
                    const junctionPos = junction.getPosition();
                    const trainPos = this.train.currentTrack.getTrackPosition(trainBody);
                    if (Math.abs(trainPos - junctionPos) < 0.1) {
                        // If we're on the main track, switch to the active branch
                        if (this.train.currentTrack === junction.getMainTrack()) {
                            return junction.getActiveBranchTrack();
                        }
                        // If we're on a branch track heading towards the junction, switch to main track
                        if ((this.train.currentTrack === junction.getLeftTrack() || 
                            this.train.currentTrack === junction.getRightTrack()) &&
                            trainPos < junctionPos) {
                            return junction.getMainTrack();
                        }
                        // Otherwise stay on current track
                        return this.train.currentTrack;
                    }
                }
            }
            return this.trackProvider.getClosestTrack(trainPosition, limit, this.train.currentTrack) || null;
        } else {
            // Legacy array-based implementation
            let localTracks = this.trackProvider.filter(track => {
                let trackLength = track.getCurvePath().getLength();
                let trackMidpoint = track.getCurvePath().getPoint(0.5);
                return new Vector2(trackMidpoint.x, trackMidpoint.y).distance(new Vector2(trainPosition.x, trainPosition.y)) < trackLength;
            });

            if (limit > 0) {
                localTracks = localTracks.filter(track => {
                    return track.getTrackPoint(trainBody).distance(trainBody) < limit;
                });
            }

            if (localTracks.length > 0) {
                return localTracks.reduce((previousValue, currentValue) => {
                    let prevTrackDist = previousValue.getTrackPoint(trainBody).distance(trainBody);
                    let currentTrackDist = currentValue.getTrackPoint(trainBody).distance(trainBody);
                    return currentTrackDist < prevTrackDist ? currentValue : previousValue;
                });
            }
        }
        
        this.train.derailed = true;
        return null;
    }

    private drawForceArrow(start: Vector2, force: Vector2, color: number) {
        // Scale the arrow length based on force magnitude
        // Using log scale since forces can vary greatly in magnitude
        const forceMagnitude = force.length();
        const scaledLength = Math.log10(1 + forceMagnitude) * 50;
        const normalizedForce = force.clone().normalize().scale(scaledLength);
        const end = start.clone().add(normalizedForce);
        
        // Line thickness also varies with force magnitude
        const lineThickness = Math.max(1, Math.min(4, Math.log10(1 + forceMagnitude)));
        this.debugArrow.lineStyle(lineThickness, color, 1);
        this.debugArrow.beginPath();
        this.debugArrow.moveTo(start.x, start.y);
        this.debugArrow.lineTo(end.x, end.y);
        
        // Draw arrowhead with size proportional to force
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const arrowLength = Math.max(5, Math.min(15, Math.log10(1 + forceMagnitude) * 5));
        this.debugArrow.lineTo(
            end.x - arrowLength * Math.cos(angle - Math.PI / 6),
            end.y - arrowLength * Math.sin(angle - Math.PI / 6)
        );
        this.debugArrow.moveTo(end.x, end.y);
        this.debugArrow.lineTo(
            end.x - arrowLength * Math.cos(angle + Math.PI / 6),
            end.y - arrowLength * Math.sin(angle + Math.PI / 6)
        );
        this.debugArrow.strokePath();
    }

    private clearDebugGraphics() {
        if (this.debugArrow) {
            this.debugArrow.clear();
        }
    }

    checkAngleDirection(currentAngle: number, targetAngle: number, smoothing: number): number {
        // Ensure smoothing is between 0 and 1
        smoothing = Math.max(0, Math.min(1, smoothing));

        // Calculate the shortest difference in angles, taking into account wrapping
        let diff = ((targetAngle - currentAngle + 180 + 360) % 360) - 180;

        // If the absolute difference is larger than 90, flip the difference
        if (Math.abs(diff) > 90) {
            diff = ((diff + 180 + 360) % 360) - 180;
        }

        // Add the difference to the current angle and normalize it to the range -180 to 180
        let normalizedAngle = ((currentAngle + diff + 180 + 360) % 360) - 180;

        // Compute the smoothed angle
        let smoothedAngle = (1 - smoothing) * normalizedAngle + smoothing * currentAngle;

        // Ensure the smoothed angle is within the range of -180 to 180
        while (smoothedAngle > 180) smoothedAngle -= 360;
        while (smoothedAngle < -180) smoothedAngle += 360;

        // Return the smoothed angle
        return smoothedAngle;
    }

    getFrontContactPoint(): Phaser.GameObjects.Sprite {
        const trainBody = this.train.getMatterBody();
        const trainLength = trainBody.displayWidth;
        const trainAngle = trainBody.angle * (Math.PI / 180);
        const trainDirection = new Vector2(Math.cos(trainAngle), Math.sin(trainAngle));
        
        // Calculate front position (40% forward from center)
        const frontOffset = trainDirection.clone().scale(trainLength * 0.4);
        
        return new Phaser.GameObjects.Sprite(this.train.scene,
            trainBody.body.position.x + frontOffset.x,
            trainBody.body.position.y + frontOffset.y,
            ''
        );
    }

    getRearContactPoint(): Phaser.GameObjects.Sprite {
        const trainBody = this.train.getMatterBody();
        const trainLength = trainBody.displayWidth;
        const trainAngle = trainBody.angle * (Math.PI / 180);
        const trainDirection = new Vector2(Math.cos(trainAngle), Math.sin(trainAngle));
        
        // Calculate rear position (40% back from center)
        const rearOffset = trainDirection.clone().scale(-trainLength * 0.4);
        
        return new Phaser.GameObjects.Sprite(this.train.scene,
            trainBody.body.position.x + rearOffset.x,
            trainBody.body.position.y + rearOffset.y,
            ''
        );
    }

    getTrackForces(track: RailTrack, frontPoint: Phaser.GameObjects.Sprite, rearPoint: Phaser.GameObjects.Sprite, scale: number = 1): Vector2 {
        const trainBody = this.train.getMatterBody();
        
        // Get track points
        const frontTrackPoint = track.getTrackPoint(frontPoint);
        const rearTrackPoint = track.getTrackPoint(rearPoint);

        // Calculate forces
        const frontForce = guideForceTowardsPoint(trainBody, frontTrackPoint, this.train.pidController);
        const rearForce = guideForceTowardsPoint(trainBody, rearTrackPoint, this.train.pidController);

        // Debug visualization of individual point forces
        if (scale === 1) { // Only for main track
            this.drawForceArrow(new Vector2(frontPoint.x, frontPoint.y), frontForce, 0x00ff00);
            this.drawForceArrow(new Vector2(rearPoint.x, rearPoint.y), rearForce, 0x00ff00);
        } else if (scale < 0) { // For repulsion
            // For repulsion, draw arrows in opposite direction to show pushing away
            this.drawForceArrow(new Vector2(frontPoint.x, frontPoint.y), frontForce.clone().scale(-1), 0xff0000);
            this.drawForceArrow(new Vector2(rearPoint.x, rearPoint.y), rearForce.clone().scale(-1), 0xff0000);
        }

        // Combine and scale forces
        return new Vector2(
            (frontForce.x + rearForce.x) * scale * 0.5,
            (frontForce.y + rearForce.y) * scale * 0.5
        );
    }

    applyTrackFlowForces() {
        const trainBody = this.train.getMatterBody();
        const currentTrack = this.train.currentTrack;
        if (!currentTrack || this.train.derailed)
            return;

        // Clear debug graphics at the start of each frame
        this.clearDebugGraphics();

        // Create contact points
        const frontPoint = this.getFrontContactPoint();
        const rearPoint = this.getRearContactPoint();

        // Calculate main track forces
        const mainForce = this.getTrackForces(currentTrack, frontPoint, rearPoint, 1);

        // Calculate forces from other tracks at junctions
        let repulsionForce = new Vector2(0, 0);
        if (this.isTrackManager(this.trackProvider)) {
            const junctions = this.trackProvider.getJunctionsForTrack(currentTrack);
            for (const junction of junctions) {
                // Get force scale for each track in the junction
                const tracks = junction.getAllTracks();
                for (const track of tracks) {
                    const forceScale = junction.getForceScale(track);
                    if (forceScale !== 0 && track !== currentTrack) {
                        const trackForce = this.getTrackForces(track, frontPoint, rearPoint, forceScale);
                        if (forceScale < 0) {
                            repulsionForce.add(trackForce);
                        } else {
                            mainForce.add(trackForce);
                        }
                    }
                }
            }
        }

        // Clean up sprites
        frontPoint.destroy();
        rearPoint.destroy();

        // Calculate average track angle between front and rear points
        const rotation = currentTrack.getTrackAngle(trainBody);
        const newAngle = this.checkAngleDirection(trainBody.angle, rotation, 0.7);
        trainBody.setAngle(newAngle);

        // Combine forces and apply
        const combinedForce = mainForce.add(repulsionForce);
        
        // First limit the force to lateral only
        const lateralForce = limitForceToLateralApplication(trainBody, combinedForce);
        
        // Debug visualization of final lateral force
        const trainCenter = new Vector2(trainBody.body.position.x, trainBody.body.position.y);
        this.drawForceArrow(trainCenter, lateralForce, 0x0000ff);

        applyForceToGameObject(trainBody, lateralForce);
    }
}