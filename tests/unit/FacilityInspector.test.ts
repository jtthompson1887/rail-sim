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

function cementWorksInspection(): FacilityInspectionDto {
  const created = WorldManager.tryCreateNew(
    'Cement inspection',
    'cement-inspector-seed',
    'temperate',
  );
  if (!created.ok) throw new Error('fixture generation failed');
  const cementWorks = created.world.economy.facilities.find(
    ({ id }) => id === 'cement-works',
  );
  if (!cementWorks) throw new Error('cement works missing');
  cementWorks.recipeProgressTicks = 2;
  cementWorks.inventories['limestone-aggregate'].quantity = 120;
  created.world.economy.market.constructionIndexBps = 10_000;
  created.world.economy.market.regionalDemandBpsByProduct[
    'limestone-aggregate'
  ] = 10_000;
  const dto = buildFacilityInspection(created.world, 'cement-works', true);
  if (!dto) throw new Error('cement works inspection missing');
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
      inputRows: [{
        productId: 'logs',
        displayName: 'Logs',
        unitLabel: 'tonne',
        requiredQuantity: 10,
        availableQuantity: 0,
        missingQuantity: 10,
      }],
      outputRows: [{
        productId: 'structural-timber',
        displayName: 'Structural Timber',
        unitLabel: 'tonne',
        cycleQuantity: 8,
      }],
      railConnected: false,
    });
    expect(dto.inventories).toEqual([
      {
        productId: 'logs',
        displayName: 'Logs',
        unitLabel: 'tonne',
        quantity: 0,
        capacity: 200,
      },
      {
        productId: 'structural-timber',
        displayName: 'Structural Timber',
        unitLabel: 'tonne',
        quantity: 0,
        capacity: 160,
      },
    ]);
    expect(dto.quotes).toHaveLength(1);
    expect(dto.quotes[0]).toEqual(expect.objectContaining({
      displayName: 'Logs',
      unitLabel: 'tonne',
    }));
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
      .toEqual({ code: 'working', label: 'Working 0 / 3 ticks' });
  });

  it('keeps every remaining prefab input blocker in recipe order after timber arrives', () => {
    const created = WorldManager.tryCreateNew(
      'Prefab inputs',
      'facility-prefab-inputs-seed',
      'temperate',
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const prefab = created.world.economy.facilities.find(
      ({ id }) => id === 'prefabrication-plant',
    );
    if (!prefab) throw new Error('prefab missing');
    prefab.inventories['structural-timber'].quantity = 8;

    const dto = buildFacilityInspection(
      created.world,
      'prefabrication-plant',
      true,
    );

    expect(dto?.status).toEqual({
      code: 'waiting-input',
      label: 'Needs cement and steel',
    });
    expect(dto?.inputRows).toEqual([
      {
        productId: 'structural-timber',
        displayName: 'Structural Timber',
        unitLabel: 'tonne',
        requiredQuantity: 8,
        availableQuantity: 8,
        missingQuantity: 0,
      },
      {
        productId: 'cement',
        displayName: 'Cement',
        unitLabel: 'tonne',
        requiredQuantity: 8,
        availableQuantity: 0,
        missingQuantity: 8,
      },
      {
        productId: 'steel',
        displayName: 'Steel',
        unitLabel: 'tonne',
        requiredQuantity: 6,
        availableQuantity: 0,
        missingQuantity: 6,
      },
    ]);
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
    expect(root.querySelector('[data-testid="facility-products"]')?.textContent)
      .toContain('Logs needs 10 tonnes');
    expect(root.querySelector('[data-testid="facility-inventories"]')?.textContent)
      .toContain('Logs 0 / 200');
    expect(root.querySelector('[data-testid="facility-quotes"]')?.textContent)
      .toMatch(/Receiving Logs · £[\d,]+ \/ t/);
    expect(root.querySelector('[data-testid="facility-quotes"]')?.textContent)
      .toContain('Global construction');
    expect(root.querySelector('[data-testid="facility-quotes"]')?.textContent)
      .toContain('Regional demand');
    expect(root.querySelector('[data-testid="facility-quotes"]')?.textContent)
      .toContain('Inventory pressure');
    expect(root.querySelector('[data-testid="facility-rail"]')?.textContent)
      .toBe('Rail access: not connected');
  });

  it('shows received timber and every remaining prefab blocker in recipe order', () => {
    const created = WorldManager.tryCreateNew(
      'Prefab inspector',
      'facility-prefab-inspector-seed',
      'temperate',
    );
    if (!created.ok) throw new Error('fixture generation failed');
    const prefab = created.world.economy.facilities.find(
      ({ id }) => id === 'prefabrication-plant',
    );
    if (!prefab) throw new Error('prefab missing');
    prefab.inventories['structural-timber'].quantity = 8;
    const dto = buildFacilityInspection(
      created.world,
      'prefabrication-plant',
      true,
    );
    if (!dto) throw new Error('prefab inspection missing');

    EventBus.emit('facility:inspection', dto);

    const text = document.querySelector(
      '[data-testid="facility-products"]',
    )?.textContent ?? '';
    expect(text).toContain('Structural Timber received 8 / 8 tonnes');
    expect(text).toContain('Cement needs 8 tonnes');
    expect(text).toContain('Steel needs 6 tonnes');
    expect(text.indexOf('Cement needs')).toBeLessThan(
      text.indexOf('Steel needs'),
    );
    expect(document.querySelector(
      '[data-testid="facility-recipe"]',
    )?.textContent).toBe(
      'Module assembly · 8 t Structural Timber + 8 t Cement + 6 t Steel'
      + ' → 4 modules Building Modules · 6 ticks',
    );
  });

  it('shows cement progress, conversion, receiving economics, and stock', () => {
    EventBus.emit('facility:inspection', cementWorksInspection());

    const root = document.querySelector(
      '[data-testid="facility-inspector"]',
    ) as HTMLElement;
    expect(root.querySelector('[data-testid="facility-status"]')?.textContent)
      .toBe('Working 2 / 4 ticks');
    expect(root.querySelector('[data-testid="facility-recipe"]')?.textContent)
      .toContain(
        'Cement kiln · 12 t Limestone Aggregate → 8 t Cement · 4 ticks',
      );
    expect(root.querySelector('[data-testid="facility-recipe"]')?.textContent)
      .toContain(
        'Full Aggregate Hopper Set · 120 t → 80 t · 10 cycles',
      );
    expect(root.querySelector('[data-testid="facility-inventories"]')?.textContent)
      .toContain('Limestone Aggregate 120 / 240 tonnes');
    expect(root.querySelector('[data-testid="facility-quotes"]')?.textContent)
      .toContain('Receiving Limestone Aggregate · £45 / t');
    expect(root.querySelector('[data-testid="facility-quotes"]')?.textContent)
      .toContain('Full 120 t at current rate · £5,400 gross');
  });

  it('keeps pointer and touch input inside its scrollable mobile surface', () => {
    EventBus.emit('facility:inspection', cementWorksInspection());
    const root = document.querySelector(
      '[data-testid="facility-inspector"]',
    ) as HTMLElement;
    const bodyPointer = jest.fn();
    const bodyTouch = jest.fn();
    document.body.addEventListener('pointerdown', bodyPointer);
    document.body.addEventListener('touchstart', bodyTouch);

    root.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    root.dispatchEvent(new Event('touchstart', { bubbles: true }));

    expect(bodyPointer).not.toHaveBeenCalled();
    expect(bodyTouch).not.toHaveBeenCalled();
    expect(root.style.overflow).toBe('auto');
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

  it('restores the same inspection after a temporary visibility change', () => {
    EventBus.emit('facility:inspection', sawmillInspection());
    const root = document.querySelector(
      '[data-testid="facility-inspector"]',
    ) as HTMLElement;

    inspector.setVisible(false);
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(root.querySelector('[data-testid="facility-name"]')?.textContent)
      .toBe('Sawmill');

    inspector.setVisible(true);
    expect(root.getAttribute('aria-hidden')).toBe('false');
    expect(root.querySelector('[data-testid="facility-name"]')?.textContent)
      .toBe('Sawmill');
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
    expect(root.style.maxHeight).toBe('calc(75vh - 208px)');
    expect(root.querySelector('[data-testid="facility-recipe"]')).not.toBeNull();

    Object.defineProperty(window, 'innerWidth', {
      value: 667,
      configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', {
      value: 375,
      configurable: true,
    });
    window.dispatchEvent(new Event('resize'));
    expect(root.style.left).toBe('calc(28px + 50vw)');
    expect(root.style.right).toBe('8px');
    expect(root.style.maxHeight).toBe('58vh');
  });
});
