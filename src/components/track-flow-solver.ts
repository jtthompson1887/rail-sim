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
        if (currentTrackPosition > 0.9 || currentTrackPosition < 0.1) {
            this.train.currentTrack = this.getClosestRailTrack();
        }

    }

    getClosestRailTrack(track: RailTrack[] = this.tracks): RailTrack {
        let trainBody = this.train.getMatterBody();
        let trainPosition = trainBody.getCenter()
        let localTracks = this.tracks.filter(track => {
            let trackLength = track.getCurvePath().getLength();
            let trackMidpoint = track.getCurvePath().getPoint(0.5);
            return trackMidpoint.distance(trainPosition) < trackLength
        })
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

    applyTrackFlowForces() {
        let trainBody = this.train.getMatterBody();
        let currentTrack = this.train.currentTrack
        if (!currentTrack || this.train.derailed)
            return;
        let trackPoint = currentTrack.getTrackPoint(trainBody);
        guideForceTowardsPoint(this.train.getMatterBody(), trackPoint, this.train.pidController)

        let rotation = currentTrack.getTrackAngle(trainBody);
        trainBody.setAngle(rotation)
    }
}