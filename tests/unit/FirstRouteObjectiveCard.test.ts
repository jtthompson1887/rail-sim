/**
 * @jest-environment jsdom
 */
import type { FirstRouteObjectiveDto } from '../../src/freight/FirstRouteObjective';
import { EventBus } from '../../src/services/EventBus';
import { FirstRouteObjectiveCard } from '../../src/ui/FirstRouteObjectiveCard';

const objective = (achieved = false): FirstRouteObjectiveDto => Object.freeze({
  objectiveVersion: 1,
  achieved,
  steps: Object.freeze([
    Object.freeze({
      id: 'connect-route',
      label: 'Connect the route',
      state: 'complete',
    }),
    Object.freeze({
      id: 'buy-train',
      label: 'Buy the train',
      state: achieved ? 'complete' : 'current',
    }),
    Object.freeze({
      id: 'load-logs',
      label: 'Load logs',
      state: achieved ? 'complete' : 'pending',
    }),
    Object.freeze({
      id: 'deliver-logs',
      label: 'Deliver logs',
      state: achieved ? 'complete' : 'pending',
    }),
    Object.freeze({
      id: 'run-profitably',
      label: 'Run profitably',
      state: achieved ? 'complete' : 'pending',
    }),
  ]),
});

describe('FirstRouteObjectiveCard', () => {
  let card: FirstRouteObjectiveCard;

  beforeEach(() => {
    document.body.innerHTML = '';
    card = new FirstRouteObjectiveCard();
  });

  afterEach(() => {
    card.destroy();
    document.body.innerHTML = '';
  });

  it('remains visible in either mode and presents an accessible achieved state', () => {
    card.setVisible(true);
    EventBus.emit('ui:first-route-objective', objective(true));
    const root = document.querySelector(
      '[data-testid="first-route-objective"]',
    ) as HTMLElement;

    expect(root.getAttribute('aria-hidden')).toBe('false');
    expect(root.getAttribute('aria-label')).toBe(
      'First freight route objective achieved',
    );
    expect(root.textContent).toContain('First freight route');
    expect(root.textContent).toContain('Route profitable');
    expect(root.querySelectorAll('li')).toHaveLength(5);
    expect(root.querySelector('[data-step="buy-train"]')
      ?.getAttribute('aria-current')).toBeNull();
  });

  it('marks one current step without relying on colour alone', () => {
    card.setState(objective());
    const root = document.querySelector(
      '[data-testid="first-route-objective"]',
    ) as HTMLElement;
    const current = root.querySelector(
      '[data-step="buy-train"]',
    ) as HTMLElement;
    expect(current.textContent).toContain('Current: Buy the train');
    expect(current.getAttribute('aria-current')).toBe('step');
    expect(root.textContent).toContain('Complete: Connect the route');
    expect(root.textContent).toContain('Pending: Load logs');
  });

  it('uses a bounded 375x667 layout, stops pointers, and removes its listener', () => {
    Object.defineProperty(window, 'innerWidth', {
      value: 375,
      configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', {
      value: 667,
      configurable: true,
    });
    window.dispatchEvent(new Event('resize'));
    card.setState(objective());
    const root = document.querySelector(
      '[data-testid="first-route-objective"]',
    ) as HTMLElement;
    const bubbled = jest.fn();
    document.body.addEventListener('pointerdown', bubbled);
    root.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(root.dataset.layout).toBe('mobile');
    expect(root.style.left).toBe('56px');
    expect(root.style.right).toBe('8px');
    expect(root.style.maxHeight).not.toBe('');
    expect(bubbled).not.toHaveBeenCalled();

    card.destroy();
    EventBus.emit('ui:first-route-objective', objective(true));
    expect(document.querySelector(
      '[data-testid="first-route-objective"]',
    )).toBeNull();
    document.body.removeEventListener('pointerdown', bubbled);
  });
});
