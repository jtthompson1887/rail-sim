/**
 * Tests for CommandStack (incremental undo/redo) and concrete commands.
 */

import { CommandStack, DeleteTracksCommand } from '../../src/systems/CommandStack';
import { ReshapeTrackCommand } from '../../src/commands/ReshapeTrackCommand';
import type { Command } from '../../src/systems/CommandStack';
import TrackManager from '../../src/managers/TrackManager';
import RailTrack from '../../src/entities/RailTrack';
import { WorldManager } from '../../src/managers/WorldManager';
import type { TrackDef } from '../../src/config/WorldData';
import { TrackSerializer } from '../../src/utils/TrackSerializer';
import { clonePlainData } from '../../src/utils/PlainData';
import { ConstructionEconomy } from '../../src/systems/ConstructionEconomy';

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

function topologyOf(manager: TrackManager): unknown {
  const nodes = [...manager.tracks, ...manager.junctions];
  return nodes
    .map((node) => ({
      kind: node.isJunction() ? 'junction' : 'track',
      uuid: node.getUUID(),
      previous: node.getPrevious()?.getUUID() ?? null,
      next: node.getNext()?.getUUID() ?? null,
    }))
    .sort((left, right) => `${left.kind}:${left.uuid}`.localeCompare(`${right.kind}:${right.uuid}`));
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

describe('CommandStack revision-aware history', () => {
  let scene: any;
  let trackManager: TrackManager;
  let stack: CommandStack;
  let uuid: string;
  let first: TrackDef;
  let second: TrackDef;
  let third: TrackDef;

  beforeEach(() => {
    scene = makeScene();
    trackManager = new TrackManager(scene);
    stack = new CommandStack();
    WorldManager.createNew('Revision history', 'revision-history');
    const track = makeTrack(scene, 0, 0, 100, 0);
    trackManager.addTrack(track);
    uuid = track.getUUID();
    first = withConstruction({
      geometryVersion: 1,
      uuid,
      p0: { x: 0, y: 0 },
      p1: { x: 33, y: 0 },
      p2: { x: 67, y: 0 },
      p3: { x: 100, y: 0 },
    });
    second = {
      ...clonePlainData(first),
      p1: { x: 33, y: 25 },
      p2: { x: 67, y: 25 },
    };
    third = {
      ...clonePlainData(first),
      p1: { x: 33, y: 50 },
      p2: { x: 67, y: 50 },
    };
    expect(WorldManager.addTrackDef(first)).toBe(true);
  });

  afterEach(() => WorldManager.reset());

  it('undoes and redoes two sequential reshape commands in strict LIFO order', () => {
    const world = WorldManager.world!;
    const initialRevision = world.revision;
    expect(stack.push(new ReshapeTrackCommand(trackManager, uuid, first, second))).toBe(true);
    expect(stack.push(new ReshapeTrackCommand(trackManager, uuid, second, third))).toBe(true);
    expect(world.revision).toBe(initialRevision + 2);
    expect(world.tracks[0]).toEqual(third);

    expect(stack.undo()).toBe(true);
    expect(world.tracks[0]).toEqual(second);
    expect(stack.undo()).toBe(true);
    expect(world.tracks[0]).toEqual(first);
    expect(world.revision).toBe(initialRevision + 4);

    expect(stack.redo()).toBe(true);
    expect(world.tracks[0]).toEqual(second);
    expect(stack.redo()).toBe(true);
    expect(world.tracks[0]).toEqual(third);
    expect(world.revision).toBe(initialRevision + 6);
  });

  it('records an already-executed revision-aware command and continues LIFO history', () => {
    const world = WorldManager.world!;
    const firstCommand = new ReshapeTrackCommand(trackManager, uuid, first, second);
    expect(stack.push(firstCommand)).toBe(true);
    const alreadyExecuted = new ReshapeTrackCommand(trackManager, uuid, second, third);
    expect(alreadyExecuted.execute()).toBe(true);

    expect(stack.record(alreadyExecuted)).toBe(true);
    expect(stack.undo()).toBe(true);
    expect(world.tracks[0]).toEqual(second);
    expect(stack.undo()).toBe(true);
    expect(world.tracks[0]).toEqual(first);
  });

  it('preserves history and notifications when an external mutation blocks undo', () => {
    expect(stack.push(new ReshapeTrackCommand(trackManager, uuid, first, second))).toBe(true);
    expect(WorldManager.addSceneryDef({
      id: 'external-before-undo',
      type: 'tree_oak',
      x: 0,
      y: 0,
      rotation: 0,
      scale: 1,
      variant: 0,
    })).toBe(true);
    const revisionAfterExternalMutation = WorldManager.world!.revision;
    const onChange = jest.fn();
    stack.onChange = onChange;

    expect(stack.undo()).toBe(false);
    expect(stack.canUndo).toBe(true);
    expect(stack.canRedo).toBe(false);
    expect(WorldManager.world!.revision).toBe(revisionAfterExternalMutation);
    expect(WorldManager.world!.tracks[0]).toEqual(second);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not let a current-revision push launder an external mutation into old history', () => {
    expect(stack.push(new ReshapeTrackCommand(trackManager, uuid, first, second))).toBe(true);
    expect(WorldManager.addSceneryDef({
      id: 'external-before-push',
      type: 'tree_oak',
      x: 0,
      y: 0,
      rotation: 0,
      scale: 1,
      variant: 0,
    })).toBe(true);
    const revisionAfterExternalMutation = WorldManager.world!.revision;
    const onChange = jest.fn();
    stack.onChange = onChange;
    const currentRevisionCommand = new ReshapeTrackCommand(
      trackManager,
      uuid,
      second,
      third,
    );

    expect(stack.push(currentRevisionCommand)).toBe(false);
    expect(stack.canUndo).toBe(true);
    expect(stack.canRedo).toBe(false);
    expect(WorldManager.world!.revision).toBe(revisionAfterExternalMutation);
    expect(WorldManager.world!.tracks[0]).toEqual(second);
    expect(onChange).not.toHaveBeenCalled();
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
    WorldManager.addTrackDef(TrackSerializer.toTrackDef(track));
    const uuid = track.getUUID();

    const cmd = new DeleteTracksCommand(trackManager, scene, [uuid]);
    cmd.execute();

    expect(trackManager.getTrack(uuid)).toBeFalsy();
  });

  it('Given execute was called, When undo(), Then track is restored', () => {
    const track = makeTrack(scene);
    trackManager.addTrack(track);
    WorldManager.addTrackDef(TrackSerializer.toTrackDef(track));
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
    WorldManager.addTrackDef(TrackSerializer.toTrackDef(track));
    const beforeCash = WorldManager.world!.company.cash;
    const beforeRevision = WorldManager.world!.revision;
    const cmd = new DeleteTracksCommand(trackManager, scene, [track.getUUID()]);

    expect(cmd.execute()).toBe(true);
    expect(WorldManager.world!.company.cash).toBe(beforeCash + 500);
    expect(WorldManager.world!.revision).toBe(beforeRevision + 1);
    expect(cmd.execute()).toBe(false);
    expect(WorldManager.world!.company.cash).toBe(beforeCash + 500);
    expect(cmd.undo()).toBe(true);
    expect(WorldManager.world!.company.cash).toBe(beforeCash);
    expect(WorldManager.world!.revision).toBe(beforeRevision + 2);
  });

  it('deletes paidBuildCost 1 successfully with a zero refund', () => {
    const track = makeTrack(scene);
    track.setConstructionData(track.verticalProfile!, track.structures!, 1);
    trackManager.addTrack(track);
    WorldManager.addTrackDef(TrackSerializer.toTrackDef(track));
    const beforeCash = WorldManager.world!.company.cash;
    const command = new DeleteTracksCommand(trackManager, scene, [track.getUUID()]);
    expect(command.execute()).toBe(true);
    expect(WorldManager.world!.company.cash).toBe(beforeCash);
    expect(trackManager.getTrack(track.getUUID())).toBeUndefined();
    expect(command.undo()).toBe(true);
    expect(WorldManager.world!.company.cash).toBe(beforeCash);
  });

  it('applies mixed zero and nonzero refunds exactly', () => {
    const cheap = makeTrack(scene, 0, 0, 100, 0);
    const paid = makeTrack(scene, 200, 0, 300, 0);
    cheap.setConstructionData(cheap.verticalProfile!, cheap.structures!, 1);
    paid.setConstructionData(paid.verticalProfile!, paid.structures!, 3);
    for (const track of [cheap, paid]) {
      trackManager.addTrack(track);
      WorldManager.addTrackDef(TrackSerializer.toTrackDef(track));
    }
    const beforeCash = WorldManager.world!.company.cash;
    const command = new DeleteTracksCommand(
      trackManager,
      scene,
      [cheap.getUUID(), paid.getUUID()],
    );
    expect(command.execute()).toBe(true);
    expect(WorldManager.world!.company.cash).toBe(beforeCash + 1);
    expect(command.undo()).toBe(true);
    expect(WorldManager.world!.company.cash).toBe(beforeCash);
  });

  it('rejects the whole batch when one track is missing or referenced', () => {
    const track = makeTrack(scene);
    trackManager.addTrack(track);
    WorldManager.addTrackDef(TrackSerializer.toTrackDef(track));
    const uuid = track.getUUID();
    const beforeCash = WorldManager.world!.company.cash;
    const beforeRevision = WorldManager.world!.revision;
    expect(new DeleteTracksCommand(trackManager, scene, [uuid, 'missing']).execute()).toBe(false);
    expect(trackManager.getTrack(uuid)).toBe(track);
    expect(WorldManager.world!.company.cash).toBe(beforeCash);
    expect(WorldManager.world!.revision).toBe(beforeRevision);

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
      WorldManager.addTrackDef(TrackSerializer.toTrackDef(track));
    }
    const beforeCash = WorldManager.world!.company.cash;
    const beforeRevision = WorldManager.world!.revision;
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
    expect(WorldManager.world!.revision).toBe(beforeRevision + 3);
  });

  it('cascades only a directly owned junction and restores its exact identity and state', () => {
    const main = makeTrack(scene, 0, 0, 100, 0);
    const left = makeTrack(scene, 100, 0, 200, -100);
    const right = makeTrack(scene, 100, 0, 200, 100);
    for (const track of [main, left, right]) {
      trackManager.addTrack(track);
      WorldManager.addTrackDef(TrackSerializer.toTrackDef(track));
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
    });
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

  it('restores exact topology after all tracks and junctions exist regardless of request order', () => {
    const main = makeTrack(scene, 0, 0, 100, 0);
    const left = makeTrack(scene, 500, 0, 600, 0);
    const right = makeTrack(scene, 800, 0, 900, 0);
    for (const track of [main, left, right]) {
      trackManager.addTrack(track);
      WorldManager.addTrackDef(TrackSerializer.toTrackDef(track));
    }
    const Junction = require('../../src/entities/Junction').default;
    const junction = new Junction(scene, main, left, right, 0.5);
    junction.setUUID('topology-junction');
    trackManager.addJunction(junction);
    WorldManager.addJunctionDef({
      uuid: 'topology-junction',
      mainTrackUUID: main.getUUID(),
      leftTrackUUID: left.getUUID(),
      rightTrackUUID: right.getUUID(),
      position: 0.5,
      branchState: 'right',
    });
    main.setNext(junction);
    junction.setPrevious(main);
    junction.setNext(right);
    right.setPrevious(junction);
    left.setPrevious(junction);
    const before = topologyOf(trackManager);

    const command = new DeleteTracksCommand(
      trackManager,
      scene,
      [right.getUUID(), left.getUUID()],
    );
    expect(command.execute()).toBe(true);
    expect(command.undo()).toBe(true);
    expect(topologyOf(trackManager)).toEqual(before);
  });

  it('does not consume refund lifecycle identities when aggregate cash preflight fails', () => {
    const tracks = [
      makeTrack(scene, 0, 0, 100, 0),
      makeTrack(scene, 200, 0, 300, 0),
    ];
    for (const track of tracks) {
      track.setConstructionData(track.verticalProfile!, track.structures!, 2);
      trackManager.addTrack(track);
      WorldManager.addTrackDef(TrackSerializer.toTrackDef(track));
    }
    WorldManager.world!.company.cash = Number.MAX_SAFE_INTEGER - 1;
    const command = new DeleteTracksCommand(
      trackManager,
      scene,
      tracks.map((track) => track.getUUID()),
    );
    expect(command.execute()).toBe(false);
    expect(trackManager.tracks).toHaveLength(2);
    WorldManager.world!.company.cash = 100;
    expect(command.execute()).toBe(true);
    expect(WorldManager.world!.company.cash).toBe(102);
  });

  it.each(['after-live-removal', 'after-draft-removal'])(
    'restores the exact before-state and permits retry after execute fails at %s',
    (failureStage) => {
      const track = makeTrack(scene);
      track.setConstructionData(track.verticalProfile!, track.structures!, 3);
      trackManager.addTrack(track);
      WorldManager.addTrackDef(TrackSerializer.toTrackDef(track));
      const world = WorldManager.world!;
      const beforeTracks = clonePlainData(world.tracks);
      const beforeJunctions = clonePlainData(world.junctions);
      const beforeTopology = topologyOf(trackManager);
      const beforeCash = world.company.cash;
      const beforeRevision = world.revision;
      let inject = true;
      const command = new DeleteTracksCommand(
        trackManager,
        scene,
        [track.getUUID()],
        new ConstructionEconomy(world.company),
        (stage) => {
          if (inject && stage === failureStage) throw new Error('injected execute failure');
        },
      );

      expect(command.execute()).toBe(false);
      expect(world.tracks).toEqual(beforeTracks);
      expect(world.junctions).toEqual(beforeJunctions);
      expect(topologyOf(trackManager)).toEqual(beforeTopology);
      expect(world.company.cash).toBe(beforeCash);
      expect(world.revision).toBe(beforeRevision);

      inject = false;
      expect(command.execute()).toBe(true);
      expect(world.company.cash).toBe(beforeCash + 1);
    },
  );

  it.each(['after-live-restore', 'after-draft-restore'])(
    'restores the exact applied-state and permits retry after undo fails at %s',
    (failureStage) => {
      const track = makeTrack(scene);
      track.setConstructionData(track.verticalProfile!, track.structures!, 3);
      trackManager.addTrack(track);
      WorldManager.addTrackDef(TrackSerializer.toTrackDef(track));
      const world = WorldManager.world!;
      let inject = false;
      const command = new DeleteTracksCommand(
        trackManager,
        scene,
        [track.getUUID()],
        new ConstructionEconomy(world.company),
        (stage) => {
          if (inject && stage === failureStage) throw new Error('injected undo failure');
        },
      );
      expect(command.execute()).toBe(true);
      const appliedTracks = clonePlainData(world.tracks);
      const appliedJunctions = clonePlainData(world.junctions);
      const appliedTopology = topologyOf(trackManager);
      const appliedCash = world.company.cash;
      const appliedRevision = world.revision;

      inject = true;
      expect(command.undo()).toBe(false);
      expect(world.tracks).toEqual(appliedTracks);
      expect(world.junctions).toEqual(appliedJunctions);
      expect(topologyOf(trackManager)).toEqual(appliedTopology);
      expect(world.company.cash).toBe(appliedCash);
      expect(world.revision).toBe(appliedRevision);

      inject = false;
      expect(command.undo()).toBe(true);
      expect(world.company.cash).toBe(appliedCash - 1);
    },
  );

  it('keeps intervening authoritative defs when failed execute rolls back', () => {
    const track = makeTrack(scene);
    trackManager.addTrack(track);
    WorldManager.addTrackDef(TrackSerializer.toTrackDef(track));
    const intervening = withConstruction({
      geometryVersion: 1,
      uuid: 'intervening-execute',
      p0: { x: 500, y: 0 },
      p1: { x: 533, y: 0 },
      p2: { x: 567, y: 0 },
      p3: { x: 600, y: 0 },
    });
    const command = new (DeleteTracksCommand as any)(
      trackManager,
      scene,
      [track.getUUID()],
      new ConstructionEconomy(WorldManager.world!.company),
      (stage: string) => {
        if (stage === 'after-live-removal') {
          WorldManager.addTrackDef(intervening);
          throw new Error('intervening execute mutation');
        }
      },
    );
    expect(command.execute()).toBe(false);
    expect(trackManager.getTrack(track.getUUID())).toBeDefined();
    expect(WorldManager.world!.tracks.map((def) => def.uuid).sort()).toEqual(
      [track.getUUID(), intervening.uuid].sort(),
    );
  });

  it('keeps intervening authoritative defs when failed undo rolls back', () => {
    const track = makeTrack(scene);
    trackManager.addTrack(track);
    WorldManager.addTrackDef(TrackSerializer.toTrackDef(track));
    const intervening = withConstruction({
      geometryVersion: 1,
      uuid: 'intervening-undo',
      p0: { x: 500, y: 0 },
      p1: { x: 533, y: 0 },
      p2: { x: 567, y: 0 },
      p3: { x: 600, y: 0 },
    });
    const command = new (DeleteTracksCommand as any)(
      trackManager,
      scene,
      [track.getUUID()],
      new ConstructionEconomy(WorldManager.world!.company),
      (stage: string) => {
        if (stage === 'after-live-restore') {
          WorldManager.addTrackDef(intervening);
          throw new Error('intervening undo mutation');
        }
      },
    );
    expect(command.execute()).toBe(true);
    expect(command.undo()).toBe(false);
    expect(trackManager.getTrack(track.getUUID())).toBeUndefined();
    expect(WorldManager.world!.tracks.map((def) => def.uuid)).toEqual([intervening.uuid]);
  });

  it('rejects undo and redo after any intervening authoritative revision', () => {
    const track = makeTrack(scene);
    trackManager.addTrack(track);
    WorldManager.addTrackDef(TrackSerializer.toTrackDef(track));
    const command = new DeleteTracksCommand(trackManager, scene, [track.getUUID()]);
    expect(command.execute()).toBe(true);
    WorldManager.addSceneryDef({
      id: 'intervening-undo',
      type: 'tree_oak',
      x: 0,
      y: 0,
      rotation: 0,
      scale: 1,
      variant: 0,
    });
    expect(command.undo()).toBe(false);

    WorldManager.reset();
    WorldManager.createNew('Redo stale', 'real-terrain-alpha');
    const redoTrack = makeTrack(scene, 0, 0, 100, 0);
    trackManager = new TrackManager(scene);
    trackManager.addTrack(redoTrack);
    WorldManager.addTrackDef(TrackSerializer.toTrackDef(redoTrack));
    const redo = new DeleteTracksCommand(trackManager, scene, [redoTrack.getUUID()]);
    expect(redo.execute()).toBe(true);
    expect(redo.undo()).toBe(true);
    WorldManager.addSceneryDef({
      id: 'intervening-redo',
      type: 'tree_oak',
      x: 0,
      y: 0,
      rotation: 0,
      scale: 1,
      variant: 0,
    });
    expect(redo.execute()).toBe(false);
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

    WorldManager.addTrackDef(before);
    const cmd = new ReshapeTrackCommand(trackManager, uuid, before, after);
    expect(cmd.execute()).toBe(true);
    expect(WorldManager.world!.tracks).toContainEqual(after);
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

    WorldManager.addTrackDef(before);
    const cmd = new ReshapeTrackCommand(trackManager, uuid, before, after);
    expect(cmd.execute()).toBe(true);
    expect(cmd.undo()).toBe(true);
    expect(WorldManager.world!.tracks).toContainEqual(before);
  });

  it('is a no-op when track UUID is not found', () => {
    const before = withConstruction({ geometryVersion: 1 as const, uuid: 'x', p0: { x: 0, y: 0 }, p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 }, p3: { x: 0, y: 0 } });
    const after  = { ...before };
    const cmd = new ReshapeTrackCommand(trackManager, 'x', before, after);
    expect(cmd.execute()).toBe(false);
  });

  it('rejects undo and redo after an intervening authoritative revision', () => {
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
    WorldManager.addTrackDef(before);
    const staleUndo = new ReshapeTrackCommand(trackManager, uuid, before, after);
    expect(staleUndo.execute()).toBe(true);
    WorldManager.addSceneryDef({
      id: 'reshape-stale-undo',
      type: 'tree_oak',
      x: 0,
      y: 0,
      rotation: 0,
      scale: 1,
      variant: 0,
    });
    expect(staleUndo.undo()).toBe(false);

    WorldManager.reset();
    WorldManager.createNew('Reshape redo stale', 'real-terrain-alpha');
    trackManager = new TrackManager(scene);
    const redoTrack = makeTrack(scene, 0, 0, 100, 0);
    redoTrack.setUUID(uuid);
    trackManager.addTrack(redoTrack);
    WorldManager.addTrackDef(before);
    const staleRedo = new ReshapeTrackCommand(trackManager, uuid, before, after);
    expect(staleRedo.execute()).toBe(true);
    expect(staleRedo.undo()).toBe(true);
    WorldManager.addSceneryDef({
      id: 'reshape-stale-redo',
      type: 'tree_oak',
      x: 0,
      y: 0,
      rotation: 0,
      scale: 1,
      variant: 0,
    });
    expect(staleRedo.execute()).toBe(false);
  });
});
