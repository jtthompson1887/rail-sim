import { CabHudOverlay } from '../../src/cab3d/ui/CabHudOverlay';
import { EventBus } from '../../src/services/EventBus';
import type { CabWorldSnapshot, CabVehicleSnapshot } from '../../src/cab3d/model/CabWorldSnapshot';
import { DEFAULT_WEATHER } from '../../src/cab3d/atmosphere/CabWeatherModel';

describe('CabHudOverlay', () => {
  let overlay: CabHudOverlay;
  let toggleEvents: Array<Record<string, never>>;
  let toggleHandler: () => void;
  let qualityEvents: Array<{ tier: string }>;
  let qualityHandler: (data: { tier: string }) => void;

  function makeVehicle(overrides: Partial<CabVehicleSnapshot> = {}): CabVehicleSnapshot {
    return {
      id: 't1',
      x: 0,
      y: 0,
      headingRad: 0,
      speedMps: 10,
      throttle: 0.5,
      derailed: false,
      onTrack: true,
      ...overrides,
    };
  }

  function makeSnapshot(overrides: Partial<CabWorldSnapshot> = {}): CabWorldSnapshot {
    return {
      valid: true,
      seed: 'test',
      biome: 'temperate',
      vehicle: makeVehicle(),
      path: [],
      elapsedSecs: 3600,
      weather: DEFAULT_WEATHER,
      nearestFacilityDistanceM: 250,
      ...overrides,
    };
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    toggleEvents = [];
    toggleHandler = () => toggleEvents.push({});
    qualityEvents = [];
    qualityHandler = (data) => qualityEvents.push(data);
    EventBus.on('cab:toggle', toggleHandler);
    EventBus.on('cab:quality', qualityHandler);
    overlay = new CabHudOverlay();
  });

  afterEach(() => {
    EventBus.off('cab:toggle', toggleHandler);
    EventBus.off('cab:quality', qualityHandler);
    overlay.destroy();
    document.body.innerHTML = '';
  });

  it('renders the overlay element with the expected test id', () => {
    const el = document.querySelector('[data-testid="cab-hud"]');
    expect(el).toBeInstanceOf(HTMLElement);
  });

  it('is hidden by default', () => {
    const el = document.querySelector('[data-testid="cab-hud"]') as HTMLElement;
    expect(el.style.display).toBe('none');
  });

  it('shows and hides via the public methods', () => {
    const el = document.querySelector('[data-testid="cab-hud"]') as HTMLElement;
    overlay.show();
    expect(el.style.display).toBe('block');
    expect(el.getAttribute('aria-hidden')).toBe('false');

    overlay.hide();
    expect(el.style.display).toBe('none');
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  it('displays speed, facility distance, weather, and time', () => {
    overlay.show();
    overlay.update(makeSnapshot());

    expect(document.querySelector('[data-testid="cab-hud-speed"]')?.textContent).toBe('22 mph');
    expect(document.querySelector('[data-testid="cab-hud-facility"]')?.textContent).toBe('250 m');
    expect(document.querySelector('[data-testid="cab-hud-weather"]')?.textContent).toBe('Clear');
    expect(document.querySelector('[data-testid="cab-hud-time"]')?.textContent).toMatch(/^\d{2}:\d{2}$/);
  });

  it('renders dashes when weather and facility are unavailable', () => {
    overlay.show();
    overlay.update(makeSnapshot({ weather: null, nearestFacilityDistanceM: null }));

    expect(document.querySelector('[data-testid="cab-hud-facility"]')?.textContent).toBe('—');
    expect(document.querySelector('[data-testid="cab-hud-weather"]')?.textContent).toBe('—');
  });

  it('updates the throttle bar for power and brake', () => {
    overlay.show();
    overlay.update(makeSnapshot({ vehicle: makeVehicle({ throttle: 0.6 }) }));

    const fill = document.querySelector('[data-testid="cab-hud-throttle-fill"]') as HTMLElement;
    expect(fill.style.left).toBe('50%');
    expect(fill.style.width).toBe('30%');
    expect(fill.style.backgroundColor).toMatch(/4ad54a|rgb\(74,\s*213,\s*74\)/i);

    overlay.update(makeSnapshot({ vehicle: makeVehicle({ throttle: -0.8 }) }));
    expect(fill.style.left).toBe('10%');
    expect(fill.style.width).toBe('40%');
    expect(fill.style.backgroundColor).toMatch(/d54a4a|rgb\(213,\s*74,\s*74\)/i);
  });

  it('applies the reduced-motion class from the snapshot', () => {
    overlay.show();
    const el = document.querySelector('[data-testid="cab-hud"]') as HTMLElement;

    overlay.update(makeSnapshot({ reducedMotion: false }));
    expect(el.classList.contains('cab-hud--reduced-motion')).toBe(false);

    overlay.update(makeSnapshot({ reducedMotion: true }));
    expect(el.classList.contains('cab-hud--reduced-motion')).toBe(true);

    overlay.update(makeSnapshot({ reducedMotion: false }));
    expect(el.classList.contains('cab-hud--reduced-motion')).toBe(false);
  });

  it('emits cab:toggle when the exit button is clicked', () => {
    overlay.show();
    const exit = document.querySelector('[data-testid="cab-hud-exit"]') as HTMLElement;
    exit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(toggleEvents).toHaveLength(1);
  });

  it('exposes a quality tier selector defaulting to auto', () => {
    overlay.show();
    const select = document.querySelector('[data-testid="cab-hud-quality"]') as HTMLSelectElement;
    expect(select).toBeInstanceOf(HTMLSelectElement);
    expect(select.value).toBe('auto');

    select.value = 'high';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(select.value).toBe('high');
    expect(document.querySelector('[data-testid="cab-hud-quality-label"]')?.textContent).toBe('Quality: High');
  });

  it('emits cab:quality when the quality selector changes', () => {
    overlay.show();
    const select = document.querySelector('[data-testid="cab-hud-quality"]') as HTMLSelectElement;

    select.value = 'low';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(qualityEvents).toContainEqual({ tier: 'low' });
  });

  it('is removed from the DOM on destroy', () => {
    overlay.destroy();
    expect(document.querySelector('[data-testid="cab-hud"]')).toBeNull();
  });
});
