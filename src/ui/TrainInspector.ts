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
      this.content.replaceChildren();
      this.syncVisibility();
      return;
    }

    const heading = document.createElement('h2');
    heading.textContent = dto.displayName;
    heading.style.cssText =
      'margin:0 0 3px;font:700 16px/1.2 Verdana,sans-serif;color:#fff';
    const movement = document.createElement('strong');
    movement.textContent =
      `${titleCase(dto.direction)} · ${dto.movementState}`;
    movement.style.cssText =
      'display:block;margin-bottom:9px;color:#9feaff';

    const cargoText = document.createElement('div');
    cargoText.textContent = dto.cargo.text;
    const cargo = document.createElement('progress');
    cargo.dataset.testid = 'train-cargo-progress';
    cargo.max = dto.cargo.capacityUnits;
    cargo.value = dto.cargo.units;
    cargo.setAttribute(
      'aria-label',
      `Cargo ${dto.cargo.productLabel} ${dto.cargo.units} of ${dto.cargo.capacityUnits} tonnes`,
    );
    cargo.style.cssText =
      'display:block;width:100%;height:8px;accent-color:#4ad5ff';

    const nearest = document.createElement('div');
    nearest.textContent = dto.nearestEligibleFacility
      ? `Nearest eligible: ${dto.nearestEligibleFacility}`
      : 'Nearest eligible: none';
    nearest.style.cssText = 'margin-top:8px;color:#bad3e2';
    const status = document.createElement('strong');
    status.dataset.testid = 'train-transfer-status';
    status.textContent = dto.transfer.blocker
      ?? titleCase(dto.transfer.kind);
    status.style.cssText =
      'display:block;margin-top:6px;color:#ffe39a';
    const batchText = document.createElement('div');
    batchText.textContent = `Batch ${dto.transfer.batchUnits} / 10 t`;
    const batch = document.createElement('progress');
    batch.dataset.testid = 'train-transfer-progress';
    batch.max = 10;
    batch.value = dto.transfer.batchUnits;
    batch.setAttribute(
      'aria-label',
      `Cargo transfer batch ${dto.transfer.batchUnits} of 10 tonnes`,
    );
    batch.style.cssText =
      'display:block;width:100%;height:8px;accent-color:#69df9a';

    const figures = document.createElement('div');
    figures.style.cssText =
      'white-space:pre-line;margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,.12)';
    figures.textContent = [
      `Current trip · revenue ${CURRENCY.format(dto.currentTrip.revenue)} · running ${CURRENCY.format(dto.currentTrip.runningCost)} · ${CURRENCY.format(dto.currentTrip.operatingProfit)}`,
      `Last delivery · revenue ${CURRENCY.format(dto.lastDelivery.revenue)} · running ${CURRENCY.format(dto.lastDelivery.runningCost)} · ${CURRENCY.format(dto.lastDelivery.operatingProfit)}`,
      `Lifetime · ${dto.lifetime.deliveredUnits} t · revenue ${CURRENCY.format(dto.lifetime.revenue)} · running ${CURRENCY.format(dto.lifetime.runningCost)} · ${CURRENCY.format(dto.lifetime.operatingProfit)}`,
    ].join('\n');

    const controls = document.createElement('div');
    controls.setAttribute('aria-label', 'Train throttle');
    controls.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:10px';
    for (const [value, label] of [
      [-1, 'Reverse'],
      [0, 'Stop'],
      [1, 'Forward'],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.throttle = String(value);
      button.textContent = label;
      button.style.cssText =
        'padding:8px 4px;border:1px solid #4ad5ff;border-radius:4px;background:#123c55;color:#fff';
      button.addEventListener('click', () => {
        button.blur();
        EventBus.emit('mobile:throttle', { value });
      });
      controls.append(button);
    }

    this.content.replaceChildren(
      heading,
      movement,
      cargoText,
      cargo,
      nearest,
      status,
      batchText,
      batch,
      figures,
      controls,
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
