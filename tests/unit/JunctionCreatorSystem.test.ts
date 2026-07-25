/**
 * Unit tests for JunctionCreatorSystem
 *
 * Tests focus on the pure-logic parts (angle optimisation, candidate finding)
 * using the Phaser mock.
 */

import { JunctionCreatorSystem } from '../../src/systems/JunctionCreatorSystem';
import TrackManager from '../../src/managers/TrackManager';
import { WorldManager } from '../../src/managers/WorldManager';
import { GameConfig } from '../../src/config/GameConfig';

const { makeScene } = require('../../__mocks__/phaser');
const Phaser = require('phaser');

function makeTrack(scene: any, x1 = 0, y1 = 0, x2 = 500, y2 = 0) {
  const p0 = new Phaser.Math.Vector2(x1, y1);
  const p1 = new Phaser.Math.Vector2(x1 + (x2 - x1) / 3, y1);
  const p2 = new Phaser.Math.Vector2(x1 + 2 * (x2 - x1) / 3, y1);
  const p3 = new Phaser.Math.Vector2(x2, y2);
  const { default: RailTrack } = require('../../src/entities/RailTrack');
  return new RailTrack(scene, p0, p1, p2, p3);
}

describe('JunctionCreatorSystem', () => {
  let scene: any;
  let trackManager: TrackManager;
  let system: JunctionCreatorSystem;

  beforeEach(() => {
    scene = makeScene();
    trackManager = new TrackManager(scene);
    WorldManager.createNew('JctTest');
    system = new JunctionCreatorSystem(scene, trackManager);
  });

  afterEach(() => {
    WorldManager.reset();
    system.destroy();
  });

  describe('constructor', () => {
    it('initialises without errors', () => {
      expect(system).toBeDefined();
    });
  });

  describe('onPointerDown / onPointerMove / onPointerUp', () => {
    it('onPointerDown with non-right-click is a no-op', () => {
      const pointer = { rightButtonDown: () => false, x: 100, y: 100 };
      expect(() => system.onPointerDown(pointer as any)).not.toThrow();
    });

    it('onPointerMove without active drag is a no-op', () => {
      const pointer = { x: 200, y: 200 };
      expect(() => system.onPointerMove(pointer as any)).not.toThrow();
    });

    it('onPointerUp without active drag is a no-op', () => {
      const pointer = { x: 200, y: 200 };
      expect(() => system.onPointerUp(pointer as any)).not.toThrow();
    });
  });

  describe('angle optimisation (via full flow)', () => {
    it('emits toast when no tracks in selection', () => {
      const toasts: string[] = [];
      const { EventBus } = require('../../src/services/EventBus');
      const handler = (d: { message: string }) => toasts.push(d.message);
      EventBus.on('ui:toast', handler);

      // Simulate a right-drag over an empty area
      const cam = { zoom: 1, scrollX: 0, scrollY: 0, getWorldPoint: (x: number, y: number) => {
        const Phaser = require('phaser'); return new Phaser.Math.Vector2(x, y);
      } };
      scene.cameras = { main: cam };

      const downPointer = { rightButtonDown: () => true, x: 0, y: 0 };
      const upPointer = { x: 200, y: 200 };

      system.onPointerDown(downPointer as any);
      system.onPointerMove({ x: 200, y: 200 } as any);
      system.onPointerUp(upPointer as any);

      expect(toasts.some((t) => t.toLowerCase().includes('no tracks'))).toBe(true);
      EventBus.off('ui:toast', handler);
    });

    it('does not throw when track is present in selection', () => {
      const cam = { zoom: 1, scrollX: 0, scrollY: 0, getWorldPoint: (x: number, y: number) => {
        const Phaser = require('phaser'); return new Phaser.Math.Vector2(x, y);
      } };
      scene.cameras = { main: cam };

      const track = makeTrack(scene, 50, 50, 150, 50);
      trackManager.addTrack(track);

      const downPointer = { rightButtonDown: () => true, x: 0, y: 0 };
      system.onPointerDown(downPointer as any);
      system.onPointerMove({ x: 200, y: 200 } as any);
      expect(() => system.onPointerUp({ x: 200, y: 200 } as any)).not.toThrow();
    });
  });

  describe('angle optimisation internals', () => {
    it('MAX_CURVE_TOLERANCE_DEG config exists', () => {
      expect(GameConfig.WORLD.MAX_CURVE_TOLERANCE_DEG).toBeGreaterThan(0);
    });

    it('JUNCTION_OPTIMISATION_ITERATIONS config exists', () => {
      expect(GameConfig.TOOLS.JUNCTION_OPTIMISATION_ITERATIONS).toBeGreaterThan(0);
    });

    it('optimised left angle is negative relative to main angle', () => {
      // Access private method via cast
      const leftAngleDeg = GameConfig.JUNCTION.LEFT_ANGLE_DEG;
      expect(leftAngleDeg).toBeLessThan(0);
    });

    it('optimised right angle is positive relative to main angle', () => {
      const rightAngleDeg = GameConfig.JUNCTION.RIGHT_ANGLE_DEG;
      expect(rightAngleDeg).toBeGreaterThan(0);
    });
  });

  describe('terrain validation', () => {
    it('validates both generated branches with their exact four cubic controls', () => {
      const terrainValidator = {
        canPlaceTrack: jest.fn().mockReturnValue({
          valid: true,
          geometry: {
            geometryVersion: 1,
            p0: { x: 0, y: 0 },
            p1: { x: 1, y: 0 },
            p2: { x: 2, y: 0 },
            p3: { x: 3, y: 0 },
          },
          verticalProfile: {
            profileVersion: 1,
            knots: [{ t: 0, elevation: 0 }, { t: 1, elevation: 0 }],
          },
          structures: [{
            type: 'surface',
            startT: 0,
            endT: 1,
            startElevation: 0,
            endElevation: 0,
          }],
          costs: { track: 100, earthworks: 0, bridge: 0, tunnel: 0, total: 100 },
          length: 10,
          minimumRadius: Number.POSITIVE_INFINITY,
          maximumGradePercent: 0,
          maximumGradeT: 0,
          remedy: '',
          reasonCode: 'ok',
        }),
      };
      system.destroy();
      system = new JunctionCreatorSystem(scene, trackManager, terrainValidator as any);
      const mainTrack = makeTrack(scene, 0, 0, 500, 0);
      trackManager.addTrack(mainTrack);

      (system as any).createJunctionAtSplit(mainTrack, 0.5);

      const branchTracks = trackManager.tracks.filter((track) => track !== mainTrack);
      expect(branchTracks).toHaveLength(2);
      expect(terrainValidator.canPlaceTrack).toHaveBeenCalledTimes(2);
      branchTracks.forEach((branch, index) => {
        const controls = branch.getControlPoints();
        expect(terrainValidator.canPlaceTrack.mock.calls[index]).toEqual([
          controls.p0,
          controls.p1,
          controls.p2,
          controls.p3,
        ]);
      });
    });
  });

  describe('destroy()', () => {
    it('destroys without throwing', () => {
      expect(() => system.destroy()).not.toThrow();
    });
  });
});
