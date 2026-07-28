/**
 * @jest-environment jsdom
 */
import { EventBus } from '../../src/services/EventBus';
import { CompanyHud } from '../../src/ui/CompanyHud';

const operatingSummary = {
  fromTick: 1,
  throughTick: 24,
  deliveryRevenue: 1_000,
  contractBonuses: 250_000,
  runningExpenses: 300,
  operatingProfit: 700,
  capitalExpenditure: 2_000,
  cashFlow: 248_700,
};

describe('CompanyHud', () => {
  let hud: CompanyHud;

  beforeEach(() => {
    document.body.innerHTML = '';
    hud = new CompanyHud();
  });

  afterEach(() => {
    hud.destroy();
    document.body.innerHTML = '';
  });

  it('shows authoritative cash and saved state after build, undo, redo, and load updates', () => {
    for (const state of [
      {
        cash: 1_000_000,
        saveState: 'saved' as const,
        economyTick: 0,
        constructionIndexBps: 10_000,
        operatingSummary,
      },
      {
        cash: 997_200,
        saveState: 'unsaved' as const,
        economyTick: 25,
        constructionIndexBps: 10_125,
        operatingSummary,
      },
    ]) {
      EventBus.emit('ui:company-state', state);
      expect(document.querySelector('[data-testid="company-cash"]')?.textContent)
        .toBe(`£${state.cash.toLocaleString('en-GB')}`);
      expect(document.querySelector('[data-testid="company-save-state"]')?.textContent)
        .toBe(state.saveState === 'saved' ? 'Saved' : 'Unsaved');
      expect(document.querySelector('[data-testid="company-economy-time"]')?.textContent)
        .toBe(state.economyTick === 0 ? 'Day 1 · Tick 0' : 'Day 2 · Tick 25');
      expect(document.querySelector('[data-testid="company-construction-index"]')?.textContent)
        .toBe(state.constructionIndexBps === 10_000
          ? 'Construction index 100.0'
          : 'Construction index 101.3');
    }
  });

  it('stays visible across create and operate while unsubscribing cleanly on destroy', () => {
    EventBus.emit('ui:company-state', {
      cash: 500,
      saveState: 'saved',
      economyTick: 4,
      constructionIndexBps: 9_900,
      operatingSummary,
    });
    hud.setVisible(true);
    expect(document.querySelector('[data-testid="company-hud"]')
      ?.getAttribute('aria-hidden')).toBe('false');
    hud.setVisible(false);
    expect(document.querySelector('[data-testid="company-hud"]')
      ?.getAttribute('aria-hidden')).toBe('true');

    hud.destroy();
    EventBus.emit('ui:company-state', {
      cash: 250,
      saveState: 'unsaved',
      economyTick: 5,
      constructionIndexBps: 9_875,
      operatingSummary,
    });
    expect(document.querySelector('[data-testid="company-hud"]')).toBeNull();
  });

  it('uses border-box mobile insets that cannot exceed a 375px viewport', () => {
    hud.destroy();
    Object.defineProperty(window, 'innerWidth', {
      value: 375,
      configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', {
      value: 667,
      configurable: true,
    });
    hud = new CompanyHud();
    const root = document.querySelector(
      '[data-testid="company-hud"]',
    ) as HTMLElement;

    expect(root.dataset.layout).toBe('mobile');
    expect(root.style.boxSizing).toBe('border-box');
    expect(root.style.left).toBe('56px');
    expect(root.style.right).toBe('96px');
    expect(root.style.width).toBe('auto');
  });

  it('shows the inclusive operating summary with stable selectors', () => {
    EventBus.emit('ui:company-state', {
      cash: 100_000,
      saveState: 'saved',
      economyTick: 24,
      constructionIndexBps: 10_000,
      operatingSummary,
    });

    expect(document.querySelector(
      '[data-testid="company-operating-period"]',
    )?.textContent).toBe('Last 24 ticks');
    expect(document.querySelector(
      '[data-testid="company-delivery-revenue"]',
    )?.textContent).toBe('Deliveries £1,000');
    expect(document.querySelector(
      '[data-testid="company-contract-bonuses"]',
    )?.textContent).toBe('Development £250,000');
    expect(document.querySelector(
      '[data-testid="company-running-expenses"]',
    )?.textContent).toBe('Running £300');
    expect(document.querySelector(
      '[data-testid="company-operating-profit"]',
    )?.textContent).toBe('Rail profit £700');
    expect(document.querySelector(
      '[data-testid="company-operating-profit"]',
    )?.getAttribute('data-tone')).toBe('profit');
    expect(document.querySelector(
      '[data-testid="company-capital-expenditure"]',
    )?.textContent).toBe('Capex £2,000');
    expect(document.querySelector(
      '[data-testid="company-cash-flow"]',
    )?.textContent).toBe('Cash flow £248,700');
  });

  it.each([
    [500, 'profit'],
    [-500, 'loss'],
    [0, 'neutral'],
  ] as const)('marks rail profit %s with the %s tone', (
    operatingProfit,
    tone,
  ) => {
    EventBus.emit('ui:company-state', {
      cash: 100_000,
      saveState: 'saved',
      economyTick: 24,
      constructionIndexBps: 10_000,
      operatingSummary: {
        ...operatingSummary,
        operatingProfit,
      },
    });

    expect(document.querySelector(
      '[data-testid="company-operating-profit"]',
    )?.getAttribute('data-tone')).toBe(tone);
  });

  it.each([
    [1_800, 'profit', 'Trip profit £1,800'],
    [-500, 'loss', 'Trip loss £500'],
    [0, 'neutral', 'Break-even £0'],
  ] as const)('shows a named delivery with %s result', (
    operatingProfit,
    tone,
    result,
  ) => {
    EventBus.emit('ui:freight-delivery-completed', Object.freeze({
      trainId: 'train-1',
      productId: 'limestone-aggregate',
      units: 120,
      destinationFacilityId: 'cement-works',
      tick: 24,
      revenue: 5_400,
      runningCost: 3_600,
      operatingProfit,
    }));

    const delivery = document.querySelector(
      '[data-testid="company-last-delivery"]',
    ) as HTMLElement;
    expect(delivery.textContent).toBe(
      `Limestone Aggregate delivered to Cement Works · Revenue £5,400 · ${result}`,
    );
    expect(delivery.dataset.tone).toBe(tone);
  });

  it('renders unknown delivery references safely and removes the listener', () => {
    EventBus.emit('ui:freight-delivery-completed', Object.freeze({
      trainId: 'unknown-train',
      productId: 'unknown-product',
      units: 1,
      destinationFacilityId: 'unknown-destination',
      tick: 1,
      revenue: 100,
      runningCost: 20,
      operatingProfit: 80,
    }));
    expect(document.querySelector(
      '[data-testid="company-last-delivery"]',
    )?.textContent).toBe(
      'Unknown product delivered to Unknown destination'
      + ' · Revenue £100 · Trip profit £80',
    );

    hud.destroy();
    expect(() => EventBus.emit(
      'ui:freight-delivery-completed',
      Object.freeze({
        trainId: 'unknown-train',
        productId: 'unknown-product',
        units: 1,
        destinationFacilityId: 'unknown-destination',
        tick: 2,
        revenue: 50,
        runningCost: 100,
        operatingProfit: -50,
      }),
    )).not.toThrow();
    expect(document.querySelector(
      '[data-testid="company-last-delivery"]',
    )).toBeNull();
  });

  it('shows one visible positive delivery cash pulse and removes its listener', () => {
    EventBus.emit('ui:cash-pulse', { amount: 1_250 });
    const pulse = document.querySelector(
      '[data-testid="company-cash-pulse"]',
    ) as HTMLElement;
    expect(pulse.textContent).toBe('+£1,250');
    expect(pulse.style.display).toBe('inline');

    hud.destroy();
    EventBus.emit('ui:cash-pulse', { amount: 500 });
    expect(document.querySelector(
      '[data-testid="company-cash-pulse"]',
    )).toBeNull();
  });
});
