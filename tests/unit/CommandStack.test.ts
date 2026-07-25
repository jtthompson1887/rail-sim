/**
 * Tests for CommandStack (incremental undo/redo) and concrete commands.
 */

import { CommandStack, DeleteTracksCommand, ReshapeTrackCommand } from '../../src/systems/CommandStack';
import type { Command } from '../../src/systems/CommandStack';
import TrackManager from '../../src/managers/TrackManager';
import RailTrack from '../../src/entities/RailTrack';
import { WorldManager } from '../../src/managers/WorldManager';
import type { TrackDef } from '../../src/config/WorldData';
import { TrackSerializer } from '../../src/utils/TrackSerializer';

const { makeScene } = require('../../__mocks__/phaser');

function makeTrack(scene: any, x1 = 0, y1 = 0, x2 = 100, y2 = 0): RailTrack {
  const Phaser = require('phaser');
  const p0 = new Phaser.Math.Vector2(x1, y1);
  const p1 = new Phaser.Math.Vector2(x1 + (x2 - x1) / 3, y1);
  const p2 = new Phaser.Math.Vector2(x1 + 2 * (x2 - x1) / 3, y1);
  const p3 = new Phaser.Math.Vector2(x2, y2);
  const track = new RailTrack(scene, p0, p1, p2, p3);
  track.setConstructionData(
    {
      profileVersion: 1,
      knots: [{ t: 0, elevation: 0 }, { t: 1, elevation: 0 }],
    },
    [{
      type: 'surface',
      startT: 0,
      endT: 1,
      startElevation: 0,
      endElevation: 0,
    }],
    0,
  );
  return track;
}

function withConstruction(
  geometry: Pick<TrackDef, 'geometryVersion' | 'uuid' | 'p0' | 'p1' | 'p2' | 'p3'>,
): TrackDef {
  return {
    ...geometry,
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
    paidBuildCost: 0,
  };
}

function makeCommand(label = 'cmd'): Command & { execCount: number; undoCount: number } {
  return {
    description: label,
    execCount: 0,
    undoCount: 0,
    execute() { this.execCount++; return true; },
    undo()    { this.undoCount++; return true; },
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

    it('preserves redo and emits no change when execute fails', () => {
      stack.push(makeCommand());
      stack.undo();
      const onChange = jest.fn();
      stack.onChange = onChange;
      const failed: Command = {
        description: 'failed',
        execute: () => false,
        undo: () => true,
      };
      expect(stack.push(failed)).toBe(false);
      expect(stack.canUndo).toBe(false);
      expect(stack.canRedo).toBe(true);
      expect(onChange).not.toHaveBeenCalled();
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
      expect(stack.undo()).toBe(false);
    });

    it('keeps a failed undo on the undo stack', () => {
      const command: Command = {
        description: 'failed undo',
        execute: () => true,
        undo: () => false,
      };
      stack.push(command);
      const onChange = jest.fn();
      stack.onChange = onChange;
      expect(stack.undo()).toBe(false);
      expect(stack.canUndo).toBe(true);
      expect(stack.canRedo).toBe(false);
      expect(onChange).not.toHaveBeenCalled();
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
      expect(stack.redo()).toBe(false);
    });

    it('keeps a failed redo on the redo stack', () => {
      let execution = 0;
      const command: Command = {
        description: 'failed redo',
        execute: () => ++execution === 1,
        undo: () => true,
      };
      stack.push(command);
      stack.undo();
      const onChange = jest.fn();
      stack.onChange = onChange;
      expect(stack.redo()).toBe(false);
      expect(stack.canUndo).toBe(false);
      expect(stack.canRedo).toBe(true);
      expect(onChange).not.toHaveBeenCalled();
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
    WorldManager.createNew('CmdTest', 'real-terrain-alpha');
  });

  afterEach(() => {
    WorldManager.reset();
  });

  it('Given a track exists, When execute(), Then track is removed', () => {
    const track = makeTrack(scene);
    trackManager.addTrack(track);
    WorldManager.addTrackDef(TrackSerializer.toTrackDef(track), false);
    const uuid = track.getUUID();

    const cmd = new DeleteTracksCommand(trackManager, scene, [uuid]);
    cmd.execute();

    expect(trackManager.getTrack(uuid)).toBeFalsy();
  });

  it('Given execute was called, When undo(), Then track is restored', () => {
    const track = makeTrack(scene);
    trackManager.addTrack(track);
    WorldManager.addTrackDef(TrackSerializer.toTrackDef(track), false);
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

  it('refunds floor 50% per track exactly once and reverses it on undo', () => {
    const track = makeTrack(scene);
    track.setConstructionData(
      track.verticalProfile!,
      track.structures!,
      1_001,
    );
    trackManager.addTrack(track);
    WorldManager.addTrackDef(TrackSerializer.toTrackDef(track), false);
    const beforeCash = WorldManager.world!.company.cash;
    const cmd = new DeleteTracksCommand(trackManager, scene, [track.getUUID()]);

    expect(cmd.execute()).toBe(true);
    expect(WorldManager.world!.company.cash).toBe(beforeCash + 500);
    expect(WorldManager.world!.revision).toBe(1);
    expect(cmd.execute()).toBe(false);
    expect(WorldManager.world!.company.cash).toBe(beforeCash + 500);
    expect(cmd.undo()).toBe(true);
    expect(WorldManager.world!.company.cash).toBe(beforeCash);
    expect(WorldManager.world!.revision).toBe(2);
  });

  it('rejects the whole batch when one track is missing or referenced', () => {
    const track = makeTrack(scene);
    trackManager.addTrack(track);
    WorldManager.addTrackDef(TrackSerializer.toTrackDef(track), false);
    const uuid = track.getUUID();
    const beforeCash = WorldManager.world!.company.cash;
    expect(new DeleteTracksCommand(trackManager, scene, [uuid, 'missing']).execute()).toBe(false);
    expect(trackManager.getTrack(uuid)).toBe(track);
    expect(WorldManager.world!.company.cash).toBe(beforeCash);
    expect(WorldManager.world!.revision).toBe(0);

    WorldManager.world!.stations.push({
      id: 'station',
      name: 'Station',
      trackUUID: uuid,
      trackT: 0.5,
      passengerSpawnRate: 1,
    });
    expect(new DeleteTracksCommand(trackManager, scene, [uuid]).execute()).toBe(false);
    expect(trackManager.getTrack(uuid)).toBe(track);
  });

  it('sums per-track floored refunds and conserves them through redo', () => {
    const tracks = [
      makeTrack(scene, 0, 0, 100, 0),
      makeTrack(scene, 200, 0, 300, 0),
    ];
    for (const track of tracks) {
      track.setConstructionData(track.verticalProfile!, track.structures!, 1_001);
      trackManager.addTrack(track);
      WorldManager.addTrackDef(TrackSerializer.toTrackDef(track), false);
    }
    const beforeCash = WorldManager.world!.company.cash;
    const cmd = new DeleteTracksCommand(
      trackManager,
      scene,
      tracks.map((track) => track.getUUID()),
    );
    expect(cmd.execute()).toBe(true);
    expect(WorldManager.world!.company.cash).toBe(beforeCash + 1_000);
    expect(cmd.undo()).toBe(true);
    expect(WorldManager.world!.company.cash).toBe(beforeCash);
    expect(cmd.execute()).toBe(true);
    expect(WorldManager.world!.company.cash).toBe(beforeCash + 1_000);
    expect(WorldManager.world!.revision).toBe(3);
  });

  it('cascades only a directly owned junction and restores its exact identity and state', () => {
    const main = makeTrack(scene, 0, 0, 100, 0);
    const left = makeTrack(scene, 100, 0, 200, -100);
    const right = makeTrack(scene, 100, 0, 200, 100);
    for (const track of [main, left, right]) {
      trackManager.addTrack(track);
      WorldManager.addTrackDef(TrackSerializer.toTrackDef(track), false);
    }
    const junction = new (require('../../src/entities/Junction').default)(
      scene,
      main,
      left,
      right,
      0.5,
    );
    junction.setUUID('owned-junction');
    junction.branchState = 'left';
    trackManager.addJunction(junction);
    WorldManager.addJunctionDef({
      uuid: 'owned-junction',
      mainTrackUUID: main.getUUID(),
      leftTrackUUID: left.getUUID(),
      rightTrackUUID: right.getUUID(),
      position: 0.5,
      branchState: 'right',
    }, false);
    const command = new DeleteTracksCommand(trackManager, scene, [left.getUUID()]);
    expect(command.execute()).toBe(true);
    expect(trackManager.getTrack(main.getUUID())).toBe(main);
    expect(trackManager.getTrack(right.getUUID())).toBe(right);
    expect(trackManager.getJunction('owned-junction')).toBeUndefined();
    expect(WorldManager.world!.junctions).toEqual([]);

    expect(command.undo()).toBe(true);
    expect(trackManager.getJunction('owned-junction')!.branchState).toBe('left');
    expect(WorldManager.world!.junctions).toEqual([expect.objectContaining({
      uuid: 'owned-junction',
      branchState: 'right',
    })]);
  });
});

describe('ReshapeTrackCommand', () => {
  let scene: any;
  let trackManager: TrackManager;

  beforeEach(() => {
    scene = makeScene();
    trackManager = new TrackManager(scene);
    WorldManager.createNew('ReshapeTest', 'real-terrain-alpha');
  });

  afterEach(() => {
    WorldManager.reset();
  });

  it('execute() applies afterDef to the track', () => {
    const Phaser = require('phaser');
    const track = makeTrack(scene, 0, 0, 100, 0);
    trackManager.addTrack(track);
    const uuid = track.getUUID();

    const before = withConstruction({
      geometryVersion: 1 as const, uuid, p0: { x: 0, y: 0 }, p1: { x: 33, y: 0 },
      p2: { x: 67, y: 0 }, p3: { x: 100, y: 0 },
    });
    const after = withConstruction({
      geometryVersion: 1 as const, uuid, p0: { x: 0, y: 0 }, p1: { x: 33, y: 50 },
      p2: { x: 67, y: 50 }, p3: { x: 100, y: 0 },
    });

    const cmd = new ReshapeTrackCommand(trackManager, uuid, before, after);
    WorldManager.addTrackDef(before, false);
    expect(() => cmd.execute()).not.toThrow();
  });

  it('undo() reverts to beforeDef', () => {
    const track = makeTrack(scene, 0, 0, 100, 0);
    trackManager.addTrack(track);
    const uuid = track.getUUID();

    const before = withConstruction({
      geometryVersion: 1 as const, uuid, p0: { x: 0, y: 0 }, p1: { x: 33, y: 0 },
      p2: { x: 67, y: 0 }, p3: { x: 100, y: 0 },
    });
    const after = withConstruction({
      geometryVersion: 1 as const, uuid, p0: { x: 0, y: 0 }, p1: { x: 33, y: 50 },
      p2: { x: 67, y: 50 }, p3: { x: 100, y: 0 },
    });

    const cmd = new ReshapeTrackCommand(trackManager, uuid, before, after);
    WorldManager.addTrackDef(before, false);
    cmd.execute();
    expect(() => cmd.undo()).not.toThrow();
  });

  it('is a no-op when track UUID is not found', () => {
    const before = withConstruction({ geometryVersion: 1 as const, uuid: 'x', p0: { x: 0, y: 0 }, p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 }, p3: { x: 0, y: 0 } });
    const after  = { ...before };
    const cmd = new ReshapeTrackCommand(trackManager, 'x', before, after);
    expect(() => cmd.execute()).not.toThrow();
  });
});
