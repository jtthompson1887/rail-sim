import type { FacilityInspectionDto } from '../economy/FacilityPresentation';
import { EventBus } from '../services/EventBus';

const CURRENCY = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});

const FACTOR_NAMES: Record<string, string> = {
  'global-construction': 'Global construction',
  'regional-demand': 'Regional demand',
  'inventory-pressure': 'Inventory pressure',
};

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  testId: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.dataset.testid = testId;
  return node;
}

function productNames(
  products: ReadonlyArray<{ displayName: string }>,
): string {
  if (products.length === 0) return 'None';
  return products.map(({ displayName }) => displayName).join(', ');
}

const units = (unitLabel: string, quantity: number): string =>
  quantity === 1 ? unitLabel : `${unitLabel}s`;

function factorText(id: string, basisPoints: number): string {
  const percent = (basisPoints - 10_000) / 100;
  const sign = percent >= 0 ? '+' : '';
  return `${FACTOR_NAMES[id] ?? id} ${sign}${percent.toFixed(1)}%`;
}

/** Compact, accessible right inspector driven only by immutable snapshots. */
export class FacilityInspector {
  private readonly root = element('section', 'facility-inspector');
  private readonly name = element('h2', 'facility-name');
  private readonly status = element('strong', 'facility-status');
  private readonly products = element('div', 'facility-products');
  private readonly inventories = element('div', 'facility-inventories');
  private readonly quotes = element('div', 'facility-quotes');
  private readonly rail = element('div', 'facility-rail');
  private current: FacilityInspectionDto | null = null;
  private enabled = true;

  private readonly inspectionHandler = (dto: FacilityInspectionDto) => {
    this.render(dto);
  };
  private readonly deselectedHandler = () => this.clear();
  private readonly resizeHandler = () => this.applyLayout();
  private readonly stopPropagation = (event: Event) => event.stopPropagation();

  constructor() {
    this.root.setAttribute('aria-label', 'Facility inspection');
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
      'font:12px/1.35 Verdana,sans-serif',
      'pointer-events:auto',
    ].join(';');
    this.name.style.cssText = [
      'margin:0 0 3px',
      'font:700 16px/1.2 Verdana,sans-serif',
      'color:#fff',
    ].join(';');
    this.status.style.cssText = [
      'display:block',
      'margin-bottom:9px',
      'padding:6px 8px',
      'border-radius:4px',
      'background:#102c42',
      'color:#ffe39a',
      'font-size:13px',
    ].join(';');
    this.products.style.cssText = 'white-space:pre-line;margin-bottom:10px;color:#bad3e2';
    this.inventories.style.cssText = 'display:grid;gap:7px;margin-bottom:10px';
    this.quotes.style.cssText = 'display:grid;gap:8px;margin-bottom:10px';
    this.rail.style.cssText = 'padding-top:8px;border-top:1px solid rgba(255,255,255,.12);font-weight:700';
    this.root.append(
      this.name,
      this.status,
      this.products,
      this.inventories,
      this.quotes,
      this.rail,
    );
    for (const eventName of ['pointerdown', 'mousedown', 'touchstart', 'click']) {
      this.root.addEventListener(eventName, this.stopPropagation);
    }
    document.body.append(this.root);
    this.applyLayout();
    this.clear();
    EventBus.on('facility:inspection', this.inspectionHandler);
    EventBus.on('facility:deselected', this.deselectedHandler);
    window.addEventListener('resize', this.resizeHandler);
  }

  private render(dto: FacilityInspectionDto): void {
    this.current = dto;
    this.name.textContent = dto.name;
    this.status.textContent = dto.status.label;
    this.status.dataset.status = dto.status.code;
    this.products.textContent = [
      `Produces ${productNames(dto.outputRows)}`,
      `Needs ${productNames(dto.inputRows)}`,
      ...dto.inputRows.map((row) => row.missingQuantity === 0
        ? `${row.displayName} received `
          + `${row.availableQuantity.toLocaleString('en-GB')} / `
          + `${row.requiredQuantity.toLocaleString('en-GB')} `
          + units(row.unitLabel, row.requiredQuantity)
        : `${row.displayName} needs `
          + `${row.missingQuantity.toLocaleString('en-GB')} `
          + units(row.unitLabel, row.missingQuantity)),
    ].join('\n');
    this.inventories.replaceChildren(...dto.inventories.map((slot) => {
      const row = document.createElement('div');
      const label = document.createElement('div');
      label.textContent = `${slot.displayName} `
        + `${slot.quantity.toLocaleString('en-GB')} / `
        + `${slot.capacity.toLocaleString('en-GB')} `
        + units(slot.unitLabel, slot.capacity);
      const progress = document.createElement('progress');
      progress.max = slot.capacity;
      progress.value = slot.quantity;
      progress.setAttribute('aria-label', `${slot.displayName} inventory`);
      progress.style.cssText = 'display:block;width:100%;height:7px;accent-color:#4ad5ff';
      row.append(label, progress);
      return row;
    }));
    this.quotes.replaceChildren(...dto.quotes.map((quote) => {
      const row = document.createElement('div');
      row.style.cssText = 'padding:7px 8px;border-radius:4px;background:#0c2638';
      const heading = document.createElement('strong');
      heading.textContent = `${quote.displayName} · `
        + `${CURRENCY.format(quote.unitPrice)} / ${quote.unitLabel}`;
      heading.style.cssText = 'display:block;color:#eaf8ff;margin-bottom:3px';
      const factors = document.createElement('div');
      factors.style.cssText = 'white-space:pre-line;color:#8ab4d0;font-size:11px';
      factors.textContent = quote.factors.map(
        ({ id, basisPoints }) => factorText(id, basisPoints),
      ).join('\n');
      row.append(heading, factors);
      return row;
    }));
    this.rail.textContent = dto.railConnected
      ? 'Rail access: connected'
      : 'Rail access: not connected';
    this.root.style.display = this.enabled ? 'block' : 'none';
    this.root.setAttribute('aria-hidden', this.enabled ? 'false' : 'true');
  }

  private applyLayout(): void {
    const mobile = window.innerWidth <= 720;
    const shortWide = mobile && window.innerWidth > window.innerHeight;
    this.root.dataset.layout = mobile ? 'mobile' : 'desktop';
    if (mobile) {
      this.root.style.left = shortWide
        ? 'calc(50vw + 28px)'
        : '56px';
      this.root.style.right = '8px';
      this.root.style.top = 'auto';
      this.root.style.bottom = '8px';
      this.root.style.width = 'auto';
      this.root.style.maxHeight = shortWide
        ? '58vh'
        : 'calc(75vh - 208px)';
    } else {
      this.root.style.left = 'auto';
      this.root.style.right = '14px';
      this.root.style.top = '58px';
      this.root.style.bottom = 'auto';
      this.root.style.width = '320px';
      this.root.style.maxHeight = 'calc(100vh - 76px)';
    }
  }

  setVisible(visible: boolean): void {
    this.enabled = visible;
    const displayed = visible && this.current !== null;
    this.root.style.display = displayed ? 'block' : 'none';
    this.root.setAttribute('aria-hidden', displayed ? 'false' : 'true');
  }

  clear(): void {
    this.current = null;
    this.name.textContent = '';
    this.status.textContent = '';
    delete this.status.dataset.status;
    this.products.textContent = '';
    this.inventories.replaceChildren();
    this.quotes.replaceChildren();
    this.rail.textContent = '';
    this.root.style.display = 'none';
    this.root.setAttribute('aria-hidden', 'true');
  }

  containsScreenPoint(x: number, y: number): boolean {
    if (this.root.style.display === 'none') return false;
    const bounds = this.root.getBoundingClientRect();
    return x >= bounds.left && x <= bounds.right
      && y >= bounds.top && y <= bounds.bottom;
  }

  destroy(): void {
    EventBus.off('facility:inspection', this.inspectionHandler);
    EventBus.off('facility:deselected', this.deselectedHandler);
    window.removeEventListener('resize', this.resizeHandler);
    this.clear();
    this.root.remove();
  }
}
