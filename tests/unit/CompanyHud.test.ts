/**
 * @jest-environment jsdom
 */
import { EventBus } from '../../src/services/EventBus';
import { CompanyHud } from '../../src/ui/CompanyHud';

const operatingSummary = {
  fromTick: 1,
  throughTick: 24,
  deliveryRevenue: 2_000,
  runningExpenses: 500,
  operatingProfit: 1_500,
  capitalExpenditure: 90_000,
  cashFlow: -88_500,
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

  it('shows the saving state while preserving construction and time fields', () => {
    EventBus.emit('ui:company-state', {
      cash: 950_000,
      saveState: 'saving',
      economyTick: 12,
      constructionIndexBps: 10_050,
      operatingSummary,
    });

    expect(document.querySelector('[data-testid="company-save-state"]')?.textContent)
      .toBe('Saving…');
    const root = document.querySelector('[data-testid="company-hud"]') as HTMLElement;
    expect(root.dataset.saveState).toBe('saving');
    expect(document.querySelector('[data-testid="company-economy-time"]')?.textContent)
      .toBe('Day 1 · Tick 12');
  });

  it('reports whether a screen point falls within its bounding box', () => {
    const root = document.querySelector('[data-testid="company-hud"]') as HTMLElement;
    jest.spyOn(root, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 20,
      right: 300,
      bottom: 80,
      width: 200,
      height: 60,
      x: 100,
      y: 20,
      toJSON: () => {},
    } as any);

    expect(hud.containsScreenPoint(150, 50)).toBe(true);
    expect(hud.containsScreenPoint(99, 50)).toBe(false);
    expect(hud.containsScreenPoint(150, 81)).toBe(false);

    hud.setVisible(false);
    expect(hud.containsScreenPoint(150, 50)).toBe(false);
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
      '[data-testid="company-delivery-revenue"]',
    )?.textContent).toBe('Revenue £2,000');
    expect(document.querySelector(
      '[data-testid="company-running-expenses"]',
    )?.textContent).toBe('Running £500');
    expect(document.querySelector(
      '[data-testid="company-operating-profit"]',
    )?.textContent).toBe('Operating profit £1,500');
    expect(document.querySelector(
      '[data-testid="company-capital-expenditure"]',
    )?.textContent).toBe('Capex £90,000');
    expect(document.querySelector(
      '[data-testid="company-cash-flow"]',
    )?.textContent).toBe('Cash flow −£88,500');
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
