import { EventBus } from '../../src/services/EventBus';
import type {
  FreightPurchaseQuote,
  FreightPurchaseResult,
} from '../../src/freight/FreightPurchaseService';
import type {
  FreightPurchaseDto,
  OperatingSummaryDto,
  TrainInspectionDto,
} from '../../src/freight/FreightPresentation';
import type { FirstRouteObjectiveDto } from '../../src/freight/FirstRouteObjective';
import type { FreightDeliveryEvent } from '../../src/freight/CargoSystem';

// Re-import to reset singleton state between tests via module re-evaluation
// EventBus is a singleton, so we test it directly but clear listeners each time.

describe('EventBus', () => {
  afterEach(() => {
    // Remove all listeners by emitting with no active ones; we do this by
    // calling off for each registered callback.
  });

  it('calls listener when event is emitted', () => {
    const cb = jest.fn();
    EventBus.on('game:paused', cb);
    EventBus.emit('game:paused', {});
    expect(cb).toHaveBeenCalledWith({});
    EventBus.off('game:paused', cb);
  });

  it('does not call listener after off()', () => {
    const cb = jest.fn();
    EventBus.on('game:resumed', cb);
    EventBus.off('game:resumed', cb);
    EventBus.emit('game:resumed', {});
    expect(cb).not.toHaveBeenCalled();
  });

  it('supports multiple listeners for the same event', () => {
    const cb1 = jest.fn();
    const cb2 = jest.fn();
    EventBus.on('game:paused', cb1);
    EventBus.on('game:paused', cb2);
    EventBus.emit('game:paused', {});
    expect(cb1).toHaveBeenCalled();
    expect(cb2).toHaveBeenCalled();
    EventBus.off('game:paused', cb1);
    EventBus.off('game:paused', cb2);
  });

  it('passes typed payload to listener', () => {
    const cb = jest.fn();
    EventBus.on('train:derailed', cb);
    EventBus.emit('train:derailed', { trainId: 'train-abc' });
    expect(cb).toHaveBeenCalledWith({ trainId: 'train-abc' });
    EventBus.off('train:derailed', cb);
  });

  it('does not throw if off() is called for an event with no listeners', () => {
    const cb = jest.fn();
    expect(() => EventBus.off('game:over', cb)).not.toThrow();
  });

  it('does not throw if emit() is called for an event with no listeners', () => {
    expect(() => EventBus.emit('game:paused', {})).not.toThrow();
  });

  it('handles junction:toggled event with full payload', () => {
    const cb = jest.fn();
    EventBus.on('junction:toggled', cb);
    EventBus.emit('junction:toggled', { junctionId: 'j1', state: 'left' });
    expect(cb).toHaveBeenCalledWith({ junctionId: 'j1', state: 'left' });
    EventBus.off('junction:toggled', cb);
  });

  it('handles passenger:delivered event', () => {
    const cb = jest.fn();
    EventBus.on('passenger:delivered', cb);
    EventBus.emit('passenger:delivered', { stationId: 'st1', count: 5 });
    expect(cb).toHaveBeenCalledWith({ stationId: 'st1', count: 5 });
    EventBus.off('passenger:delivered', cb);
  });

  it('handles objective:completed event', () => {
    const cb = jest.fn();
    EventBus.on('objective:completed', cb);
    EventBus.emit('objective:completed', { objectiveId: 'obj1', score: 500 });
    expect(cb).toHaveBeenCalledWith({ objectiveId: 'obj1', score: 500 });
    EventBus.off('objective:completed', cb);
  });

  it('handles objective:failed event', () => {
    const cb = jest.fn();
    EventBus.on('objective:failed', cb);
    EventBus.emit('objective:failed', { objectiveId: 'obj2' });
    expect(cb).toHaveBeenCalledWith({ objectiveId: 'obj2' });
    EventBus.off('objective:failed', cb);
  });

  it('handles level:complete event', () => {
    const cb = jest.fn();
    EventBus.on('level:complete', cb);
    EventBus.emit('level:complete', { levelId: 'level_01', score: 1000 });
    expect(cb).toHaveBeenCalledWith({ levelId: 'level_01', score: 1000 });
    EventBus.off('level:complete', cb);
  });

  it('handles train:selected and train:deselected events', () => {
    const sel = jest.fn();
    const desel = jest.fn();
    EventBus.on('train:selected', sel);
    EventBus.on('train:deselected', desel);
    EventBus.emit('train:selected', { trainId: 't1' });
    EventBus.emit('train:deselected', {});
    expect(sel).toHaveBeenCalledWith({ trainId: 't1' });
    expect(desel).toHaveBeenCalledWith({});
    EventBus.off('train:selected', sel);
    EventBus.off('train:deselected', desel);
  });

  it('removes only the specified listener when multiple are registered', () => {
    const cb1 = jest.fn();
    const cb2 = jest.fn();
    EventBus.on('game:over', cb1);
    EventBus.on('game:over', cb2);
    EventBus.off('game:over', cb1);
    EventBus.emit('game:over', { won: true, score: 100 });
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalled();
    EventBus.off('game:over', cb2);
  });

  it('handles audio events', () => {
    const sfx = jest.fn();
    const bgm = jest.fn();
    EventBus.on('audio:play-sfx', sfx);
    EventBus.on('audio:play-bgm', bgm);
    EventBus.emit('audio:play-sfx', { key: 'click' });
    EventBus.emit('audio:play-bgm', { key: 'menu_music' });
    expect(sfx).toHaveBeenCalledWith({ key: 'click' });
    expect(bgm).toHaveBeenCalledWith({ key: 'menu_music' });
    EventBus.off('audio:play-sfx', sfx);
    EventBus.off('audio:play-bgm', bgm);
  });

  it('round-trips the typed frozen freight quote and purchase result payloads', () => {
    const quote: FreightPurchaseQuote = Object.freeze({
      expectedRevision: 7,
      freightSetId: 'timber-freight-set',
      trackUUID: 'forest-route',
      trackT: 0.125,
      facing: -1,
      purchasePrice: 90_000,
      cashAfter: 210_000,
      affordable: true,
      valid: true,
      blocker: null,
    });
    const result: FreightPurchaseResult = Object.freeze({
      ok: true,
      trainId: 'timber-7',
      saved: false,
      saveState: 'unsaved',
    });
    const stateListener = jest.fn();
    const confirmedListener = jest.fn();
    const resultListener = jest.fn();
    EventBus.on('ui:freight-purchase-state', stateListener);
    EventBus.on('freight:purchase-confirmed', confirmedListener);
    EventBus.on('freight:purchase-result', resultListener);

    EventBus.emit('ui:freight-purchase-state', {
      quote,
      cash: 300_000,
      message: 'Review placement',
    });
    EventBus.emit('freight:purchase-confirmed', { quote });
    EventBus.emit('freight:purchase-result', result);

    expect(stateListener).toHaveBeenCalledWith({
      quote,
      cash: 300_000,
      message: 'Review placement',
    });
    expect(confirmedListener).toHaveBeenCalledWith({ quote });
    expect(resultListener).toHaveBeenCalledWith(result);

    EventBus.off('ui:freight-purchase-state', stateListener);
    EventBus.off('freight:purchase-confirmed', confirmedListener);
    EventBus.off('freight:purchase-result', resultListener);
  });

  it('round-trips the timber-only purchase mode request', () => {
    const listener = jest.fn();
    EventBus.on('freight:purchase-mode-requested', listener);

    EventBus.emit('freight:purchase-mode-requested', {
      freightSetId: 'timber-freight-set',
    });

    expect(listener).toHaveBeenCalledWith({
      freightSetId: 'timber-freight-set',
    });
    EventBus.off('freight:purchase-mode-requested', listener);
  });

  it('round-trips detached freight inspection, objective, company summary, and delivery payloads', () => {
    const transfer = Object.freeze({
      trainId: 'train-1',
      facilityId: 'sawmill',
      kind: 'unloading' as const,
      blocker: null,
      batchUnits: 4,
      cargoUnits: 40,
      capacityUnits: 60,
      batchRevenue: 500,
    });
    const inspection: TrainInspectionDto = Object.freeze({
      trainId: 'train-1',
      displayName: 'Timber Freight Set',
      direction: 'forward',
      throttle: 1,
      movementState: 'stopped',
      cargo: Object.freeze({
        productLabel: 'Logs',
        units: 40,
        capacityUnits: 60,
        text: 'Logs 40 / 60 t',
      }),
      nearestEligibleFacility: 'Sawmill',
      transfer,
      currentTrip: Object.freeze({
        revenue: 500,
        runningCost: 100,
        operatingProfit: 400,
      }),
      lastDelivery: Object.freeze({
        revenue: 1_000,
        runningCost: 250,
        operatingProfit: 750,
      }),
      lifetime: Object.freeze({
        deliveredUnits: 60,
        revenue: 1_000,
        runningCost: 250,
        operatingProfit: 750,
      }),
    });
    const objective: FirstRouteObjectiveDto = Object.freeze({
      objectiveVersion: 1,
      achieved: false,
      steps: Object.freeze([Object.freeze({
        id: 'connect-route',
        label: 'Connect the route',
        state: 'current',
      })]),
    });
    const operatingSummary: OperatingSummaryDto = Object.freeze({
      fromTick: 1,
      throughTick: 24,
      deliveryRevenue: 1_000,
      contractBonuses: 0,
      runningExpenses: 250,
      operatingProfit: 750,
      capitalExpenditure: 0,
      cashFlow: 750,
    });
    const delivery: FreightDeliveryEvent = Object.freeze({
      trainId: 'train-1',
      destinationFacilityId: 'sawmill',
      tick: 24,
      revenue: 1_000,
      runningCost: 250,
      operatingProfit: 750,
    });
    const purchase: FreightPurchaseDto = Object.freeze({
      freightSetId: 'timber-freight-set',
      displayName: 'Timber Freight Set',
      price: 90_000,
      compatibleCargoLabel: 'Logs',
      capacityLabel: '60 tonnes',
      runningCostLabel: '£20 / active tick',
      cashAfter: 10_000,
      affordable: true,
      validPlacement: true,
      remedy: '',
    });
    expect(purchase.validPlacement).toBe(true);

    const trainListener = jest.fn();
    const objectiveListener = jest.fn();
    const companyListener = jest.fn();
    const deliveryListener = jest.fn();
    EventBus.on('ui:train-inspection', trainListener);
    EventBus.on('ui:first-route-objective', objectiveListener);
    EventBus.on('ui:company-state', companyListener);
    EventBus.on('ui:freight-delivery-completed', deliveryListener);

    EventBus.emit('ui:train-inspection', { inspection });
    EventBus.emit('ui:first-route-objective', objective);
    EventBus.emit('ui:company-state', {
      cash: 100_000,
      saveState: 'saved',
      economyTick: 24,
      constructionIndexBps: 10_000,
      operatingSummary,
    });
    EventBus.emit('ui:freight-delivery-completed', delivery);

    expect(trainListener).toHaveBeenCalledWith({ inspection });
    expect(objectiveListener).toHaveBeenCalledWith(objective);
    expect(companyListener).toHaveBeenCalledWith(expect.objectContaining({
      operatingSummary,
    }));
    expect(deliveryListener).toHaveBeenCalledWith(delivery);

    EventBus.off('ui:train-inspection', trainListener);
    EventBus.off('ui:first-route-objective', objectiveListener);
    EventBus.off('ui:company-state', companyListener);
    EventBus.off('ui:freight-delivery-completed', deliveryListener);
  });
});
