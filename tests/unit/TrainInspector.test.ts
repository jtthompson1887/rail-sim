/**
 * @jest-environment jsdom
 */
import type { CargoBlocker } from '../../src/freight/CargoSystem';
import type { TrainInspectionDto } from '../../src/freight/FreightPresentation';
import { EventBus } from '../../src/services/EventBus';
import { TrainInspector } from '../../src/ui/TrainInspector';

const inspection = (
  blocker: CargoBlocker | null = null,
): TrainInspectionDto => Object.freeze({
  trainId: 'train-1',
  displayName: 'General Flatbed Set',
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
  transfer: Object.freeze({
    trainId: 'train-1',
    facilityId: 'sawmill',
    kind: blocker ? 'blocked' : 'unloading',
    blocker,
    batchUnits: 6,
    cargoUnits: 40,
    capacityUnits: 60,
    batchRevenue: 640,
  }),
  currentTrip: Object.freeze({
    revenue: 900,
    runningCost: 140,
    operatingProfit: 760,
  }),
  lastDelivery: Object.freeze({
    revenue: 1_200,
    runningCost: 320,
    operatingProfit: 880,
  }),
  lifetime: Object.freeze({
    deliveredUnits: 120,
    revenue: 3_600,
    runningCost: 820,
    operatingProfit: 2_780,
  }),
});

describe('TrainInspector', () => {
  let panel: TrainInspector;

  beforeEach(() => {
    document.body.innerHTML = '';
    panel = new TrainInspector();
    panel.setVisible(true);
  });

  afterEach(() => {
    panel.destroy();
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  it('renders selected train state, textual/ARIA progress, and operating figures', () => {
    EventBus.emit('ui:train-inspection', { inspection: inspection() });
    const root = document.querySelector(
      '[data-testid="train-inspector"]',
    ) as HTMLElement;
    const cargo = root.querySelector(
      '[data-testid="train-cargo-progress"]',
    ) as HTMLProgressElement;
    const batch = root.querySelector(
      '[data-testid="train-transfer-progress"]',
    ) as HTMLProgressElement;

    expect(root.getAttribute('aria-hidden')).toBe('false');
    expect(root.textContent).toContain('General Flatbed Set');
    expect(root.textContent).toContain('Forward · stopped');
    expect(root.textContent).toContain('Logs 40 / 60 t');
    expect(root.textContent).toContain('Nearest eligible: Sawmill');
    expect(root.textContent).toContain('Batch 6 / 10 t');
    expect(root.textContent).toContain('Current trip');
    expect(root.textContent).toContain('£760');
    expect(root.textContent).toContain('Last delivery');
    expect(root.textContent).toContain('Lifetime');
    expect(cargo.value).toBe(40);
    expect(cargo.max).toBe(60);
    expect(cargo.getAttribute('aria-label')).toBe('Cargo Logs 40 of 60 tonnes');
    expect(batch.value).toBe(6);
    expect(batch.max).toBe(10);
    expect(batch.getAttribute('aria-label')).toBe(
      'Cargo transfer batch 6 of 10 tonnes',
    );
  });

  it.each([
    'Stop the train to transfer cargo',
    'Move inside Managed Forest rail access',
    'Move inside Sawmill rail access',
    'Waiting for logs',
    'Timber set is full',
    'Sawmill input storage is full',
    'Cargo is not accepted here',
    'Insufficient cash for running costs',
    'Re-rail the train before operating',
  ] as const)('renders the exact blocker copy: %s', (blocker) => {
    panel.setState(inspection(blocker));
    expect(document.querySelector(
      '[data-testid="train-transfer-status"]',
    )?.textContent).toBe(blocker);
  });

  it('emits safe mobile throttle controls and stops their pointer gestures', () => {
    panel.setState(inspection());
    const values: number[] = [];
    const listener = ({ value }: { value: number }) => values.push(value);
    EventBus.on('mobile:throttle', listener);
    const root = document.querySelector(
      '[data-testid="train-inspector"]',
    ) as HTMLElement;
    const bubbled = jest.fn();
    document.body.addEventListener('pointerdown', bubbled);

    for (const value of [-1, 0, 1]) {
      const button = root.querySelector(
        `[data-throttle="${value}"]`,
      ) as HTMLButtonElement;
      button.focus();
      button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      button.click();
      expect(document.activeElement).not.toBe(button);
    }

    expect(values).toEqual([-1, 0, 1]);
    expect(bubbled).not.toHaveBeenCalled();
    EventBus.off('mobile:throttle', listener);
    document.body.removeEventListener('pointerdown', bubbled);
  });

  it('keeps one throttle button alive across multiframe state updates and emits once on click', async () => {
    panel.setState(inspection());
    const values: number[] = [];
    const listener = ({ value }: { value: number }) => values.push(value);
    EventBus.on('mobile:throttle', listener);
    const root = document.querySelector(
      '[data-testid="train-inspector"]',
    ) as HTMLElement;
    const pressed = root.querySelector(
      '[data-throttle="1"]',
    ) as HTMLButtonElement;

    pressed.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await Promise.resolve();
    EventBus.emit('ui:train-inspection', {
      inspection: inspection('Stop the train to transfer cargo'),
    });
    await Promise.resolve();
    EventBus.emit('ui:train-inspection', {
      inspection: inspection(),
    });
    await Promise.resolve();

    expect(root.querySelector('[data-throttle="1"]')).toBe(pressed);
    pressed.click();
    expect(values).toEqual([1]);
    EventBus.off('mobile:throttle', listener);
  });

  it('stays bounded at 375x667 and removes its exact listener on destroy', () => {
    Object.defineProperty(window, 'innerWidth', {
      value: 375,
      configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', {
      value: 667,
      configurable: true,
    });
    window.dispatchEvent(new Event('resize'));
    panel.setState(inspection());
    const root = document.querySelector(
      '[data-testid="train-inspector"]',
    ) as HTMLElement;
    expect(root.dataset.layout).toBe('mobile');
    expect(root.style.left).toBe('56px');
    expect(root.style.right).toBe('8px');
    expect(root.style.maxHeight).not.toBe('');

    panel.destroy();
    EventBus.emit('ui:train-inspection', { inspection: inspection() });
    expect(document.querySelector(
      '[data-testid="train-inspector"]',
    )).toBeNull();
  });
});
