import {
  buildFreightPurchasePresentation,
  buildOperatingSummary,
  buildTrainInspection,
  formatCargoRemedy,
  formatFreightPurchaseRemedy,
} from '../../src/freight/FreightPresentation';
import type {
  OperatingSummaryDto,
} from '../../src/freight/FreightPresentation';
import { postLedgerEntry } from '../../src/economy/FinanceLedger';
import type { CompanyStateDef } from '../../src/economy/EconomyData';
import type { CargoTransferStatus } from '../../src/freight/CargoSystem';
import type { TrainRuntimeSnapshot } from '../../src/freight/TrainRuntime';
import {
  AGGREGATE_HOPPER_SET_ID,
  COVERED_CEMENT_SET_ID,
  FLATBED_FREIGHT_SET_ID,
} from '../../src/freight/FreightSetCatalog';
import { clonePlainData } from '../../src/utils/PlainData';
import {
  makeFirstFreightRouteWorld,
  makeFreightTrainDef,
} from '../fixtures/FirstFreightRouteFixture';

const post = (
  company: CompanyStateDef,
  tick: number,
  category:
    | 'delivery-revenue'
    | 'contract-bonus'
    | 'train-running-cost'
    | 'construction-capex'
    | 'vehicle-capex',
  magnitude: number,
): CompanyStateDef => {
  const result = postLedgerEntry(company, {
    tick,
    category,
    magnitude,
    referenceId: `${category}-${tick}`,
    direction: 'forward',
  });
  if (result.ok === false) throw new Error(result.code);
  return result.company;
};

const runtime = (
  overrides: Partial<TrainRuntimeSnapshot> = {},
): TrainRuntimeSnapshot => ({
  trainId: 'train-1',
  trackUUID: 'forest-sawmill-track',
  trackT: 0.9,
  facing: 1,
  x: 500,
  y: 0,
  speedWorldUnitsPerSecond: 2,
  throttle: 1,
  derailed: false,
  ...overrides,
});

const transfer = (
  overrides: Partial<CargoTransferStatus> = {},
): CargoTransferStatus => ({
  trainId: 'train-1',
  facilityId: 'sawmill',
  productId: 'logs',
  kind: 'unloading',
  blocker: null,
  batchUnits: 6,
  cargoUnits: 40,
  capacityUnits: 60,
  batchRevenue: 640,
  ...overrides,
});

describe('FreightPresentation', () => {
  it('requires every operating summary producer to report contract bonuses', () => {
    type ContractBonusesIsRequired =
      {} extends Pick<OperatingSummaryDto, 'contractBonuses'> ? false : true;
    const contractBonusesIsRequired: ContractBonusesIsRequired = true;

    expect(contractBonusesIsRequired).toBe(true);
  });

  it('builds one immutable flatbed purchase decision with exact commercial copy', () => {
    const quote = Object.freeze({
      expectedRevision: 7,
      freightSetId: 'flatbed-freight-set' as const,
      trackUUID: 'forest-sawmill-track',
      trackT: 0.1,
      facing: 1 as const,
      purchasePrice: 90_000 as const,
      cashAfter: 110_000,
      affordable: true,
      valid: false,
      blocker: 'outside-source-access' as const,
    });

    const dto = buildFreightPurchasePresentation(
      FLATBED_FREIGHT_SET_ID,
      quote,
      200_000,
    );

    expect(dto).toEqual({
      freightSetId: 'flatbed-freight-set',
      displayName: 'General Flatbed Set',
      price: 90_000,
      compatibleCargoLabel: 'Logs · Structural Timber',
      capacityLabel: '60 tonnes',
      runningCostLabel: '£20 / active tick',
      cashAfter: 110_000,
      affordable: true,
      validPlacement: false,
      remedy: 'Place inside Managed Forest rail access',
    });
    expect(Object.isFrozen(dto)).toBe(true);
  });

  it.each([
    [
      AGGREGATE_HOPPER_SET_ID,
      110_000,
      'Aggregate Hopper Set',
      'Limestone Aggregate',
      '120 tonnes',
      '£20 / active tick',
      'Place inside Quarry rail access',
    ],
    [
      COVERED_CEMENT_SET_ID,
      105_000,
      'Covered Cement Set',
      'Cement',
      '80 tonnes',
      '£22 / active tick',
      'Place inside Cement Works rail access',
    ],
  ] as const)(
    'builds one immutable %s purchase decision with exact commercial copy',
    (
      freightSetId,
      purchasePrice,
      displayName,
      compatibleCargoLabel,
      capacityLabel,
      runningCostLabel,
      remedy,
    ) => {
      const quote = Object.freeze({
        expectedRevision: 7,
        freightSetId,
        trackUUID: 'route-track',
        trackT: 0.1,
        facing: 1 as const,
        purchasePrice,
        cashAfter: 200_000 - purchasePrice,
        affordable: true,
        valid: false,
        blocker: 'outside-source-access' as const,
      });

      const dto = buildFreightPurchasePresentation(
        freightSetId,
        quote,
        200_000,
      );

      expect(dto).toEqual({
        freightSetId,
        displayName,
        price: purchasePrice,
        compatibleCargoLabel,
        capacityLabel,
        runningCostLabel,
        cashAfter: 200_000 - purchasePrice,
        affordable: true,
        validPlacement: false,
        remedy,
      });
      expect(Object.isFrozen(dto)).toBe(true);
    },
  );

  it.each([
    [
      FLATBED_FREIGHT_SET_ID,
      'Connect Managed Forest and Sawmill first',
    ],
    [
      AGGREGATE_HOPPER_SET_ID,
      'Connect Quarry and Cement Works first',
    ],
    [
      COVERED_CEMENT_SET_ID,
      'Connect Cement Works and Prefabrication Plant first',
    ],
  ] as const)(
    'formats the selected %s route remedy without duplicating route policy',
    (freightSetId, expected) => {
      expect(formatFreightPurchaseRemedy(
        'disconnected-route',
        freightSetId,
      )).toBe(expected);
    },
  );

  it('presents the selected set before a quote exists', () => {
    expect(buildFreightPurchasePresentation(
      AGGREGATE_HOPPER_SET_ID,
      null,
      200_000,
    )).toMatchObject({
      freightSetId: AGGREGATE_HOPPER_SET_ID,
      displayName: 'Aggregate Hopper Set',
      price: 110_000,
      cashAfter: 90_000,
      affordable: true,
      validPlacement: false,
    });
  });

  it('keeps an unknown purchase selection safe and inspectable', () => {
    const dto = buildFreightPurchasePresentation(
      'removed-set',
      null,
      200_000,
    );

    expect(dto).toEqual({
      freightSetId: 'removed-set',
      displayName: 'Unknown freight set',
      price: 0,
      compatibleCargoLabel: 'Cargo unavailable',
      capacityLabel: 'Capacity unavailable',
      runningCostLabel: 'Running cost unavailable',
      cashAfter: 200_000,
      affordable: false,
      validPlacement: false,
      remedy: 'Unknown freight set',
    });
    expect(JSON.stringify(dto)).not.toContain('undefined');
  });

  it('detaches selected train cargo, transfer, trip, delivery, and lifetime figures', () => {
    const world = makeFirstFreightRouteWorld();
    world.trains[0] = makeFreightTrainDef({
      cargo: {
        productId: 'logs',
        units: 40,
        loadedUnits: 40,
        originFacilityId: 'managed-forest',
      },
      operations: {
        currentTripRevenue: 900,
        currentTripRunningCost: 140,
        lastTripRevenue: 1_200,
        lastTripRunningCost: 320,
        lifetimeDeliveredUnits: 120,
        lifetimeRevenue: 3_600,
        lifetimeRunningCost: 820,
      },
    });
    const status = transfer();

    const dto = buildTrainInspection(world, runtime(), status);

    expect(dto).toEqual({
      trainId: 'train-1',
      displayName: 'General Flatbed Set',
      direction: 'forward',
      throttle: 1,
      movementState: 'stopped',
      cargo: {
        productLabel: 'Logs',
        unitLabel: 'tonnes',
        units: 40,
        capacityUnits: 60,
        text: 'Logs 40 / 60 t',
      },
      nearestEligibleFacility: 'Sawmill',
      transfer: status,
      transferRemedy: '',
      currentTrip: {
        revenue: 900,
        runningCost: 140,
        operatingProfit: 760,
      },
      lastDelivery: {
        revenue: 1_200,
        runningCost: 320,
        operatingProfit: 880,
      },
      lifetime: {
        deliveredUnits: 120,
        revenue: 3_600,
        runningCost: 820,
        operatingProfit: 2_780,
      },
    });
    expect(Object.isFrozen(dto)).toBe(true);
    expect(Object.isFrozen(dto?.cargo)).toBe(true);
    expect(Object.isFrozen(dto?.transfer)).toBe(true);
    expect(buildTrainInspection(
      world,
      runtime({ trainId: 'missing' }),
      transfer({ trainId: 'missing' }),
    )).toBeNull();
  });

  it.each([
    ['logs', 'Logs 40 / 60 t', 'Logs', 'tonnes'],
    [
      'structural-timber',
      'Structural Timber 40 / 60 t',
      'Structural Timber',
      'tonnes',
    ],
  ] as const)(
    'derives %s cargo name, units, and capacity from the catalogues',
    (productId, text, productLabel, unitLabel) => {
      const world = makeFirstFreightRouteWorld();
      world.trains[0] = makeFreightTrainDef({
        cargo: {
          productId,
          units: 40,
          loadedUnits: 40,
          originFacilityId: 'managed-forest',
        },
      });

      expect(buildTrainInspection(
        world,
        runtime(),
        transfer({ productId }),
      )?.cargo).toEqual({
        productLabel,
        unitLabel,
        units: 40,
        capacityUnits: 60,
        text,
      });
    },
  );

  it('uses the transfer product to give an empty compatible train useful capacity', () => {
    const world = makeFirstFreightRouteWorld();
    world.trains[0] = makeFreightTrainDef({ cargo: null });

    expect(buildTrainInspection(
      world,
      runtime({ x: -500 }),
      transfer({
        facilityId: 'managed-forest',
        productId: 'logs',
        kind: 'loading',
        cargoUnits: 0,
      }),
    )?.cargo).toEqual({
      productLabel: 'Empty',
      unitLabel: 'tonnes',
      units: 0,
      capacityUnits: 60,
      text: 'Empty 0 / 60 t',
    });
  });

  it('uses the first valid compatible catalogue product for an early empty status with no product yet', () => {
    const world = makeFirstFreightRouteWorld();
    world.trains[0] = makeFreightTrainDef({ cargo: null });

    expect(buildTrainInspection(
      world,
      runtime({ x: -500 }),
      transfer({
        facilityId: null,
        productId: null,
        kind: 'blocked',
        blocker: 'not-operating',
        cargoUnits: 0,
        capacityUnits: 0,
      }),
    )?.cargo).toEqual({
      productLabel: 'Empty',
      unitLabel: 'tonnes',
      units: 0,
      capacityUnits: 60,
      text: 'Empty 0 / 60 t',
    });
  });

  it('prefers the chosen transfer facility, then derives the nearest eligible facility by distance and ID', () => {
    const world = makeFirstFreightRouteWorld();
    const secondForest = clonePlainData(world.economy.facilities.find(
      ({ id }) => id === 'managed-forest',
    )!);
    secondForest.id = 'a-forest';
    secondForest.name = 'Nearest Forest';
    secondForest.railAccess = { x: -10, y: 0, radius: 120 };
    world.economy.facilities.push(secondForest);
    world.economy.facilities.find(
      ({ id }) => id === 'managed-forest',
    )!.railAccess = { x: 10, y: 0, radius: 120 };
    world.trains[0] = makeFreightTrainDef({ cargo: null });

    expect(buildTrainInspection(
      world,
      runtime({ x: 0, y: 0 }),
      transfer({
        facilityId: null,
        productId: 'logs',
        kind: 'blocked',
        blocker: 'not-operating',
        cargoUnits: 0,
      }),
    )?.nearestEligibleFacility).toBe('Nearest Forest');
    expect(buildTrainInspection(
      world,
      runtime({ x: 0, y: 0 }),
      transfer({
        facilityId: 'sawmill',
        productId: 'logs',
        kind: 'blocked',
        blocker: 'train-moving',
      }),
    )?.nearestEligibleFacility).toBe('Sawmill');
  });

  it('considers both recipe sources and destinations for a loaded train with an early blocker', () => {
    const world = makeFirstFreightRouteWorld();
    world.trains[0] = makeFreightTrainDef({
      cargo: {
        productId: 'logs',
        units: 40,
        loadedUnits: 40,
        originFacilityId: 'managed-forest',
      },
    });

    expect(buildTrainInspection(
      world,
      runtime({ x: -500, y: 0 }),
      transfer({
        facilityId: null,
        productId: 'logs',
        kind: 'blocked',
        blocker: 'not-operating',
      }),
    )?.nearestEligibleFacility).toBe('Managed Forest');
  });

  it.each([
    [
      'a full consignment',
      { units: 60, loadedUnits: 60, originFacilityId: 'managed-forest' },
      'Sawmill',
    ],
    [
      'a partially unloaded consignment',
      { units: 30, loadedUnits: 40, originFacilityId: 'managed-forest' },
      'Sawmill',
    ],
    [
      'a mismatched origin',
      { units: 40, loadedUnits: 40, originFacilityId: 'other-forest' },
      'Sawmill',
    ],
    [
      'a valid partial same-origin consignment',
      { units: 40, loadedUnits: 40, originFacilityId: 'managed-forest' },
      'Managed Forest',
    ],
  ] as const)('uses cargo authority when deriving facilities for %s', (
    _case,
    cargo,
    expected,
  ) => {
    const world = makeFirstFreightRouteWorld();
    world.trains[0] = makeFreightTrainDef({
      cargo: { productId: 'logs', ...cargo },
    });

    expect(buildTrainInspection(
      world,
      runtime({ x: -500, y: 0 }),
      transfer({
        facilityId: null,
        productId: 'logs',
        kind: 'blocked',
        blocker: 'not-operating',
      }),
    )?.nearestEligibleFacility).toBe(expected);
  });

  it.each([
    ['not-operating', 'Resume the game to transfer cargo'],
    ['derailed', 'Rerail the train to transfer cargo'],
    ['train-moving', 'Stop the train to transfer cargo'],
    ['unknown-freight-set', 'This train has no recognised freight set'],
    ['incompatible-product', 'General Flatbed Set cannot carry Logs'],
    ['outside-eligible-facility', 'Move inside Sawmill rail access'],
    ['source-empty', 'Sawmill has no Logs available'],
    ['train-full', 'General Flatbed Set is full of Logs'],
    ['destination-full', 'Sawmill Logs storage is full'],
    ['product-not-accepted', 'Sawmill does not accept Logs'],
    ['insufficient-running-cash', 'Add cash to cover train running costs'],
  ] as const)('formats the %s blocker in one product-aware presenter', (
    blocker,
    expected,
  ) => {
    expect(formatCargoRemedy(
      makeFirstFreightRouteWorld(),
      'flatbed-freight-set',
      transfer({ blocker, kind: 'blocked' }),
    )).toBe(expected);
  });

  it('keeps unknown catalogue references inspectable without leaking IDs or undefined', () => {
    const world = makeFirstFreightRouteWorld();
    world.trains[0] = {
      ...makeFreightTrainDef(),
      freightSetId: 'removed-set',
      cargo: {
        productId: 'removed-product',
        units: 4,
        loadedUnits: 4,
        originFacilityId: 'managed-forest',
      },
    };
    const dto = buildTrainInspection(
      world,
      runtime(),
      transfer({
        facilityId: 'removed-facility',
        productId: 'removed-product',
        blocker: 'unknown-freight-set',
        kind: 'blocked',
      }),
    );

    expect(dto).not.toBeNull();
    expect(dto?.displayName).toBe('Unknown freight set');
    expect(dto?.cargo).toEqual({
      productLabel: 'Unknown cargo',
      unitLabel: 'units',
      units: 4,
      capacityUnits: 0,
      text: 'Unknown cargo 4 / 0 units',
    });
    expect(dto?.nearestEligibleFacility).toBe('Unknown facility');
    expect(JSON.stringify(dto)).not.toMatch(
      /removed-set|removed-product|removed-facility|undefined/,
    );
  });

  it('exports the same purchase remedy used by the purchase panel and tool', () => {
    expect(formatFreightPurchaseRemedy(
      'outside-source-access',
      FLATBED_FREIGHT_SET_ID,
    ))
      .toBe('Place inside Managed Forest rail access');
    expect(formatFreightPurchaseRemedy(
      'world-install-failed',
      AGGREGATE_HOPPER_SET_ID,
    )).toBe('Aggregate Hopper Set purchase could not be completed');
  });

  it.each([
    [{ derailed: false, speedWorldUnitsPerSecond: 2 }, 'stopped'],
    [{ derailed: false, speedWorldUnitsPerSecond: 2.000001 }, 'moving'],
    [{ derailed: true, speedWorldUnitsPerSecond: 0 }, 'derailed'],
  ] as const)('uses the cargo speed boundary for %o', (change, expected) => {
    const dto = buildTrainInspection(
      makeFirstFreightRouteWorld(),
      runtime(change),
      transfer(),
    );
    expect(dto?.movementState).toBe(expected);
  });

  it('uses inclusive ticks 0..23 then 1..24 and includes current-tick entries', () => {
    const world = makeFirstFreightRouteWorld();
    let company = world.company;
    company = post(company, 0, 'delivery-revenue', 100);
    company = post(company, 23, 'delivery-revenue', 230);
    company = post(company, 24, 'delivery-revenue', 240);

    expect(buildOperatingSummary(company, 23)).toMatchObject({
      fromTick: 0,
      throughTick: 23,
      deliveryRevenue: 330,
      contractBonuses: 0,
      operatingProfit: 330,
    });
    expect(buildOperatingSummary(company, 24)).toMatchObject({
      fromTick: 1,
      throughTick: 24,
      deliveryRevenue: 470,
      contractBonuses: 0,
      operatingProfit: 470,
    });
  });

  it('separates development bonuses and capex from railway operating profit', () => {
    const world = makeFirstFreightRouteWorld();
    let company = world.company;
    company = post(company, 24, 'delivery-revenue', 1_000);
    company = post(company, 24, 'contract-bonus', 250_000);
    company = post(company, 24, 'train-running-cost', 300);
    company = post(company, 24, 'construction-capex', 2_000);

    expect(buildOperatingSummary(company, 24)).toEqual({
      fromTick: 1,
      throughTick: 24,
      deliveryRevenue: 1_000,
      contractBonuses: 250_000,
      runningExpenses: 300,
      operatingProfit: 700,
      capitalExpenditure: 2_000,
      cashFlow: 248_700,
    });
  });
});
