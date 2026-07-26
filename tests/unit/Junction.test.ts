import Junction from '../../src/entities/Junction';
import RailTrack from '../../src/entities/RailTrack';
import { EventBus } from '../../src/services/EventBus';

// Phaser is mocked via __mocks__/phaser.js

function makeScene() {
  const Phaser = require('phaser');
  const arc = { setInteractive: jest.fn().mockReturnThis(), on: jest.fn().mockReturnThis(), setStrokeStyle: jest.fn().mockReturnThis() };
  return {
    add: {
      existing: jest.fn(),
      circle: jest.fn().mockReturnValue(arc),
      image: jest.fn().mockReturnValue({ setOrigin: jest.fn().mockReturnThis(), setScale: jest.fn().mockReturnThis(), setDepth: jest.fn().mockReturnThis(), rotation: 0 }),
      text: jest.fn().mockReturnValue({ setOrigin: jest.fn().mockReturnThis(), setText: jest.fn().mockReturnThis() }),
      graphics: jest.fn().mockReturnValue({ setDepth: jest.fn().mockReturnThis(), lineStyle: jest.fn(), beginPath: jest.fn(), moveTo: jest.fn(), lineTo: jest.fn(), strokePath: jest.fn(), clear: jest.fn() }),
    },
    matter: { add: { image: jest.fn() }, world: { remove: jest.fn(), scene: { matter: { bodies: { rectangle: jest.fn() } } } } },
    cameras: { main: {} },
    input: { keyboard: { addKey: jest.fn() }, on: jest.fn() },
    sound: {},
    cache: { audio: { exists: jest.fn() } },
  };
}

function makeTrack(scene: any, x1 = 0, y1 = 0, x2 = 100, y2 = 0): RailTrack {
  const Phaser = require('phaser');
  const p0 = new Phaser.Math.Vector2(x1, y1);
  const p1 = new Phaser.Math.Vector2(x1 + (x2 - x1) / 3, y1);
  const p2 = new Phaser.Math.Vector2(x1 + 2 * (x2 - x1) / 3, y1);
  const p3 = new Phaser.Math.Vector2(x2, y2);
  return new RailTrack(scene, p0, p1, p2, p3);
}

function makeJunction(scene: any): Junction {
  const main = makeTrack(scene, 0, 0, 100, 0);
  const left = makeTrack(scene, 50, 0, 100, -50);
  const right = makeTrack(scene, 50, 0, 100, 50);
  return new Junction(scene, main, left, right, 0.5);
}

describe('Junction', () => {
  let scene: any;
  let junction: Junction;

  beforeEach(() => {
    scene = makeScene();
    junction = makeJunction(scene);
  });

  describe('initial state', () => {
    it('starts with branchState = right', () => {
      expect(junction.branchState).toBe('right');
    });

    it('isJunction() returns true', () => {
      expect(junction.isJunction()).toBe(true);
    });

    it('isTrack() returns false', () => {
      expect(junction.isTrack()).toBe(false);
    });

    it('has a UUID', () => {
      expect(junction.getUUID()).toBeTruthy();
      expect(typeof junction.getUUID()).toBe('string');
    });

    it('getAllTracks() returns 3 tracks', () => {
      expect(junction.getAllTracks()).toHaveLength(3);
    });
  });

  describe('branchState getter/setter', () => {
    it('can set branchState to left', () => {
      junction.branchState = 'left';
      expect(junction.branchState).toBe('left');
    });

    it('can set branchState back to right', () => {
      junction.branchState = 'left';
      junction.branchState = 'right';
      expect(junction.branchState).toBe('right');
    });

    it('synchronizes branch visuals without emitting a toggle event', () => {
      const [main, left, right] = junction.getAllTracks();
      const callback = jest.fn();
      EventBus.on('junction:toggled', callback);
      junction.branchState = 'left';
      expect((left as any)._alpha).toBe(1);
      expect((right as any)._alpha).toBe(0.5);
      expect((main as any)._alpha).toBe(1);
      expect(callback).not.toHaveBeenCalled();
      EventBus.off('junction:toggled', callback);
    });
  });

  describe('toggle()', () => {
    it('switches from right to left', () => {
      junction.toggle();
      expect(junction.branchState).toBe('left');
    });

    it('switches from left to right', () => {
      junction.toggle();
      junction.toggle();
      expect(junction.branchState).toBe('right');
    });

    it('emits junction:toggled event', () => {
      const cb = jest.fn();
      EventBus.on('junction:toggled', cb);
      junction.toggle();
      expect(cb).toHaveBeenCalledWith({ junctionId: junction.getUUID(), state: 'left' });
      EventBus.off('junction:toggled', cb);
    });

    it('emits toggled state correctly when toggling back', () => {
      const cb = jest.fn();
      junction.toggle(); // left
      EventBus.on('junction:toggled', cb);
      junction.toggle(); // right
      expect(cb).toHaveBeenCalledWith({ junctionId: junction.getUUID(), state: 'right' });
      EventBus.off('junction:toggled', cb);
    });
  });

  describe('getActiveTrack()', () => {
    it('returns the main track', () => {
      const main = junction.getMainTrack();
      expect(junction.getActiveTrack()).toBe(main);
    });
  });

  describe('getActiveBranchTrack() / getInactiveBranchTrack()', () => {
    it('returns right track when state is right', () => {
      expect(junction.getActiveBranchTrack()).toBe(junction.getRightTrack());
      expect(junction.getInactiveBranchTrack()).toBe(junction.getLeftTrack());
    });

    it('returns left track when state is left', () => {
      junction.toggle();
      expect(junction.getActiveBranchTrack()).toBe(junction.getLeftTrack());
      expect(junction.getInactiveBranchTrack()).toBe(junction.getRightTrack());
    });
  });

  describe('getForceScale()', () => {
    it('returns 1 for main track', () => {
      expect(junction.getForceScale(junction.getMainTrack())).toBe(1);
    });

    it('returns 1 for active branch track', () => {
      expect(junction.getForceScale(junction.getActiveBranchTrack())).toBe(1);
    });

    it('returns -1 for inactive branch track', () => {
      expect(junction.getForceScale(junction.getInactiveBranchTrack())).toBe(-1);
    });

    it('returns 0 for unrecognized track', () => {
      const foreign = makeTrack(scene, 200, 200, 300, 300);
      expect(junction.getForceScale(foreign)).toBe(0);
    });
  });

  describe('track connections (TrackNode interface)', () => {
    it('hasNext() returns false initially', () => {
      expect(junction.hasNext()).toBe(false);
    });

    it('hasPrevious() returns false initially', () => {
      expect(junction.hasPrevious()).toBe(false);
    });

    it('setNext() / getNext() round-trips', () => {
      const other = makeTrack(scene, 200, 0, 300, 0);
      junction.setNext(other);
      expect(junction.hasNext()).toBe(true);
      expect(junction.getNext()).toBe(other);
    });

    it('setPrevious() / getPrevious() round-trips', () => {
      const other = makeTrack(scene, -100, 0, 0, 0);
      junction.setPrevious(other);
      expect(junction.hasPrevious()).toBe(true);
      expect(junction.getPrevious()).toBe(other);
    });

    it('setNext(undefined) clears next connection', () => {
      const other = makeTrack(scene, 200, 0, 300, 0);
      junction.setNext(other);
      junction.setNext(undefined);
      expect(junction.hasNext()).toBe(false);
    });
  });

  describe('getPosition() / getBranchLength() / isSwitched()', () => {
    it('getPosition() returns the junction position parameter', () => {
      expect(junction.getPosition()).toBe(0.5);
    });

    it('getBranchLength() returns the configured junction length', () => {
      const { GameConfig } = require('../../src/config/GameConfig');
      expect(junction.getBranchLength()).toBe(GameConfig.JUNCTION.LENGTH);
    });

    it('isSwitched() is false initially', () => {
      expect(junction.isSwitched()).toBe(false);
    });

    it('isSwitched() is true after a toggle', () => {
      junction.toggle();
      expect(junction.isSwitched()).toBe(true);
    });
  });
});

// -----------------------------------------------------------------------
// Additional RailTrack tests (to cover lines 85–153 missed above)
// -----------------------------------------------------------------------
describe('RailTrack', () => {
  let scene: any;

  beforeEach(() => {
    scene = makeScene();
  });

  describe('getTrackPosition()', () => {
    it('returns t in [0, 1]', () => {
      const track = makeTrack(scene, 0, 0, 100, 0);
      const Phaser = require('phaser');
      const sprite = new Phaser.GameObjects.Sprite(scene, 50, 0, '');
      const t = track.getTrackPosition(sprite as any);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
    });

    it('returns ~0 for object at track start', () => {
      const track = makeTrack(scene, 0, 0, 100, 0);
      const Phaser = require('phaser');
      // Object at body position
      const obj = { body: { position: { x: 0, y: 0 } } };
      const t = track.getTrackPosition(obj as any);
      expect(t).toBeCloseTo(0, 1);
    });

    it('returns ~1 for object at track end', () => {
      const track = makeTrack(scene, 0, 0, 100, 0);
      const obj = { body: { position: { x: 100, y: 0 } } };
      const t = track.getTrackPosition(obj as any);
      expect(t).toBeCloseTo(1, 1);
    });

    it('uses x/y fallback when no body property', () => {
      const track = makeTrack(scene, 0, 0, 100, 0);
      const obj = { x: 50, y: 0 };
      const t = track.getTrackPosition(obj as any);
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThan(1);
    });
  });

  describe('getTrackAngle()', () => {
    it('returns a number for a valid trackable position', () => {
      const track = makeTrack(scene, 0, 0, 100, 0);
      const obj = { body: { position: { x: 50, y: 0 } } };
      const angle = track.getTrackAngle(obj as any);
      expect(typeof angle).toBe('number');
    });

    it('returns ~0 degrees for a horizontal track', () => {
      const track = makeTrack(scene, 0, 0, 100, 0);
      const obj = { body: { position: { x: 50, y: 0 } } };
      const angle = track.getTrackAngle(obj as any);
      expect(angle).toBeCloseTo(0, 0);
    });
  });

  describe('getTrackPoint()', () => {
    it('returns a Vector2 with x and y', () => {
      const track = makeTrack(scene, 0, 0, 100, 0);
      const obj = { body: { position: { x: 50, y: 0 } } };
      const point = track.getTrackPoint(obj as any);
      expect(typeof point.x).toBe('number');
      expect(typeof point.y).toBe('number');
    });

    it('returns the start of track for object at start position', () => {
      const track = makeTrack(scene, 0, 0, 100, 0);
      const obj = { body: { position: { x: 0, y: 0 } } };
      const point = track.getTrackPoint(obj as any);
      expect(point.x).toBeCloseTo(0, 0);
    });
  });

  describe('getCurvePath()', () => {
    it('returns a path object with getPoint() method', () => {
      const track = makeTrack(scene, 0, 0, 100, 0);
      const path = track.getCurvePath();
      expect(path).toBeDefined();
      expect(typeof path.getPoint).toBe('function');
    });

    it('path getLength() is positive', () => {
      const track = makeTrack(scene, 0, 0, 100, 0);
      expect(track.getCurvePath().getLength()).toBeGreaterThan(0);
    });
  });

  describe('getBounds()', () => {
    it('returns an object with left, right, top, bottom', () => {
      const track = makeTrack(scene, 0, 0, 100, 0);
      const bounds = track.getBounds();
      expect(bounds).toHaveProperty('left');
      expect(bounds).toHaveProperty('right');
      expect(bounds).toHaveProperty('top');
      expect(bounds).toHaveProperty('bottom');
    });
  });

  describe('destroy()', () => {
    it('does not throw when called', () => {
      const track = makeTrack(scene, 0, 0, 100, 0);
      expect(() => track.destroy()).not.toThrow();
    });
  });

  describe('isJunction() and isTrack()', () => {
    it('isJunction() returns false', () => {
      const track = makeTrack(scene, 0, 0, 100, 0);
      expect(track.isJunction()).toBe(false);
    });

    it('isTrack() returns true', () => {
      const track = makeTrack(scene, 0, 0, 100, 0);
      expect(track.isTrack()).toBe(true);
    });
  });
});
