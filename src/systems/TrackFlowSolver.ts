import Phaser from 'phaser';
import RailTrack from '../entities/RailTrack';
import type { ITrackFollower } from '../config/VehicleTypes';
import { applyForceToGameObject, guideForceTowardsPoint, limitForceToLateralApplication } from '../utils/physics';
import TrackManager from '../managers/TrackManager';
import { GameConfig } from '../config/GameConfig';

const HANDOFF_MAX_GUIDANCE_MOMENTUM_FRACTION = 0.01;
const HANDOFF_GUIDANCE_WINDOW_MS = GameConfig.TRACK.SWITCH_COOLDOWN_MS * 4;

export default class TrackFlowSolver {
  private trackProvider: TrackManager | RailTrack[];
  private train: ITrackFollower;
  private debugArrow: Phaser.GameObjects.Graphics;
  /** Timestamp (performance.now) of the last automatic track switch, used to enforce SWITCH_COOLDOWN_MS. */
  private _lastSwitchTime: number = -Infinity;
  /** Guidance limiting is active only for a finite stabilization window after a switch. */
  private _handoffGuidanceUntil: number = -Infinity;

  constructor(trackProvider: TrackManager | RailTrack[], train: ITrackFollower) {
    this.trackProvider = trackProvider;
    this.train = train;
    this.debugArrow = this.train.debugGraphics || this.train.scene.add.graphics();
    this.debugArrow.setDepth(1000);
  }

  private isTrackManager(provider: TrackManager | RailTrack[]): provider is TrackManager {
    return 'getClosestTrack' in provider;
  }

  /**
   * Commit to a new track, resetting PID state so there is no derivative spike
   * from the position jump, and recording the time to enforce the switch cooldown.
   */
  private _switchToTrack(track: RailTrack): void {
    this.train.currentTrack = track;

    // Soft-reset PIDs to the current error on the new track so the derivative
    // term does not spike on the first frame after the switch.  A hard reset
    // (previousError = 0) would make the D term compute kd*(error-0)/delta,
    // causing an overshoot and the 'shake' when switching segments.
    const trainBody = this.train.getMatterBody();
    const mass = trainBody.body?.mass ?? 1;
    const forceConstant = 0.0020;

    const frontPoint = this.getFrontContactPoint();
    const rearPoint = this.getRearContactPoint();
    const frontTrackPoint = track.getTrackPoint(frontPoint);
    const rearTrackPoint = track.getTrackPoint(rearPoint);
    const frontDist = new Phaser.Math.Vector2(frontTrackPoint.x - frontPoint.x, frontTrackPoint.y - frontPoint.y).length();
    const rearDist = new Phaser.Math.Vector2(rearTrackPoint.x - rearPoint.x, rearTrackPoint.y - rearPoint.y).length();

    const frontError = mass * forceConstant * frontDist;
    const rearError = mass * forceConstant * rearDist;
    this.train.pidControllerFront.resetToError(frontError);
    this.train.pidControllerRear.resetToError(rearError);

    this._lastSwitchTime = performance.now();
    this._handoffGuidanceUntil = this._lastSwitchTime + HANDOFF_GUIDANCE_WINDOW_MS;
  }

  /**
   * Returns true if `fromTrack` and `toTrack` are connected by a junction,
   * which means the switch is a deliberate routing event rather than
   * opportunistic proximity-based switching.
   */
  private _isJunctionTransition(fromTrack: RailTrack, toTrack: RailTrack): boolean {
    if (!this.isTrackManager(this.trackProvider)) return false;
    const junctions = this.trackProvider.getJunctionsForTrack(fromTrack);
    return junctions.some((j) => j.getAllTracks().indexOf(toTrack) !== -1);
  }

  private syncTrackState(): boolean {
    if (this.train.derailed) {
      this.train.currentTrack = null;
      this._handoffGuidanceUntil = -Infinity;
      return false;
    }

    // Initial assignment when no track is set yet — no hysteresis needed.
    if (this.train.currentTrack === null) {
      this.train.currentTrack = this.getClosestRailTrack();
      if (this.train.currentTrack) {
        this._lastSwitchTime = performance.now();
      }
    }

    const closestTrack = this.getClosestRailTrack(GameConfig.TRACK.MAX_CLOSE_DISTANCE);
    if (!closestTrack) {
      this.train.derailed = true;
      this.train.currentTrack = null;
      this._handoffGuidanceUntil = -Infinity;
      return false;
    }

    // Track has not changed — stay on it.
    if (closestTrack === this.train.currentTrack) {
      return true;
    }

    // Junction transitions (e.g. branching at a switch point) always apply
    // immediately — they are deliberate routing decisions, not noise.
    if (this.train.currentTrack && this._isJunctionTransition(this.train.currentTrack, closestTrack)) {
      this._switchToTrack(closestTrack);
      return true;
    }

    // When operating on a plain RailTrack[] (e.g. the menu preview loop) there
    // are no junctions to oscillate across, so the cooldown, hysteresis, and
    // parallel-deadband guards are unnecessary and actively harmful: they prevent
    // the solver from following the train onto the next segment, causing the
    // train to overrun its segment endpoint and fly off track.
    if (!this.isTrackManager(this.trackProvider)) {
      this._switchToTrack(closestTrack);
      return true;
    }

    // --- General proximity switching with hysteresis + cooldown + deadband ---
    // These guards only make sense for TrackManager mode (main game) where there
    // are junction oscillation risks.

    // Enforce cooldown: do not switch again so soon after the last switch.
    const now = performance.now();
    if (now - this._lastSwitchTime < GameConfig.TRACK.SWITCH_COOLDOWN_MS) {
      return true;
    }

    if (this.train.currentTrack) {
      const trainBody = this.train.getMatterBody();
      const trainPosition = trainBody.body.position;

      const currentTrackPoint = this.train.currentTrack.getTrackPoint(trainBody);
      const currentDist = new Phaser.Math.Vector2(
        currentTrackPoint.x - trainPosition.x,
        currentTrackPoint.y - trainPosition.y,
      ).length();

      const candidatePoint = closestTrack.getTrackPoint(trainBody);
      const candidateDist = new Phaser.Math.Vector2(
        candidatePoint.x - trainPosition.x,
        candidatePoint.y - trainPosition.y,
      ).length();

      // Parallel deadband: if the closest points of the two tracks are very near
      // each other the tracks are in the same corridor — treat them as identical
      // and suppress the switch to avoid oscillation between parallel tracks.
      const trackSeparation = new Phaser.Math.Vector2(
        candidatePoint.x - currentTrackPoint.x,
        candidatePoint.y - currentTrackPoint.y,
      ).length();
      if (trackSeparation < GameConfig.TRACK.PARALLEL_DEADBAND) {
        return true;
      }

      // Hysteresis: the candidate must offer a meaningful distance advantage
      // before we commit to it.  A marginal 1-px lead is not enough.
      if (candidateDist >= currentDist - GameConfig.TRACK.SWITCH_HYSTERESIS) {
        return true;
      }
    }

    this._switchToTrack(closestTrack);
    return true;
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

  getFrontContactPoint(): { x: number; y: number; body?: { position: { x: number; y: number } } } {
    const trainBody = this.train.getMatterBody();
    const trainLength = trainBody.displayWidth;
    const trainAngle = trainBody.angle * (Math.PI / 180);
    const trainDirection = new Phaser.Math.Vector2(Math.cos(trainAngle), Math.sin(trainAngle));
    const frontOffset = trainDirection.clone().scale(trainLength * 0.4);
    const x = trainBody.body.position.x + frontOffset.x;
    const y = trainBody.body.position.y + frontOffset.y;
    return { x, y, body: { position: { x, y } } };
  }

  getRearContactPoint(): { x: number; y: number; body?: { position: { x: number; y: number } } } {
    const trainBody = this.train.getMatterBody();
    const trainLength = trainBody.displayWidth;
    const trainAngle = trainBody.angle * (Math.PI / 180);
    const trainDirection = new Phaser.Math.Vector2(Math.cos(trainAngle), Math.sin(trainAngle));
    const rearOffset = trainDirection.clone().scale(-trainLength * 0.4);
    const x = trainBody.body.position.x + rearOffset.x;
    const y = trainBody.body.position.y + rearOffset.y;
    return { x, y, body: { position: { x, y } } };
  }

  getTrackForces(track: RailTrack, frontPoint: { x: number; y: number; body?: { position: { x: number; y: number } } }, rearPoint: { x: number; y: number; body?: { position: { x: number; y: number } } }, scale: number = 1): Phaser.Math.Vector2 {
    const trainBody = this.train.getMatterBody();
    const frontTrackPoint = track.getTrackPoint(frontPoint);
    const rearTrackPoint = track.getTrackPoint(rearPoint);
    const frontForce = guideForceTowardsPoint(
      trainBody,
      frontTrackPoint,
      this.train.pidControllerFront,
      frontPoint,
    );
    const rearForce = guideForceTowardsPoint(
      trainBody,
      rearTrackPoint,
      this.train.pidControllerRear,
      rearPoint,
    );

    if (scale === 1) {
      this.drawForceArrow(new Phaser.Math.Vector2(frontPoint.x, frontPoint.y), frontForce, 0x00ff00);
      this.drawForceArrow(new Phaser.Math.Vector2(rearPoint.x, rearPoint.y), rearForce, 0x00ff00);
    } else if (scale < 0) {
      this.drawForceArrow(new Phaser.Math.Vector2(frontPoint.x, frontPoint.y), frontForce.clone().scale(-1), 0xff0000);
      this.drawForceArrow(new Phaser.Math.Vector2(rearPoint.x, rearPoint.y), rearForce.clone().scale(-1), 0xff0000);
    }

    return new Phaser.Math.Vector2((frontForce.x + rearForce.x) * scale * 0.5, (frontForce.y + rearForce.y) * scale * 0.5);
  }

  private limitHandoffGuidanceForce(
    force: Phaser.Math.Vector2,
    dtSq: number,
    mass: number,
    velocity: Phaser.Math.Vector2,
  ): Phaser.Math.Vector2 {
    if (performance.now() >= this._handoffGuidanceUntil) {
      this._handoffGuidanceUntil = -Infinity;
      return force;
    }

    const forceMagnitude = force.length();
    if (forceMagnitude === 0) {
      return force;
    }

    // Matter integrates guidance as delta-v = force / mass * dt^2. During the
    // finite handoff window, bound that delta to 1% of current momentum per
    // frame. At zero momentum the safe guidance impulse is therefore zero;
    // engine force remains independent and can still start the train.
    const maxForce = dtSq > 0
      ? mass * velocity.length() * HANDOFF_MAX_GUIDANCE_MOMENTUM_FRACTION / dtSq
      : 0;
    if (forceMagnitude > maxForce) {
      return force.clone().scale(maxForce / forceMagnitude);
    }
    return force;
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
    const body = trainBody.body as any;

    // Scale damping by the active physics timestep so it remains stable
    // across frame rates.
    const matterWorld = (trainBody.scene as any)?.matter?.world as any;
    const engineTiming = matterWorld?.engine?.timing;
    const dt = engineTiming?.lastDelta ?? (engineTiming?.timeScale ? 1000 / 60 : 16.667);
    const dtSq = dt * dt;
    const mass = body?.mass ?? 1;

    if (this.isTrackManager(this.trackProvider)) {
      const junctions = this.trackProvider.getJunctionsForTrack(currentTrack);
      for (const junction of junctions) {
        const junctionPos = junction.getPosition();
        const trainPos = currentTrack.getTrackPosition(trainBody);
        const distanceToJunction = Math.abs(trainPos - junctionPos);
        const proximityScale = Math.max(0, 1 - distanceToJunction * 5);

        // Only apply junction forces when the train is meaningfully close to the junction.
        if (proximityScale <= 0.1) {
          continue;
        }

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

    // No destroy needed - frontPoint/rearPoint are plain objects now

    // Smooth angle correction — a higher smoothing factor (closer to 1) means slower,
    // gentler alignment so a track switch does not cause a sudden heading snap.
    const rotation = currentTrack.getTrackAngle(trainBody);
    const newAngle = this.checkAngleDirection(trainBody.angle, rotation, 0.96);
    trainBody.setAngle(newAngle);

    // Cap repulsion so it cannot overpower the main attraction force.
    const mainMag = mainForce.length();
    const repulsionMag = repulsionForce.length();
    if (repulsionMag > mainMag * 0.5) {
      repulsionForce.scale((mainMag * 0.5) / repulsionMag);
    }

    const combinedForce = mainForce.add(repulsionForce.scale(0.5));
    const lateralForce = limitForceToLateralApplication(trainBody, combinedForce);

    // Lateral velocity damping: oppose any sideways motion that is not caused by
    // the current track force to damp out residual oscillation.
    const velocity = new Phaser.Math.Vector2(trainBody.body?.velocity?.x ?? 0, trainBody.body?.velocity?.y ?? 0);
    const forwardDir = new Phaser.Math.Vector2(Math.cos(trainBody.rotation ?? 0), Math.sin(trainBody.rotation ?? 0));
    const lateralDir = new Phaser.Math.Vector2(-forwardDir.y, forwardDir.x);
    const lateralVelocity = velocity.dot(lateralDir);
    // FIX: Matter.js integrates force as:
    //   new_disp = old_disp * (1 - frictionAir) + (force/mass) * dt^2
    // So a force produces a displacement change proportional to dt^2.
    // To achieve an ~8% reduction of lateral displacement per frame, we must
    // divide by dt^2 so the coefficient is consistent across framerates.
    const dampingCoefficient = dtSq > 0 ? 0.08 / dtSq : 0;
    const dampingForce = lateralDir.clone().scale(-mass * lateralVelocity * dampingCoefficient);

    const guidanceForce = this.limitHandoffGuidanceForce(
      lateralForce.clone().add(dampingForce),
      dtSq,
      mass,
      velocity,
    );

    this.drawForceArrow(new Phaser.Math.Vector2(trainBody.body?.position?.x ?? 0, trainBody.body?.position?.y ?? 0), guidanceForce, 0x0000ff);
    applyForceToGameObject(trainBody, guidanceForce);
  }
}
