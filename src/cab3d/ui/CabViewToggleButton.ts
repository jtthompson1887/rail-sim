import { EventBus } from '../../services/EventBus';

/**
 * DOM toggle button for the 3-D cab view.
 *
 * Follows the {@link CompanyHud} pattern: plain HTML/CSS, no framework.
 * The button is visible only in play mode with a selected train.
 */
export class CabViewToggleButton {
  private readonly root: HTMLButtonElement;
  private playMode = false;
  private trainSelected = false;
  private cabActive = false;

  constructor() {
    this.root = document.createElement('button');
    this.root.type = 'button';
    this.root.dataset.testid = 'cab-view-toggle';
    this.root.setAttribute('aria-label', 'Open cab view');
    this.root.textContent = 'Cab';
    this.root.style.cssText = [
      'position:fixed',
      'box-sizing:border-box',
      'z-index:1510',
      'right:12px',
      'top:12px',
      'display:none',
      'padding:8px 14px',
      'border:1px solid rgba(102,202,255,.4)',
      'border-radius:6px',
      'background:rgba(6,19,31,.92)',
      'color:#d8efff',
      'font:13px Verdana,sans-serif',
      'cursor:pointer',
      'pointer-events:auto',
    ].join(';');

    document.body.append(this.root);
    this.applyVisibility();

    this.root.addEventListener('click', this.handleClick);
    EventBus.on('mode:changed', this.handleModeChanged);
    EventBus.on('train:selected', this.handleTrainSelected);
    EventBus.on('train:deselected', this.handleTrainDeselected);
    EventBus.on('cab:state', this.handleCabState);
  }

  /** Remove the button and release EventBus listeners. */
  destroy(): void {
    this.root.remove();
    this.root.removeEventListener('click', this.handleClick);
    EventBus.off('mode:changed', this.handleModeChanged);
    EventBus.off('train:selected', this.handleTrainSelected);
    EventBus.off('train:deselected', this.handleTrainDeselected);
    EventBus.off('cab:state', this.handleCabState);
  }

  private readonly handleClick = (): void => {
    EventBus.emit('cab:toggle', {});
  };

  private readonly handleModeChanged = ({ mode }: { mode: 'create' | 'play' }): void => {
    this.playMode = mode === 'play';
    this.applyVisibility();
  };

  private readonly handleTrainSelected = (): void => {
    this.trainSelected = true;
    this.applyVisibility();
  };

  private readonly handleTrainDeselected = (): void => {
    this.trainSelected = false;
    this.applyVisibility();
  };

  private readonly handleCabState = ({ active }: { active: boolean }): void => {
    this.cabActive = active;
    this.applyVisibility();
  };

  private applyVisibility(): void {
    const visible = this.playMode && this.trainSelected && !this.cabActive;
    this.root.style.display = visible ? 'block' : 'none';
    this.root.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }
}
