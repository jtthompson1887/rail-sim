import { WorldContentLoader } from '../../src/services/WorldContentLoader';
import { WorldManager } from '../../src/managers/WorldManager';
import { TrackSerializer } from '../../src/utils/TrackSerializer';

const { makeScene } = require('../../__mocks__/phaser');

describe('WorldContentLoader exact track restoration', () => {
  afterEach(() => {
    WorldManager.reset();
  });

  it('restores and reserializes every cubic knot without drift', () => {
    const original = {
      geometryVersion: 1 as const,
      uuid: 'exact-track',
      p0: { x: 2.125, y: -8.25 },
      p1: { x: 143.75, y: 312.5 },
      p2: { x: 389.875, y: -177.125 },
      p3: { x: 600.25, y: 44.5 },
      isTunnel: true,
      elevation: 73.5,
    };
    const world = WorldManager.createNew('Exact restore');
    world.tracks = [original];
    const restoredTracks: any[] = [];
    const trackManager = {
      addTrack: jest.fn((track) => restoredTracks.push(track)),
      getTrack: jest.fn(),
    };
    const trainManager = {
      createInitialTrain: jest.fn(),
      createCarriage: jest.fn(),
    };
    const scene = makeScene();
    const image = scene.add.image();
    image.setAlpha = jest.fn().mockReturnValue(image);
    image.setTint = jest.fn().mockReturnValue(image);
    const loader = new WorldContentLoader(scene, trackManager as any, trainManager as any);

    loader.load();

    expect(restoredTracks).toHaveLength(1);
    let serialized = TrackSerializer.toTrackDef(restoredTracks[0]);
    expect(serialized).toEqual(original);

    for (let cycle = 0; cycle < 5; cycle++) {
      world.tracks = [serialized];
      restoredTracks.length = 0;
      loader.load();
      serialized = TrackSerializer.toTrackDef(restoredTracks[0]);
      expect(serialized).toEqual(original);
    }
  });
});
