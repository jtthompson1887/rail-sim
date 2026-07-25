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
      { cash: 1_000_000, saveState: 'saved' as const },
      { cash: 997_200, saveState: 'unsaved' as const },
      { cash: 1_000_000, saveState: 'unsaved' as const },
      { cash: 997_200, saveState: 'unsaved' as const },
      { cash: 997_200, saveState: 'saved' as const },
    ]) {
      EventBus.emit('ui:company-state', state);
      expect(document.querySelector('[data-testid="company-cash"]')?.textContent)
        .toBe(`£${state.cash.toLocaleString('en-GB')}`);
      expect(document.querySelector('[data-testid="company-save-state"]')?.textContent)
        .toBe(state.saveState === 'saved' ? 'Saved' : 'Unsaved');
    }
  });

  it('hides, disables, and unsubscribes cleanly across play and relaunch lifecycle', () => {
    EventBus.emit('ui:company-state', { cash: 500, saveState: 'saved' });
    hud.setVisible(false);
    expect(document.querySelector('[data-testid="company-hud"]')
      ?.getAttribute('aria-hidden')).toBe('true');

    hud.destroy();
    EventBus.emit('ui:company-state', { cash: 250, saveState: 'unsaved' });
    expect(document.querySelector('[data-testid="company-hud"]')).toBeNull();
  });
});
