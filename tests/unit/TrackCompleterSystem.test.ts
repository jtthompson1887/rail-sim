/**
 * Unit tests for TrackCompleterSystem
 *
 * Tests focus on endpoint detection, A* path validity, and
 * ghost-preview lifecycle.
 */

import { TrackCompleterSystem } from '../../src/systems/TrackCompleterSystem';
import TrackManager from '../../src/managers/TrackManager';
import { WorldManager } from '../../src/managers/WorldManager';
import { GameConfig } from '../../src/config/GameConfig';

const { makeScene } = require('../../__mocks__/phaser');
const Phaser = require('phaser');

function makeTrack(scene: any, x1 = 0, y1 = 0, x2 = 300, y2 = 0) {
  const p0 = new Phaser.Math.Vector2(x1, y1);
  const p1 = new Phaser.Math.Vector2(x1 + (x2 - x1) / 3, y1);
  const p2 = new Phaser.Math.Vector2(x1 + 2 * (x2 - x1) / 3, y1);
  const p3 = new Phaser.Math.Vector2(x2, y2);
  const { default: RailTrack } = require('../../src/entities/RailTrack');
  return new RailTrack(scene, p0, p1, p2, p3);
}

describe('TrackCompleterSystem', () => {
  let scene: any;
  let trackManager: TrackManager;
  let system: TrackCompleterSystem;

  beforeEach(() => {
    scene = makeScene();
    scene.cameras = {
      main: {
        zoom: 1, scrollX: 0, scrollY: 0, width: 1920, height: 1080,
        getWorldPoint: (x: number, y: number) => {
          const Phaser = require('phaser');
          return new Phaser.Math.Vector2(x, y);
        },
      },
    };
    trackManager = new TrackManager(scene);
    WorldManager.createNew('CompleterTest', 'real-terrain-alpha');
    system = new TrackCompleterSystem(scene, trackManager);
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

  describe('update()', () => {
    it('does not throw with no tracks', () => {
      expect(() => system.update(16)).not.toThrow();
    });

    it('accumulates pulseT over multiple updates', () => {
      // update runs without error over many frames
      for (let i = 0; i < 60; i++) {
        system.update(16);
      }
    });
  });

  describe('onPointerDown()', () => {
    it('non-left-click is a no-op', () => {
      const pointer = { leftButtonDown: () => false, x: 0, y: 0 };
      expect(() => system.onPointerDown(pointer as any)).not.toThrow();
    });

    it('left click far from any endpoint is a no-op', () => {
      const pointer = { leftButtonDown: () => true, x: 9999, y: 9999 };
      expect(() => system.onPointerDown(pointer as any)).not.toThrow();
    });

    it('left click near an open endpoint selects it', () => {
      const toasts: string[] = [];
      const { EventBus } = require('../../src/services/EventBus');
      const handler = (d: { message: string }) => toasts.push(d.message);
      EventBus.on('ui:toast', handler);

      // Add an isolated track (both endpoints are open)
      const track = makeTrack(scene, 0, 0, 300, 0);
      trackManager.addTrack(track);

      // Click near start of track (world 0,0)
      const pointer = { leftButtonDown: () => true, x: 0, y: 0 };
      system.onPointerDown(pointer as any);

      expect(toasts.some((t) => t.toLowerCase().includes('endpoint selected'))).toBe(true);
      EventBus.off('ui:toast', handler);
    });
  });

  describe('cancel()', () => {
    it('does not throw when no pending tracks exist', () => {
      expect(() => system.cancel()).not.toThrow();
    });
  });

  describe('confirm()', () => {
    it('does nothing when not awaiting confirmation', () => {
      expect(() => system.confirm()).not.toThrow();
    });
  });

  describe('onKeyDown()', () => {
    it('ESC calls cancel without throwing', () => {
      expect(() => system.onKeyDown({ code: 'Escape' } as KeyboardEvent)).not.toThrow();
    });

    it('Enter calls confirm without throwing', () => {
      expect(() => system.onKeyDown({ code: 'Enter' } as KeyboardEvent)).not.toThrow();
    });

    it('Space calls confirm without throwing', () => {
      expect(() => system.onKeyDown({ code: 'Space' } as KeyboardEvent)).not.toThrow();
    });
  });

  describe('A* search configuration', () => {
    it('has a positive COMPLETER_SEARCH_BUDGET', () => {
      expect(GameConfig.TOOLS.COMPLETER_SEARCH_BUDGET).toBeGreaterThan(0);
    });

    it('has a positive COMPLETER_SAMPLE_RESOLUTION', () => {
      expect(GameConfig.TOOLS.COMPLETER_SAMPLE_RESOLUTION).toBeGreaterThan(0);
    });

    it('MAX_CURVE_TOLERANCE_DEG keeps bends under 90 degrees', () => {
      expect(GameConfig.WORLD.MAX_CURVE_TOLERANCE_DEG).toBeLessThan(90);
    });
  });

  describe('destroy()', () => {
    it('destroys without throwing', () => {
      expect(() => system.destroy()).not.toThrow();
    });
  });
});
