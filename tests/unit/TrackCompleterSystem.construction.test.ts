import Phaser from 'phaser';
import RailTrack from '../../src/entities/RailTrack';
import { TrackCompleterSystem } from '../../src/systems/TrackCompleterSystem';
import { EventBus } from '../../src/services/EventBus';
import { WorldManager } from '../../src/managers/WorldManager';
import { GameConfig } from '../../src/config/GameConfig';

const { makeScene } = require('../../__mocks__/phaser');

function makeTrack(scene: any, x0: number, y0: number, x3: number, y3: number): RailTrack {
  return new RailTrack(
    scene,
    new Phaser.Math.Vector2(x0, y0),
    new Phaser.Math.Vector2(x0 + (x3 - x0) / 3, y0 + (y3 - y0) / 3),
    new Phaser.Math.Vector2(x0 + (x3 - x0) * 2 / 3, y0 + (y3 - y0) * 2 / 3),
    new Phaser.Math.Vector2(x3, y3),
  );
}

function endpoint(track: RailTrack, isStart: boolean) {
  const curve = track.getCurvePath();
  const point = new Phaser.Math.Vector2(
    isStart ? curve.getStartPoint() : curve.getEndPoint(),
  );
  const tangent = new Phaser.Math.Vector2(
    curve.getTangent(isStart ? 0 : 1),
  );
  if (isStart) tangent.scale(-1);
  return { track, isStart, point, tangent };
}

function makeGraphicsFake(scene: any) {
  const graphics = new Phaser.GameObjects.Graphics(scene) as any;
  for (const method of [
    'clear', 'fillStyle', 'fillCircle', 'lineStyle', 'beginPath',
    'moveTo', 'lineTo', 'strokePath', 'destroy',
  ]) {
    graphics[method] = jest.fn().mockReturnValue(graphics);
  }
  return graphics;
}

describe('TrackCompleterSystem construction behavior', () => {
  let scene: any;
  let ghostGraphics: any;
  let endpointGraphics: any;
  let endpointDots: any;
  let trackManager: any;
  let terrainValidator: any;
  let system: TrackCompleterSystem;
  let emitSpy: jest.SpyInstance;

  beforeEach(() => {
    scene = makeScene();
    scene.add.graphics = jest.fn().mockImplementation(() => makeGraphicsFake(scene));
    trackManager = {
      tracks: [],
      addTrack: jest.fn((track) => trackManager.tracks.push(track)),
    };
    terrainValidator = { canPlaceTrack: jest.fn() };
    WorldManager.createNew('Completer construction');
    emitSpy = jest.spyOn(EventBus, 'emit');
    system = new TrackCompleterSystem(scene, trackManager, terrainValidator);
    ghostGraphics = (system as any).ghostGraphics;
    endpointGraphics = (system as any).endpointGraphics;
    endpointDots = (system as any).endpointDots;
  });

  afterEach(() => {
    emitSpy.mockRestore();
    WorldManager.reset();
  });

  it('renders only open endpoints while active and clears endpoint visuals when disabled', () => {
    const open = makeTrack(scene, 0, 0, 200, 0);
    const connected = makeTrack(scene, 400, 0, 600, 0);
    connected.setPrevious(open);
    connected.setNext(open);
    trackManager.tracks = [open, connected];

    system.update(100);
    expect(endpointDots.fillCircle).not.toHaveBeenCalled();

    system.setActive(true);
    system.update(300);
    expect(endpointDots.fillCircle).toHaveBeenCalledTimes(2);
    expect(endpointDots.fillCircle).toHaveBeenCalledWith(0, 0, 12);
    expect(endpointDots.fillCircle).toHaveBeenCalledWith(200, 0, 12);

    const dotClearsBeforeDisable = endpointDots.clear.mock.calls.length;
    const lineClearsBeforeDisable = endpointGraphics.clear.mock.calls.length;
    system.setActive(false);
    expect(endpointDots.clear.mock.calls.length).toBeGreaterThan(dotClearsBeforeDisable);
    expect(endpointGraphics.clear.mock.calls.length).toBeGreaterThan(lineClearsBeforeDisable);
  });

  it('selects an endpoint, rejects the other endpoint of the same track, and supports Escape cleanup', () => {
    const track = makeTrack(scene, 0, 0, 300, 0);
    trackManager.tracks = [track];

    system.onPointerDown({ leftButtonDown: () => true, x: 0, y: 0 } as any);
    system.onPointerDown({ leftButtonDown: () => true, x: 300, y: 0 } as any);

    expect(emitSpy).toHaveBeenCalledWith(
      'ui:toast',
      { message: 'Select a different track endpoint.', type: 'info' },
    );
    system.onKeyDown({ code: 'Escape' } as KeyboardEvent);
    expect((system as any).firstEndpoint).toBeNull();
  });

  it('finds a route, builds a preview, and commits it on Enter', () => {
    const fromTrack = makeTrack(scene, -100, 0, 0, 0);
    const toTrack = makeTrack(scene, 120, 0, 220, 0);
    trackManager.tracks = [];
    terrainValidator.canPlaceTrack.mockReturnValue({
      valid: true,
      requiresTunnel: false,
      averageElevation: 20,
      reason: '',
    });
    const addWorld = jest.spyOn(WorldManager, 'addTrackDef');

    (system as any).runCompletion(endpoint(fromTrack, false), endpoint(toTrack, true));

    expect((system as any).isAwaitingConfirm).toBe(true);
    expect((system as any).pendingTracks.length).toBeGreaterThan(0);
    expect(ghostGraphics.strokePath).toHaveBeenCalled();

    system.onKeyDown({ code: 'Enter' } as KeyboardEvent);

    expect((system as any).isAwaitingConfirm).toBe(false);
    expect(trackManager.addTrack).toHaveBeenCalled();
    expect(addWorld).toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith(
      'completer:success',
      { trackUUIDs: expect.any(Array) },
    );
    expect(emitSpy).toHaveBeenCalledWith(
      'ui:toast',
      { message: 'Track connection committed.', type: 'success' },
    );
  });

  it('reports budget exhaustion without creating a preview', () => {
    const fromTrack = makeTrack(scene, 0, 0, 100, 0);
    const toTrack = makeTrack(scene, 1000, 0, 1100, 0);
    const originalBudget = GameConfig.TOOLS.COMPLETER_SEARCH_BUDGET;
    (GameConfig.TOOLS as any).COMPLETER_SEARCH_BUDGET = 0;
    try {
      (system as any).runCompletion(endpoint(fromTrack, false), endpoint(toTrack, true));
    } finally {
      (GameConfig.TOOLS as any).COMPLETER_SEARCH_BUDGET = originalBudget;
    }

    expect((system as any).isAwaitingConfirm).toBe(false);
    expect(emitSpy).toHaveBeenCalledWith('completer:failed', { reason: 'budget' });
    expect(emitSpy).toHaveBeenCalledWith(
      'ui:toast',
      {
        message: 'No valid route found — try adjusting the endpoints.',
        type: 'error',
      },
    );
  });

  it('rejects the entire pending preview when terrain validation fails', () => {
    const first = makeTrack(scene, 0, 0, 100, 0);
    const second = makeTrack(scene, 100, 0, 200, 0);
    const destroyFirst = jest.spyOn(first, 'destroy');
    const destroySecond = jest.spyOn(second, 'destroy');
    (system as any).pendingTracks = [first, second];
    (system as any).isAwaitingConfirm = true;
    terrainValidator.canPlaceTrack.mockReturnValue({
      valid: false,
      requiresTunnel: false,
      averageElevation: 0,
      reason: 'terrain blocked',
    });

    system.confirm();

    expect(trackManager.addTrack).not.toHaveBeenCalled();
    expect(destroyFirst).toHaveBeenCalled();
    expect(destroySecond).toHaveBeenCalled();
    expect((system as any).pendingTracks).toEqual([]);
    expect((system as any).isAwaitingConfirm).toBe(false);
    expect(emitSpy).toHaveBeenCalledWith(
      'ui:toast',
      { message: 'terrain blocked', type: 'error' },
    );
  });

  it('applies tunnel/elevation metadata and serializes optional fields on valid commit', () => {
    const pending = makeTrack(scene, 0, 0, 300, 100);
    (system as any).pendingTracks = [pending];
    (system as any).isAwaitingConfirm = true;
    terrainValidator.canPlaceTrack.mockReturnValue({
      valid: true,
      requiresTunnel: true,
      averageElevation: 91,
      reason: 'tunnel required',
    });
    const addWorld = jest.spyOn(WorldManager, 'addTrackDef');

    system.confirm();

    expect(pending.isTunnel).toBe(true);
    expect(pending.elevation).toBe(91);
    expect(addWorld).toHaveBeenCalledWith(expect.objectContaining({
      uuid: pending.getUUID(),
      isTunnel: true,
      elevation: 91,
    }));
  });

  it('groups long paths into multiple track segments and detects proximity collisions', () => {
    const path = Array.from({ length: 18 }, (_, index) => ({
      point: new Phaser.Math.Vector2(index * 20, index * 5),
      angle: Math.atan2(5, 20),
    }));
    const built = (system as any).buildTracksFromPath(path) as RailTrack[];
    expect(built).toHaveLength(3);
    expect((system as any).buildTracksFromPath([])).toEqual([]);

    const blocker = makeTrack(scene, 0, 0, 100, 0);
    trackManager.tracks = [blocker];
    expect((system as any).collidesWithExistingTracks(
      new Phaser.Math.Vector2(50, 5), 30,
    )).toBe(true);
    expect((system as any).collidesWithExistingTracks(
      new Phaser.Math.Vector2(50, 200), 30,
    )).toBe(false);

    for (const track of built) track.destroy();
  });

  it('cancel destroys pending tracks and destroy releases all owned graphics', () => {
    const pending = makeTrack(scene, 0, 0, 100, 0);
    const destroyPending = jest.spyOn(pending, 'destroy');
    (system as any).pendingTracks = [pending];
    (system as any).isAwaitingConfirm = true;

    system.cancel();
    expect(destroyPending).toHaveBeenCalled();
    expect((system as any).pendingTracks).toEqual([]);
    expect((system as any).isAwaitingConfirm).toBe(false);

    const ownedGraphics = [
      ghostGraphics,
      endpointGraphics,
      endpointDots,
    ];
    expect(new Set(ownedGraphics).size).toBe(3);

    system.destroy();
    for (const ownedGraphic of ownedGraphics) {
      expect(ownedGraphic.destroy).toHaveBeenCalledTimes(1);
    }
  });
});
