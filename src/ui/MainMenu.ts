import { MAIN_MENU_STYLES } from './MainMenuStyles';

type MenuAction = () => void | boolean;

interface MainMenuOptions {
  parent: HTMLElement;
  savedWorldName?: string;
  onMotionChange?: (paused: boolean) => void;
  onNew: MenuAction;
  onContinue: MenuAction;
  onWorlds: MenuAction;
  onSettings: MenuAction;
}

const ICON_PATHS = {
  rail: '<path d="m8 3-3 18M16 3l3 18M7 7h10M6 12h12M5 17h14"/>',
  play: '<path d="m9 5 11 7-11 7Z"/>',
  worlds: '<path d="m3 6 6-2 6 2 6-2v15l-6 2-6-2-6 2ZM9 4v15M15 6v15"/>',
  settings: '<path d="M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
} as const;

function icon(name: keyof typeof ICON_PATHS, className = ''): string {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
}

/** Local title-screen DOM; callbacks alone can enter another scene. */
export class MainMenu {
  private readonly root = document.createElement('main');
  private readonly motionButton = document.createElement('button');
  private readonly reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  private motionPaused = this.reducedMotion?.matches ?? false;
  private leaving = false;

  private readonly onMotionPreference = (event: MediaQueryListEvent) => {
    this.motionPaused = event.matches;
    this.renderMotionState();
  };
  private readonly onVisibility = () => {
    this.root.dataset.hidden = String(document.hidden);
    this.options.onMotionChange?.(this.motionPaused || document.hidden);
  };
  private readonly onKeyUp = (event: KeyboardEvent) => {
    if ((event.key === ' ' || event.key === 'Enter')
      && event.target instanceof HTMLButtonElement && this.root.contains(event.target)) {
      // Space activates a native button on keyup; retained Phaser key captures
      // from play must not prevent that default action when returning here.
      event.stopImmediatePropagation();
    }
  };
  private readonly onKeyboard = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    const inMenu = target instanceof Node && this.root.contains(target);
    const buttons = [...this.root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      .filter(button => button.getClientRects().length > 0);
    if (inMenu && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      if (!inMenu && target !== document.body && target !== document.documentElement
        && !(target instanceof HTMLCanvasElement)) return;
      // Stop Phaser's shared keyboard captures from stealing native button activation.
      event.stopImmediatePropagation();
      if (event.repeat) { event.preventDefault(); return; }
      if (!inMenu || !(target instanceof HTMLButtonElement)) {
        event.preventDefault();
        // Preserve the existing Enter/Space shortcut to the railway chooser.
        this.navigate(this.options.onWorlds);
      }
    }
  };

  constructor(private readonly options: MainMenuOptions) {
    this.root.className = 'rail-main-menu';
    this.root.dataset.testid = 'main-menu';
    this.root.setAttribute('aria-label', 'Rail Sim main menu');
    // Only static authored markup is interpolated. Saved names use textContent.
    this.root.innerHTML = `
      <style>${MAIN_MENU_STYLES}</style>
      <div class="rmm-veil"></div>
      <div class="rmm-layout">
        <header class="rmm-topline">
          <div class="rmm-brand">${icon('rail', 'rmm-brand-mark')}<span>A world connected</span></div>
          <span class="rmm-top-note">Design &nbsp;·&nbsp; Operate &nbsp;·&nbsp; Discover</span>
        </header>
        <div class="rmm-main"><div class="rmm-content">
          <p class="rmm-eyebrow">Your railway. Your way.</p>
          <h1>Rail Sim</h1>
          <p class="rmm-tagline">Build a railway.<br> Bring a region to life.</p>
          <div class="rmm-rule" aria-hidden="true"></div>
          <nav aria-label="Main menu"></nav>
          <p class="rmm-error" role="alert" hidden></p>
        </div></div>
        <footer class="rmm-footer">
          <p class="rmm-hint"><kbd>Enter</kbd> Your railways <span aria-hidden="true">&nbsp;·&nbsp;</span> <kbd>Tab</kbd> Explore</p>
          <div class="rmm-caption"><p class="rmm-caption-title">Every line starts somewhere.</p><p class="rmm-caption-note">Brookford · Live railway</p></div>
        </footer>
      </div>`;

    const hasSave = options.savedWorldName !== undefined;
    if (hasSave) {
      this.addAction('Continue', 'play', options.onContinue, options.savedWorldName || 'Your railway', true);
    }
    this.addAction('Play Brookford', 'rail', options.onNew, 'A railway by the river', !hasSave);
    if (!hasSave) this.addAction('Continue', 'play', options.onContinue, 'Your saved railway will appear here', false, true);
    this.addAction('Your railways', 'worlds', options.onWorlds);
    this.addAction('Settings', 'settings', options.onSettings);

    this.motionButton.type = 'button';
    this.motionButton.className = 'rmm-motion';
    this.motionButton.addEventListener('click', () => {
      this.motionPaused = !this.motionPaused;
      this.renderMotionState();
    });
    this.root.querySelector('footer')!.append(this.motionButton);
    this.renderMotionState();
    this.onVisibility();
    options.parent.append(this.root);
    this.reducedMotion?.addEventListener('change', this.onMotionPreference);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('keydown', this.onKeyboard, true);
    window.addEventListener('keyup', this.onKeyUp, true);
  }

  destroy(): void {
    this.leaving = true;
    this.reducedMotion?.removeEventListener('change', this.onMotionPreference);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('keydown', this.onKeyboard, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    this.root.remove();
  }

  private addAction(
    label: string, glyph: keyof typeof ICON_PATHS, action: MenuAction,
    detail?: string, primary = false, disabled = false,
  ): void {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `rmm-action${primary ? ' rmm-primary' : ''}${disabled ? ' rmm-disabled' : ''}`;
    button.disabled = disabled;
    button.setAttribute('aria-label', label);
    button.innerHTML = `${icon(glyph)}<span class="rmm-action-label"><strong></strong></span>${icon('arrow', 'rmm-arrow')}`;
    button.querySelector('strong')!.textContent = label;
    if (detail !== undefined) {
      const small = document.createElement('small');
      small.textContent = detail;
      small.id = `rail-main-menu-detail-${this.root.querySelectorAll('nav button').length}`;
      button.setAttribute('aria-describedby', small.id);
      button.querySelector('.rmm-action-label')!.append(small);
    }
    button.addEventListener('click', () => this.navigate(action));
    this.root.querySelector('nav')!.append(button);
  }

  private navigate(action: MenuAction): void {
    if (this.leaving) return;
    this.leaving = true;
    const error = this.root.querySelector<HTMLElement>('.rmm-error')!;
    error.hidden = true;
    try {
      if (action() !== false) return;
    } catch (cause) {
      console.error('Main menu action failed', cause);
    }
    this.leaving = false;
    error.textContent = 'Could not open the railway. Try again, or open Your railways to choose an existing save.';
    error.hidden = false;
  }

  private renderMotionState(): void {
    this.root.dataset.motion = this.motionPaused ? 'paused' : 'playing';
    const label = this.motionPaused ? 'Play preview' : 'Pause preview';
    this.motionButton.setAttribute('aria-label', label);
    this.motionButton.innerHTML = `${icon(this.motionPaused ? 'play' : 'pause')}<span>${label}</span>`;
    this.options.onMotionChange?.(this.motionPaused || document.hidden);
  }
}
