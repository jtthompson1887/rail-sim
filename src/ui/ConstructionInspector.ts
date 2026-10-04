import { EventBus } from '../services/EventBus';
import type {
  ConstructionPreviewEvent,
  ConstructionPreviewModel,
} from './ConstructionPreviewOverlay';
import { isDirectionHandle, type TrackDraftIntent } from '../systems/TrackDraft';

const CURRENCY = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});

function money(value: number): string {
  return CURRENCY.format(value);
}

function distance(value: number): string {
  return Math.round(value).toLocaleString('en-GB');
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  testId: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.dataset.testid = testId;
  return node;
}

/** Accessible, compact decision panel driven only by immutable preview DTOs. */
export class ConstructionInspector {
  private readonly root = element('section', 'construction-inspector');
  private readonly objective = element('div', 'construction-objective');
  private readonly primary = element('div', 'construction-primary');
  private readonly subtotal = element('div', 'construction-engineering-subtotal');
  private readonly geometrySummary = element('div', 'construction-geometry-summary');
  private readonly detail = element('div', 'construction-detail');
  private readonly remedy = element('div', 'construction-remedy');
  private readonly shapeControls = element('details', 'construction-shape-controls');
  private readonly shapeHelp = element('div', 'construction-shape-help');
  private readonly startDirection = element('button', 'construction-start-direction');
  private readonly endDirection = element('button', 'construction-end-direction');
  private readonly rotateLeft = element('button', 'construction-rotate-left');
  private readonly rotateRight = element('button', 'construction-rotate-right');
  private readonly shorter = element('button', 'construction-shorter');
  private readonly longer = element('button', 'construction-longer');
  private readonly resetShape = element('button', 'construction-reset-shape');
  private readonly undoShape = element('button', 'construction-undo-shape');
  private readonly confirmButton = element('button', 'construction-confirm');
  private readonly backButton = element('button', 'construction-back');
  private readonly cancelButton = element('button', 'construction-cancel');
  private current: ConstructionPreviewModel | null = null;
  private enabled = true;

  private readonly previewHandler = (event: ConstructionPreviewEvent) => {
    if (!event.preview || event.phase === 'idle' || event.phase === 'committed') {
      this.clear();
      return;
    }
    this.render(event.preview);
  };

  private readonly resizeHandler = () => this.applyLayout();
  private readonly stopPropagation = (event: Event) => {
    if (event.type !== 'keydown' || ['Enter', 'Space'].includes((event as KeyboardEvent).code)) {
      event.stopPropagation();
    }
  };

  constructor() {
    this.root.setAttribute('aria-label', 'Construction decision');
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-live', 'polite');
    this.root.style.cssText = [
      'position:fixed',
      'z-index:1200',
      'box-sizing:border-box',
      'width:min(360px,calc(100vw - 92px))',
      'max-height:calc(100vh - 88px)',
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
    this.objective.style.cssText =
      'color:#9feaff;font-weight:700;margin-bottom:8px';
    this.primary.style.cssText = 'font-size:15px;font-weight:700;color:#fff;margin-bottom:4px';
    this.subtotal.style.cssText = 'color:#8ab4d0;margin-bottom:8px';
    this.geometrySummary.style.cssText = 'color:#bad3e2;font-size:11px';
    this.detail.style.cssText = 'white-space:pre-line;color:#bad3e2;font-size:11px';
    this.remedy.style.cssText = [
      'position:sticky',
      'bottom:52px',
      'margin-top:8px',
      'padding:7px 8px',
      'border-radius:4px',
      'background:#102c42',
      'color:#ffe39a',
      'font-weight:700',
    ].join(';');

    this.shapeControls.open = true;
    this.shapeControls.style.cssText = 'margin:8px 0;padding:8px;border:1px solid #345b72;border-radius:6px';
    const shapeTitle = document.createElement('summary');
    shapeTitle.textContent = 'Shape track';
    shapeTitle.style.cssText = 'cursor:pointer;font-weight:700;min-height:24px';
    const shapeButtons = document.createElement('div');
    shapeButtons.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px';
    this.shapeHelp.style.cssText = 'font-size:11px;color:#bad3e2;margin:6px 0';
    const buttons: Array<[HTMLButtonElement, string, string, TrackDraftIntent]> = [
      [this.startDirection, 'Start direction', 'Adjust start direction', { action: 'select', handle: 'start-direction' }],
      [this.endDirection, 'Finish direction', 'Adjust finish direction', { action: 'select', handle: 'end-direction' }],
      [this.rotateLeft, '↶ 5°', 'Rotate direction anticlockwise by 5 degrees', { action: 'rotate', degrees: -5 }],
      [this.rotateRight, '↷ 5°', 'Rotate direction clockwise by 5 degrees', { action: 'rotate', degrees: 5 }],
      [this.shorter, 'Shorter approach', 'Shorten selected approach', { action: 'reach', factor: 0.85 }],
      [this.longer, 'Longer approach', 'Lengthen selected approach', { action: 'reach', factor: 1 / 0.85 }],
      [this.resetShape, 'Reset shape', 'Reset to automatic curve', { action: 'reset' }],
      [this.undoShape, 'Undo shape', 'Undo last draft adjustment', { action: 'undo' }],
    ];
    for (const [button, label, aria, intent] of buttons) {
      this.configureButton(button, label, aria);
      button.addEventListener('click', () => this.emitShapeIntent(intent));
      button.addEventListener('keydown', (event) => {
        if (event.code !== 'Enter' && event.code !== 'Space') return;
        event.preventDefault();
        event.stopPropagation();
        this.emitShapeIntent(intent);
      });
      shapeButtons.append(button);
    }
    this.shapeControls.append(shapeTitle, this.shapeHelp, shapeButtons);
    const engineering = document.createElement('details');
    engineering.dataset.testid = 'construction-engineering';
    const engineeringTitle = document.createElement('summary');
    engineeringTitle.textContent = 'Engineering details';
    engineeringTitle.style.cssText = 'cursor:pointer;min-height:32px;padding-top:4px';
    engineering.append(engineeringTitle, this.detail);

    const actions = document.createElement('div');
    actions.dataset.testid = 'construction-actions';
    actions.style.cssText = [
      'position:sticky',
      'bottom:0',
      'display:grid',
      'grid-template-columns:1fr 1fr 1fr',
      'gap:6px',
      'padding-top:8px',
      'background:rgba(6,19,31,.98)',
    ].join(';');
    this.configureButton(this.confirmButton, 'Build', 'Confirm construction');
    this.configureButton(this.backButton, 'Back', 'Back to route adjustment');
    this.configureButton(this.cancelButton, 'Cancel', 'Cancel construction');
    this.bindAction(this.confirmButton, 'confirm');
    this.bindAction(this.backButton, 'backstep');
    this.bindAction(this.cancelButton, 'cancel');
    actions.append(this.confirmButton, this.backButton, this.cancelButton);
    const decision = document.createElement('div');
    decision.style.cssText = 'position:sticky;top:0;z-index:1;padding-bottom:8px;background:#06131f';
    decision.append(this.primary, this.subtotal, this.geometrySummary);
    this.root.append(
      this.objective,
      decision,
      this.shapeControls,
      engineering,
      this.remedy,
      actions,
    );
    for (const eventName of ['pointerdown', 'mousedown', 'touchstart', 'click', 'keydown']) {
      this.root.addEventListener(eventName, this.stopPropagation);
    }
    document.body.append(this.root);
    this.applyLayout();
    this.clear();
    EventBus.on('construction:preview', this.previewHandler);
    window.addEventListener('resize', this.resizeHandler);
  }

  private configureButton(
    button: HTMLButtonElement,
    label: string,
    ariaLabel: string,
  ): void {
    button.type = 'button';
    button.textContent = label;
    button.setAttribute('aria-label', ariaLabel);
    button.style.cssText = [
      'min-height:44px',
      'border:1px solid #3d7594',
      'border-radius:4px',
      'background:#143a54',
      'color:#e9f7ff',
      'font:700 11px Verdana,sans-serif',
      'cursor:pointer',
    ].join(';');
  }

  private bindAction(
    button: HTMLButtonElement,
    action: 'confirm' | 'backstep' | 'cancel',
  ): void {
    button.addEventListener('click', () => this.emitIntent(action));
    button.addEventListener('keydown', (event) => {
      if (event.code !== 'Enter' && event.code !== 'Space') return;
      event.preventDefault();
      event.stopPropagation();
      this.emitIntent(action);
    });
  }

  private render(model: ConstructionPreviewModel): void {
    this.current = model;
    this.root.setAttribute('aria-hidden', this.enabled ? 'false' : 'true');
    this.root.style.display = this.enabled ? 'block' : 'none';
    this.objective.textContent = model.guidance.reserve > 0
      ? `${model.guidance.objective} Keep ${money(model.guidance.reserve)}`
        + ` reserved for ${model.guidance.reservePurpose}.`
      : model.guidance.objective;
    const affordability = model.affordable ? 'Affordable' : 'Unaffordable';
    this.primary.textContent = `Build ${money(model.totalCost)} · Cash after ${money(model.cashAfter)} · ${affordability}`;
    this.subtotal.textContent = `Engineering subtotal ${money(model.engineeringSubtotal)}`;
    this.renderShapeControls(model);
    const radius = Number.isFinite(model.proposal.minimumRadius)
      ? distance(model.proposal.minimumRadius)
      : 'Straight (∞)';
    this.geometrySummary.textContent = `Minimum radius ${radius} · Grade ${model.proposal.maximumGradePercent.toFixed(1)}%`;
    const lengths = model.structureLengths;
    const costs = model.proposal.costs;
    this.detail.textContent = [
      `Length ${distance(model.proposal.length)} · Minimum radius ${radius}`,
      `Maximum grade ${model.proposal.maximumGradePercent.toFixed(1)}% at ${distance(model.proposal.maximumGradeDistance)}`,
      `Surface ${distance(lengths.surface)} · Cut ${distance(lengths.cut)} · Fill ${distance(lengths.fill)}`,
      `Bridge ${distance(lengths.bridge)} · Tunnel ${distance(lengths.tunnel)}`,
      `Track ${money(costs.track)} · Earthworks ${money(costs.earthworks)}`,
      `Bridge ${money(costs.bridge)} · Tunnel ${money(costs.tunnel)} · Topology ${money(model.topologyCost)}`,
    ].join('\n');
    const hardBlocker = model.phase === 'review'
      && !model.canConfirm
      && model.message.length > 0;
    const reserveWarning = model.breachesReserve && !hardBlocker;
    const message = reserveWarning
      ? `Build leaves less than ${money(model.guidance.reserve)}`
        + ` reserved for ${model.guidance.reservePurpose}`
      : model.message;
    this.remedy.textContent = message;
    this.remedy.dataset.tone = reserveWarning ? 'amber' : 'default';
    this.remedy.style.background = reserveWarning ? '#5c430f' : '#102c42';
    this.remedy.style.display = message ? 'block' : 'none';
    this.confirmButton.disabled = !this.enabled
      || !model.canConfirm
      || model.actions.indexOf('confirm') === -1;
    this.confirmButton.textContent = this.confirmButton.disabled ? 'Cannot build' : 'Build';
    this.backButton.disabled = !this.enabled || model.actions.indexOf('backstep') === -1;
    this.cancelButton.disabled = !this.enabled || model.actions.indexOf('cancel') === -1;
  }

  private emitIntent(action: 'confirm' | 'backstep' | 'cancel'): void {
    if (!this.enabled || !this.current) return;
    if (action === 'confirm' && !this.current.canConfirm) return;
    if (this.current.actions.indexOf(action) === -1) return;
    EventBus.emit('construction:intent', { action });
  }

  private renderShapeControls(model: ConstructionPreviewModel): void {
    const draft = model.draft;
    this.shapeControls.style.display = draft && model.phase === 'review' ? 'block' : 'none';
    if (!draft) return;
    const selected = draft.selectedHandle;
    const directionSelected = selected && isDirectionHandle(selected);
    const start = selected === 'start-direction';
    const locked = start ? draft.startDirectionLocked : draft.endDirectionLocked;
    this.startDirection.setAttribute('aria-pressed', String(start));
    this.endDirection.setAttribute('aria-pressed', String(selected === 'end-direction'));
    this.startDirection.style.borderColor = start ? '#fff' : '#67e6ff';
    this.endDirection.style.borderColor = selected === 'end-direction' ? '#fff' : '#ffd17c';
    this.rotateLeft.disabled = this.rotateRight.disabled = !directionSelected || locked;
    this.shorter.disabled = this.longer.disabled = !directionSelected;
    this.undoShape.disabled = !draft.canUndo;
    const geometry = model.proposal.geometry;
    const startAngle = Math.atan2(geometry.p1.y - geometry.p0.y, geometry.p1.x - geometry.p0.x) * 180 / Math.PI;
    const endAngle = Math.atan2(geometry.p3.y - geometry.p2.y, geometry.p3.x - geometry.p2.x) * 180 / Math.PI;
    this.startDirection.textContent = `Start ${Math.round(startAngle)}°${draft.startDirectionLocked ? ' · linked' : ''}`;
    this.endDirection.textContent = `Finish ${Math.round(endAngle)}°${draft.endDirectionLocked ? ' · linked' : ''}`;
    this.shapeHelp.textContent = directionSelected
      ? locked
        ? 'Direction matches connected rail. Drag along the guide or adjust approach length.'
        : 'Drag this handle, tap a new position, or use the angle and approach buttons.'
      : 'Drag a direction handle to shape the curve. Select Start or Finish for tap placement. Drag an endpoint to move it.';
  }

  private emitShapeIntent(intent: TrackDraftIntent): void {
    if (!this.enabled || this.current?.phase !== 'review' || !this.current.draft) return;
    EventBus.emit('construction:shape-intent', intent);
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
      this.root.style.maxHeight = '52vh';
    } else {
      this.root.style.left = 'auto';
      this.root.style.right = '14px';
      this.root.style.top = '14px';
      this.root.style.bottom = 'auto';
      this.root.style.width = '360px';
      this.root.style.maxHeight = window.innerHeight <= 600
        ? 'calc(100vh - 28px)' : 'calc(100vh - 88px)';
    }
  }

  setVisible(visible: boolean): void {
    this.enabled = visible;
    if (!visible) {
      this.clear();
      return;
    }
    this.root.style.display = this.current ? 'block' : 'none';
    this.root.setAttribute('aria-hidden', this.current ? 'false' : 'true');
  }

  clear(): void {
    this.current = null;
    this.primary.textContent = '';
    this.subtotal.textContent = '';
    this.geometrySummary.textContent = '';
    this.detail.textContent = '';
    this.remedy.textContent = '';
    this.remedy.style.display = 'none';
    this.shapeControls.style.display = 'none';
    this.confirmButton.disabled = true;
    this.backButton.disabled = true;
    this.cancelButton.disabled = true;
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
    EventBus.off('construction:preview', this.previewHandler);
    window.removeEventListener('resize', this.resizeHandler);
    this.root.remove();
    this.current = null;
  }
}
