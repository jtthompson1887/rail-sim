/**
 * @jest-environment jsdom
 */
import Phaser from 'phaser';
import RailTrack from '../../src/entities/RailTrack';
import TrackManager from '../../src/managers/TrackManager';
import { WorldManager } from '../../src/managers/WorldManager';
import { ConstructionAnalyzer } from '../../src/systems/ConstructionAnalyzer';
import { ConstructionService } from '../../src/systems/ConstructionService';
import { ENDPOINT_CONNECTION_COST } from '../../src/config/ConstructionConfig';
import { TrackSerializer } from '../../src/utils/TrackSerializer';

const { makeScene } = require('../../__mocks__/phaser');

function addTrack(manager: TrackManager, scene: Phaser.Scene): RailTrack {
  const track = new RailTrack(
    scene,
    new Phaser.Math.Vector2(-300, 0),
    new Phaser.Math.Vector2(-200, 0),
    new Phaser.Math.Vector2(-100, 0),
    new Phaser.Math.Vector2(0, 0),
  );
  track.setUUID('neighbour');
  track.setConstructionData(
    { profileVersion: 1, knots: [{ t: 0, elevation: 0 }, { t: 1, elevation: 0 }] },
    [{ type: 'surface', startT: 0, endT: 1, startElevation: 0, endElevation: 0 }],
    100,
  );
  manager.addTrack(track);
  WorldManager.addTrackDef(TrackSerializer.toTrackDef(track));
  return track;
}

describe('ConstructionService', () => {
  let scene: Phaser.Scene;
  let manager: TrackManager;
  let service: ConstructionService;

  beforeEach(() => {
    scene = makeScene();
    manager = new TrackManager(scene);
    WorldManager.createNew('Quote', 'quote-seed');
    service = new ConstructionService(
      manager,
      new ConstructionAnalyzer({ getHeightAt: () => 0 }),
    );
  });

  afterEach(() => WorldManager.reset());

  it('snaps first, analyzes the canonical geometry, prices topology, and freezes deeply', () => {
    addTrack(manager, scene);
    const quote = service.createQuote({ x: 5, y: 0 }, { x: 300, y: 0 }, 'new-track');
    expect(quote).not.toBeNull();
    expect(quote!.proposal.geometry.p0).toEqual({ x: 0, y: 0 });
    expect(quote!.predictedConnections).toEqual([expect.objectContaining({
      existingTrackUUID: 'neighbour',
      existingEndpoint: 'end',
      newEndpoint: 'start',
      point: { x: 0, y: 0 },
    })]);
    expect(quote!.topologyCost).toBe(ENDPOINT_CONNECTION_COST);
    expect(quote!.totalCost).toBe(quote!.proposal.costs.total + ENDPOINT_CONNECTION_COST);
    expect(Object.isFrozen(quote)).toBe(true);
    expect(Object.isFrozen(quote!.proposal.geometry.p0)).toBe(true);
  });

  it('returns one immutable preview whose valid quote shares the exact proposal', () => {
    const analyzed = jest.spyOn(
      (service as any).analyzer,
      'analyze',
    );
    const result = service.createPreview(
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      'preview-track',
    );

    expect(result).not.toBeNull();
    expect(analyzed).toHaveBeenCalledTimes(1);
    expect(result!.quote!.proposal).toBe(result!.proposal);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result!.proposal)).toBe(true);
  });

  it('keeps invalid analysis available without manufacturing a quote', () => {
    const result = service.createPreview(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      'invalid-preview',
    );

    expect(result).not.toBeNull();
    expect(result!.proposal.valid).toBe(false);
    expect(result!.quote).toBeNull();
    expect(result!.proposal.remedy).not.toBe('');
  });

  it('respects an explicit free/grid anchor when endpoint snapping is disabled', () => {
    addTrack(manager, scene);
    const result = service.createPreview(
      { x: 5, y: 0, snapped: false, type: 'none' },
      { x: 300, y: 0, snapped: true, type: 'grid' },
      'explicit-free',
    );

    expect(result).not.toBeNull();
    expect(result!.proposal.geometry.p0).toEqual({ x: 5, y: 0 });
    expect(result!.proposal.geometry.p3).toEqual({ x: 300, y: 0 });
    expect(result!.predictedConnections).toEqual([]);
  });

  it('preserves Infinity in a straight proposal without JSON coercion', () => {
    const quote = service.createQuote({ x: 0, y: 0 }, { x: 300, y: 0 }, 'straight');
    expect(quote).not.toBeNull();
    expect(quote!.proposal.minimumRadius).toBe(Infinity);
    expect(service.revalidateQuote(quote!)).toBe(true);
  });

  it('rejects a quote after revision, cash, or affected geometry changes', () => {
    const neighbour = addTrack(manager, scene);
    const quote = service.createQuote({ x: 5, y: 0 }, { x: 300, y: 0 }, 'new-track')!;
    WorldManager.world!.company.cash -= 1;
    expect(service.revalidateQuote(quote)).toBe(false);
    WorldManager.world!.company.cash += 1;
    WorldManager.world!.revision += 1;
    expect(service.revalidateQuote(quote)).toBe(false);
    WorldManager.world!.revision -= 1;
    manager.updateTrackVectors(
      neighbour.getUUID(),
      new Phaser.Math.Vector2(-300, 0),
      new Phaser.Math.Vector2(-200, 10),
      new Phaser.Math.Vector2(-100, 0),
      new Phaser.Math.Vector2(0, 0),
    );
    expect(service.revalidateQuote(quote)).toBe(false);
  });

  it('rejects consuming an endpoint that is already connected', () => {
    addTrack(manager, scene);
    const first = service.createQuote({ x: 0, y: 0 }, { x: 300, y: 0 }, 'first')!;
    const connecting = new RailTrack(
      scene,
      new Phaser.Math.Vector2(0, 0),
      new Phaser.Math.Vector2(100, 0),
      new Phaser.Math.Vector2(200, 0),
      new Phaser.Math.Vector2(300, 0),
    );
    connecting.setUUID(first.newTrackUUID);
    connecting.setConstructionData(first.proposal.verticalProfile, first.proposal.structures, first.totalCost);
    manager.addTrack(connecting);
    expect(service.createQuote({ x: 0, y: 0 }, { x: 0, y: 300 }, 'second')).toBeNull();
  });
});
