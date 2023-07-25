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

        let currentTrackPosition = this.train.currentTrack.getTrackPosition(trainBody);
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

    private checkAngleDirection(currentAngle: number, targetAngle: number): number {
        // Calculate the difference in angles
        let diff = Math.abs(targetAngle - currentAngle);

        // Check if the difference is larger than 90 degrees
        if (diff > 90) {
            // Flip the target angle by adding or subtracting 180, ensuring we keep the value within -180 and 180
            if (targetAngle >= 0) {
                targetAngle -= 180;
                if (targetAngle < -180) targetAngle += 360;
            } else {
                targetAngle += 180;
                if (targetAngle > 180) targetAngle -= 360;
            }
        }

        // Return the (potentially flipped) target angle
        return targetAngle;
    }


    applyTrackFlowForces() {
        let trainBody = this.train.getMatterBody();
        let currentTrack = this.train.currentTrack
        if (!currentTrack || this.train.derailed)
            return;
        let trackPoint = currentTrack.getTrackPoint(trainBody);
        guideForceTowardsPoint(this.train.getMatterBody(), trackPoint, this.train.pidController)

        let rotation = currentTrack.getTrackAngle(trainBody);

        let newAngle = this.checkAngleDirection(trainBody.angle, rotation)
        trainBody.setAngle(newAngle) //todo if angle change is more than (90 abs) then flip angle
    }
}