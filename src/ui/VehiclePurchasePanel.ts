import type { FreightPurchaseQuote } from '../freight/FreightPurchaseService';
import type { FreightPurchaseResult } from '../freight/FreightPurchaseService';
import { buildFreightPurchasePresentation } from '../freight/FreightPresentation';
import { FLATBED_FREIGHT_SET_ID } from '../freight/FreightSetCatalog';
import { EventBus } from '../services/EventBus';

const CURRENCY = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});

export class VehiclePurchasePanel {
  private readonly root = document.createElement('section');
  private readonly details = document.createElement('div');
  private readonly remedy = document.createElement('div');
  private readonly buy = document.createElement('button');
  private readonly confirm = document.createElement('button');
  private currentQuote: FreightPurchaseQuote | null = null;
  private visible = true;
  private facilityInspectionActive = false;
  private readonly resizeHandler = () => this.applyLayout();
  private readonly stopPropagation = (event: Event) => event.stopPropagation();
  private readonly stateHandler = (state: {
    quote: FreightPurchaseQuote | null;
    cash: number;
    message: string;
  }) => this.setState(state);
  private readonly purchaseResultHandler = (
    result: FreightPurchaseResult,
  ) => {
    if (result.ok) this.confirm.blur();
  };
  private readonly facilityInspectionHandler = () => {
    this.facilityInspectionActive = true;
    this.syncVisibility();
  };
  private readonly facilityDeselectedHandler = () => {
    this.facilityInspectionActive = false;
    this.syncVisibility();
  };

  constructor() {
    this.root.dataset.testid = 'vehicle-purchase-panel';
    this.root.setAttribute('aria-label', 'Vehicle purchase');
    this.root.setAttribute('aria-live', 'polite');
    this.root.style.cssText = [
      'position:fixed',
      'z-index:1210',
      'box-sizing:border-box',
      'right:14px',
      'top:58px',
      'width:320px',
      'max-height:calc(100vh - 76px)',
      'overflow:auto',
      'padding:12px',
      'border:1px solid rgba(102,202,255,.42)',
      'border-radius:8px',
      'background:rgba(6,19,31,.96)',
      'box-shadow:0 12px 32px rgba(0,0,0,.38)',
      'color:#d8efff',
      'font:12px/1.4 Verdana,sans-serif',
      'pointer-events:auto',
    ].join(';');
    const title = document.createElement('h2');
    title.textContent = 'Vehicles';
    title.style.cssText =
      'margin:0 0 8px;font:700 16px/1.2 Verdana,sans-serif;color:#fff';
    this.details.style.cssText =
      'white-space:pre-line;padding:9px;border-radius:5px;background:#0c2638';
    this.remedy.dataset.testid = 'freight-purchase-remedy';
    this.remedy.style.cssText =
      'margin-top:8px;padding:7px 8px;border-radius:4px;background:#102c42;color:#ffe39a';
    this.buy.type = 'button';
    this.buy.dataset.testid = 'flatbed-freight-set-buy';
    this.buy.textContent = 'Place General Flatbed Set';
    this.confirm.type = 'button';
    this.confirm.dataset.testid = 'freight-purchase-confirm';
    this.confirm.textContent = 'Confirm purchase';
    for (const button of [this.buy, this.confirm]) {
      button.style.cssText = [
        'width:100%',
        'margin-top:8px',
        'padding:9px',
        'border:1px solid #4ad5ff',
        'border-radius:5px',
        'background:#123c55',
        'color:#fff',
        'font:700 12px Verdana,sans-serif',
        'cursor:pointer',
      ].join(';');
    }
    this.buy.addEventListener('click', () => {
      EventBus.emit('freight:purchase-mode-requested', {
        freightSetId: FLATBED_FREIGHT_SET_ID,
      });
    });
    this.confirm.addEventListener('click', () => {
      if (!this.currentQuote || this.confirm.disabled) return;
      EventBus.emit('freight:purchase-confirmed', {
        quote: this.currentQuote,
      });
    });
    this.root.append(
      title,
      this.details,
      this.remedy,
      this.buy,
      this.confirm,
    );
    for (const eventName of ['pointerdown', 'mousedown', 'touchstart', 'click']) {
      this.root.addEventListener(eventName, this.stopPropagation);
    }
    document.body.append(this.root);
    this.applyLayout();
    this.setState({ quote: null, cash: 0, message: '' });
    EventBus.on('ui:freight-purchase-state', this.stateHandler);
    EventBus.on('freight:purchase-result', this.purchaseResultHandler);
    EventBus.on('facility:inspection', this.facilityInspectionHandler);
    EventBus.on('facility:deselected', this.facilityDeselectedHandler);
    window.addEventListener('resize', this.resizeHandler);
    this.syncVisibility();
  }

  setState(state: {
    quote: FreightPurchaseQuote | null;
    cash: number;
    message: string;
  }): void {
    this.currentQuote = state.quote
      ? Object.freeze(state.quote)
      : null;
    const dto = buildFreightPurchasePresentation(
      this.currentQuote,
      state.cash,
    );
    this.details.textContent = [
      dto.displayName,
      `${CURRENCY.format(dto.price)} · ${dto.capacityLabel}`,
      `${dto.compatibleCargoLabel} · ${dto.runningCostLabel}`,
      `Cash after ${CURRENCY.format(dto.cashAfter)}`,
    ].join('\n');
    this.remedy.textContent = state.message || dto.remedy;
    this.remedy.style.display = this.remedy.textContent ? 'block' : 'none';
    this.confirm.disabled = !this.currentQuote
      || !dto.affordable
      || !dto.validPlacement;
    this.confirm.setAttribute(
      'aria-disabled',
      this.confirm.disabled ? 'true' : 'false',
    );
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.syncVisibility();
  }

  containsScreenPoint(x: number, y: number): boolean {
    if (this.root.style.display === 'none') return false;
    const bounds = this.root.getBoundingClientRect();
    return x >= bounds.left && x <= bounds.right
      && y >= bounds.top && y <= bounds.bottom;
  }

  destroy(): void {
    EventBus.off('ui:freight-purchase-state', this.stateHandler);
    EventBus.off('freight:purchase-result', this.purchaseResultHandler);
    EventBus.off('facility:inspection', this.facilityInspectionHandler);
    EventBus.off('facility:deselected', this.facilityDeselectedHandler);
    window.removeEventListener('resize', this.resizeHandler);
    this.root.remove();
  }

  private syncVisibility(): void {
    const displayed = this.visible && !this.facilityInspectionActive;
    this.root.style.display = displayed ? 'block' : 'none';
    this.root.setAttribute('aria-hidden', displayed ? 'false' : 'true');
  }

  private applyLayout(): void {
    const mobile = window.innerWidth <= 720;
    this.root.dataset.layout = mobile ? 'mobile' : 'desktop';
    if (mobile) {
      this.root.style.left = '56px';
      this.root.style.right = '8px';
      this.root.style.top = 'auto';
      this.root.style.bottom = '8px';
      this.root.style.width = 'auto';
      this.root.style.maxHeight = '48vh';
    } else {
      this.root.style.left = 'auto';
      this.root.style.right = '14px';
      this.root.style.top = '58px';
      this.root.style.bottom = 'auto';
      this.root.style.width = '320px';
      this.root.style.maxHeight = 'calc(100vh - 76px)';
    }
  }
}
