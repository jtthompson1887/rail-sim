import MenuScene from '../../src/scenes/MenuScene';
import { SaveService } from '../../src/services/SaveService';
import { MenuRailway } from '../../src/presentation/MenuRailway';

jest.mock('../../src/presentation/MenuRailway', () => ({
  MenuRailway: jest.fn().mockImplementation(() => ({
    setPaused: jest.fn(), update: jest.fn(), destroy: jest.fn(),
  })),
}));

jest.mock('../../src/services/SaveService', () => ({
  SaveService: {
    getLastPlayedWorldId: jest.fn(() => null),
    loadWorld: jest.fn(() => null),
    saveWorld: jest.fn(() => true),
  },
}));

jest.mock('../../src/region/RiversideRegion', () => ({
  createRiversideRegion: jest.fn(() => ({ id: 'brookford-test', name: 'Brookford' })),
}));

function button(label: string): HTMLButtonElement {
  return document.querySelector(`button[aria-label="${label}"]`)!;
}

function createMenu() {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const start = jest.fn();
  let shutdown: () => void = () => {};
  const menu = new MenuScene();
  Object.assign(menu, {
    game: { canvas },
    scene: { start },
    events: { once: jest.fn((_event, handler) => { shutdown = handler; }) },
  });
  menu.create();
  return { start, shutdown: () => { shutdown(); canvas.remove(); } };
}

describe('Main menu navigation and lifecycle', () => {
  let current: ReturnType<typeof createMenu> | undefined;
  beforeEach(() => {
    jest.clearAllMocks();
    (SaveService.getLastPlayedWorldId as jest.Mock).mockReturnValue(null);
    (SaveService.loadWorld as jest.Mock).mockReturnValue(null);
    (SaveService.saveWorld as jest.Mock).mockReturnValue(true);
  });
  afterEach(() => {
    current?.shutdown();
    current = undefined;
    document.body.replaceChildren();
    delete (window as any).matchMedia;
  });

  it('starts a new railway without requiring an existing save', () => {
    current = createMenu();
    expect(button('Continue').disabled).toBe(true);
    button('Play Brookford').click();
    button('Play Brookford').click();
    expect(current.start).toHaveBeenCalledTimes(1);
    expect(current.start).toHaveBeenCalledWith('WorldScene', { worldId: 'brookford-test', mode: 'create' });
  });

  it('keeps navigation usable and explains a failed quick-start save', () => {
    (SaveService.saveWorld as jest.Mock).mockReturnValue(false);
    current = createMenu();
    button('Play Brookford').click();
    expect(current.start).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLElement>('[role="alert"]')!.hidden).toBe(false);
    button('Your railways').click();
    expect(current.start).toHaveBeenCalledWith('WorldSelectScene');
  });

  it.each([
    ['Your railways', 'WorldSelectScene'],
    ['Settings', 'SettingsScene'],
  ])('opens %s', (label, destination) => {
    current = createMenu();
    button(label).click();
    expect(current.start).toHaveBeenCalledWith(destination);
  });

  it('continues the actual last world and safely displays its name', () => {
    (SaveService.getLastPlayedWorldId as jest.Mock).mockReturnValue('river-17');
    (SaveService.loadWorld as jest.Mock).mockReturnValue({ name: '<img src=x onerror=alert(1)>' });
    current = createMenu();
    const continueButton = button('Continue');
    expect(continueButton.disabled).toBe(false);
    expect(continueButton.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(continueButton.querySelector('img')).toBeNull();
    continueButton.click();
    expect(current.start).toHaveBeenCalledWith('WorldScene', { worldId: 'river-17', mode: 'create' });
  });

  it('does not advertise Continue for a stale or incompatible save', () => {
    (SaveService.getLastPlayedWorldId as jest.Mock).mockReturnValue('missing');
    current = createMenu();
    expect(button('Continue').disabled).toBe(true);
    button('Continue').click();
    expect(current.start).not.toHaveBeenCalled();
  });

  it('returns to the library if the save disappears while the menu is open', () => {
    (SaveService.getLastPlayedWorldId as jest.Mock).mockReturnValue('river-17');
    (SaveService.loadWorld as jest.Mock).mockReturnValueOnce({ name: 'Northmere' });
    current = createMenu();
    button('Continue').click();
    expect(current.start).toHaveBeenCalledWith('WorldSelectScene');
  });

  it('preserves the Enter library shortcut, then removes it on shutdown', () => {
    current = createMenu();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(current.start).toHaveBeenCalledWith('WorldSelectScene');
    current.shutdown();
    current.start.mockClear();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(current.start).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="main-menu"]')).toBeNull();
  });

  it('leaves focused button activation to the browser instead of opening the library', () => {
    current = createMenu();
    const settings = button('Settings');
    settings.focus();
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    settings.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(current.start).not.toHaveBeenCalled();
  });

  it('honours reduced motion, supports an explicit override and releases listeners', () => {
    const addEventListener = jest.fn();
    const removeEventListener = jest.fn();
    window.matchMedia = jest.fn().mockReturnValue({ matches: true, addEventListener, removeEventListener });
    current = createMenu();
    const root = document.querySelector<HTMLElement>('[data-testid="main-menu"]')!;
    expect(root.dataset.motion).toBe('paused');
    const railway = (MenuRailway as jest.Mock).mock.results[0].value;
    expect(railway.setPaused).toHaveBeenLastCalledWith(true);
    button('Play preview').click();
    expect(root.dataset.motion).toBe('playing');
    expect(current.start).not.toHaveBeenCalled();
    expect(railway.setPaused).toHaveBeenLastCalledWith(false);
    addEventListener.mock.calls[0][1]({ matches: true });
    expect(root.dataset.motion).toBe('paused');
    expect(railway.setPaused).toHaveBeenLastCalledWith(true);
    current.shutdown();
    expect(removeEventListener).toHaveBeenCalledWith('change', addEventListener.mock.calls[0][1]);
    expect(railway.destroy).toHaveBeenCalled();
  });
});
