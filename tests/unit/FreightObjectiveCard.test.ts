/**
 * @jest-environment jsdom
 */
import type { FreightObjectiveDto } from '../../src/freight/FreightObjective';
import { EventBus } from '../../src/services/EventBus';
import { FreightObjectiveCard } from '../../src/ui/FreightObjectiveCard';

interface MutableFreightObjective {
  objectiveVersion: 1;
  id: FreightObjectiveDto['id'];
  title: string;
  status: string;
  achieved: boolean;
  steps: Array<{
    id: FreightObjectiveDto['steps'][number]['id'];
    label: string;
    state: FreightObjectiveDto['steps'][number]['state'];
  }>;
}

const objective = (achieved = false): FreightObjectiveDto => Object.freeze({
  objectiveVersion: 1,
  id: 'structural-timber-link',
  title: 'Extend the timber chain',
  status: achieved
    ? 'Timber link profitable · Prefabrication awaits cement and steel'
    : 'Use the development grant to reach the Prefabrication Plant',
  achieved,
  steps: Object.freeze([
    Object.freeze({
      id: 'produce-structural-timber',
      label: 'Produce structural timber',
      state: 'complete',
    }),
    Object.freeze({
      id: 'connect-prefabrication-plant',
      label: 'Connect the Prefabrication Plant',
      state: achieved ? 'complete' : 'current',
    }),
    Object.freeze({
      id: 'load-structural-timber',
      label: 'Load structural timber',
      state: achieved ? 'complete' : 'pending',
    }),
    Object.freeze({
      id: 'deliver-structural-timber-profitably',
      label: 'Deliver profitably',
      state: achieved ? 'complete' : 'pending',
    }),
  ]),
});

const detachedObjective = (
  source: FreightObjectiveDto,
): MutableFreightObjective => (
  JSON.parse(JSON.stringify(source)) as MutableFreightObjective
);

const semanticChanges: Array<[
  string,
  (dto: MutableFreightObjective) => void,
]> = [
  ['objective ID', (dto) => {
    dto.id = 'first-profitable-route';
  }],
  ['title', (dto) => {
    dto.title = 'Changed title';
  }],
  ['status', (dto) => {
    dto.status = 'Changed status';
  }],
  ['achieved state', (dto) => {
    dto.achieved = true;
  }],
  ['step ID', (dto) => {
    dto.steps[0].id = 'connect-route';
  }],
  ['step label', (dto) => {
    dto.steps[0].label = 'Changed step';
  }],
  ['transient step state', (dto) => {
    dto.steps[0].state = 'current';
  }],
];

describe('FreightObjectiveCard', () => {
  let card: FreightObjectiveCard;

  beforeEach(() => {
    document.body.innerHTML = '';
    card = new FreightObjectiveCard();
  });

  afterEach(() => {
    card.destroy();
    document.body.innerHTML = '';
  });

  it('reuses one persistent card for the active objective and achieved state', () => {
    card.setVisible(true);
    EventBus.emit('ui:freight-objective', objective(true));
    const root = document.querySelector(
      '[data-testid="freight-objective"]',
    ) as HTMLElement;

    expect(root.dataset.objective).toBe('structural-timber-link');
    expect(root.getAttribute('aria-hidden')).toBe('false');
    expect(root.getAttribute('aria-label')).toBe(
      'Extend the timber chain objective achieved',
    );
    expect(root.textContent).toContain('Extend the timber chain');
    expect(root.textContent).toContain(
      'Timber link profitable · Prefabrication awaits cement and steel',
    );
    expect(root.querySelectorAll('li')).toHaveLength(4);
  });

  it('marks exactly one current step while the objective is unachieved', () => {
    card.setState(objective());
    const root = document.querySelector(
      '[data-testid="freight-objective"]',
    ) as HTMLElement;
    const current = root.querySelectorAll('[aria-current="step"]');

    expect(current).toHaveLength(1);
    expect(current[0].textContent)
      .toContain('Current: Connect the Prefabrication Plant');
    expect(root.textContent).toContain(
      'Complete: Produce structural timber',
    );
    expect(root.textContent).toContain('Pending: Load structural timber');
  });

  it('preserves live-region DOM nodes for semantically identical updates', () => {
    const first = objective();
    card.setState(first);
    const root = document.querySelector(
      '[data-testid="freight-objective"]',
    ) as HTMLElement;
    const title = root.querySelector('h2');
    const status = root.querySelector('strong');
    const steps = Array.from(root.querySelectorAll('li'));

    card.setState(detachedObjective(first));

    expect(root.querySelector('h2')).toBe(title);
    expect(root.querySelector('strong')).toBe(status);
    Array.from(root.querySelectorAll('li')).forEach((step, index) => {
      expect(step).toBe(steps[index]);
    });
  });

  it.each(semanticChanges)('rerenders when %s changes', (_field, mutate) => {
    const first = objective();
    card.setState(first);
    const root = document.querySelector(
      '[data-testid="freight-objective"]',
    ) as HTMLElement;
    const firstStep = root.querySelector('li');
    const changed = detachedObjective(first);
    mutate(changed);

    card.setState(changed);

    expect(root.querySelector('li')).not.toBe(firstStep);
  });

  it('keeps the bounded mobile layout and contains pointer propagation', () => {
    Object.defineProperty(window, 'innerWidth', {
      value: 375,
      configurable: true,
    });
    window.dispatchEvent(new Event('resize'));
    const root = document.querySelector(
      '[data-testid="freight-objective"]',
    ) as HTMLElement;
    const bubbled = jest.fn();
    document.body.addEventListener('pointerdown', bubbled);
    root.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(root.dataset.layout).toBe('mobile');
    expect(root.style.left).toBe('56px');
    expect(root.style.right).toBe('8px');
    expect(root.style.maxHeight).toBe('25vh');
    expect(bubbled).not.toHaveBeenCalled();

    document.body.removeEventListener('pointerdown', bubbled);
  });

  it('tears down both EventBus and resize listeners', () => {
    const removeResize = jest.spyOn(window, 'removeEventListener');
    card.destroy();

    EventBus.emit('ui:freight-objective', objective(true));

    expect(document.querySelector(
      '[data-testid="freight-objective"]',
    )).toBeNull();
    expect(removeResize).toHaveBeenCalledWith(
      'resize',
      expect.any(Function),
    );
  });
});
