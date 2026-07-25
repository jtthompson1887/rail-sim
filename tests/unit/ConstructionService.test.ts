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
import type { TrackGeometryDef } from '../../src/systems/TrackGeometry';

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

function addGeometryTrack(
  manager: TrackManager,
  scene: Phaser.Scene,
  uuid: string,
  geometry: TrackGeometryDef,
  persist = true,
): RailTrack {
  const track = new RailTrack(
    scene,
    new Phaser.Math.Vector2(geometry.p0.x, geometry.p0.y),
    new Phaser.Math.Vector2(geometry.p1.x, geometry.p1.y),
    new Phaser.Math.Vector2(geometry.p2.x, geometry.p2.y),
    new Phaser.Math.Vector2(geometry.p3.x, geometry.p3.y),
  );
  track.setUUID(uuid);
  track.setConstructionData(
    { profileVersion: 1, knots: [{ t: 0, elevation: 0 }, { t: 1, elevation: 0 }] },
    [{ type: 'surface', startT: 0, endT: 1, startElevation: 0, endElevation: 0 }],
    100,
  );
  manager.addTrack(track);
  if (persist) WorldManager.addTrackDef(TrackSerializer.toTrackDef(track));
  return track;
}

function line(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): TrackGeometryDef {
  return {
    geometryVersion: 1,
    p0: { x: x0, y: y0 },
    p1: { x: x0 + (x1 - x0) / 3, y: y0 + (y1 - y0) / 3 },
    p2: { x: x0 + 2 * (x1 - x0) / 3, y: y0 + 2 * (y1 - y0) / 3 },
    p3: { x: x1, y: y1 },
  };
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
      'analyzeDetailed',
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

  it('returns a clearance-invalid engineering preview without manufacturing a quote', () => {
    addGeometryTrack(manager, scene, 'crossed', line(-150, 0, 150, 0));

    const result = service.createPreview(
      { x: 0, y: -150, snapped: false, type: 'none' },
      { x: 0, y: 150, snapped: false, type: 'none' },
      'crossing',
    );

    expect(result).not.toBeNull();
    expect(result!.status).toBe('engineering-invalid');
    expect(result!.proposal.valid).toBe(false);
    expect(result!.proposal.reasonCode).toBe('clearance');
    expect(result!.proposal.remedy).toBe(
      'Move the route away from existing infrastructure.',
    );
    expect(result!.quote).toBeNull();
  });

  it('fails closed when persisted and live track authority diverge', () => {
    const liveOnly = addGeometryTrack(
      manager,
      scene,
      'live-only',
      line(1_000, 0, 1_300, 0),
      false,
    );
    expect(service.createPreview(
      { x: 0, y: 0, snapped: false, type: 'none' },
      { x: 300, y: 0, snapped: false, type: 'none' },
      'live-divergence',
    )).toBeNull();

    manager.removeTrack(liveOnly.getUUID());
    WorldManager.world!.tracks.push({
      uuid: 'persisted-only',
      ...line(1_000, 0, 1_300, 0),
      verticalProfile: {
        profileVersion: 1,
        knots: [{ t: 0, elevation: 0 }, { t: 1, elevation: 0 }],
      },
      structures: [],
      paidBuildCost: 100,
    });
    expect(service.createPreview(
      { x: 0, y: 0, snapped: false, type: 'none' },
      { x: 300, y: 0, snapped: false, type: 'none' },
      'persisted-divergence',
    )).toBeNull();
  });

  it('does not treat a free anchor on an endpoint as a legal connection', () => {
    addTrack(manager, scene);

    const result = service.createPreview(
      { x: 0, y: 0, snapped: false, type: 'none' },
      { x: 300, y: 0, snapped: false, type: 'none' },
      'unnamed-endpoint',
    );

    expect(result).not.toBeNull();
    expect(result!.proposal.reasonCode).toBe('clearance');
    expect(result!.quote).toBeNull();
    expect(result!.predictedConnections).toEqual([]);
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
    expect(result!.cashBefore).toBe(1_000_000);
    expect(result!.cashAfter).toBe(result!.cashBefore - result!.totalCost);
  });

  it('captures exact cash before and after for an unaffordable quote-null preview', () => {
    WorldManager.world!.company.cash = 100;
    const result = service.createPreview(
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      'unaffordable-preview',
    );

    expect(result).not.toBeNull();
    expect(result!.status).toBe('unaffordable');
    expect(result!.quote).toBeNull();
    expect(result!.cashBefore).toBe(100);
    expect(result!.cashAfter).toBe(100 - result!.totalCost);
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

  it('rejects adversarial outward vectors on free and grid anchors', () => {
    const result = service.createPreview(
      {
        x: 0,
        y: 0,
        snapped: false,
        type: 'none',
        outward: { x: 0, y: 1 },
      } as any,
      {
        x: 300,
        y: 0,
        snapped: true,
        type: 'grid',
        outward: { x: 0, y: -1 },
      } as any,
      'adversarial-free',
    );

    expect(result).toBeNull();
  });

  it('accepts an endpoint only when all supplied metadata exactly matches authority', () => {
    addTrack(manager, scene);
    const accepted = service.createPreview(
      {
        x: 0,
        y: 0,
        snapped: true,
        type: 'endpoint',
        trackUUID: 'neighbour',
        endpoint: 'end',
        outward: { x: 1, y: 0 },
        open: true,
      } as any,
      { x: 300, y: 0, snapped: false, type: 'none' },
      'exact-endpoint',
    );

    expect(accepted).not.toBeNull();
    expect(accepted!.proposal.geometry.p1).toEqual({ x: 100, y: 0 });
    expect(accepted!.predictedConnections).toEqual([
      expect.objectContaining({
        existingTrackUUID: 'neighbour',
        existingEndpoint: 'end',
      }),
    ]);

    for (const [newTrackUUID, override] of [
      ['offset-point', { x: Number.EPSILON }],
      ['forged-tangent', { outward: { x: 0, y: 1 } }],
      ['stale-open', { open: false }],
    ] as const) {
      const rejected = service.createPreview(
        {
          x: 0,
          y: 0,
          snapped: true,
          type: 'endpoint',
          trackUUID: 'neighbour',
          endpoint: 'end',
          outward: { x: 1, y: 0 },
          open: true,
          ...override,
        } as any,
        { x: 300, y: 0, snapped: false, type: 'none' },
        newTrackUUID,
      );
      expect(rejected).not.toBeNull();
      expect(rejected!.status).toBe('endpoint-unavailable');
      expect(rejected!.quote).toBeNull();
      expect(rejected!.predictedConnections).toEqual([]);
    }
  });

  it('rejects malformed endpoint input at the runtime boundary', () => {
    addTrack(manager, scene);
    const result = service.createPreview(
      {
        x: 0,
        y: 0,
        snapped: true,
        type: 'endpoint',
        trackUUID: 'neighbour',
        endpoint: 'end',
      } as any,
      { x: 300, y: 0, snapped: false, type: 'none' },
      'missing-endpoint-metadata',
    );

    expect(result).toBeNull();
  });

  it('rejects endpoint metadata attached to none or grid anchors', () => {
    addTrack(manager, scene);
    for (const type of ['none', 'grid'] as const) {
      const result = service.createPreview(
        {
          x: 0,
          y: 0,
          snapped: type === 'grid',
          type,
          trackUUID: 'neighbour',
          endpoint: 'end',
          outward: { x: 1, y: 0 },
          open: true,
        } as any,
        { x: 300, y: 0, snapped: false, type: 'none' },
        `metadata-${type}`,
      );
      expect(result).toBeNull();
    }
  });

  it('rejects midpoint preview anchors at runtime without creating a quote', () => {
    const result = service.createPreview(
      { x: 0, y: 0, snapped: true, type: 'midpoint' } as any,
      { x: 300, y: 0, snapped: false, type: 'none' },
      'midpoint-anchor',
    );

    expect(result).toBeNull();
  });

  it('returns a deterministic frozen invalid preview for the same snapped port', () => {
    addTrack(manager, scene);
    const anchor = {
      x: 0,
      y: 0,
      snapped: true as const,
      type: 'endpoint' as const,
      trackUUID: 'neighbour',
      endpoint: 'end' as const,
      outward: { x: 1, y: 0 },
      open: true,
    };
    const first = service.createPreview(anchor, anchor, 'same-port-a');
    const second = service.createPreview(anchor, anchor, 'same-port-b');

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.proposal.valid).toBe(false);
    expect(first!.quote).toBeNull();
    expect(first!.proposal.remedy).not.toBe('');
    expect(first!.proposal.geometry).toEqual(second!.proposal.geometry);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first!.proposal.geometry)).toBe(true);
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

  it('rejects a quote when an unrelated live track crosses it after pricing', () => {
    const quote = service.createPreview(
      { x: -150, y: 0, snapped: false, type: 'none' },
      { x: 150, y: 0, snapped: false, type: 'none' },
      'priced-before-crossing',
    )!.quote!;
    addGeometryTrack(
      manager,
      scene,
      'late-crossing',
      line(0, -150, 0, 150),
      false,
    );
    WorldManager.world!.tracks.push(
      TrackSerializer.toTrackDef(manager.getTrack('late-crossing')!),
    );

    expect(service.revalidateQuote(quote)).toBe(false);
  });

  it('rejects confirm and redo validation after unrelated geometry moves into the route', () => {
    const distant = addGeometryTrack(
      manager,
      scene,
      'moving-track',
      line(1_000, -150, 1_000, 150),
    );
    const quote = service.createPreview(
      { x: -150, y: 0, snapped: false, type: 'none' },
      { x: 150, y: 0, snapped: false, type: 'none' },
      'geometry-mutation-guard',
    )!.quote!;
    manager.updateTrackVectors(
      distant.getUUID(),
      new Phaser.Math.Vector2(0, -150),
      new Phaser.Math.Vector2(0, -50),
      new Phaser.Math.Vector2(0, 50),
      new Phaser.Math.Vector2(0, 150),
    );
    WorldManager.world!.tracks[0] = TrackSerializer.toTrackDef(distant);

    expect(service.revalidateQuote(quote)).toBe(false);
    expect(service.revalidateQuoteForRedo(quote, quote.expectedCash)).toBe(false);
  });

  it('fails closed when any live existing track cannot be profiled', () => {
    const distant = addGeometryTrack(
      manager,
      scene,
      'distant',
      line(1_000, 1_000, 1_300, 1_000),
    );
    const quote = service.createPreview(
      { x: -150, y: 0, snapped: false, type: 'none' },
      { x: 150, y: 0, snapped: false, type: 'none' },
      'profile-guard',
    )!.quote!;
    manager.updateTrackVectors(
      distant.getUUID(),
      new Phaser.Math.Vector2(-3_500, 1_000),
      new Phaser.Math.Vector2(-1_167, 1_000),
      new Phaser.Math.Vector2(1_167, 1_000),
      new Phaser.Math.Vector2(3_500, 1_000),
    );
    WorldManager.world!.tracks[0] = TrackSerializer.toTrackDef(distant);

    expect(service.revalidateQuote(quote)).toBe(false);
    expect(service.revalidateQuoteForRedo(quote, quote.expectedCash)).toBe(false);
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
