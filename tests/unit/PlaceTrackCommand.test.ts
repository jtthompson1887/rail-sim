/**
 * @jest-environment jsdom
 */
import Phaser from 'phaser';
import RailTrack from '../../src/entities/RailTrack';
import TrackManager from '../../src/managers/TrackManager';
import { WorldManager } from '../../src/managers/WorldManager';
import { PlaceTrackCommand } from '../../src/commands/PlaceTrackCommand';
import { ConstructionAnalyzer } from '../../src/systems/ConstructionAnalyzer';
import { ConstructionEconomy } from '../../src/systems/ConstructionEconomy';
import { ConstructionService } from '../../src/systems/ConstructionService';
import { CommandStack } from '../../src/systems/CommandStack';
import { TrackSerializer } from '../../src/utils/TrackSerializer';
import { WorldContentLoader } from '../../src/services/WorldContentLoader';
import { ENDPOINT_CONNECTION_COST } from '../../src/config/ConstructionConfig';

const { makeScene } = require('../../__mocks__/phaser');

describe('PlaceTrackCommand', () => {
  let scene: Phaser.Scene;
  let manager: TrackManager;
  let service: ConstructionService;

  beforeEach(() => {
    scene = makeScene();
    manager = new TrackManager(scene);
    WorldManager.createNew('Build', 'build-seed');
    service = new ConstructionService(
      manager,
      new ConstructionAnalyzer({ getHeightAt: () => 0 }),
    );
  });

  afterEach(() => WorldManager.reset());

  it('commits, undoes, and redoes the exact quote atomically with one revision each', () => {
    const world = WorldManager.world!;
    const quote = service.createQuote({ x: 0, y: 0 }, { x: 300, y: 0 }, 'built')!;
    const initialCash = world.company.cash;
    const stack = new CommandStack();
    const command = new PlaceTrackCommand(
      scene,
      manager,
      new ConstructionEconomy(world.company),
      service,
      quote,
    );

    expect(stack.push(command)).toBe(true);
    expect(world.revision).toBe(1);
    expect(world.company.cash).toBe(initialCash - quote.totalCost);
    expect(world.tracks[0]).toEqual(expect.objectContaining({
      uuid: 'built',
      ...quote.proposal.geometry,
      paidBuildCost: quote.totalCost,
    }));
    expect(manager.getTrack('built')!.paidBuildCost).toBe(quote.totalCost);

    expect(stack.undo()).toBe(true);
    expect(world.revision).toBe(2);
    expect(world.company.cash).toBe(initialCash);
    expect(world.tracks).toEqual([]);
    expect(manager.getTrack('built')).toBeUndefined();

    expect(stack.redo()).toBe(true);
    expect(world.revision).toBe(3);
    expect(world.company.cash).toBe(initialCash - quote.totalCost);
    expect(world.tracks[0].uuid).toBe('built');
  });

  it.each([
    'after-debit',
    'after-live-track',
    'after-world-def',
  ] as const)('rolls back every earlier mutation when %s fails', (failedStage) => {
    const world = WorldManager.world!;
    const company = world.company;
    const quote = service.createQuote({ x: 0, y: 0 }, { x: 300, y: 0 }, 'failed')!;
    const before = JSON.stringify(world);
    const command = new PlaceTrackCommand(
      scene,
      manager,
      new ConstructionEconomy(world.company),
      service,
      quote,
      (stage) => {
        if (stage === failedStage) throw new Error('injected');
      },
    );

    expect(command.execute()).toBe(false);
    expect(WorldManager.world).toBe(world);
    expect(world.company).toBe(company);
    expect(JSON.stringify(world)).toBe(before);
    expect(manager.getTrack('failed')).toBeUndefined();
  });

  it.each([
    'undo-after-live-track',
    'undo-after-world-def',
    'undo-after-refund',
  ] as const)('restores the applied state when %s fails', (failedStage) => {
    const world = WorldManager.world!;
    const quote = service.createQuote({ x: 0, y: 0 }, { x: 300, y: 0 }, 'undo-failed')!;
    const command = new PlaceTrackCommand(
      scene,
      manager,
      new ConstructionEconomy(world.company),
      service,
      quote,
      (stage) => {
        if (stage === failedStage) throw new Error('injected');
      },
    );
    expect(command.execute()).toBe(true);
    const beforeUndo = JSON.stringify(world);
    expect(command.undo()).toBe(false);
    expect(JSON.stringify(world)).toBe(beforeUndo);
    expect(manager.getTrack('undo-failed')).toBeDefined();
  });

  it('rejects stale and unaffordable quotes with zero mutation', () => {
    const world = WorldManager.world!;
    const quote = service.createQuote({ x: 0, y: 0 }, { x: 300, y: 0 }, 'stale')!;
    world.company.cash = 0;
    const command = new PlaceTrackCommand(
      scene,
      manager,
      new ConstructionEconomy(world.company),
      service,
      quote,
    );
    expect(command.execute()).toBe(false);
    expect(world.revision).toBe(0);
    expect(world.tracks).toEqual([]);
    expect(manager.getTrack('stale')).toBeUndefined();
  });

  it('rejects redo after an intervening authoritative revision', () => {
    const world = WorldManager.world!;
    const quote = service.createQuote({ x: 0, y: 0 }, { x: 300, y: 0 }, 'redo-stale')!;
    const command = new PlaceTrackCommand(
      scene,
      manager,
      new ConstructionEconomy(world.company),
      service,
      quote,
    );
    expect(command.execute()).toBe(true);
    expect(command.undo()).toBe(true);
    WorldManager.addSceneryDef({
      id: 'intervening',
      type: 'tree_oak',
      x: 0,
      y: 0,
      rotation: 0,
      scale: 1,
      variant: 0,
    });
    expect(command.execute()).toBe(false);
    expect(manager.getTrack('redo-stale')).toBeUndefined();
  });

  it('charges both endpoint connections and reloads the exact graph and engineering data', () => {
    const addNeighbour = (
      uuid: string,
      points: [number, number, number, number],
    ): RailTrack => {
      const track = new RailTrack(
        scene,
        new Phaser.Math.Vector2(points[0], 0),
        new Phaser.Math.Vector2(points[1], 0),
        new Phaser.Math.Vector2(points[2], 0),
        new Phaser.Math.Vector2(points[3], 0),
      );
      track.setUUID(uuid);
      track.setConstructionData(
        { profileVersion: 1, knots: [{ t: 0, elevation: 0 }, { t: 1, elevation: 0 }] },
        [{ type: 'surface', startT: 0, endT: 1, startElevation: 0, endElevation: 0 }],
        100,
      );
      manager.addTrack(track);
      WorldManager.addTrackDef(TrackSerializer.toTrackDef(track));
      return track;
    };
    const left = addNeighbour('left', [-300, -200, -100, 0]);
    const right = addNeighbour('right', [300, 400, 500, 600]);
    const quote = service.createQuote({ x: 2, y: 0 }, { x: 298, y: 0 }, 'middle')!;
    expect(quote.topologyCost).toBe(2 * ENDPOINT_CONNECTION_COST);
    const command = new PlaceTrackCommand(
      scene,
      manager,
      new ConstructionEconomy(WorldManager.world!.company),
      service,
      quote,
    );
    expect(command.execute()).toBe(true);
    const middle = manager.getTrack('middle')!;
    expect(middle.getPrevious()).toBe(left);
    expect(middle.getNext()).toBe(right);
    expect(left.getNext()).toBe(middle);
    expect(right.getPrevious()).toBe(middle);

    const id = WorldManager.world!.id;
    expect(WorldManager.save()).toBe(true);
    WorldManager.reset();
    expect(WorldManager.load(id)).not.toBeNull();
    const reloaded = new TrackManager(scene);
    new WorldContentLoader(scene, reloaded, {} as any).load();
    const restored = reloaded.getTrack('middle')!;
    expect(TrackSerializer.toTrackDef(restored)).toEqual(
      WorldManager.world!.tracks.find((track) => track.uuid === 'middle'),
    );
    expect(restored.paidBuildCost).toBe(quote.totalCost);
    expect(restored.getPrevious()!.getUUID()).toBe('left');
    expect(restored.getNext()!.getUUID()).toBe('right');
  });
});
