import { EventBus } from '../../services/EventBus';
import { buildInstrumentValues } from '../cab/CabInstrumentModel';
import { getSimHours } from '../atmosphere/CabTimeOfDay';
import type { CabWorldSnapshot } from '../model/CabWorldSnapshot';
import {
  type CabQualitySetting,
  CAB_QUALITY_SETTINGS,
  DEFAULT_QUALITY_SETTING,
  getQualityTierLabel,
} from '../quality';

/**
 * DOM HUD overlay for the 3-D cab view.
 *
 * Shown only while the cab view is active. The overlay root uses
 * `pointer-events: none` so the look controller receives touch events on empty
 * areas; interactive children re-enable pointer events.
 */
export class CabHudOverlay {
  private readonly root: HTMLElement;
  private readonly speed: HTMLElement;
  private readonly throttleFill: HTMLElement;
  private readonly facility: HTMLElement;
  private readonly weather: HTMLElement;
  private readonly time: HTMLElement;
  private readonly qualitySelect: HTMLSelectElement;
  private readonly qualityLabel: HTMLElement;
  private readonly exit: HTMLButtonElement;

  private currentTier: CabQualitySetting = DEFAULT_QUALITY_SETTING;

  constructor() {
    this.root = document.createElement('section');
    this.root.dataset.testid = 'cab-hud';
    this.root.setAttribute('aria-label', 'Cab view HUD');
    this.root.style.cssText = [
      'position:fixed',
      'box-sizing:border-box',
      'z-index:1600',
      'left:0',
      'top:0',
      'width:100%',
      'height:100%',
      'display:none',
      'padding:12px',
      'pointer-events:none',
      'font:13px Verdana,sans-serif',
      'color:#d8efff',
    ].join(';');

    const panel = document.createElement('div');
    panel.style.cssText = [
      'position:absolute',
      'left:12px',
      'top:12px',
      'display:flex',
      'flex-direction:column',
      'gap:8px',
      'padding:10px 12px',
      'border:1px solid rgba(102,202,255,.3)',
      'border-radius:6px',
      'background:rgba(6,19,31,.85)',
      'pointer-events:auto',
    ].join(';');

    this.speed = this.createReadout('cab-hud-speed');
    this.speed.setAttribute('aria-live', 'polite');

    const throttleRow = document.createElement('div');
    throttleRow.dataset.testid = 'cab-hud-throttle';
    throttleRow.style.cssText = [
      'position:relative',
      'width:100px',
      'height:10px',
      'background:rgba(255,255,255,.15)',
      'border-radius:5px',
    ].join(';');
    const center = document.createElement('div');
    center.style.cssText = [
      'position:absolute',
      'left:50%',
      'top:0',
      'width:2px',
      'height:100%',
      'background:rgba(255,255,255,.5)',
    ].join(';');
    this.throttleFill = document.createElement('div');
    this.throttleFill.dataset.testid = 'cab-hud-throttle-fill';
    this.throttleFill.style.cssText = [
      'position:absolute',
      'top:0',
      'height:100%',
      'border-radius:5px',
    ].join(';');
    throttleRow.append(center, this.throttleFill);

    this.facility = this.createReadout('cab-hud-facility');
    this.facility.setAttribute('aria-live', 'polite');

    this.weather = this.createReadout('cab-hud-weather');
    this.time = this.createReadout('cab-hud-time');

    this.qualityLabel = this.createReadout('cab-hud-quality-label');
    this.qualitySelect = document.createElement('select');
    this.qualitySelect.dataset.testid = 'cab-hud-quality';
    this.qualitySelect.setAttribute('aria-label', 'Quality tier');
    this.qualitySelect.style.cssText = [
      'background:rgba(0,0,0,.4)',
      'color:#d8efff',
      'border:1px solid rgba(102,202,255,.3)',
      'border-radius:4px',
      'padding:2px 6px',
      'font:inherit',
    ].join(';');
    for (const tier of CAB_QUALITY_SETTINGS) {
      const option = document.createElement('option');
      option.value = tier;
      option.textContent = getQualityTierLabel(tier);
      this.qualitySelect.append(option);
    }
    this.qualitySelect.value = this.currentTier;
    this.qualitySelect.addEventListener('change', this.handleQualityChange);
    this.renderQualityLabel();

    const qualityRow = document.createElement('div');
    qualityRow.append(this.qualityLabel, this.qualitySelect);
    qualityRow.style.cssText = 'display:flex;align-items:center;gap:8px';

    this.exit = document.createElement('button');
    this.exit.type = 'button';
    this.exit.dataset.testid = 'cab-hud-exit';
    this.exit.setAttribute('aria-label', 'Close cab view');
    this.exit.textContent = 'Exit';
    this.exit.style.cssText = [
      'align-self:flex-start',
      'padding:6px 12px',
      'border:1px solid rgba(102,202,255,.4)',
      'border-radius:4px',
      'background:rgba(6,19,31,.9)',
      'color:#d8efff',
      'font:inherit',
      'cursor:pointer',
      'pointer-events:auto',
    ].join(';');
    this.exit.addEventListener('click', this.handleExit);

    panel.append(
      this.speed,
      throttleRow,
      this.facility,
      this.weather,
      this.time,
      qualityRow,
      this.exit,
    );
    this.root.append(panel);
    document.body.append(this.root);

    // Reuse the existing mobile throttle channel to mirror transient input.
    EventBus.on('mobile:throttle', this.handleMobileThrottle);
  }

  /** Show the overlay. */
  show(): void {
    this.root.style.display = 'block';
    this.root.setAttribute('aria-hidden', 'false');
  }

  /** Hide the overlay. */
  hide(): void {
    this.root.style.display = 'none';
    this.root.setAttribute('aria-hidden', 'true');
  }

  /** Update readouts from the latest world snapshot. */
  update(snapshot: Readonly<CabWorldSnapshot>): void {
    const values = buildInstrumentValues(snapshot);

    const speedMph = Math.round(values.speedMph);
    this.speed.textContent = `${speedMph} mph`;

    if (values.powerFraction > 0) {
      this.throttleFill.style.left = '50%';
      this.throttleFill.style.width = `${values.powerFraction * 50}%`;
      this.throttleFill.style.backgroundColor = '#4ad54a';
    } else if (values.brakeFraction > 0) {
      const width = values.brakeFraction * 50;
      this.throttleFill.style.left = `${50 - width}%`;
      this.throttleFill.style.width = `${width}%`;
      this.throttleFill.style.backgroundColor = '#d54a4a';
    } else {
      this.throttleFill.style.left = '50%';
      this.throttleFill.style.width = '0%';
      this.throttleFill.style.backgroundColor = 'transparent';
    }

    const distance = snapshot.nearestFacilityDistanceM;
    this.facility.textContent = typeof distance === 'number'
      ? `${Math.round(distance)} m`
      : '—';

    const weatherState = snapshot.weather?.state ?? null;
    this.weather.textContent = weatherState
      ? this.capitalise(weatherState)
      : '—';
    this.weather.className = weatherState
      ? `cab-hud-weather--${weatherState}`
      : '';

    this.time.textContent = this.formatTime(getSimHours(snapshot.elapsedSecs));

    if (snapshot.reducedMotion) {
      this.root.classList.add('cab-hud--reduced-motion');
    } else {
      this.root.classList.remove('cab-hud--reduced-motion');
    }
  }

  /** Remove the overlay and release listeners. */
  destroy(): void {
    this.qualitySelect.removeEventListener('change', this.handleQualityChange);
    this.exit.removeEventListener('click', this.handleExit);
    EventBus.off('mobile:throttle', this.handleMobileThrottle);
    this.root.remove();
  }

  private createReadout(testId: string): HTMLElement {
    const el = document.createElement('div');
    el.dataset.testid = testId;
    el.style.cssText = 'min-height:1.2em';
    return el;
  }

  private readonly handleQualityChange = (): void => {
    const value = this.qualitySelect.value as CabQualitySetting;
    this.currentTier = value;
    this.renderQualityLabel();
    EventBus.emit('cab:quality', { tier: value });
  };

  private readonly handleExit = (): void => {
    EventBus.emit('cab:toggle', {});
  };

  private readonly handleMobileThrottle = ({ value }: { value: number }): void => {
    // The throttle bar is updated each frame from the vehicle snapshot.
    // This listener exists so the HUD is subscribed to the existing mobile
    // throttle channel and can be extended later without adding new channels.
    void value;
  };

  private renderQualityLabel(): void {
    this.qualityLabel.textContent = `Quality: ${getQualityTierLabel(this.currentTier)}`;
  }

  private capitalise(value: string): string {
    if (value.length === 0) return value;
    return value[0].toUpperCase() + value.slice(1);
  }

  private formatTime(simHours: number): string {
    const totalMinutes = Math.floor(simHours * 60);
    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;
    const hh = hours < 10 ? `0${hours}` : `${hours}`;
    const mm = minutes < 10 ? `0${minutes}` : `${minutes}`;
    return `${hh}:${mm}`;
  }
}
