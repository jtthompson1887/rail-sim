import Phaser from 'phaser';
import RailTrack from '../../src/entities/RailTrack';
import type {
  FreightPurchaseBlocker,
  FreightPurchaseQuote,
  FreightPurchaseService,
} from '../../src/freight/FreightPurchaseService';
import { WorldManager } from '../../src/managers/WorldManager';
import { EventBus } from '../../src/services/EventBus';
import { PlaceVehicleTool } from '../../src/systems/tools/PlaceVehicleTool';

const { makeScene } = require('../../__mocks__/phaser');

function makeTrack(
  scene: any,
  uuid = 'forest-route',
  x1 = -500,
  y1 = 0,
  x2 = 500,
  y2 = 0,
): RailTrack {
  const p0 = new Phaser.Math.Vector2(x1, y1);
  const p1 = new Phaser.Math.Vector2(x1 + (x2 - x1) / 3, y1 + 30);
  const p2 = new Phaser.Math.Vector2(x1 + 2 * (x2 - x1) / 3, y1 - 30);
  const p3 = new Phaser.Math.Vector2(x2, y2);
  const track = new RailTrack(scene, p0, p1, p2, p3);
  track.setUUID(uuid);
  return track;
}

function makeQuote(
  blocker: FreightPurchaseBlocker | null = null,
  expectedRevision = 0,
  freightSetId = 'flatbed-freight-set',
): FreightPurchaseQuote {
  return {
    expectedRevision,
    freightSetId,
    trackUUID: 'forest-route',
    trackT: 0,
    facing: 1,
    purchasePrice: 90_000,
    cashAfter: 910_000,
    affordable: blocker !== 'insufficient-cash',
    valid: blocker === null,
    blocker,
  };
}

describe('PlaceVehicleTool selected freight-set purchase gesture', () => {
  let scene: any;
  let trackManager: any;
  let trainManager: any;
  let quoteService: Pick<FreightPurchaseService, 'quote'>;
  let quote: jest.Mock;
  let tool: PlaceVehicleTool;

  beforeEach(() => {
    WorldManager.createNew('Purchase tool', 'purchase-tool');
    scene = makeScene();
    trackManager = {
      getClosestTrack: jest.fn(),
      captureTopology: jest.fn().mockReturnValue([{
        kind: 'track',
        uuid: 'forest-route',
        previous: null,
        next: null,
      }]),
    };
    trainManager = {};
    quote = jest.fn().mockReturnValue(makeQuote());
    quoteService = { quote };
    tool = new PlaceVehicleTool(
      scene,
      trackManager,
      trainManager,
      undefined,
      quoteService,
    );
  });

  afterEach(() => {
    tool.destroy();
    jest.restoreAllMocks();
    WorldManager.reset();
    localStorage.clear();
  });

  it('ignores unsupported pointer buttons without quoting', () => {
    trackManager.getClosestTrack.mockReturnValue(makeTrack(scene));

    tool.onPointerDown(-500, 0, { button: 1 } as any);

    expect(trackManager.getClosestTrack).not.toHaveBeenCalled();
    expect(quote).not.toHaveBeenCalled();
  });

  it('reports the exact no-track remedy', () => {
    trackManager.getClosestTrack.mockReturnValue(null);
    const state = jest.fn();
    EventBus.on('ui:freight-purchase-state', state);

    tool.onPointerDown(0, 0, { button: 0 } as any);

    expect(state).toHaveBeenCalledWith({
      freightSetId: 'flatbed-freight-set',
      quote: null,
      cash: WorldManager.world!.company.cash,
      message: 'Click on player track to place the General Flatbed Set',
    });
    expect(quote).not.toHaveBeenCalled();
    EventBus.off('ui:freight-purchase-state', state);
  });

  it.each([
    [
      'outside-source-access',
      'Place inside Managed Forest rail access',
    ],
    [
      'disconnected-route',
      'Connect Managed Forest and Sawmill first',
    ],
    [
      'insufficient-cash',
      'Insufficient cash for General Flatbed Set',
    ],
  ] as const)('reports the exact %s remedy', (blocker, message) => {
    const track = makeTrack(scene);
    trackManager.getClosestTrack.mockReturnValue(track);
    quote.mockReturnValue(makeQuote(blocker));
    const state = jest.fn();
    EventBus.on('ui:freight-purchase-state', state);

    tool.onPointerDown(-500, 0, { button: 0 } as any);

    expect(state).toHaveBeenCalledWith({
      freightSetId: 'flatbed-freight-set',
      quote: expect.objectContaining({ blocker }),
      cash: WorldManager.world!.company.cash,
      message,
    });
    EventBus.off('ui:freight-purchase-state', state);
  });

  it('preserves the service-issued frozen quote identity for confirmation', () => {
    const track = makeTrack(scene);
    trackManager.getClosestTrack.mockReturnValue(track);
    const issuedQuote = Object.freeze(makeQuote());
    quote.mockReturnValue(issuedQuote);
    const state = jest.fn();
    EventBus.on('ui:freight-purchase-state', state);

    tool.onPointerDown(-500, 0, { button: 0 } as any);

    const payload = state.mock.calls[0][0];
    expect(quote).toHaveBeenCalledWith({
      freightSetId: 'flatbed-freight-set',
      trackUUID: 'forest-route',
      trackT: expect.any(Number),
      x: expect.any(Number),
      y: expect.any(Number),
      topology: trackManager.captureTopology.mock.results[0].value,
    });
    expect(payload.message).toBe('');
    expect(payload.quote).toBe(issuedQuote);
    expect(Object.isFrozen(payload.quote)).toBe(true);
    EventBus.off('ui:freight-purchase-state', state);
  });

  it('holds one in-flight gesture until a result and reports the exact duplicate remedy', () => {
    trackManager.getClosestTrack.mockReturnValue(makeTrack(scene));
    const state = jest.fn();
    EventBus.on('ui:freight-purchase-state', state);

    tool.onPointerDown(-500, 0, { button: 0 } as any);
    tool.onPointerDown(-500, 0, { button: 0 } as any);

    expect(quote).toHaveBeenCalledTimes(1);
    expect(state).toHaveBeenLastCalledWith({
      freightSetId: 'flatbed-freight-set',
      quote: null,
      cash: WorldManager.world!.company.cash,
      message: 'Purchase already in progress',
    });

    EventBus.emit('freight:purchase-result', {
      ok: false,
      blocker: 'live-spawn-failed',
    });
    tool.onPointerDown(-500, 0, { button: 0 } as any);
    expect(quote).toHaveBeenCalledTimes(2);
    EventBus.off('ui:freight-purchase-state', state);
  });

  it('discards a stale quote and renders a fresh current-revision quote for review', () => {
    trackManager.getClosestTrack.mockReturnValue(makeTrack(scene));
    quote
      .mockReturnValueOnce(makeQuote(null, 0))
      .mockReturnValueOnce(Object.freeze(makeQuote(null, 1)));
    const state = jest.fn();
    EventBus.on('ui:freight-purchase-state', state);
    tool.onPointerDown(-500, 0, { button: 0 } as any);

    EventBus.emit('freight:purchase-result', {
      ok: false,
      blocker: 'stale-revision',
    });

    expect(quote).toHaveBeenCalledTimes(2);
    expect(trackManager.captureTopology).toHaveBeenCalledTimes(2);
    expect(state).toHaveBeenLastCalledWith({
      freightSetId: 'flatbed-freight-set',
      quote: expect.objectContaining({
        expectedRevision: 1,
        valid: true,
      }),
      cash: WorldManager.world!.company.cash,
      message: 'Freight state changed · review and retry purchase',
    });
    expect(Object.isFrozen(state.mock.calls.at(-1)[0].quote)).toBe(true);
    expect(state.mock.calls.at(-1)[0].quote)
      .toBe(quote.mock.results[1].value);
    EventBus.off('ui:freight-purchase-state', state);
  });

  it('uses a real middle dot when a stale purchase has no requotable placement', () => {
    const state = jest.fn();
    EventBus.on('ui:freight-purchase-state', state);

    EventBus.emit('freight:purchase-result', {
      ok: false,
      blocker: 'stale-revision',
    });

    expect(state).toHaveBeenLastCalledWith({
      freightSetId: 'flatbed-freight-set',
      quote: null,
      cash: WorldManager.world!.company.cash,
      message: 'Freight state changed · review and retry purchase',
    });
    EventBus.off('ui:freight-purchase-state', state);
  });

  it('quotes hover state and renders only valid snapped player-track placement', () => {
    trackManager.getClosestTrack.mockReturnValue(makeTrack(scene));

    expect(() => tool.onPointerMove(
      -500,
      0,
      { button: 0 } as any,
    )).not.toThrow();

    expect(quote).toHaveBeenCalledTimes(1);
    expect(quote.mock.calls[0][0]).toEqual(expect.objectContaining({
      freightSetId: 'flatbed-freight-set',
      trackUUID: 'forest-route',
    }));
  });

  it('supports the general flatbed freight-set mode', () => {
    expect(tool.setFreightSetId('flatbed-freight-set')).toBe(true);
  });

  it('clears a pending quote when the selected set is requested again', () => {
    trackManager.getClosestTrack.mockReturnValue(makeTrack(scene));
    const issued = Object.freeze(makeQuote());
    quote.mockReturnValue(issued);
    tool.onPointerDown(-500, 0, { button: 0 } as any);
    expect(tool.canConfirmQuote(issued)).toBe(true);

    expect(tool.setFreightSetId('flatbed-freight-set')).toBe(true);

    expect(tool.canConfirmQuote(issued)).toBe(false);
  });

  it('publishes one cleared selected-set state when cancellation and deactivation invalidate a quote', () => {
    trackManager.getClosestTrack.mockReturnValue(makeTrack(scene));
    const issued = Object.freeze(makeQuote());
    quote.mockReturnValue(issued);
    const state = jest.fn();
    EventBus.on('ui:freight-purchase-state', state);
    tool.onPointerDown(-500, 0, { button: 0 } as any);

    tool.cancel();
    tool.deactivate();

    expect(tool.canConfirmQuote(issued)).toBe(false);
    expect(state).toHaveBeenCalledTimes(2);
    expect(state).toHaveBeenLastCalledWith({
      freightSetId: 'flatbed-freight-set',
      quote: null,
      cash: WorldManager.world!.company.cash,
      message: 'Click on player track to place the General Flatbed Set',
    });
    EventBus.off('ui:freight-purchase-state', state);
  });

  it('switches among supported sets and clears the old pending quote before another placement', () => {
    trackManager.getClosestTrack.mockReturnValue(makeTrack(scene));
    quote
      .mockReturnValueOnce(makeQuote())
      .mockReturnValueOnce(makeQuote(
        null,
        0,
        'aggregate-hopper-set',
      ));
    const state = jest.fn();
    EventBus.on('ui:freight-purchase-state', state);
    tool.onPointerDown(-500, 0, { button: 0 } as any);

    expect(tool.setFreightSetId('aggregate-hopper-set')).toBe(true);
    expect(state).toHaveBeenLastCalledWith({
      freightSetId: 'aggregate-hopper-set',
      quote: null,
      cash: WorldManager.world!.company.cash,
      message: 'Click on player track to place the Aggregate Hopper Set',
    });

    tool.onPointerDown(-500, 0, { button: 0 } as any);
    expect(quote).toHaveBeenLastCalledWith(expect.objectContaining({
      freightSetId: 'aggregate-hopper-set',
    }));
    EventBus.off('ui:freight-purchase-state', state);
  });

  it('fails closed on unsupported set selection without clearing the current pending quote', () => {
    trackManager.getClosestTrack.mockReturnValue(makeTrack(scene));
    const issued = Object.freeze(makeQuote());
    quote.mockReturnValue(issued);
    tool.onPointerDown(-500, 0, { button: 0 } as any);

    expect(tool.setFreightSetId('unknown-set')).toBe(false);
    expect(tool.canConfirmQuote(issued)).toBe(true);
  });

  it('accepts confirmation only for the exact latest selected-set quote identity', () => {
    trackManager.getClosestTrack.mockReturnValue(makeTrack(scene));
    const issued = Object.freeze(makeQuote());
    quote.mockReturnValue(issued);
    tool.onPointerDown(-500, 0, { button: 0 } as any);

    expect(tool.canConfirmQuote(issued)).toBe(true);
    expect(tool.canConfirmQuote({ ...issued })).toBe(false);
    expect(tool.canConfirmQuote({
      ...issued,
      freightSetId: 'aggregate-hopper-set',
    })).toBe(false);

    EventBus.emit('freight:purchase-result', {
      ok: false,
      blocker: 'live-placement-failed',
    });
    expect(tool.canConfirmQuote(issued)).toBe(false);
  });

  it('re-quotes a stale placement only for the currently selected set', () => {
    trackManager.getClosestTrack.mockReturnValue(makeTrack(scene));
    quote
      .mockReturnValueOnce(makeQuote(
        null,
        0,
        'covered-cement-set',
      ))
      .mockReturnValueOnce(Object.freeze(makeQuote(
        null,
        1,
        'covered-cement-set',
      )));
    expect(tool.setFreightSetId('covered-cement-set')).toBe(true);
    tool.onPointerDown(-500, 0, { button: 0 } as any);

    EventBus.emit('freight:purchase-result', {
      ok: false,
      blocker: 'stale-revision',
    });

    expect(quote).toHaveBeenLastCalledWith(expect.objectContaining({
      freightSetId: 'covered-cement-set',
    }));
    expect(tool.canConfirmQuote(
      quote.mock.results[1].value,
    )).toBe(true);
  });

  it('clears its result listener on destroy', () => {
    const off = jest.spyOn(EventBus, 'off');

    tool.destroy();

    expect(off).toHaveBeenCalledWith(
      'freight:purchase-result',
      expect.any(Function),
    );
    tool = new PlaceVehicleTool(
      scene,
      trackManager,
      trainManager,
      undefined,
      quoteService,
    );
  });
});
