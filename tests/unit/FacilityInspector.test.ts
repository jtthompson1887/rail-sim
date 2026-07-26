/**
 * @jest-environment jsdom
 */
import { EventBus } from '../../src/services/EventBus';
import { WorldManager } from '../../src/managers/WorldManager';
import {
  buildFacilityInspection,
  type FacilityInspectionDto,
} from '../../src/economy/FacilityPresentation';
import { FacilityInspector } from '../../src/ui/FacilityInspector';

function sawmillInspection(): FacilityInspectionDto {
  const created = WorldManager.tryCreateNew(
    'Inspection',
    'facility-inspector-seed',
    'temperate',
  );
  if (!created.ok) throw new Error('fixture generation failed');
  const dto = buildFacilityInspection(created.world, 'sawmill', false);
  if (!dto) throw new Error('sawmill inspection missing');
  return dto;
}

describe('Facility presentation', () => {
  beforeEach(() => {
    localStorage.clear();
    WorldManager.reset();
  });

  it('builds an immutable sawmill decision DTO with blockers, stock, and explained quotes', () => {
    const dto = sawmillInspection();

    expect(dto).toMatchObject({
      id: 'sawmill',
      name: 'Sawmill',
      status: { code: 'waiting-input', label: 'Needs logs' },
      produces: ['structural-timber'],
      needs: ['logs'],
      railConnected: false,
    });
    expect(dto.inventories).toEqual([
      {
        productId: 'logs',
        displayName: 'Logs',
        quantity: 0,
        capacity: 200,
      },
      {
        productId: 'structural-timber',
        displayName: 'Structural Timber',
        quantity: 0,
        capacity: 160,
      },
    ]);
    expect(dto.quotes).toHaveLength(2);
    expect(dto.quotes.every((quote) => quote.factors.length === 3)).toBe(true);
    expect(Object.isFrozen(dto)).toBe(true);
    expect(Object.isFrozen(dto.status)).toBe(true);
    expect(Object.isFrozen(dto.inventories)).toBe(true);
    expect(Object.isFrozen(dto.quotes[0].factors)).toBe(true);
  });

  it('keeps production blockers ahead of rail state and reserves waiting-railway for idle sites', () => {
    const created = WorldManager.tryCreateNew(
      'Statuses',
      'facility-status-seed',
      'temperate',
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(buildFacilityInspection(created.world, 'sawmill', false)?.status)
      .toEqual({ code: 'waiting-input', label: 'Needs logs' });
    expect(buildFacilityInspection(
      created.world,
      'port-interchange',
      false,
    )?.status).toEqual({
      code: 'waiting-railway',
      label: 'Waiting for railway',
    });
    expect(buildFacilityInspection(
      created.world,
      'port-interchange',
      true,
    )?.status).toEqual({ code: 'idle', label: 'Idle' });
    expect(buildFacilityInspection(created.world, 'missing', false)).toBeNull();
  });

  it('changes the Sawmill from Needs logs to Working when its recipe can advance', () => {
    const created = WorldManager.tryCreateNew(
      'Working status',
      'facility-working-seed',
      'temperate',
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const sawmill = created.world.economy.facilities.find(
      ({ id }) => id === 'sawmill',
    );
    if (!sawmill) throw new Error('sawmill missing');

    expect(buildFacilityInspection(created.world, 'sawmill', true)?.status)
      .toEqual({ code: 'waiting-input', label: 'Needs logs' });
    sawmill.inventories.logs.quantity = 10;
    expect(buildFacilityInspection(created.world, 'sawmill', true)?.status)
      .toEqual({ code: 'working', label: 'Working' });
  });
});

describe('FacilityInspector', () => {
  let inspector: FacilityInspector;

  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    WorldManager.reset();
    inspector = new FacilityInspector();
  });

  afterEach(() => {
    inspector.destroy();
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  it('shows the primary blocker before products, inventories, quotes, and rail access', () => {
    EventBus.emit('facility:inspection', sawmillInspection());

    const root = document.querySelector(
      '[data-testid="facility-inspector"]',
    ) as HTMLElement;
    expect(root.getAttribute('aria-hidden')).toBe('false');
    expect(root.querySelector('[data-testid="facility-name"]')?.textContent)
      .toBe('Sawmill');
    expect(root.querySelector('[data-testid="facility-status"]')?.textContent)
      .toBe('Needs logs');
    expect(root.querySelector('[data-testid="facility-products"]')?.textContent)
      .toContain('Produces Structural Timber');
    expect(root.querySelector('[data-testid="facility-products"]')?.textContent)
      .toContain('Needs Logs');
    expect(root.querySelector('[data-testid="facility-inventories"]')?.textContent)
      .toContain('Logs 0 / 200');
    expect(root.querySelector('[data-testid="facility-quotes"]')?.textContent)
      .toContain('Global construction');
    expect(root.querySelector('[data-testid="facility-quotes"]')?.textContent)
      .toContain('Regional demand');
    expect(root.querySelector('[data-testid="facility-quotes"]')?.textContent)
      .toContain('Inventory pressure');
    expect(root.querySelector('[data-testid="facility-rail"]')?.textContent)
      .toBe('Rail access: not connected');
  });

  it('clears stale content and screen hit bounds when selection is cleared', () => {
    EventBus.emit('facility:inspection', sawmillInspection());
    const root = document.querySelector(
      '[data-testid="facility-inspector"]',
    ) as HTMLElement;
    root.getBoundingClientRect = () => ({
      left: 50, right: 350, top: 50, bottom: 500,
      x: 50, y: 50, width: 300, height: 450,
      toJSON: () => ({}),
    });
    expect(inspector.containsScreenPoint(100, 100)).toBe(true);

    EventBus.emit('facility:deselected', { facilityId: 'sawmill' });

    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(root.querySelector('[data-testid="facility-name"]')?.textContent)
      .toBe('');
    expect(root.querySelector('[data-testid="facility-inventories"]')?.children)
      .toHaveLength(0);
    expect(inspector.containsScreenPoint(100, 100)).toBe(false);
  });

  it('keeps the blocker readable and the world edge visible at 375x667', () => {
    Object.defineProperty(window, 'innerWidth', {
      value: 375,
      configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', {
      value: 667,
      configurable: true,
    });
    window.dispatchEvent(new Event('resize'));
    EventBus.emit('facility:inspection', sawmillInspection());

    const root = document.querySelector(
      '[data-testid="facility-inspector"]',
    ) as HTMLElement;
    expect(root.dataset.layout).toBe('mobile');
    expect(root.style.left).toBe('56px');
    expect(root.querySelector('[data-testid="facility-status"]')?.textContent)
      .toBe('Needs logs');
    expect(root.style.maxHeight).toBe('58vh');
  });
});
