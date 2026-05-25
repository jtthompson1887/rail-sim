import Phaser from 'phaser';
import RailTrack from '../entities/RailTrack';
import type Train from '../entities/Train';
import { applyForceToGameObject, guideForceTowardsPoint, limitForceToLateralApplication } from '../utils/physics';
import TrackManager from '../managers/TrackManager';
import { GameConfig } from '../config/GameConfig';

export default class TrackFlowSolver {
  private trackProvider: TrackManager | RailTrack[];
  private train: Train;
  private debugArrow: Phaser.GameObjects.Graphics;

  constructor(trackProvider: TrackManager | RailTrack[], train: Train) {
    this.trackProvider = trackProvider;
    this.train = train;
    this.debugArrow = this.train.debugGraphics || this.train.scene.add.graphics();
    this.debugArrow.setDepth(1000);
  }

  private isTrackManager(provider: TrackManager | RailTrack[]): provider is TrackManager {
    return 'getClosestTrack' in provider;
  }

  private syncTrackState(): boolean {
    if (this.train.derailed) {
      this.train.currentTrack = null;
      return false;
    }

    if (this.train.currentTrack === null) {
      this.train.currentTrack = this.getClosestRailTrack();
    }

    const closestTrack = this.getClosestRailTrack(GameConfig.TRACK.MAX_CLOSE_DISTANCE);
    if (closestTrack) {
      this.train.currentTrack = closestTrack;
      return true;
    }

    this.train.derailed = true;
    this.train.currentTrack = null;
    return false;
  }

  getClosestRailTrack(limit: number = 0): RailTrack | null {
    const trainBody = this.train.getMatterBody();
    const trainPosition = trainBody.body.position;

    if (this.isTrackManager(this.trackProvider)) {
      if (this.train.currentTrack) {
        const junctions = this.trackProvider.getJunctionsForTrack(this.train.currentTrack);
        for (const junction of junctions) {
          const junctionPos = junction.getPosition();
          const trainPos = this.train.currentTrack.getTrackPosition(trainBody);
          const junctionPoint = this.train.currentTrack.getCurvePath().getPoint(junctionPos);
          const distToJunction = new Phaser.Math.Vector2(trainPosition.x - junctionPoint.x, trainPosition.y - junctionPoint.y).length();
          if (Math.abs(trainPos - junctionPos) < 0.1 && (limit === 0 || distToJunction < limit)) {
            if (this.train.currentTrack === junction.getMainTrack()) {
              return junction.getActiveBranchTrack();
            }
            if ((this.train.currentTrack === junction.getLeftTrack() || this.train.currentTrack === junction.getRightTrack()) && trainPos < junctionPos) {
              return junction.getMainTrack();
            }
            return this.train.currentTrack;
          }
        }
      }
      return this.trackProvider.getClosestTrack(trainPosition, limit, this.train.currentTrack || undefined) || null;
    }

    let localTracks = this.trackProvider.filter((track) => {
      const trackLength = track.getCurvePath().getLength();
      const trackMidpoint = track.getCurvePath().getPoint(0.5);
      return new Phaser.Math.Vector2(trackMidpoint.x, trackMidpoint.y).distance(new Phaser.Math.Vector2(trainPosition.x, trainPosition.y)) < trackLength;
    });

    if (limit > 0) {
      localTracks = localTracks.filter((track) => track.getTrackPoint(trainBody).distance(trainBody as unknown as Phaser.Math.Vector2) < limit);
    }

    if (localTracks.length > 0) {
      return localTracks.reduce((previousValue, currentValue) => {
        const prevTrackDist = previousValue.getTrackPoint(trainBody).distance(trainBody as unknown as Phaser.Math.Vector2);
        const currentTrackDist = currentValue.getTrackPoint(trainBody).distance(trainBody as unknown as Phaser.Math.Vector2);
        return currentTrackDist < prevTrackDist ? currentValue : previousValue;
      });
    }

    return null;
  }

  private drawForceArrow(start: Phaser.Math.Vector2, force: Phaser.Math.Vector2, color: number): void {
    if (!GameConfig.DEBUG) {
      return;
    }
    const forceMagnitude = force.length();
    const scaledLength = Math.log10(1 + forceMagnitude) * 50;
    const normalizedForce = force.clone().normalize().scale(scaledLength);
    const end = start.clone().add(normalizedForce);
    const lineThickness = Math.max(1, Math.min(4, Math.log10(1 + forceMagnitude)));
    this.debugArrow.lineStyle(lineThickness, color, 1);
    this.debugArrow.beginPath();
    this.debugArrow.moveTo(start.x, start.y);
    this.debugArrow.lineTo(end.x, end.y);
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const arrowLength = Math.max(5, Math.min(15, Math.log10(1 + forceMagnitude) * 5));
    this.debugArrow.lineTo(end.x - arrowLength * Math.cos(angle - Math.PI / 6), end.y - arrowLength * Math.sin(angle - Math.PI / 6));
    this.debugArrow.moveTo(end.x, end.y);
    this.debugArrow.lineTo(end.x - arrowLength * Math.cos(angle + Math.PI / 6), end.y - arrowLength * Math.sin(angle + Math.PI / 6));
    this.debugArrow.strokePath();
  }

  private clearDebugGraphics(): void {
    if (this.debugArrow) {
      this.debugArrow.clear();
    }
  }

  checkAngleDirection(currentAngle: number, targetAngle: number, smoothing: number): number {
    smoothing = Math.max(0, Math.min(1, smoothing));
    let diff = ((targetAngle - currentAngle + 180 + 360) % 360) - 180;
    if (Math.abs(diff) > 90) {
      diff = ((diff + 180 + 360) % 360) - 180;
    }
    const normalizedAngle = ((currentAngle + diff + 180 + 360) % 360) - 180;
    let smoothedAngle = (1 - smoothing) * normalizedAngle + smoothing * currentAngle;
    while (smoothedAngle > 180) smoothedAngle -= 360;
    while (smoothedAngle < -180) smoothedAngle += 360;
    return smoothedAngle;
  }

  getFrontContactPoint(): Phaser.GameObjects.Sprite {
    const trainBody = this.train.getMatterBody();
    const trainLength = trainBody.displayWidth;
    const trainAngle = trainBody.angle * (Math.PI / 180);
    const trainDirection = new Phaser.Math.Vector2(Math.cos(trainAngle), Math.sin(trainAngle));
    const frontOffset = trainDirection.clone().scale(trainLength * 0.4);
    return new Phaser.GameObjects.Sprite(this.train.scene, trainBody.body.position.x + frontOffset.x, trainBody.body.position.y + frontOffset.y, '');
  }

  getRearContactPoint(): Phaser.GameObjects.Sprite {
    const trainBody = this.train.getMatterBody();
    const trainLength = trainBody.displayWidth;
    const trainAngle = trainBody.angle * (Math.PI / 180);
    const trainDirection = new Phaser.Math.Vector2(Math.cos(trainAngle), Math.sin(trainAngle));
    const rearOffset = trainDirection.clone().scale(-trainLength * 0.4);
    return new Phaser.GameObjects.Sprite(this.train.scene, trainBody.body.position.x + rearOffset.x, trainBody.body.position.y + rearOffset.y, '');
  }

  getTrackForces(track: RailTrack, frontPoint: Phaser.GameObjects.Sprite, rearPoint: Phaser.GameObjects.Sprite, scale: number = 1): Phaser.Math.Vector2 {
    const trainBody = this.train.getMatterBody();
    const frontTrackPoint = track.getTrackPoint(frontPoint);
    const rearTrackPoint = track.getTrackPoint(rearPoint);
    const frontForce = guideForceTowardsPoint(trainBody, frontTrackPoint, this.train.pidControllerFront);
    const rearForce = guideForceTowardsPoint(trainBody, rearTrackPoint, this.train.pidControllerRear);

    if (scale === 1) {
      this.drawForceArrow(new Phaser.Math.Vector2(frontPoint.x, frontPoint.y), frontForce, 0x00ff00);
      this.drawForceArrow(new Phaser.Math.Vector2(rearPoint.x, rearPoint.y), rearForce, 0x00ff00);
    } else if (scale < 0) {
      this.drawForceArrow(new Phaser.Math.Vector2(frontPoint.x, frontPoint.y), frontForce.clone().scale(-1), 0xff0000);
      this.drawForceArrow(new Phaser.Math.Vector2(rearPoint.x, rearPoint.y), rearForce.clone().scale(-1), 0xff0000);
    }

    return new Phaser.Math.Vector2((frontForce.x + rearForce.x) * scale * 0.5, (frontForce.y + rearForce.y) * scale * 0.5);
  }

  applyTrackFlowForces(): void {
    const trainBody = this.train.getMatterBody();
    if (!this.syncTrackState()) {
      return;
    }

    const currentTrack = this.train.currentTrack;
    if (!currentTrack || this.train.derailed) {
      return;
    }

    this.clearDebugGraphics();
    const frontPoint = this.getFrontContactPoint();
    const rearPoint = this.getRearContactPoint();
    const mainForce = this.getTrackForces(currentTrack, frontPoint, rearPoint, 1);
    const repulsionForce = new Phaser.Math.Vector2(0, 0);

    if (this.isTrackManager(this.trackProvider)) {
      const junctions = this.trackProvider.getJunctionsForTrack(currentTrack);
      for (const junction of junctions) {
        const junctionPos = junction.getPosition();
        const trainPos = currentTrack.getTrackPosition(trainBody);
        const distanceToJunction = Math.abs(trainPos - junctionPos);
        const proximityScale = Math.max(0, 1 - distanceToJunction * 5);

        for (const track of junction.getAllTracks()) {
          const forceScale = junction.getForceScale(track);
          if (forceScale !== 0 && track !== currentTrack) {
            const scaledForce = this.getTrackForces(track, frontPoint, rearPoint, forceScale * proximityScale);
            const lateralForce = limitForceToLateralApplication(trainBody, scaledForce);
            if (forceScale < 0) {
              repulsionForce.add(lateralForce);
            } else {
              mainForce.add(lateralForce);
            }
          }
        }
      }
    }

    frontPoint.destroy();
    rearPoint.destroy();

    const rotation = currentTrack.getTrackAngle(trainBody);
    const newAngle = this.checkAngleDirection(trainBody.angle, rotation, 0.85);
    trainBody.setAngle(newAngle);

    const combinedForce = mainForce.add(repulsionForce.scale(0.5));
    const lateralForce = limitForceToLateralApplication(trainBody, combinedForce);
    this.drawForceArrow(new Phaser.Math.Vector2(trainBody.body.position.x, trainBody.body.position.y), lateralForce, 0x0000ff);
    applyForceToGameObject(trainBody, lateralForce);
  }
}
