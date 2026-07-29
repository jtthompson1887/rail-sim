/**
 * @jest-environment jsdom
 */

import Phaser from 'phaser';
import { ReshapeTrackCommand } from '../../src/commands/ReshapeTrackCommand';
import RailTrack from '../../src/entities/RailTrack';
import type { TrackDef } from '../../src/config/WorldData';
import TrackManager from '../../src/managers/TrackManager';
import { WorldManager } from '../../src/managers/WorldManager';
import { TrackSerializer } from '../../src/utils/TrackSerializer';

const { makeScene } = require('../../__mocks__/phaser');

function trackDef(uuid: string, height: number): TrackDef {
  return {
    geometryVersion: 1,
    uuid,
    p0: { x: 0, y: 0 },
    p1: { x: 100, y: height },
    p2: { x: 200, y: height },
    p3: { x: 300, y: 0 },
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

describe('ReshapeTrackCommand root cursor', () => {
  let manager: TrackManager;
  let beforeDef: TrackDef;
  let afterDef: TrackDef;
  let command: ReshapeTrackCommand;

  beforeEach(() => {
    const scene: Phaser.Scene = makeScene();
    manager = new TrackManager(scene);
    const track = new RailTrack(
      scene,
      new Phaser.Math.Vector2(0, 0),
      new Phaser.Math.Vector2(100, 0),
      new Phaser.Math.Vector2(200, 0),
      new Phaser.Math.Vector2(300, 0),
    );
    track.setUUID('reshape-root-guard');
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
    manager.addTrack(track);
    WorldManager.createNew('Reshape root guard', 'reshape-root-guard');
    beforeDef = trackDef(track.getUUID(), 0);
    afterDef = trackDef(track.getUUID(), 50);
    expect(WorldManager.addTrackDef(beforeDef)).toBe(true);
    command = new ReshapeTrackCommand(
      manager,
      track.getUUID(),
      beforeDef,
      afterDef,
    );
  });

  afterEach(() => WorldManager.reset());

  it('rejects stale undo before changing live or persisted geometry', () => {
    expect(command.execute()).toBe(true);
    const world = WorldManager.world!;
    expect(WorldManager.applyOperationsBatch(
      world.revision,
      (draft) => {
        draft.economy.tick += 1;
        return true;
      },
    )).toBe(true);
    const before = JSON.stringify(world);
    const liveBefore = TrackSerializer.toTrackDef(
      manager.getTrack(beforeDef.uuid)!,
    );

    expect(command.undo()).toBe(false);
    expect(JSON.stringify(world)).toBe(before);
    expect(TrackSerializer.toTrackDef(manager.getTrack(beforeDef.uuid)!))
      .toEqual(liveBefore);
  });

  it('rejects stale redo before changing live or persisted geometry', () => {
    expect(command.execute()).toBe(true);
    expect(command.undo()).toBe(true);
    const world = WorldManager.world!;
    expect(WorldManager.applyOperationsBatch(
      world.revision,
      (draft) => {
        draft.economy.tick += 1;
        return true;
      },
    )).toBe(true);
    const before = JSON.stringify(world);
    const liveBefore = TrackSerializer.toTrackDef(
      manager.getTrack(beforeDef.uuid)!,
    );

    expect(command.execute()).toBe(false);
    expect(JSON.stringify(world)).toBe(before);
    expect(TrackSerializer.toTrackDef(manager.getTrack(beforeDef.uuid)!))
      .toEqual(liveBefore);
  });

  it('restores live geometry when operations advance after the initial cursor check', () => {
    const world = WorldManager.world!;
    const applyTrackDef = manager.applyTrackDef.bind(manager);
    let reenter = true;
    jest.spyOn(manager, 'applyTrackDef').mockImplementation((def) => {
      const applied = applyTrackDef(def);
      if (applied && reenter) {
        reenter = false;
        expect(WorldManager.applyOperationsBatch(
          world.revision,
          (draft) => {
            draft.economy.tick += 1;
            return true;
          },
        )).toBe(true);
      }
      return applied;
    });

    expect(command.execute()).toBe(false);
    expect(world.tracks).toEqual([beforeDef]);
    expect(TrackSerializer.toTrackDef(manager.getTrack(beforeDef.uuid)!))
      .toEqual(beforeDef);
    expect(world.economy.tick).toBe(1);
    expect(world.revision).toBe(2);
    expect(world.constructionRevision).toBe(1);
    expect(world.operationsRevision).toBe(1);
  });
});
