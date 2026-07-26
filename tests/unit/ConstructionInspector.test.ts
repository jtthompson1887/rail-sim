/**
 * @jest-environment jsdom
 */
import { EventBus } from '../../src/services/EventBus';
import { ConstructionInspector } from '../../src/ui/ConstructionInspector';

function preview(overrides: Record<string, unknown> = {}): any {
  return {
    phase: 'review',
    preview: {
      phase: 'review',
      proposal: {
        geometry: {
          geometryVersion: 1,
          p0: { x: 0, y: 0 },
          p1: { x: 100, y: 0 },
          p2: { x: 200, y: 0 },
          p3: { x: 300, y: 0 },
        },
        verticalProfile: {
          profileVersion: 1,
          knots: [{ t: 0, elevation: 0 }, { t: 1, elevation: 0 }],
        },
        length: 300,
        minimumRadius: Infinity,
        maximumGradePercent: 2,
        maximumGradeT: 0.5,
        maximumGradeDistance: 150,
        structures: [{
          type: 'surface',
          startT: 0,
          endT: 1,
          startElevation: 0,
          endElevation: 0,
        }],
        costs: {
          track: 300,
          earthworks: 0,
          bridge: 0,
          tunnel: 0,
          total: 300,
        },
        valid: true,
        reasonCode: 'ok',
        remedy: '',
      },
      predictedConnections: [],
      engineeringSubtotal: 300,
      topologyCost: 2_500,
      totalCost: 2_800,
      cashBefore: 1_000_000,
      cashAfter: 997_200,
      structureLengths: {
        surface: 300,
        cut: 0,
        fill: 0,
        bridge: 0,
        tunnel: 0,
      },
      affordable: true,
      canConfirm: true,
      stale: false,
      message: 'Click or press Enter to build this section.',
      actions: ['confirm', 'backstep', 'cancel'],
      breachesStarterReserve: false,
      ...overrides,
    },
  };
}

describe('ConstructionInspector', () => {
  let inspector: ConstructionInspector;

  beforeEach(() => {
    document.body.innerHTML = '';
    inspector = new ConstructionInspector();
  });

  afterEach(() => {
    inspector.destroy();
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  it('shows one compact authoritative build decision before engineering detail', () => {
    EventBus.emit('construction:preview', preview());

    expect(document.querySelector('[data-testid="construction-primary"]')?.textContent)
      .toBe('Build £2,800 · Cash after £997,200 · Affordable');
    expect(document.querySelector('[data-testid="construction-engineering-subtotal"]')?.textContent)
      .toBe('Engineering subtotal £300');
    const detail = document.querySelector('[data-testid="construction-detail"]')?.textContent;
    expect(detail).toContain('Length 300');
    expect(detail).toContain('Minimum radius Straight (∞)');
    expect(detail).toContain('Maximum grade 2.0% at 150');
    expect(detail).toContain('Surface 300');
    expect(detail).toContain('Track £300');
    expect(detail).toContain('Topology £2,500');
    expect(document.querySelectorAll('[data-testid="construction-remedy"]')).toHaveLength(1);
    expect(document.querySelector('[data-testid="construction-remedy"]')?.textContent)
      .toBe('Click or press Enter to build this section.');
    expect(document.querySelector('[data-testid="construction-objective"]')?.textContent)
      .toBe(
        'Connect Managed Forest to Sawmill. Keep £110,000 for a timber train and operating reserve.',
      );
  });

  it('shows an amber reserve warning without disabling an affordable build', () => {
    EventBus.emit('construction:preview', preview({
      cashAfter: 110_000,
      breachesStarterReserve: false,
    }));
    expect(document.querySelector('[data-testid="construction-remedy"]')?.textContent)
      .toBe('Click or press Enter to build this section.');

    EventBus.emit('construction:preview', preview({
      cashAfter: 109_999,
      breachesStarterReserve: true,
    }));

    const remedy = document.querySelector(
      '[data-testid="construction-remedy"]',
    ) as HTMLElement;
    expect(remedy.textContent)
      .toBe('Build leaves less than the £110,000 train and operating reserve');
    expect(remedy.dataset.tone).toBe('amber');
    expect((document.querySelector(
      '[data-testid="construction-confirm"]',
    ) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows a hard construction blocker ahead of the reserve advisory', () => {
    EventBus.emit('construction:preview', preview({
      affordable: true,
      canConfirm: false,
      breachesStarterReserve: true,
      message: 'Maximum grade exceeds the engineering limit.',
      actions: ['backstep', 'cancel'],
    }));

    const remedy = document.querySelector(
      '[data-testid="construction-remedy"]',
    ) as HTMLElement;
    expect(remedy.textContent)
      .toBe('Maximum grade exceeds the engineering limit.');
    expect(remedy.dataset.tone).toBe('default');
    expect((document.querySelector(
      '[data-testid="construction-confirm"]',
    ) as HTMLButtonElement).disabled).toBe(true);
  });

  it('emits display-only intents and never confirms invalid or unaffordable work', () => {
    const emit = jest.spyOn(EventBus, 'emit');
    EventBus.emit('construction:preview', preview());
    (document.querySelector('[data-testid="construction-confirm"]') as HTMLButtonElement).click();
    expect(emit).toHaveBeenCalledWith('construction:intent', { action: 'confirm' });

    EventBus.emit('construction:preview', preview({
      affordable: false,
      canConfirm: false,
      cashAfter: -200,
      message: 'This section exceeds your cash — shorten or simplify the route.',
      actions: ['backstep', 'cancel'],
    }));
    const confirm = document.querySelector(
      '[data-testid="construction-confirm"]',
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    const confirmsBefore = emit.mock.calls.filter(
      ([event, payload]) => event === 'construction:intent'
        && (payload as any).action === 'confirm',
    ).length;
    confirm.click();
    const confirmsAfter = emit.mock.calls.filter(
      ([event, payload]) => event === 'construction:intent'
        && (payload as any).action === 'confirm',
    ).length;
    expect(confirmsAfter).toBe(confirmsBefore);
  });

  it.each([
    ['construction-confirm', 'confirm', 'Enter'],
    ['construction-back', 'backstep', 'Enter'],
    ['construction-cancel', 'cancel', ' '],
  ])('activates %s semantically from the keyboard', (testId, action, key) => {
    const emit = jest.spyOn(EventBus, 'emit');
    EventBus.emit('construction:preview', preview());
    const button = document.querySelector(
      `[data-testid="${testId}"]`,
    ) as HTMLButtonElement;

    button.dispatchEvent(new KeyboardEvent('keydown', {
      key,
      code: key === ' ' ? 'Space' : 'Enter',
      bubbles: true,
      cancelable: true,
    }));

    expect(emit).toHaveBeenCalledWith('construction:intent', { action });
  });

  it('clears stale content on empty, cancel, commit, hide, and destroy lifecycles', () => {
    EventBus.emit('construction:preview', preview());
    expect(document.querySelector('[data-testid="construction-inspector"]')).not.toBeNull();

    EventBus.emit('construction:preview', { phase: 'idle', preview: null });
    expect(document.querySelector('[data-testid="construction-inspector"]')
      ?.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('[data-testid="construction-primary"]')?.textContent).toBe('');

    EventBus.emit('construction:preview', preview());
    inspector.setVisible(false);
    expect(document.querySelector('[data-testid="construction-inspector"]')
      ?.getAttribute('aria-hidden')).toBe('true');
    expect((document.querySelector(
      '[data-testid="construction-confirm"]',
    ) as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders a live chained preview but clears an empty chained state', () => {
    const chained = preview({
      phase: 'chained',
      canConfirm: false,
      message: 'Release to review this section.',
      actions: ['backstep', 'cancel'],
    });

    EventBus.emit('construction:preview', {
      phase: 'chained',
      preview: chained.preview,
    });

    expect(document.querySelector('[data-testid="construction-inspector"]')
      ?.getAttribute('aria-hidden')).toBe('false');
    expect(document.querySelector('[data-testid="construction-primary"]')?.textContent)
      .toContain('Build £2,800');
    expect(document.querySelector('[data-testid="construction-remedy"]')?.textContent)
      .toBe('Release to review this section.');

    EventBus.emit('construction:preview', { phase: 'chained', preview: null });
    expect(document.querySelector('[data-testid="construction-inspector"]')
      ?.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('[data-testid="construction-primary"]')?.textContent)
      .toBe('');
  });

  it('keeps the primary decision and blocking reason in the compact mobile hierarchy', () => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    window.dispatchEvent(new Event('resize'));
    EventBus.emit('construction:preview', preview({
      affordable: false,
      canConfirm: false,
      message: 'This section exceeds your cash.',
      actions: ['backstep', 'cancel'],
    }));

    const root = document.querySelector(
      '[data-testid="construction-inspector"]',
    ) as HTMLElement;
    expect(root.dataset.layout).toBe('mobile');
    expect(root.querySelector('[data-testid="construction-primary"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="construction-remedy"]')?.textContent)
      .toBe('This section exceeds your cash.');
  });
});
