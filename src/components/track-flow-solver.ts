import RailTrack from "./track";
import type Train from "./train";
import {applyForceToGameObject, guideForceTowardsPoint, limitForceToLateralApplication} from "../utils/physics";
import {PIDController} from "../utils/math";
import TrackManager from "./track-manager";
import Vector2 = Phaser.Math.Vector2;

export default class TrackFlowSolver {
    private trackProvider: TrackManager | RailTrack[];
    private train: Train;

    constructor(trackProvider: TrackManager | RailTrack[], train: Train) {
        this.trackProvider = trackProvider;
        this.train = train;
        let trainBody = this.train.getMatterBody();

        if (train.derailed) {
            return train.currentTrack = null;
        }

        if (train.currentTrack === null) {
            this.train.currentTrack = this.getClosestRailTrack();
        }

        this.train.currentTrack = this.getClosestRailTrack(undefined, 100);
    }

    private isTrackManager(provider: TrackManager | RailTrack[]): provider is TrackManager {
        return 'getClosestTrack' in provider;
    }

    getClosestRailTrack(track?: RailTrack[], limit: number = 0): RailTrack | null {
        let trainBody = this.train.getMatterBody();
        let trainPosition = trainBody.getCenter();

        if (this.isTrackManager(this.trackProvider)) {
            return this.trackProvider.getClosestTrack(trainPosition, limit) || null;
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


    applyTrackFlowForces() {
        let trainBody = this.train.getMatterBody();
        let currentTrack = this.train.currentTrack
        if (!currentTrack || this.train.derailed)
            return;

        let rotation = currentTrack.getTrackAngle(trainBody);

        let newAngle = this.checkAngleDirection(trainBody.angle, rotation, 0.7)
        trainBody.setAngle(newAngle)

        let trackPoint = currentTrack.getTrackPoint(trainBody);
        let forceVector = guideForceTowardsPoint(trainBody, trackPoint, this.train.pidController)
        let lateralForce = limitForceToLateralApplication(this.train.getMatterBody(), forceVector);
        applyForceToGameObject(trainBody, lateralForce)


    }
}