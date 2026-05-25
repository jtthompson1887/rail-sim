import Phaser from 'phaser';
import RailTrack from '../entities/RailTrack';
import TrackManager from '../managers/TrackManager';
import { GameConfig } from '../config/GameConfig';

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

  generateTracks(params: {
    startPoint?: Phaser.Math.Vector2;
    startAngle?: number;
    sections: number;
    minLength?: number;
    maxLength?: number;
    curveProbability?: number;
    minCurveAngle?: number;
    maxCurveAngle?: number;
    smoothness?: number;
  }): RailTrack[] {
    const tracks: RailTrack[] = [];
    let currentPoint: Phaser.Math.Vector2;
    let currentAngle: number;

    if (params.startPoint && params.startAngle !== undefined) {
      currentPoint = params.startPoint.clone();
      currentAngle = params.startAngle;
    } else if (this.lastTrack) {
      const endPoint = this.lastTrack.getCurvePath().getEndPoint();
      currentPoint = new Phaser.Math.Vector2(endPoint.x, endPoint.y);
      const endTangent = this.lastTrack.getCurvePath().getTangent(1);
      currentAngle = Math.atan2(endTangent.y, endTangent.x);
    } else {
      throw new Error('Must provide startPoint and startAngle if no previous track exists');
    }

    const defaults = GameConfig.GENERATION.BRANCH;
    const {
      sections,
      minLength = defaults.MIN_LENGTH,
      maxLength = defaults.MAX_LENGTH,
      curveProbability = defaults.CURVE_PROB,
      minCurveAngle = defaults.MIN_ANGLE,
      maxCurveAngle = defaults.MAX_ANGLE,
      smoothness = defaults.SMOOTHNESS,
    } = params;

    for (let i = 0; i < sections; i++) {
      const length = this.rng.between(minLength, maxLength);
      let track: RailTrack;

      if (this.rng.frac() < curveProbability) {
        const curveAngle = Phaser.Math.DegToRad(this.rng.between(minCurveAngle, maxCurveAngle) * (this.rng.frac() < 0.5 ? -1 : 1));
        const endAngle = currentAngle + curveAngle;
        const radius = length / (2 * Math.sin(Math.abs(curveAngle) / 2));
        const center = new Phaser.Math.Vector2(
          currentPoint.x + radius * Math.cos(currentAngle + (Math.PI / 2) * Math.sign(curveAngle)),
          currentPoint.y + radius * Math.sin(currentAngle + (Math.PI / 2) * Math.sign(curveAngle))
        );
        const end = new Phaser.Math.Vector2(
          center.x + radius * Math.cos(endAngle - (Math.PI / 2) * Math.sign(curveAngle)),
          center.y + radius * Math.sin(endAngle - (Math.PI / 2) * Math.sign(curveAngle))
        );
        const controlLength = (length / 3) * smoothness;
        const control1 = new Phaser.Math.Vector2(currentPoint.x + Math.cos(currentAngle) * controlLength, currentPoint.y + Math.sin(currentAngle) * controlLength);
        const control2 = new Phaser.Math.Vector2(end.x - Math.cos(endAngle) * controlLength, end.y - Math.sin(endAngle) * controlLength);
        track = new RailTrack(this.scene, currentPoint, control1, control2, end);
        currentAngle = endAngle;
      } else {
        const end = new Phaser.Math.Vector2(currentPoint.x + Math.cos(currentAngle) * length, currentPoint.y + Math.sin(currentAngle) * length);
        const control1 = new Phaser.Math.Vector2(currentPoint.x + Math.cos(currentAngle) * (length / 3), currentPoint.y + Math.sin(currentAngle) * (length / 3));
        const control2 = new Phaser.Math.Vector2(currentPoint.x + Math.cos(currentAngle) * ((length * 2) / 3), currentPoint.y + Math.sin(currentAngle) * ((length * 2) / 3));
        track = new RailTrack(this.scene, currentPoint, control1, control2, end);
      }

      this.trackManager.addTrack(track);
      tracks.push(track);
      this.lastTrack = track;
      const endPoint = track.getCurvePath().getEndPoint();
      currentPoint = new Phaser.Math.Vector2(endPoint.x, endPoint.y);
    }

    return tracks;
  }

  continueFromTrack(track: RailTrack, sections: number, params?: Partial<TrackGeneratorParams>): RailTrack[] {
    const endPoint = track.getCurvePath().getEndPoint();
    const endTangent = track.getCurvePath().getTangent(1);
    const endAngle = Math.atan2(endTangent.y, endTangent.x);

    return this.generateTracks({
      startPoint: new Phaser.Math.Vector2(endPoint.x, endPoint.y),
      startAngle: endAngle,
      sections,
      ...params,
    });
  }
}
