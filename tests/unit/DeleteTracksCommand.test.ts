/**
 * @jest-environment jsdom
 */

import Phaser from 'phaser';
import { DeleteTracksCommand } from '../../src/commands/DeleteTracksCommand';
import RailTrack from '../../src/entities/RailTrack';
import TrackManager from '../../src/managers/TrackManager';
import { WorldManager } from '../../src/managers/WorldManager';
import { TrackSerializer } from '../../src/utils/TrackSerializer';

const { makeScene } = require('../../__mocks__/phaser');

function addTrack(scene: Phaser.Scene, manager: TrackManager): RailTrack {
  const track = new RailTrack(
    scene,
    new Phaser.Math.Vector2(0, 0),
    new Phaser.Math.Vector2(100, 0),
    new Phaser.Math.Vector2(200, 0),
    new Phaser.Math.Vector2(300, 0),
  );
  track.setUUID('delete-root-guard');
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
    100,
  );
  manager.addTrack(track);
  expect(WorldManager.addTrackDef(TrackSerializer.toTrackDef(track))).toBe(true);
  return track;
}

describe('DeleteTracksCommand root cursor', () => {
  let scene: Phaser.Scene;
  let manager: TrackManager;
  let track: RailTrack;

  beforeEach(() => {
    scene = makeScene();
    manager = new TrackManager(scene);
    WorldManager.createNew('Delete root guard', 'delete-root-guard');
    track = addTrack(scene, manager);
  });

  afterEach(() => WorldManager.reset());

  it('rejects stale undo before restoring live or persisted state', () => {
    const command = new DeleteTracksCommand(
      manager,
      scene,
      [track.getUUID()],
    );
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

    expect(command.undo()).toBe(false);
    expect(JSON.stringify(world)).toBe(before);
    expect(manager.getTrack(track.getUUID())).toBeUndefined();
  });

  it('rejects stale redo before removing live or persisted state', () => {
    const command = new DeleteTracksCommand(
      manager,
      scene,
      [track.getUUID()],
    );
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
      manager.getTrack(track.getUUID())!,
    );

    expect(command.execute()).toBe(false);
    expect(JSON.stringify(world)).toBe(before);
    expect(TrackSerializer.toTrackDef(manager.getTrack(track.getUUID())!))
      .toEqual(liveBefore);
  });

  it('restores live removal when operations advance after the initial cursor check', () => {
    const world = WorldManager.world!;
    const command = new DeleteTracksCommand(
      manager,
      scene,
      [track.getUUID()],
      (stage) => {
        if (stage !== 'after-live-removal') return;
        expect(WorldManager.applyOperationsBatch(
          world.revision,
          (draft) => {
            draft.economy.tick += 1;
            return true;
          },
        )).toBe(true);
      },
    );

    expect(command.execute()).toBe(false);
    expect(manager.getTrack(track.getUUID())).toBeDefined();
    expect(world.tracks).toHaveLength(1);
    expect(world.economy.tick).toBe(1);
    expect(world.revision).toBe(2);
    expect(world.constructionRevision).toBe(1);
    expect(world.operationsRevision).toBe(1);
  });
});
