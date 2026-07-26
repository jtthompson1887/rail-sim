/**
 * @jest-environment jsdom
 */
import { EventBus } from '../../src/services/EventBus';
import { VehiclePurchasePanel } from '../../src/ui/VehiclePurchasePanel';

const quote = () => ({
  expectedRevision: 4,
  freightSetId: 'timber-freight-set' as const,
  trackUUID: 'forest-sawmill-track',
  trackT: 0.1,
  facing: 1 as const,
  purchasePrice: 90_000 as const,
  cashAfter: 110_000,
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
    jest.restoreAllMocks();
  });

  it('contains exactly one timber SKU and emits purchase mode then its frozen quote', () => {
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
    expect(root.textContent).toContain('Timber Freight Set');
    expect(root.textContent).toContain('£90,000');
    expect(root.textContent).toContain('60 tonnes');
    expect(root.textContent).toContain('Logs');
    expect(root.textContent).toContain('£20 / active tick');
    expect(root.textContent).toContain('Cash after £110,000');
    expect(root.querySelectorAll(
      '[data-testid="timber-freight-set-buy"]',
    )).toHaveLength(1);

    (root.querySelector(
      '[data-testid="timber-freight-set-buy"]',
    ) as HTMLButtonElement).click();
    (root.querySelector(
      '[data-testid="freight-purchase-confirm"]',
    ) as HTMLButtonElement).click();

    expect(mode).toHaveBeenCalledWith({
      freightSetId: 'timber-freight-set',
    });
    expect(confirmed).toHaveBeenCalledTimes(1);
    const emittedQuote = confirmed.mock.calls[0][0].quote;
    expect(emittedQuote).toEqual(displayedQuote);
    expect(emittedQuote).not.toBe(displayedQuote);
    expect(Object.isFrozen(emittedQuote)).toBe(true);

    EventBus.off('freight:purchase-mode-requested', mode);
    EventBus.off('freight:purchase-confirmed', confirmed);
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
      message: 'Insufficient cash for Timber Freight Set',
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
      'Insufficient cash for Timber Freight Set',
    );
    expect(confirm.disabled).toBe(true);
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
