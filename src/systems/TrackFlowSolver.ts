import Phaser from 'phaser';
import RailTrack from '../entities/RailTrack';
import type { ITrackFollower } from '../config/VehicleTypes';
import { applyForceToGameObject, guideForceTowardsPoint, limitForceToLateralApplication } from '../utils/physics';
import TrackManager from '../managers/TrackManager';
import { GameConfig } from '../config/GameConfig';

const HANDOFF_MAX_GUIDANCE_MOMENTUM_FRACTION = 0.01;
const HANDOFF_RELEASE_GUIDANCE_MOMENTUM_FRACTION = 0.1;
const HANDOFF_RAIL_CORRIDOR_TOLERANCE_PX =
  GameConfig.TRACK.RAIL_TRACK_WIDTH * GameConfig.TRACK.SCALE * 0.5;
const HANDOFF_CONTACT_MIGRATION_HYSTERESIS_PX =
  HANDOFF_RAIL_CORRIDOR_TOLERANCE_PX;
const HANDOFF_LATERAL_VELOCITY_FLOOR = GameConfig.TRACK.SCALE;
const HANDOFF_RELEASE_DELTA_VELOCITY_FLOOR = GameConfig.TRACK.SCALE * 3;
const HANDOFF_LATERAL_VELOCITY_FRACTION = 0.1;
const HANDOFF_SETTLED_FRAMES_REQUIRED = 6;

export default class TrackFlowSolver {
  private trackProvider: TrackManager | RailTrack[];
  private train: ITrackFollower;
  private debugArrow: Phaser.GameObjects.Graphics;
  /** Timestamp (performance.now) of the last automatic track switch, used to enforce SWITCH_COOLDOWN_MS. */
  private _lastSwitchTime: number = -Infinity;
  /** True until the new track has met every physical settlement guard durably. */
  private _handoffGuidanceLimited: boolean = false;
  private _handoffEntryEndpoint: 0 | 1 | null = null;
  private _handoffSettledFrames: number = 0;
  private _handoffPreviousTrack: RailTrack | null = null;
  private _handoffFrontTrack: RailTrack | null = null;
  private _handoffRearTrack: RailTrack | null = null;
  /** Ordered per-contact segments still to cross during overlapping handoffs. */
  private _handoffFrontRoute: RailTrack[] = [];
  private _handoffRearRoute: RailTrack[] = [];

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
    const previousTrack = this.train.currentTrack;
    const previousFrontTrack = this._handoffGuidanceLimited
      ? this._handoffFrontTrack ?? previousTrack
      : previousTrack;
    const previousRearTrack = this._handoffGuidanceLimited
      ? this._handoffRearTrack ?? previousTrack
      : previousTrack;
    const previousFrontRoute = this._handoffGuidanceLimited
      ? [...this._handoffFrontRoute]
      : previousFrontTrack ? [previousFrontTrack] : [];
    const previousRearRoute = this._handoffGuidanceLimited
      ? [...this._handoffRearRoute]
      : previousRearTrack ? [previousRearTrack] : [];
    this.train.currentTrack = track;

    // Soft-reset PIDs to the current error on the new track so the derivative
    // term does not spike on the first frame after the switch.  A hard reset
    // (previousError = 0) would make the D term compute kd*(error-0)/delta,
    // causing an overshoot and the 'shake' when switching segments.
    const trainBody = this.train.getMatterBody();
    const mass = trainBody.body?.mass ?? 1;
    const forceConstant = GameConfig.FORCE.GUIDE_CONSTANT;

    const frontPoint = this.getFrontContactPoint();
    const rearPoint = this.getRearContactPoint();
    this._handoffPreviousTrack =
      previousTrack && previousTrack !== track ? previousTrack : null;
    this._handoffFrontRoute = this.extendHandoffContactRoute(
      frontPoint,
      track,
      previousFrontRoute,
    );
    this._handoffRearRoute = this.extendHandoffContactRoute(
      rearPoint,
      track,
      previousRearRoute,
    );
    this._handoffFrontTrack = this._handoffFrontRoute[0] ?? track;
    this._handoffRearTrack = this._handoffRearRoute[0] ?? track;
    const frontTrackPoint = this._handoffFrontTrack.getTrackPoint(frontPoint);
    const rearTrackPoint = this._handoffRearTrack.getTrackPoint(rearPoint);
    const frontDist = new Phaser.Math.Vector2(frontTrackPoint.x - frontPoint.x, frontTrackPoint.y - frontPoint.y).length();
    const rearDist = new Phaser.Math.Vector2(rearTrackPoint.x - rearPoint.x, rearTrackPoint.y - rearPoint.y).length();

    const frontError = mass * forceConstant * frontDist;
    const rearError = mass * forceConstant * rearDist;
    this.train.pidControllerFront.resetToError(frontError);
    this.train.pidControllerRear.resetToError(rearError);

    this._lastSwitchTime = performance.now();
    this._handoffGuidanceLimited = true;
    this._handoffSettledFrames = 0;
    const bodyPosition = trainBody.body.position;
    const curve = track.getCurvePath();
    const start = curve.getPoint(0);
    const end = curve.getPoint(1);
    // Proximity and mid-track switches use the nearest endpoint as their entry
    // side too. They can already be interior, but still must pass every other
    // physical settlement guard for six consecutive frames.
    this._handoffEntryEndpoint =
      new Phaser.Math.Vector2(bodyPosition.x, bodyPosition.y).distance(start)
      <= new Phaser.Math.Vector2(bodyPosition.x, bodyPosition.y).distance(end)
        ? 0
        : 1;
  }

  private contactTrackError(
    track: RailTrack,
    point: { x: number; y: number; body?: { position: { x: number; y: number } } },
  ): number {
    const trackPoint = track.getTrackPoint(point);
    return new Phaser.Math.Vector2(
      trackPoint.x - point.x,
      trackPoint.y - point.y,
    ).length();
  }

  private extendHandoffContactRoute(
    point: { x: number; y: number; body?: { position: { x: number; y: number } } },
    currentTrack: RailTrack,
    existingRoute: RailTrack[],
  ): RailTrack[] {
    const route = [...existingRoute];
    if (
      this._handoffPreviousTrack
      && route[route.length - 1] !== this._handoffPreviousTrack
      && this._handoffPreviousTrack !== currentTrack
    ) {
      route.push(this._handoffPreviousTrack);
    }
    if (route[route.length - 1] !== currentTrack) {
      route.push(currentTrack);
    }
    if (route.length === 0) {
      route.push(currentTrack);
    }

    // A contact already decisively on the next segment need not begin on the
    // old one. Once a route has more than two entries, however, preserve its
    // physical order and let the normal one-step migration advance it.
    if (
      route.length === 2
      && this.contactTrackError(route[1], point)
        + HANDOFF_CONTACT_MIGRATION_HYSTERESIS_PX
        < this.contactTrackError(route[0], point)
    ) {
      route.shift();
    }
    return route;
  }

  private updateHandoffContactAssignments(
    currentTrack: RailTrack,
    frontPoint: { x: number; y: number; body?: { position: { x: number; y: number } } },
    rearPoint: { x: number; y: number; body?: { position: { x: number; y: number } } },
  ): void {
    const migrate = (
      existingRoute: RailTrack[],
      point: { x: number; y: number; body?: { position: { x: number; y: number } } },
      resetPid: (error: number) => void,
    ): RailTrack[] => {
      const route = existingRoute.length > 0
        ? existingRoute
        : [currentTrack];
      if (route[route.length - 1] !== currentTrack) {
        route.push(currentTrack);
      }
      if (route.length === 1) return route;

      const assignedTrack = route[0];
      const nextTrack = route[1];
      const assignedError = this.contactTrackError(assignedTrack, point);
      const nextError = this.contactTrackError(nextTrack, point);
      // One rendered half-rail of advantage makes migration decisive while
      // preventing contact assignment chatter around the connected endpoint.
      if (nextError + HANDOFF_CONTACT_MIGRATION_HYSTERESIS_PX
        <= assignedError
      ) {
        route.shift();
        const mass = this.train.getMatterBody().body?.mass ?? 1;
        resetPid(
          mass * GameConfig.FORCE.GUIDE_CONSTANT
            * this.contactTrackError(route[0], point),
        );
      }
      return route;
    };

    this._handoffFrontRoute = migrate(
      this._handoffFrontRoute,
      frontPoint,
      (error) => this.train.pidControllerFront.resetToError(error),
    );
    this._handoffRearRoute = migrate(
      this._handoffRearRoute,
      rearPoint,
      (error) => this.train.pidControllerRear.resetToError(error),
    );
    this._handoffFrontTrack = this._handoffFrontRoute[0] ?? currentTrack;
    this._handoffRearTrack = this._handoffRearRoute[0] ?? currentTrack;
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
      this.clearHandoffGuidanceState();
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
      this.clearHandoffGuidanceState();
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
    return this.getContactTrackForces(
      track,
      track,
      frontPoint,
      rearPoint,
      scale,
    );
  }

  private getContactTrackForces(
    frontTrack: RailTrack,
    rearTrack: RailTrack,
    frontPoint: { x: number; y: number; body?: { position: { x: number; y: number } } },
    rearPoint: { x: number; y: number; body?: { position: { x: number; y: number } } },
    scale: number,
  ): Phaser.Math.Vector2 {
    const trainBody = this.train.getMatterBody();
    const frontTrackPoint = frontTrack.getTrackPoint(frontPoint);
    const rearTrackPoint = rearTrack.getTrackPoint(rearPoint);
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
    track: RailTrack,
    frontPoint: { x: number; y: number; body?: { position: { x: number; y: number } } },
    rearPoint: { x: number; y: number; body?: { position: { x: number; y: number } } },
    force: Phaser.Math.Vector2,
    dtSq: number,
    mass: number,
    velocity: Phaser.Math.Vector2,
    lateralVelocity: number,
  ): Phaser.Math.Vector2 {
    if (!this._handoffGuidanceLimited) {
      return force;
    }

    const forceMagnitude = force.length();
    const speed = velocity.length();
    // Matter integrates guidance as delta-v = force / mass * dt^2. During the
    // handoff, bound that delta to 1% of current momentum per frame.
    const maxForce = dtSq > 0
      ? mass * speed * HANDOFF_MAX_GUIDANCE_MOMENTUM_FRACTION / dtSq
      : 0;

    const curve = track.getCurvePath();
    const curveLength = Math.max(curve.getLength(), 1);
    const interiorMargin = Math.min(
      HANDOFF_RAIL_CORRIDOR_TOLERANCE_PX / curveLength,
      0.5,
    );
    const frontPosition = track.getTrackPosition(frontPoint);
    const rearPosition = track.getTrackPosition(rearPoint);
    const contactsInterior = this._handoffEntryEndpoint === 0
      ? frontPosition >= interiorMargin && rearPosition >= interiorMargin
      : this._handoffEntryEndpoint === 1
        ? frontPosition <= 1 - interiorMargin && rearPosition <= 1 - interiorMargin
        : false;

    const bothContactsMigrated =
      this._handoffFrontTrack === track
      && this._handoffRearTrack === track;
    const contactsAligned =
      this.contactTrackError(track, frontPoint)
        <= HANDOFF_RAIL_CORRIDOR_TOLERANCE_PX
      && this.contactTrackError(track, rearPoint)
        <= HANDOFF_RAIL_CORRIDOR_TOLERANCE_PX;

    const lateralVelocityLimit = Math.max(
      speed * HANDOFF_LATERAL_VELOCITY_FRACTION,
      HANDOFF_LATERAL_VELOCITY_FLOOR,
    );
    const lateralVelocitySettled = Math.abs(lateralVelocity) <= lateralVelocityLimit;

    // Releasing at the strict 1% cap is not reliably reachable under normal
    // contact noise. A settled handoff may release at a still-bounded 10%
    // delta-v, with a small absolute floor for stopped/near-stopped trains.
    const releaseDeltaVelocity = Math.max(
      speed * HANDOFF_RELEASE_GUIDANCE_MOMENTUM_FRACTION,
      HANDOFF_RELEASE_DELTA_VELOCITY_FLOOR,
    );
    const releaseForce = dtSq > 0
      ? mass * releaseDeltaVelocity / dtSq
      : 0;
    const guidanceSettled = forceMagnitude <= releaseForce;

    if (
      bothContactsMigrated
      && contactsInterior
      && contactsAligned
      && lateralVelocitySettled
      && guidanceSettled
    ) {
      this._handoffSettledFrames += 1;
    } else {
      this._handoffSettledFrames = 0;
    }

    if (this._handoffSettledFrames >= HANDOFF_SETTLED_FRAMES_REQUIRED) {
      this.clearHandoffGuidanceState();
      return force;
    }

    return forceMagnitude > maxForce
      ? force.clone().scale(maxForce / forceMagnitude)
      : force;
  }

  private clearHandoffGuidanceState(): void {
    this._handoffGuidanceLimited = false;
    this._handoffEntryEndpoint = null;
    this._handoffSettledFrames = 0;
    this._handoffPreviousTrack = null;
    this._handoffFrontTrack = null;
    this._handoffRearTrack = null;
    this._handoffFrontRoute = [];
    this._handoffRearRoute = [];
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
    if (this._handoffGuidanceLimited) {
      this.updateHandoffContactAssignments(
        currentTrack,
        frontPoint,
        rearPoint,
      );
    }
    const mainForce = this._handoffGuidanceLimited
      ? this.getContactTrackForces(
        this._handoffFrontTrack ?? currentTrack,
        this._handoffRearTrack ?? currentTrack,
        frontPoint,
        rearPoint,
        1,
      )
      : this.getTrackForces(currentTrack, frontPoint, rearPoint, 1);
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
      currentTrack,
      frontPoint,
      rearPoint,
      lateralForce.clone().add(dampingForce),
      dtSq,
      mass,
      velocity,
      lateralVelocity,
    );

    this.drawForceArrow(new Phaser.Math.Vector2(trainBody.body?.position?.x ?? 0, trainBody.body?.position?.y ?? 0), guidanceForce, 0x0000ff);
    applyForceToGameObject(trainBody, guidanceForce);
  }
}
