/**
 * Unit tests for TerrainValidator — curvature, alignment, and canPlaceTrack overloads.
 *
 * BDD style: Given / When / Then
 */

const Phaser = require('phaser');
import { TerrainValidator } from '../../src/systems/TerrainValidator';
import TrackManager from '../../src/managers/TrackManager';
import RailTrack from '../../src/entities/RailTrack';

const { makeScene } = require('../../__mocks__/phaser');

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Minimal TerrainGenerator that returns flat, LOWLAND terrain everywhere. */
function makeFlatTerrain() {
  return {
    getHeightAt: (_x: number, _y: number) => 0,
    getBandAt:   (_x: number, _y: number) => 'LOWLAND',
    slopeAt:     (_x: number, _y: number) => 0,
  };
}

/** Minimal TerrainGenerator that returns steep slope everywhere. */
function makeSteepTerrain() {
  return {
    getHeightAt: (x: number, _y: number) => x * 2,  // extreme gradient
    getBandAt:   (_x: number, _y: number) => 'HIGHLAND',
    slopeAt:     (_x: number, _y: number) => 90,
  };
}

function v(x: number, y: number): any {
  return new Phaser.Math.Vector2(x, y);
}

function makeTrack(scene: any, x1: number, y1: number, x2: number, y2: number): RailTrack {
  const p0 = v(x1, y1);
  const p1 = v(x1 + (x2 - x1) / 3, y1 + (y2 - y1) / 3);
  const p2 = v(x1 + 2 * (x2 - x1) / 3, y1 + 2 * (y2 - y1) / 3);
  const p3 = v(x2, y2);
  return new RailTrack(scene, p0, p1, p2, p3);
}

// ── exceedsMinCurvature ──────────────────────────────────────────────────────

describe('TerrainValidator.exceedsMinCurvature()', () => {
  let validator: TerrainValidator;

  beforeEach(() => {
    validator = new TerrainValidator(makeFlatTerrain() as any);
  });

  it('Given a near-straight track, When checking curvature, Then it passes', () => {
    // Straight line — infinite radius
    const p0 = v(0, 0);
    const p1 = v(100, 0);
    const p2 = v(200, 0);
    const p3 = v(300, 0);
    const result = validator.exceedsMinCurvature(p0, p1, p2, p3, 20);
    expect(result.exceeds).toBe(false);
  });

  it('Given a gentle arc, When checking curvature, Then it passes', () => {
    // Quarter-circle of radius ~300 px approximated by a Bézier
    // Control points derived from classic quarter-circle Bézier approximation (k ≈ 0.5523)
    const R = 300;
    const k = 0.5523;
    const p0 = v(0, 0);
    const p1 = v(R * k, 0);
    const p2 = v(R, R - R * k);
    const p3 = v(R, R);
    const result = validator.exceedsMinCurvature(p0, p1, p2, p3, 40);
    // minRadius should be close to R; well above MIN_CURVE_RADIUS_PX (150)
    expect(result.exceeds).toBe(false);
    expect(result.minRadius).toBeGreaterThan(150);
  });

  it('Given a sharp U-turn with tiny control-point spread, When checking curvature, Then it fails', () => {
    // Extremely tight S-curve: control points close together forming a very small radius turn
    const p0 = v(0, 0);
    const p1 = v(10, 0);
    const p2 = v(10, 20);
    const p3 = v(0, 20);
    const result = validator.exceedsMinCurvature(p0, p1, p2, p3, 40);
    expect(result.exceeds).toBe(true);
    expect(result.minRadius).toBeLessThan(150);
  });
});

// ── checkConnectionAlignment ─────────────────────────────────────────────────

describe('TerrainValidator.checkConnectionAlignment()', () => {
  let validator: TerrainValidator;
  let scene: any;
  let trackManager: TrackManager;

  beforeEach(() => {
    validator = new TerrainValidator(makeFlatTerrain() as any);
    scene = makeScene();
    trackManager = new TrackManager(scene);
  });

  it('Given no nearby endpoint, When checking alignment, Then it is aligned (no constraint)', () => {
    // Proposed track starts far away from any existing track
    const p0 = v(1000, 1000);
    const p1 = v(1100, 1000);
    const result = validator.checkConnectionAlignment(p0, p1, trackManager);
    expect(result.aligned).toBe(true);
    expect(result.angleDeg).toBe(0);
  });

  it('Given two collinear tracks, When checking alignment at join, Then they are aligned', () => {
    // Existing track goes right: (0,0) → (200,0)
    const existing = makeTrack(scene, 0, 0, 200, 0);
    trackManager.addTrack(existing);

    // Proposed track also goes right, snapping to the end (200, 0)
    const p0 = v(200, 0);
    const p1 = v(300, 0);  // direction = +x, same as existing track's tangent at end
    const result = validator.checkConnectionAlignment(p0, p1, trackManager);
    expect(result.aligned).toBe(true);
  });

  it('Given two tracks meeting at 30 degrees, When checking alignment, Then they are misaligned', () => {
    // Existing track goes right: (0,0) → (200,0)
    const existing = makeTrack(scene, 0, 0, 200, 0);
    trackManager.addTrack(existing);

    // Proposed track departs at ~30° from the end point
    const angle30 = Math.PI / 6;
    const p0 = v(200, 0);
    const p1 = v(200 + Math.cos(angle30) * 100, Math.sin(angle30) * 100);
    const result = validator.checkConnectionAlignment(p0, p1, trackManager);
    // 30° >> 5° limit → should be misaligned
    expect(result.aligned).toBe(false);
    expect(result.angleDeg).toBeGreaterThan(20);
  });
});

// ── canPlaceTrack — backward-compatible 2-point form ────────────────────────

describe('TerrainValidator.canPlaceTrack() — 2-point form', () => {
  it('Given a flat, short track, When calling with 2 points only, Then it is valid', () => {
    const validator = new TerrainValidator(makeFlatTerrain() as any);
    const result = validator.canPlaceTrack(v(0, 0), v(200, 0));
    expect(result.valid).toBe(true);
    expect(result.reasonCode).toBe('ok');
  });

  it('Given steep terrain, When calling 2-point form, Then slope check fires', () => {
    const validator = new TerrainValidator(makeSteepTerrain() as any);
    const result = validator.canPlaceTrack(v(0, 0), v(500, 0));
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe('slope');
  });

  it('Given terrain with a cliff, When calling 2-point form, Then cliff check fires', () => {
    const cliffTerrain = {
      getHeightAt: (_x: number, _y: number) => 0,
      getBandAt:   (_x: number, _y: number) => 'HIGHLAND',
      slopeAt:     (_x: number, _y: number) => 90,  // exceeds cliff threshold
    };
    const validator = new TerrainValidator(cliffTerrain as any);
    const result = validator.canPlaceTrack(v(0, 0), v(200, 0));
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe('cliff');
  });
});

// ── canPlaceTrack — 4-point form ─────────────────────────────────────────────

describe('TerrainValidator.canPlaceTrack() — 4-point form', () => {
  it('Given a straight track (4-point form), When validating, Then it passes', () => {
    const validator = new TerrainValidator(makeFlatTerrain() as any);
    const result = validator.canPlaceTrack(v(0, 0), v(100, 0), v(200, 0), v(300, 0), 20, null);
    expect(result.valid).toBe(true);
    expect(result.reasonCode).toBe('ok');
  });

  it('Given a tight-curve track (4-point form), When validating, Then curvature fails', () => {
    const validator = new TerrainValidator(makeFlatTerrain() as any);
    // Tight turn — control spread of only 10 px
    const result = validator.canPlaceTrack(v(0, 0), v(10, 0), v(10, 20), v(0, 20), 40, null);
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe('curvature');
  });

  it('Given a misaligned connection (4-point form), When validating with trackManager, Then alignment fails', () => {
    const scene = makeScene();
    const trackManager = new TrackManager(scene);
    const existing = makeTrack(scene, 0, 0, 200, 0);
    trackManager.addTrack(existing);

    const validator = new TerrainValidator(makeFlatTerrain() as any);
    // Proposed track departs at 30° from (200, 0)
    const angle30 = Math.PI / 6;
    const p0 = v(200, 0);
    const p1 = v(200 + Math.cos(angle30) * 100, Math.sin(angle30) * 100);
    const p2 = v(200 + Math.cos(angle30) * 200, Math.sin(angle30) * 200);
    const p3 = v(200 + Math.cos(angle30) * 300, Math.sin(angle30) * 300);
    const result = validator.canPlaceTrack(p0, p1, p2, p3, 20, trackManager);
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe('misaligned');
  });

  it('Given a valid aligned connection (4-point form), When validating with trackManager, Then it passes', () => {
    const scene = makeScene();
    const trackManager = new TrackManager(scene);
    const existing = makeTrack(scene, 0, 0, 200, 0);
    trackManager.addTrack(existing);

    const validator = new TerrainValidator(makeFlatTerrain() as any);
    // Proposed track continues straight right from (200, 0)
    const result = validator.canPlaceTrack(v(200, 0), v(300, 0), v(400, 0), v(500, 0), 20, trackManager);
    expect(result.valid).toBe(true);
    expect(result.reasonCode).toBe('ok');
  });
});

// ── TrackManager.findEndpointNear ────────────────────────────────────────────

describe('TrackManager.findEndpointNear()', () => {
  let scene: any;
  let manager: TrackManager;

  beforeEach(() => {
    scene = makeScene();
    manager = new TrackManager(scene);
  });

  it('Given no tracks, When searching near a point, Then returns null', () => {
    const result = manager.findEndpointNear(v(0, 0), 60);
    expect(result).toBeNull();
  });

  it('Given a track, When searching near its start, Then returns the track', () => {
    const track = makeTrack(scene, 0, 0, 200, 0);
    manager.addTrack(track);
    const result = manager.findEndpointNear(v(1, 0), 60);
    expect(result).not.toBeNull();
    expect(result!.track).toBe(track);
    expect(result!.isStart).toBe(true);
  });

  it('Given a track, When searching near its end, Then returns the track with isStart false', () => {
    const track = makeTrack(scene, 0, 0, 200, 0);
    manager.addTrack(track);
    const result = manager.findEndpointNear(v(199, 0), 60);
    expect(result).not.toBeNull();
    expect(result!.isStart).toBe(false);
  });

  it('Given a track, When searching outside radius, Then returns null', () => {
    const track = makeTrack(scene, 0, 0, 200, 0);
    manager.addTrack(track);
    const result = manager.findEndpointNear(v(500, 500), 60);
    expect(result).toBeNull();
  });

  it('Given a track, When excludeUUID matches, Then returns null', () => {
    const track = makeTrack(scene, 0, 0, 200, 0);
    const uuid = manager.addTrack(track);
    const result = manager.findEndpointNear(v(1, 0), 60, uuid);
    expect(result).toBeNull();
  });
});
