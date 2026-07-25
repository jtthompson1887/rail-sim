import { EventBus } from '../services/EventBus';

const CASH = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});

/** Minimal authoritative company state: cash and persistence status only. */
export class CompanyHud {
  private readonly root = document.createElement('section');
  private readonly cash = document.createElement('strong');
  private readonly saveState = document.createElement('span');
  private visible = true;

  private readonly stateHandler = (state: {
    cash: number;
    saveState: 'saved' | 'unsaved' | 'saving';
  }) => this.setState(state);

  constructor() {
    this.root.dataset.testid = 'company-hud';
    this.root.setAttribute('aria-label', 'Company finances');
    this.root.setAttribute('aria-live', 'polite');
    this.root.style.cssText = [
      'position:fixed',
      'z-index:1190',
      'left:86px',
      'top:12px',
      'display:flex',
      'align-items:center',
      'gap:8px',
      'padding:7px 10px',
      'border:1px solid rgba(102,202,255,.3)',
      'border-radius:6px',
      'background:rgba(6,19,31,.92)',
      'color:#d8efff',
      'font:12px Verdana,sans-serif',
      'pointer-events:none',
    ].join(';');
    this.cash.dataset.testid = 'company-cash';
    this.cash.style.cssText = 'font-size:15px;color:#fff';
    this.saveState.dataset.testid = 'company-save-state';
    this.saveState.style.cssText = 'color:#8ab4d0';
    this.root.append(this.cash, this.saveState);
    document.body.append(this.root);
    this.setVisible(true);
    EventBus.on('ui:company-state', this.stateHandler);
  }

  setState(state: {
    cash: number;
    saveState: 'saved' | 'unsaved' | 'saving';
  }): void {
    this.cash.textContent = CASH.format(state.cash);
    this.saveState.textContent = state.saveState === 'saved'
      ? 'Saved'
      : state.saveState === 'saving'
        ? 'Saving…'
        : 'Unsaved';
    this.root.dataset.saveState = state.saveState;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.root.style.display = visible ? 'flex' : 'none';
    this.root.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  containsScreenPoint(x: number, y: number): boolean {
    if (!this.visible) return false;
    const bounds = this.root.getBoundingClientRect();
    return x >= bounds.left && x <= bounds.right
      && y >= bounds.top && y <= bounds.bottom;
  }

  destroy(): void {
    EventBus.off('ui:company-state', this.stateHandler);
    this.root.remove();
  }
}
