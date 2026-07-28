import { TrainSerializer } from '../../src/utils/TrainSerializer';
import type { TrainRuntimeSnapshot } from '../../src/freight/TrainRuntime';
import { makeFreightTrainDef } from '../fixtures/FirstFreightRouteFixture';

describe('TrainSerializer', () => {
  it('does not expose a legacy live-vehicle to authoritative-train serializer', () => {
    expect((TrainSerializer as any).toTrainDef).toBeUndefined();
  });

  it.each([1, -1] as const)(
    'merges runtime facing %s without losing authoritative cargo or operations',
    (facing) => {
      const authoritative = makeFreightTrainDef({
        id: 'freight-train',
        cargo: {
          productId: 'logs',
          units: 17,
          loadedUnits: 17,
          originFacilityId: 'managed-forest',
        },
        operations: {
          currentTripRevenue: 101,
          currentTripRunningCost: 102,
          lastTripRevenue: 103,
          lastTripRunningCost: 104,
          lifetimeDeliveredUnits: 105,
          lifetimeRevenue: 106,
          lifetimeRunningCost: 107,
        },
      });
      const runtime: TrainRuntimeSnapshot = {
        trainId: 'freight-train',
        trackUUID: 'track-b',
        trackT: 0.75,
        facing,
        x: 75,
        y: 0,
        speedWorldUnitsPerSecond: 0,
        throttle: 0,
        derailed: false,
      };

      const merged = TrainSerializer.mergeRuntime(authoritative, runtime)!;

      expect(merged).toEqual({
        ...authoritative,
        trackUUID: 'track-b',
        trackT: 0.75,
        facing,
      });
      expect(merged.cargo).toEqual(authoritative.cargo);
      expect(merged.cargo).not.toBe(authoritative.cargo);
      expect(merged.operations).toEqual(authoritative.operations);
      expect(merged.operations).not.toBe(authoritative.operations);
    },
  );

  it.each([
    {
      label: 'mismatched train ID',
      patch: { trainId: 'different-train' },
    },
    {
      label: 'missing track UUID',
      patch: { trackUUID: null },
    },
    {
      label: 'missing track position',
      patch: { trackT: null },
    },
    {
      label: 'track position below zero',
      patch: { trackT: -0.01 },
    },
    {
      label: 'track position above one',
      patch: { trackT: 1.01 },
    },
    {
      label: 'derailed runtime',
      patch: { derailed: true },
    },
  ])('rejects $label', ({ patch }) => {
    const authoritative = makeFreightTrainDef({ id: 'freight-train' });
    const runtime: TrainRuntimeSnapshot = {
      trainId: 'freight-train',
      trackUUID: 'track-a',
      trackT: 0.5,
      facing: 1,
      x: 50,
      y: 0,
      speedWorldUnitsPerSecond: 0,
      throttle: 0,
      derailed: false,
      ...patch,
    } as TrainRuntimeSnapshot;

    expect(TrainSerializer.mergeRuntime(authoritative, runtime)).toBeNull();
  });
});
