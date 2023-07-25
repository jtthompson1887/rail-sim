import RailTrack from "./track";
import type Train from "./train";
import {guideForceTowardsPoint} from "../utils/physics";
import {PIDController} from "../utils/math";

export default class TrackFlowSolver {
    private tracks: RailTrack[];
    private train: Train;

    constructor(tracks: RailTrack[], train: Train) {
        this.tracks = tracks;
        this.train = train;
        let trainBody = this.train.getMatterBody();

        if (train.derailed) {
            return train.currentTrack = null;
        }


        if (train.currentTrack === null) {
            this.train.currentTrack = this.getClosestRailTrack();
        }

        //let currentTrackPosition = this.train.currentTrack.getTrackPosition(trainBody);
        //if (currentTrackPosition > 0.9 || currentTrackPosition < 0.1) { //cause issues if a collision happen as we wont know until the condition is meet
            this.train.currentTrack = this.getClosestRailTrack(undefined, 100);
        //}

    }

    getClosestRailTrack(track: RailTrack[] = this.tracks, limit: number = 0): RailTrack {
        let trainBody = this.train.getMatterBody();
        let trainPosition = trainBody.getCenter()
        let localTracks = this.tracks.filter(track => {
            let trackLength = track.getCurvePath().getLength();
            let trackMidpoint = track.getCurvePath().getPoint(0.5);
            return trackMidpoint.distance(trainPosition) < trackLength
        })

        if (limit > 0) {
            localTracks = localTracks.filter(track => {
                return track.getTrackPoint(trainBody).distance(trainBody) < limit
            })
        }

        if (localTracks.length > 0) {
            return localTracks.reduce((previousValue, currentValue) => {
                let prevTrackDist = previousValue.getTrackPoint(trainBody).distance(trainBody);
                let currentTrackDist = currentValue.getTrackPoint(trainBody).distance(trainBody);
                if (currentTrackDist < prevTrackDist)
                    return currentValue;
                else
                    return previousValue
            });
        } else {
            this.train.derailed = true;
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


    applyTrackFlowForces() {
        let trainBody = this.train.getMatterBody();
        let currentTrack = this.train.currentTrack
        if (!currentTrack || this.train.derailed)
            return;
        let trackPoint = currentTrack.getTrackPoint(trainBody);
        guideForceTowardsPoint(this.train.getMatterBody(), trackPoint, this.train.pidController)

        let rotation = currentTrack.getTrackAngle(trainBody);

        let newAngle = this.checkAngleDirection(trainBody.angle, rotation, 0.7)
        trainBody.setAngle(newAngle) //todo if angle change is more than (90 abs) then flip angle
    }
}