/**
 * @jest-environment jsdom
 */
import { EventBus } from '../../src/services/EventBus';
import { CompanyHud } from '../../src/ui/CompanyHud';

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
      },
      {
        cash: 997_200,
        saveState: 'unsaved' as const,
        economyTick: 25,
        constructionIndexBps: 10_125,
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
});
