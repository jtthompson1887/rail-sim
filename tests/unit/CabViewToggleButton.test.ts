import { CabViewToggleButton } from '../../src/cab3d/ui/CabViewToggleButton';
import { EventBus } from '../../src/services/EventBus';

describe('CabViewToggleButton', () => {
  let button: CabViewToggleButton;
  let toggleEvents: Array<Record<string, never>>;
  let toggleHandler: () => void;

  beforeEach(() => {
    document.body.innerHTML = '';
    toggleEvents = [];
    toggleHandler = () => toggleEvents.push({});
    EventBus.on('cab:toggle', toggleHandler);
    button = new CabViewToggleButton();
  });

  afterEach(() => {
    EventBus.off('cab:toggle', toggleHandler);
    button.destroy();
    document.body.innerHTML = '';
  });

  it('renders with the expected test id and aria label', () => {
    const el = document.querySelector('[data-testid="cab-view-toggle"]');
    expect(el).toBeInstanceOf(HTMLButtonElement);
    expect(el?.getAttribute('aria-label')).toBe('Open cab view');
    expect((el as HTMLButtonElement | null)?.textContent).toBe('Cab');
  });

  it('is hidden by default', () => {
    const el = document.querySelector('[data-testid="cab-view-toggle"]') as HTMLElement;
    expect(el.style.display).toBe('none');
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  it('becomes visible in play mode with a selected train', () => {
    const el = document.querySelector('[data-testid="cab-view-toggle"]') as HTMLElement;

    EventBus.emit('mode:changed', { mode: 'play' });
    expect(el.style.display).toBe('none');

    EventBus.emit('train:selected', { trainId: 't1' });
    expect(el.style.display).toBe('block');
    expect(el.getAttribute('aria-hidden')).toBe('false');
  });

  it('hides when the train is deselected', () => {
    const el = document.querySelector('[data-testid="cab-view-toggle"]') as HTMLElement;
    EventBus.emit('mode:changed', { mode: 'play' });
    EventBus.emit('train:selected', { trainId: 't1' });
    expect(el.style.display).toBe('block');

    EventBus.emit('train:deselected', {});
    expect(el.style.display).toBe('none');
  });

  it('hides when returning to create mode', () => {
    const el = document.querySelector('[data-testid="cab-view-toggle"]') as HTMLElement;
    EventBus.emit('mode:changed', { mode: 'play' });
    EventBus.emit('train:selected', { trainId: 't1' });
    expect(el.style.display).toBe('block');

    EventBus.emit('mode:changed', { mode: 'create' });
    expect(el.style.display).toBe('none');
  });

  it('hides while the cab view is active', () => {
    const el = document.querySelector('[data-testid="cab-view-toggle"]') as HTMLElement;
    EventBus.emit('mode:changed', { mode: 'play' });
    EventBus.emit('train:selected', { trainId: 't1' });
    expect(el.style.display).toBe('block');

    EventBus.emit('cab:state', { active: true });
    expect(el.style.display).toBe('none');

    EventBus.emit('cab:state', { active: false });
    expect(el.style.display).toBe('block');
  });

  it('emits cab:toggle when clicked', () => {
    const el = document.querySelector('[data-testid="cab-view-toggle"]') as HTMLElement;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(toggleEvents).toHaveLength(1);
  });

  it('is removed from the DOM on destroy', () => {
    button.destroy();
    expect(document.querySelector('[data-testid="cab-view-toggle"]')).toBeNull();
  });
});
