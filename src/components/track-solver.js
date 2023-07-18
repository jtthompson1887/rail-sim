import Phaser from "phaser";
import {matterVec, qVec} from "../utils/math";
import RailTrack from "./track";

export default class TrackSolver {

    constructor(tracks, train) {
        this.tracks = tracks;
        this.train = train;

        for (let track of this.tracks) {
            if (track instanceof RailTrack) {

            }
        }

    }
}