import type { FreightObjectiveDto } from '../freight/FreightObjective';
import { EventBus } from '../services/EventBus';

export class FreightObjectiveCard {
  private readonly root = document.createElement('section');
  private readonly title = document.createElement('h2');
  private readonly status = document.createElement('strong');
  private readonly steps = document.createElement('ol');
  private stateFingerprint: string | null = null;
  private visible = true;
  private readonly resizeHandler = () => this.applyLayout();
  private readonly stopPropagation = (event: Event) => event.stopPropagation();
  private readonly stateHandler = (dto: FreightObjectiveDto) =>
    this.setState(dto);

  constructor() {
    this.root.dataset.testid = 'freight-objective';
    this.root.setAttribute('aria-live', 'polite');
    this.root.style.cssText = [
      'position:fixed',
      'z-index:1200',
      'box-sizing:border-box',
      'left:86px',
      'top:72px',
      'width:270px',
      'max-height:calc(100vh - 90px)',
      'overflow:auto',
      'padding:10px 12px',
      'border:1px solid rgba(105,223,154,.42)',
      'border-radius:8px',
      'background:rgba(6,19,31,.94)',
      'color:#d8efff',
      'font:12px/1.35 Verdana,sans-serif',
      'pointer-events:auto',
    ].join(';');
    this.title.style.cssText =
      'margin:0 0 4px;font:700 14px Verdana,sans-serif;color:#fff';
    this.status.style.cssText = 'display:block;margin-bottom:5px;color:#ffe39a';
    this.steps.style.cssText = 'margin:0;padding-left:20px';
    this.root.append(this.title, this.status, this.steps);
    for (const eventName of ['pointerdown', 'mousedown', 'touchstart', 'click']) {
      this.root.addEventListener(eventName, this.stopPropagation);
    }
    document.body.append(this.root);
    this.applyLayout();
    this.setVisible(true);
    EventBus.on('ui:freight-objective', this.stateHandler);
    window.addEventListener('resize', this.resizeHandler);
  }

  setState(dto: FreightObjectiveDto): void {
    const fingerprint = JSON.stringify([
      dto.id,
      dto.title,
      dto.status,
      dto.achieved,
      dto.steps.map(({ id, label, state }) => [id, label, state]),
    ]);
    if (fingerprint === this.stateFingerprint) return;
    this.stateFingerprint = fingerprint;
    this.root.dataset.objective = dto.id;
    this.root.setAttribute(
      'aria-label',
      dto.achieved
        ? `${dto.title} objective achieved`
        : `${dto.title} objective`,
    );
    this.title.textContent = dto.title;
    this.status.textContent = dto.status;
    this.status.style.color = dto.achieved ? '#9af0b6' : '#ffe39a';
    this.steps.replaceChildren(...dto.steps.map((step) => {
      const item = document.createElement('li');
      item.dataset.step = step.id;
      const prefix = step.state === 'complete'
        ? 'Complete'
        : step.state === 'current'
          ? 'Current'
          : 'Pending';
      item.textContent = `${prefix}: ${step.label}`;
      item.style.color = step.state === 'complete'
        ? '#9af0b6'
        : step.state === 'current'
          ? '#fff'
          : '#8ab4d0';
      if (step.state === 'current') {
        item.setAttribute('aria-current', 'step');
      }
      return item;
    }));
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.root.style.display = visible ? 'block' : 'none';
    this.root.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  containsScreenPoint(x: number, y: number): boolean {
    if (!this.visible) return false;
    const bounds = this.root.getBoundingClientRect();
    return x >= bounds.left && x <= bounds.right
      && y >= bounds.top && y <= bounds.bottom;
  }

  destroy(): void {
    EventBus.off('ui:freight-objective', this.stateHandler);
    window.removeEventListener('resize', this.resizeHandler);
    this.root.remove();
  }

  private applyLayout(): void {
    const mobile = window.innerWidth <= 720;
    const shortWide = mobile && window.innerWidth > window.innerHeight;
    this.root.dataset.layout = mobile ? 'mobile' : 'desktop';
    if (mobile) {
      this.root.style.left = '56px';
      this.root.style.right = shortWide ? 'auto' : '8px';
      this.root.style.top = '192px';
      this.root.style.width = shortWide
        ? 'calc(50vw - 36px)'
        : 'auto';
      this.root.style.maxHeight = '25vh';
    } else {
      this.root.style.left = '86px';
      this.root.style.right = 'auto';
      this.root.style.top = '72px';
      this.root.style.width = '270px';
      this.root.style.maxHeight = 'calc(100vh - 90px)';
    }
  }
}
