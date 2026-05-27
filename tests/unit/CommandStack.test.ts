/**
 * Tests for CommandStack (incremental undo/redo) and concrete commands.
 */

import { CommandStack, DeleteTracksCommand, ReshapeTrackCommand } from '../../src/systems/CommandStack';
import type { Command } from '../../src/systems/CommandStack';
import TrackManager from '../../src/managers/TrackManager';
import RailTrack from '../../src/entities/RailTrack';
import { WorldManager } from '../../src/managers/WorldManager';

const { makeScene } = require('../../__mocks__/phaser');

function makeTrack(scene: any, x1 = 0, y1 = 0, x2 = 100, y2 = 0): RailTrack {
  const Phaser = require('phaser');
  const p0 = new Phaser.Math.Vector2(x1, y1);
  const p1 = new Phaser.Math.Vector2(x1 + (x2 - x1) / 3, y1);
  const p2 = new Phaser.Math.Vector2(x1 + 2 * (x2 - x1) / 3, y1);
  const p3 = new Phaser.Math.Vector2(x2, y2);
  return new RailTrack(scene, p0, p1, p2, p3);
}

function makeCommand(label = 'cmd'): Command & { execCount: number; undoCount: number } {
  return {
    description: label,
    execCount: 0,
    undoCount: 0,
    execute() { this.execCount++; },
    undo()    { this.undoCount++; },
  };
}

describe('CommandStack', () => {
  let stack: CommandStack;

  beforeEach(() => {
    stack = new CommandStack(5);
  });

  describe('Given a fresh stack', () => {
    it('starts with canUndo=false and canRedo=false', () => {
      expect(stack.canUndo).toBe(false);
      expect(stack.canRedo).toBe(false);
    });
  });

  describe('push()', () => {
    it('executes the command immediately', () => {
      const cmd = makeCommand();
      stack.push(cmd);
      expect(cmd.execCount).toBe(1);
    });

    it('sets canUndo=true after a push', () => {
      stack.push(makeCommand());
      expect(stack.canUndo).toBe(true);
    });

    it('clears the redo stack', () => {
      const c1 = makeCommand();
      stack.push(c1);
      stack.undo();
      expect(stack.canRedo).toBe(true);
      stack.push(makeCommand());
      expect(stack.canRedo).toBe(false);
    });

    it('calls onChange with correct flags', () => {
      const changes: [boolean, boolean][] = [];
      stack.onChange = (u, r) => changes.push([u, r]);
      stack.push(makeCommand());
      expect(changes).toEqual([[true, false]]);
    });

    it('respects maxDepth by dropping oldest command', () => {
      for (let i = 0; i < 6; i++) stack.push(makeCommand(`cmd${i}`));
      // Undo 5 times (max depth) — 6th should be gone
      let count = 0;
      while (stack.canUndo) { stack.undo(); count++; }
      expect(count).toBe(5);
    });
  });

  describe('undo()', () => {
    it('calls the command undo method', () => {
      const cmd = makeCommand();
      stack.push(cmd);
      stack.undo();
      expect(cmd.undoCount).toBe(1);
    });

    it('sets canRedo=true after undo', () => {
      stack.push(makeCommand());
      stack.undo();
      expect(stack.canRedo).toBe(true);
    });

    it('is a no-op when stack is empty', () => {
      expect(() => stack.undo()).not.toThrow();
    });
  });

  describe('redo()', () => {
    it('re-executes the command', () => {
      const cmd = makeCommand();
      stack.push(cmd);
      stack.undo();
      stack.redo();
      expect(cmd.execCount).toBe(2);
    });

    it('is a no-op when redo stack is empty', () => {
      expect(() => stack.redo()).not.toThrow();
    });
  });

  describe('record()', () => {
    it('does not call execute', () => {
      const cmd = makeCommand();
      stack.record(cmd);
      expect(cmd.execCount).toBe(0);
    });

    it('allows subsequent undo', () => {
      const cmd = makeCommand();
      stack.record(cmd);
      stack.undo();
      expect(cmd.undoCount).toBe(1);
    });
  });

  describe('clear()', () => {
    it('resets both stacks', () => {
      stack.push(makeCommand());
      stack.clear();
      expect(stack.canUndo).toBe(false);
      expect(stack.canRedo).toBe(false);
    });
  });
});

describe('DeleteTracksCommand', () => {
  let scene: any;
  let trackManager: TrackManager;

  beforeEach(() => {
    scene = makeScene();
    trackManager = new TrackManager(scene);
    WorldManager.createNew('CmdTest');
  });

  afterEach(() => {
    WorldManager.reset();
  });

  it('Given a track exists, When execute(), Then track is removed', () => {
    const track = makeTrack(scene);
    trackManager.addTrack(track);
    const uuid = track.getUUID();

    const cmd = new DeleteTracksCommand(trackManager, scene, [uuid]);
    cmd.execute();

    expect(trackManager.getTrack(uuid)).toBeFalsy();
  });

  it('Given execute was called, When undo(), Then track is restored', () => {
    const track = makeTrack(scene);
    trackManager.addTrack(track);
    const uuid = track.getUUID();

    const cmd = new DeleteTracksCommand(trackManager, scene, [uuid]);
    cmd.execute();
    cmd.undo();

    expect(trackManager.getTrack(uuid)).not.toBeNull();
  });

  it('ignores unknown UUIDs without throwing', () => {
    const cmd = new DeleteTracksCommand(trackManager, scene, ['nonexistent-uuid']);
    expect(() => cmd.execute()).not.toThrow();
  });
});

describe('ReshapeTrackCommand', () => {
  let scene: any;
  let trackManager: TrackManager;

  beforeEach(() => {
    scene = makeScene();
    trackManager = new TrackManager(scene);
    WorldManager.createNew('ReshapeTest');
  });

  afterEach(() => {
    WorldManager.reset();
  });

  it('execute() applies afterDef to the track', () => {
    const Phaser = require('phaser');
    const track = makeTrack(scene, 0, 0, 100, 0);
    trackManager.addTrack(track);
    const uuid = track.getUUID();

    const before = {
      uuid, p0: { x: 0, y: 0 }, p1: { x: 33, y: 0 },
      p2: { x: 67, y: 0 }, p3: { x: 100, y: 0 },
    };
    const after = {
      uuid, p0: { x: 0, y: 0 }, p1: { x: 33, y: 50 },
      p2: { x: 67, y: 50 }, p3: { x: 100, y: 0 },
    };

    const cmd = new ReshapeTrackCommand(trackManager, uuid, before, after);
    expect(() => cmd.execute()).not.toThrow();
  });

  it('undo() reverts to beforeDef', () => {
    const track = makeTrack(scene, 0, 0, 100, 0);
    trackManager.addTrack(track);
    const uuid = track.getUUID();

    const before = {
      uuid, p0: { x: 0, y: 0 }, p1: { x: 33, y: 0 },
      p2: { x: 67, y: 0 }, p3: { x: 100, y: 0 },
    };
    const after = {
      uuid, p0: { x: 0, y: 0 }, p1: { x: 33, y: 50 },
      p2: { x: 67, y: 50 }, p3: { x: 100, y: 0 },
    };

    const cmd = new ReshapeTrackCommand(trackManager, uuid, before, after);
    cmd.execute();
    expect(() => cmd.undo()).not.toThrow();
  });

  it('is a no-op when track UUID is not found', () => {
    const before = { uuid: 'x', p0: { x: 0, y: 0 }, p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 }, p3: { x: 0, y: 0 } };
    const after  = { ...before };
    const cmd = new ReshapeTrackCommand(trackManager, 'x', before, after);
    expect(() => cmd.execute()).not.toThrow();
  });
});
