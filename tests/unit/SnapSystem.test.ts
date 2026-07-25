/**
 * Tests for SnapSystem – grid/endpoint/midpoint snapping.
 */

import { SnapSystem } from '../../src/systems/SnapSystem';
import TrackManager from '../../src/managers/TrackManager';
import RailTrack from '../../src/entities/RailTrack';

const { makeScene } = require('../../__mocks__/phaser');

function makeTrack(scene: any, x1: number, y1: number, x2: number, y2: number): RailTrack {
  const Phaser = require('phaser');
  const p0 = new Phaser.Math.Vector2(x1, y1);
  const p1 = new Phaser.Math.Vector2(x1 + (x2 - x1) / 3, y1);
  const p2 = new Phaser.Math.Vector2(x1 + 2 * (x2 - x1) / 3, y1);
  const p3 = new Phaser.Math.Vector2(x2, y2);
  return new RailTrack(scene, p0, p1, p2, p3);
}

describe('SnapSystem', () => {
  let scene: any;
  let trackManager: TrackManager;
  let snap: SnapSystem;

  beforeEach(() => {
    scene = makeScene();
    trackManager = new TrackManager(scene);
    snap = new SnapSystem(trackManager);
    snap.snapRadius = 40;
    snap.gridSize = 64;
  });

  describe('Given no tracks and all snap modes enabled', () => {
    it('returns the unmodified point with snapped=false when nothing to snap to', () => {
      snap.gridEnabled = false;
      const result = snap.snapPoint(55, 77);
      expect(result).toEqual({ x: 55, y: 77, snapped: false, type: 'none' });
    });
  });

  describe('Grid snap', () => {
    it('Given gridEnabled=true, snaps to nearest grid intersection', () => {
      snap.endpointEnabled = false;
      snap.midpointEnabled = false;
      // Point is 8 units from grid intersection at (64, 64)
      const result = snap.snapPoint(60, 62);
      expect(result.snapped).toBe(true);
      expect(result.type).toBe('grid');
      expect(result.x).toBe(64);
      expect(result.y).toBe(64);
    });

    it('Given gridEnabled=false, does not snap to grid', () => {
      snap.endpointEnabled = false;
      snap.midpointEnabled = false;
      snap.gridEnabled = false;
      const result = snap.snapPoint(60, 62);
      expect(result.snapped).toBe(false);
    });

    it('always snaps to the nearest grid intersection when enabled', () => {
      snap.endpointEnabled = false;
      snap.midpointEnabled = false;
      const result = snap.snapPoint(30, 0);
      expect(result.snapped).toBe(true);
      expect(result.type).toBe('grid');
      // Math.round(30/64)*64 = 0
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });
  });

  describe('Endpoint snap', () => {
    it('Given a track nearby, snaps to its start point', () => {
      snap.gridEnabled = false;
      const track = makeTrack(scene, 100, 100, 200, 100);
      trackManager.addTrack(track);
      // Query near the start (100, 100)
      const result = snap.snapPoint(115, 108);
      expect(result.snapped).toBe(true);
      expect(result.type).toBe('endpoint');
      expect(result.x).toBe(100);
      expect(result.y).toBe(100);
    });

    it('Given a track nearby, snaps to its end point', () => {
      snap.gridEnabled = false;
      const track = makeTrack(scene, 100, 100, 200, 100);
      trackManager.addTrack(track);
      // Query near the end (200, 100)
      const result = snap.snapPoint(185, 95);
      expect(result.snapped).toBe(true);
      expect(result.type).toBe('endpoint');
      expect(result.x).toBe(200);
    });

    it('excludes tracks listed in excludeUUIDs', () => {
      snap.gridEnabled = false;
      const track = makeTrack(scene, 100, 100, 200, 100);
      trackManager.addTrack(track);
      const result = snap.snapPoint(115, 108, [track.getUUID()]);
      expect(result.snapped).toBe(false);
    });

    it('Given endpointEnabled=false, does not snap to endpoint', () => {
      snap.gridEnabled = false;
      snap.endpointEnabled = false;
      const track = makeTrack(scene, 100, 100, 200, 100);
      trackManager.addTrack(track);
      const result = snap.snapPoint(115, 108);
      expect(result.snapped).toBe(false);
    });

    it('returns deterministic endpoint identity and the outward tangent', () => {
      snap.gridEnabled = false;
      const track = makeTrack(scene, 100, 100, 200, 100);
      track.setUUID('eastbound');
      trackManager.addTrack(track);

      expect(snap.snapPoint(105, 100)).toEqual(expect.objectContaining({
        x: 100,
        y: 100,
        type: 'endpoint',
        trackUUID: 'eastbound',
        endpoint: 'start',
        outward: { x: -1, y: 0 },
      }));
      expect(snap.snapPoint(195, 100)).toEqual(expect.objectContaining({
        x: 200,
        y: 100,
        type: 'endpoint',
        trackUUID: 'eastbound',
        endpoint: 'end',
        outward: { x: 1, y: 0 },
      }));
    });
  });

  describe('Midpoint snap', () => {
    it('Given midpointEnabled=true, snaps to midpoint of a track', () => {
      snap.gridEnabled = false;
      snap.endpointEnabled = false;
      snap.midpointEnabled = true;
      const track = makeTrack(scene, 0, 0, 100, 0);
      trackManager.addTrack(track);
      // Midpoint is around (50, 0)
      const result = snap.snapPoint(52, 5);
      expect(result.snapped).toBe(true);
      expect(result.type).toBe('midpoint');
    });

    it('Given midpointEnabled=false, does not snap to midpoint', () => {
      snap.gridEnabled = false;
      snap.endpointEnabled = false;
      snap.midpointEnabled = false;
      const track = makeTrack(scene, 0, 0, 100, 0);
      trackManager.addTrack(track);
      const result = snap.snapPoint(52, 5);
      expect(result.snapped).toBe(false);
    });

    it('excludes tracks listed in excludeUUIDs for midpoint snap', () => {
      snap.gridEnabled = false;
      snap.endpointEnabled = false;
      snap.midpointEnabled = true;
      const track = makeTrack(scene, 0, 0, 100, 0);
      trackManager.addTrack(track);
      const result = snap.snapPoint(52, 5, [track.getUUID()]);
      expect(result.snapped).toBe(false);
    });
  });

  describe('Priority: endpoint > midpoint > grid', () => {
    it('prefers endpoint over grid when both would match', () => {
      // Track endpoint exactly on grid point (64, 0)
      const track = makeTrack(scene, 64, 0, 200, 0);
      trackManager.addTrack(track);
      snap.midpointEnabled = false;
      const result = snap.snapPoint(70, 5); // near (64,0) which is also on grid
      expect(result.type).toBe('endpoint');
    });
  });
});
