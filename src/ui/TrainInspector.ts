import type { TrainInspectionDto } from '../freight/FreightPresentation';
import { EventBus } from '../services/EventBus';

const CURRENCY = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});

const titleCase = (value: string): string =>
  `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;

export class TrainInspector {
  private readonly root = document.createElement('section');
  private readonly content = document.createElement('div');
  private readonly heading = document.createElement('h2');
  private readonly movement = document.createElement('strong');
  private readonly cargoText = document.createElement('div');
  private readonly cargo = document.createElement('progress');
  private readonly nearest = document.createElement('div');
  private readonly status = document.createElement('strong');
  private readonly batchText = document.createElement('div');
  private readonly batch = document.createElement('progress');
  private readonly figures = document.createElement('div');
  private readonly currentTripProfit = document.createElement('span');
  private readonly lastDeliveryProfit = document.createElement('span');
  private readonly lifetimeProfit = document.createElement('span');
  private readonly controls = document.createElement('div');
  private enabled = true;
  private current: TrainInspectionDto | null = null;
  private readonly resizeHandler = () => this.applyLayout();
  private readonly stopPropagation = (event: Event) => event.stopPropagation();
  private readonly stateHandler = ({
    inspection,
  }: {
    inspection: TrainInspectionDto | null;
  }) => this.setState(inspection);

  constructor() {
    this.root.dataset.testid = 'train-inspector';
    this.root.setAttribute('aria-label', 'Train inspection');
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
    this.heading.style.cssText =
      'margin:0 0 3px;font:700 16px/1.2 Verdana,sans-serif;color:#fff';
    this.movement.style.cssText =
      'display:block;margin-bottom:9px;color:#9feaff';
    this.cargo.dataset.testid = 'train-cargo-progress';
    this.cargo.style.cssText =
      'display:block;width:100%;height:8px;accent-color:#4ad5ff';
    this.nearest.style.cssText = 'margin-top:8px;color:#bad3e2';
    this.status.dataset.testid = 'train-transfer-status';
    this.status.style.cssText =
      'display:block;margin-top:6px;color:#ffe39a';
    this.batch.dataset.testid = 'train-transfer-progress';
    this.batch.max = 10;
    this.batch.style.cssText =
      'display:block;width:100%;height:8px;accent-color:#69df9a';
    this.figures.style.cssText =
      'white-space:pre-line;margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,.12)';
    this.currentTripProfit.dataset.testid = 'train-current-trip-profit';
    this.lastDeliveryProfit.dataset.testid = 'train-last-delivery-profit';
    this.lifetimeProfit.dataset.testid = 'train-lifetime-profit';
    this.controls.setAttribute('aria-label', 'Train throttle');
    this.controls.style.cssText =
      'display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:10px';
    for (const [value, label] of [
      [-1, 'Reverse'],
      [0, 'Stop'],
      [1, 'Forward'],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.throttle = String(value);
      button.setAttribute('aria-pressed', 'false');
      button.textContent = label;
      button.style.cssText =
        'padding:8px 4px;border:1px solid #4ad5ff;border-radius:4px;background:#123c55;color:#fff';
      button.addEventListener('click', () => {
        button.blur();
        EventBus.emit('mobile:throttle', { value });
      });
      this.controls.append(button);
    }
    this.content.append(
      this.heading,
      this.movement,
      this.cargoText,
      this.cargo,
      this.nearest,
      this.status,
      this.batchText,
      this.batch,
      this.figures,
      this.controls,
    );
    this.root.append(this.content);
    for (const eventName of ['pointerdown', 'mousedown', 'touchstart', 'click']) {
      this.root.addEventListener(eventName, this.stopPropagation);
    }
    document.body.append(this.root);
    this.applyLayout();
    this.setState(null);
    EventBus.on('ui:train-inspection', this.stateHandler);
    window.addEventListener('resize', this.resizeHandler);
  }

  setState(dto: TrainInspectionDto | null): void {
    this.current = dto;
    if (!dto) {
      this.syncVisibility();
      return;
    }
    this.controls.querySelectorAll<HTMLButtonElement>('[data-throttle]')
      .forEach((button) => {
        const selected = Number(button.dataset.throttle) === dto.throttle;
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
        button.style.backgroundColor = selected ? '#4ad5ff' : '#123c55';
        button.style.color = selected ? '#06131f' : '#fff';
        button.style.fontWeight = selected ? '700' : '400';
      });
    this.heading.textContent = dto.displayName;
    this.movement.textContent =
      `${titleCase(dto.direction)} · ${dto.movementState}`;
    this.cargoText.textContent = dto.cargo.text;
    this.cargo.max = dto.cargo.capacityUnits;
    this.cargo.value = dto.cargo.units;
    this.cargo.setAttribute(
      'aria-label',
      `Cargo ${dto.cargo.productLabel} ${dto.cargo.units} of `
      + `${dto.cargo.capacityUnits} ${dto.cargo.unitLabel}`,
    );
    this.nearest.textContent = dto.nearestEligibleFacility
      ? `Nearest eligible: ${dto.nearestEligibleFacility}`
      : 'Nearest eligible: none';
    this.status.textContent = dto.transferRemedy
      || titleCase(dto.transfer.kind);
    const compactUnit = dto.cargo.unitLabel === 'tonnes' ? 't' : 'units';
    this.batchText.textContent =
      `Batch ${dto.transfer.batchUnits} / 10 ${compactUnit}`;
    this.batch.value = dto.transfer.batchUnits;
    this.batch.setAttribute(
      'aria-label',
      `Cargo transfer batch ${dto.transfer.batchUnits} of 10 `
      + dto.cargo.unitLabel,
    );
    this.currentTripProfit.textContent =
      CURRENCY.format(dto.currentTrip.operatingProfit);
    this.lastDeliveryProfit.textContent =
      CURRENCY.format(dto.lastDelivery.operatingProfit);
    this.lifetimeProfit.textContent =
      CURRENCY.format(dto.lifetime.operatingProfit);
    const line = (
      label: string,
      revenue: number,
      runningCost: number,
      profit: HTMLElement,
    ): HTMLDivElement => {
      const row = document.createElement('div');
      row.append(
        `${label} · revenue ${CURRENCY.format(revenue)} · running `
        + `${CURRENCY.format(runningCost)} · profit `,
        profit,
      );
      return row;
    };
    this.figures.replaceChildren(
      line(
        'Current trip',
        dto.currentTrip.revenue,
        dto.currentTrip.runningCost,
        this.currentTripProfit,
      ),
      line(
        'Last delivery',
        dto.lastDelivery.revenue,
        dto.lastDelivery.runningCost,
        this.lastDeliveryProfit,
      ),
      line(
        `Lifetime · ${dto.lifetime.deliveredUnits} ${compactUnit}`,
        dto.lifetime.revenue,
        dto.lifetime.runningCost,
        this.lifetimeProfit,
      ),
    );
    this.syncVisibility();
  }

  setVisible(visible: boolean): void {
    this.enabled = visible;
    this.syncVisibility();
  }

  containsScreenPoint(x: number, y: number): boolean {
    if (!this.enabled || !this.current) return false;
    const bounds = this.root.getBoundingClientRect();
    return x >= bounds.left && x <= bounds.right
      && y >= bounds.top && y <= bounds.bottom;
  }

  destroy(): void {
    EventBus.off('ui:train-inspection', this.stateHandler);
    window.removeEventListener('resize', this.resizeHandler);
    this.root.remove();
  }

  private syncVisibility(): void {
    const visible = this.enabled && this.current !== null;
    this.root.style.display = visible ? 'block' : 'none';
    this.root.setAttribute('aria-hidden', visible ? 'false' : 'true');
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
      this.root.style.maxHeight = '48vh';
      this.controls.style.position = 'sticky';
      this.controls.style.bottom = '0px';
      this.controls.style.zIndex = '1';
      this.controls.style.paddingTop = '8px';
      this.controls.style.background = 'rgba(6, 19, 31, 0.98)';
    } else {
      this.root.style.left = 'auto';
      this.root.style.right = '14px';
      this.root.style.top = '58px';
      this.root.style.bottom = 'auto';
      this.root.style.width = '320px';
      this.root.style.maxHeight = 'calc(100vh - 76px)';
      this.controls.style.position = 'static';
      this.controls.style.bottom = 'auto';
      this.controls.style.zIndex = 'auto';
      this.controls.style.paddingTop = '0px';
      this.controls.style.background = 'transparent';
    }
  }
}
