import { WorldContentLoader } from '../../src/services/WorldContentLoader';
import { WorldManager } from '../../src/managers/WorldManager';
import { TrackSerializer } from '../../src/utils/TrackSerializer';
import RailTrack from '../../src/entities/RailTrack';
import Phaser from 'phaser';
import { ConstructionAnalyzer } from '../../src/systems/ConstructionAnalyzer';
import { makeFreightTrainDef } from '../fixtures/FirstFreightRouteFixture';

const { makeScene } = require('../../__mocks__/phaser');

describe('WorldContentLoader exact track restoration', () => {
  afterEach(() => {
    WorldManager.reset();
  });

  it('preserves proposal engineering through live, definition, reload, live, and definition', () => {
    const geometry = {
      geometryVersion: 1 as const,
      p0: { x: 0, y: 0 },
      p1: { x: 200, y: 0 },
      p2: { x: 400, y: 0 },
      p3: { x: 600, y: 0 },
    };
    const proposal = new ConstructionAnalyzer({
      getHeightAt: (x: number) => (x >= 192 && x <= 448 ? -180 : 0),
    }).analyze(geometry);
    expect(proposal.valid).toBe(true);
    const scene = makeScene();
    const sourceTrack = new RailTrack(
      scene,
      new Phaser.Math.Vector2(geometry.p0.x, geometry.p0.y),
      new Phaser.Math.Vector2(geometry.p1.x, geometry.p1.y),
      new Phaser.Math.Vector2(geometry.p2.x, geometry.p2.y),
      new Phaser.Math.Vector2(geometry.p3.x, geometry.p3.y),
    );
    sourceTrack.setUUID('exact-track');
    sourceTrack.setConstructionData(
      proposal.verticalProfile,
      proposal.structures,
      proposal.costs.total,
    );
    const original = TrackSerializer.toTrackDef(sourceTrack);
    const world = WorldManager.createNew('Exact restore', 'real-terrain-alpha');
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

  it('restores a zero paid build cost exactly', () => {
    const world = WorldManager.createNew(
      'Zero cost restore',
      'real-terrain-alpha',
    );
    world.tracks = [{
      geometryVersion: 1,
      uuid: 'zero-cost',
      p0: { x: 0, y: 0 },
      p1: { x: 100, y: 0 },
      p2: { x: 200, y: 0 },
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
    }];
    const restoredTracks: any[] = [];
    const scene = makeScene();
    const loader = new WorldContentLoader(
      scene,
      {
        addTrack: jest.fn((track) => restoredTracks.push(track)),
        getTrack: jest.fn(),
      } as any,
      { createInitialTrain: jest.fn(), createCarriage: jest.fn() } as any,
    );

    loader.load();

    expect(TrackSerializer.toTrackDef(restoredTracks[0]).paidBuildCost).toBe(0);
  });

  it('does not generate starter content for an empty schema-9 world', () => {
    WorldManager.createNew('Empty world', 'real-terrain-alpha');
    const trackManager = { addTrack: jest.fn(), getTrack: jest.fn() };
    const trainManager = {
      createInitialTrain: jest.fn(),
      createCarriage: jest.fn(),
    };
    const loader = new WorldContentLoader(
      makeScene(),
      trackManager as any,
      trainManager as any,
    );

    loader.load();

    expect(trackManager.addTrack).not.toHaveBeenCalled();
    expect(trainManager.createInitialTrain).not.toHaveBeenCalled();
  });

  it('restores aggregate freight placement, facing, and stopped state', () => {
    const world = WorldManager.createNew('Freight restore', 'freight-restore');
    const freightTrain = makeFreightTrainDef({
      trackUUID: 'persisted-track',
      trackT: 0.75,
      facing: -1,
    });
    world.trains = [freightTrain];
    const scene = makeScene();
    const liveTrain = new (require('../../src/entities/Train').default)(
      scene,
      0,
      0,
      freightTrain.id,
      freightTrain.freightSetId,
    );
    liveTrain.enginePower = 1;
    liveTrain.getMatterBody().setVelocity(3, 4);
    liveTrain.getMatterBody().setAngularVelocity(0.5);
    const track = {
      getCurvePath: jest.fn().mockReturnValue({
        getPoint: jest.fn().mockReturnValue({ x: 750, y: 25 }),
      }),
      getTrackAngle: jest.fn().mockReturnValue(45),
    };
    const trainManager = {
      createFreightTrain: jest.fn().mockReturnValue(liveTrain),
      createCarriage: jest.fn(),
    };
    const loader = new WorldContentLoader(
      scene,
      {
        addTrack: jest.fn(),
        getTrack: jest.fn().mockReturnValue(track),
      } as any,
      trainManager as any,
    );

    loader.load();

    expect(world.trains).toEqual([freightTrain]);
    expect(trainManager.createFreightTrain).toHaveBeenCalledWith(
      freightTrain.id,
      freightTrain.freightSetId,
    );
    expect(trainManager.createCarriage).not.toHaveBeenCalled();
    expect(liveTrain.currentTrack).toBe(track);
    expect(liveTrain.getMatterBody().x).toBe(750);
    expect(liveTrain.getMatterBody().y).toBe(25);
    expect(liveTrain.getMatterBody().angle).toBe(225);
    expect(liveTrain.getMatterBody().body.velocity).toEqual({ x: 0, y: 0 });
    expect(liveTrain.getMatterBody().body.angularVelocity).toBe(0);
    expect(liveTrain.enginePower).toBe(0);
  });

  it('skips a freight train whose referenced track is missing', () => {
    const world = WorldManager.createNew('Missing track', 'missing-track');
    world.trains = [makeFreightTrainDef({ trackUUID: 'missing' })];
    const trainManager = {
      createFreightTrain: jest.fn(),
      createCarriage: jest.fn(),
    };
    const loader = new WorldContentLoader(
      makeScene(),
      {
        addTrack: jest.fn(),
        getTrack: jest.fn().mockReturnValue(undefined),
      } as any,
      trainManager as any,
    );

    loader.load();

    expect(trainManager.createFreightTrain).not.toHaveBeenCalled();
    expect(trainManager.createCarriage).not.toHaveBeenCalled();
  });
});
