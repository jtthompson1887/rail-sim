/**
 * @jest-environment jsdom
 */
import { EventBus } from '../../src/services/EventBus';
import { VehiclePurchasePanel } from '../../src/ui/VehiclePurchasePanel';
import {
  FreightPurchaseService,
  type FreightPurchaseQuote,
  type FreightPurchaseSetId,
} from '../../src/freight/FreightPurchaseService';
import { WorldManager } from '../../src/managers/WorldManager';
import { makeFirstFreightRouteWorld } from '../fixtures/FirstFreightRouteFixture';
import { clonePlainData } from '../../src/utils/PlainData';
import { isGameplayInputFocused } from '../../src/systems/InputManager';

const quote = (
  freightSetId: FreightPurchaseSetId = 'flatbed-freight-set',
  purchasePrice = 90_000,
): FreightPurchaseQuote => ({
  expectedRevision: 4,
  freightSetId,
  trackUUID: 'forest-sawmill-track',
  trackT: 0.1,
  facing: 1 as const,
  purchasePrice,
  cashAfter: 200_000 - purchasePrice,
  affordable: true,
  valid: true,
  blocker: null,
});

describe('VehiclePurchasePanel', () => {
  let panel: VehiclePurchasePanel;

  beforeEach(() => {
    document.body.innerHTML = '';
    panel = new VehiclePurchasePanel();
  });

  afterEach(() => {
    panel.destroy();
    document.body.innerHTML = '';
    WorldManager.reset();
    localStorage.clear();
    jest.restoreAllMocks();
  });

  it('clears stale confirmation on a flatbed mode request then emits its new frozen quote', () => {
    const mode = jest.fn();
    const confirmed = jest.fn();
    EventBus.on('freight:purchase-mode-requested', mode);
    EventBus.on('freight:purchase-confirmed', confirmed);
    const displayedQuote = quote();

    panel.setState({
      quote: displayedQuote,
      cash: 200_000,
      message: '',
    });
    const root = document.querySelector(
      '[data-testid="vehicle-purchase-panel"]',
    ) as HTMLElement;
    expect(root.textContent).toContain('General Flatbed Set');
    expect(root.textContent).toContain('£90,000');
    expect(root.textContent).toContain('60 tonnes');
    expect(root.textContent).toContain('Logs · Structural Timber');
    expect(root.textContent).toContain('£20 / active tick');
    expect(root.textContent).toContain('Cash after £110,000');
    expect(root.querySelectorAll(
      '[data-testid="flatbed-freight-set-buy"]',
    )).toHaveLength(1);

    (root.querySelector(
      '[data-testid="flatbed-freight-set-buy"]',
    ) as HTMLButtonElement).click();
    const confirm = root.querySelector(
      '[data-testid="freight-purchase-confirm"]',
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    confirm.click();
    expect(confirmed).not.toHaveBeenCalled();

    panel.setState({
      freightSetId: 'flatbed-freight-set',
      quote: displayedQuote,
      cash: 200_000,
      message: '',
    });
    confirm.click();

    expect(mode).toHaveBeenCalledWith({
      freightSetId: 'flatbed-freight-set',
    });
    expect(confirmed).toHaveBeenCalledTimes(1);
    const emittedQuote = confirmed.mock.calls[0][0].quote;
    expect(emittedQuote).toBe(displayedQuote);
    expect(Object.isFrozen(emittedQuote)).toBe(true);

    EventBus.off('freight:purchase-mode-requested', mode);
    EventBus.off('freight:purchase-confirmed', confirmed);
  });

  it('confirms the exact service-issued quote so the real purchase accepts its provenance', () => {
    const world = WorldManager.createNew(
      'Panel provenance',
      'panel-provenance',
    );
    const fixture = makeFirstFreightRouteWorld();
    world.tracks = clonePlainData(fixture.tracks);
    world.economy = clonePlainData(fixture.economy);
    world.trains = [];
    const service = new FreightPurchaseService(
      WorldManager,
      {
        spawn: (trainId) => ({ getUUID: () => trainId } as any),
        place: () => true,
        remove: jest.fn(),
      },
      () => 'panel-purchased-train',
    );
    jest.spyOn(WorldManager, 'save').mockReturnValue(true);
    const issued = service.quote({
      freightSetId: 'flatbed-freight-set',
      trackUUID: 'forest-sawmill-track',
      trackT: 0,
      x: -500,
      y: 0,
      topology: [{
        kind: 'track',
        uuid: 'forest-sawmill-track',
        previous: null,
        next: null,
      }],
    });
    let confirmedQuote: typeof issued | undefined;
    let result: ReturnType<FreightPurchaseService['purchase']> | undefined;
    const listener = ({ quote: candidate }: { quote: typeof issued }) => {
      confirmedQuote = candidate;
      result = service.purchase(candidate);
    };
    EventBus.on('freight:purchase-confirmed', listener);
    panel.setState({
      quote: issued,
      cash: world.company.cash,
      message: '',
    });

    (document.querySelector(
      '[data-testid="freight-purchase-confirm"]',
    ) as HTMLButtonElement).click();

    expect(confirmedQuote).toBe(issued);
    expect(result).toEqual({
      ok: true,
      trainId: 'panel-purchased-train',
      saved: true,
      saveState: 'saved',
    });
    EventBus.off('freight:purchase-confirmed', listener);
  });

  it('renders three deterministic accessible SKU choices and clears confirmation when the selection changes', () => {
    const mode = jest.fn();
    const confirmed = jest.fn();
    EventBus.on('freight:purchase-mode-requested', mode);
    EventBus.on('freight:purchase-confirmed', confirmed);
    panel.setState({
      freightSetId: 'flatbed-freight-set',
      quote: quote(),
      cash: 200_000,
      message: '',
    });
    const root = document.querySelector(
      '[data-testid="vehicle-purchase-panel"]',
    ) as HTMLElement;
    const flatbed = root.querySelector(
      '[data-testid="flatbed-freight-set-buy"]',
    ) as HTMLButtonElement;
    const aggregate = root.querySelector(
      '[data-testid="aggregate-hopper-set-buy"]',
    ) as HTMLButtonElement;
    const cement = root.querySelector(
      '[data-testid="covered-cement-set-buy"]',
    ) as HTMLButtonElement;
    const confirm = root.querySelector(
      '[data-testid="freight-purchase-confirm"]',
    ) as HTMLButtonElement;

    expect(flatbed.textContent).toContain('General Flatbed Set');
    expect(flatbed.textContent).toContain('£90,000');
    expect(flatbed.textContent).toContain('60 tonnes');
    expect(flatbed.textContent).toContain('Logs · Structural Timber');
    expect(flatbed.textContent).toContain('£20 / active tick');
    expect(aggregate.textContent).toContain('Aggregate Hopper Set');
    expect(aggregate.textContent).toContain('£110,000');
    expect(aggregate.textContent).toContain('120 tonnes');
    expect(aggregate.textContent).toContain('Limestone Aggregate');
    expect(cement.textContent).toContain('Covered Cement Set');
    expect(cement.textContent).toContain('£105,000');
    expect(cement.textContent).toContain('80 tonnes');
    expect(cement.textContent).toContain('Cement');
    expect([flatbed, aggregate, cement].map(
      (button) => [button.tagName, button.type, button.tabIndex],
    )).toEqual([
      ['BUTTON', 'button', 0],
      ['BUTTON', 'button', 0],
      ['BUTTON', 'button', 0],
    ]);
    expect([flatbed, aggregate, cement].map(
      (button) => button?.getAttribute('aria-pressed'),
    )).toEqual(['true', 'false', 'false']);

    aggregate.click();

    expect(mode).toHaveBeenCalledWith({
      freightSetId: 'aggregate-hopper-set',
    });
    expect([flatbed, aggregate, cement].map(
      (button) => button.getAttribute('aria-pressed'),
    )).toEqual(['false', 'true', 'false']);
    expect(confirm.disabled).toBe(true);
    confirm.click();
    expect(confirmed).not.toHaveBeenCalled();

    EventBus.off('freight:purchase-mode-requested', mode);
    EventBus.off('freight:purchase-confirmed', confirmed);
  });

  it('confirms only the exact matching selected-set quote', () => {
    const confirmed = jest.fn();
    EventBus.on('freight:purchase-confirmed', confirmed);
    const aggregateQuote = quote('aggregate-hopper-set', 110_000);
    panel.setState({
      freightSetId: 'aggregate-hopper-set',
      quote: aggregateQuote,
      cash: 200_000,
      message: '',
    });
    const confirm = document.querySelector(
      '[data-testid="freight-purchase-confirm"]',
    ) as HTMLButtonElement;

    confirm.click();
    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(confirmed.mock.calls[0][0].quote).toBe(aggregateQuote);
    expect(Object.isFrozen(confirmed.mock.calls[0][0].quote)).toBe(true);

    panel.setState({
      freightSetId: 'covered-cement-set',
      quote: aggregateQuote,
      cash: 200_000,
      message: '',
    });
    expect(confirm.disabled).toBe(true);
    confirm.click();
    expect(confirmed).toHaveBeenCalledTimes(1);
    EventBus.off('freight:purchase-confirmed', confirmed);
  });

  it('releases confirm focus after submitting a valid purchase', () => {
    panel.setState({
      quote: quote(),
      cash: 200_000,
      message: '',
    });
    const confirm = document.querySelector(
      '[data-testid="freight-purchase-confirm"]',
    ) as HTMLButtonElement;
    confirm.focus();
    expect(document.activeElement).toBe(confirm);
    expect(isGameplayInputFocused()).toBe(true);

    confirm.click();
    EventBus.emit('freight:purchase-result', {
      ok: false,
      blocker: 'stale-revision',
    });
    expect(document.activeElement).toBe(confirm);
    expect(isGameplayInputFocused()).toBe(true);
    EventBus.emit('freight:purchase-result', {
      ok: true,
      trainId: 'focus-release-train',
      saved: true,
      saveState: 'saved',
    });

    expect(document.activeElement).not.toBe(confirm);
    expect(isGameplayInputFocused()).toBe(false);
  });

  it('shows the exact remedy, affordability, and bounded mobile layout', () => {
    Object.defineProperty(window, 'innerWidth', {
      value: 375,
      configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', {
      value: 667,
      configurable: true,
    });
    window.dispatchEvent(new Event('resize'));
    panel.setState({
      quote: {
        ...quote(),
        cashAfter: -10_000,
        affordable: false,
        valid: false,
        blocker: 'insufficient-cash',
      },
      cash: 80_000,
      message: 'Insufficient cash for General Flatbed Set',
    });
    const root = document.querySelector(
      '[data-testid="vehicle-purchase-panel"]',
    ) as HTMLElement;
    const confirm = root.querySelector(
      '[data-testid="freight-purchase-confirm"]',
    ) as HTMLButtonElement;

    expect(root.dataset.layout).toBe('mobile');
    expect(root.style.left).toBe('56px');
    expect(root.style.right).toBe('8px');
    expect(root.style.maxHeight).not.toBe('');
    expect(root.textContent).toContain(
      'Insufficient cash for General Flatbed Set',
    );
    expect(confirm.disabled).toBe(true);

    Object.defineProperty(window, 'innerWidth', {
      value: 667,
      configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', {
      value: 375,
      configurable: true,
    });
    window.dispatchEvent(new Event('resize'));
    expect(root.style.left).toBe('calc(28px + 50vw)');
    expect(root.style.right).toBe('8px');
  });

  it('blocks pointer propagation, participates in hit testing, and removes listeners on destroy', () => {
    const root = document.querySelector(
      '[data-testid="vehicle-purchase-panel"]',
    ) as HTMLElement;
    root.getBoundingClientRect = () => ({
      left: 10, right: 300, top: 20, bottom: 500,
      x: 10, y: 20, width: 290, height: 480,
      toJSON: () => ({}),
    });
    const bubbled = jest.fn();
    document.body.addEventListener('pointerdown', bubbled);
    root.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(bubbled).not.toHaveBeenCalled();
    expect(panel.containsScreenPoint(100, 100)).toBe(true);

    panel.destroy();
    EventBus.emit('ui:freight-purchase-state', {
      freightSetId: 'flatbed-freight-set',
      quote: quote(),
      cash: 200_000,
      message: '',
    });
    expect(document.querySelector(
      '[data-testid="vehicle-purchase-panel"]',
    )).toBeNull();
    document.body.removeEventListener('pointerdown', bubbled);
  });
});
