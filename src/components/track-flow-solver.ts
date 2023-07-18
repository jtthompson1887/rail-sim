import Phaser from "phaser";
import {qVec} from "../utils/math";
import RailTrack from "./track";
import type Train from "./train";

export default class TrackFlowSolver {
    private tracks: RailTrack[];
    private train: Train;

    constructor(tracks:RailTrack[], train:Train) {
        this.tracks = tracks;
        this.train = train;

        for (let track of this.tracks) {
            //track.
        }

    }
}