import { EventBus } from '../../src/services/EventBus';
import {
  FacilityView,
  type FacilityViewPlacement,
} from '../../src/entities/FacilityView';
import type { FacilityInspectionDto } from '../../src/economy/FacilityPresentation';

function inspection(
  overrides: Partial<FacilityInspectionDto> = {},
): FacilityInspectionDto {
  return {
    boundaryTrade: null,
    id: 'sawmill',
    name: 'Sawmill',
    status: { code: 'waiting-input', label: 'Needs logs' },
    activeRecipe: null,
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
    inventories: [
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
        quantity: 20,
        capacity: 160,
      },
    ],
    quotes: [],
    railConnected: false,
    ...overrides,
  };
}

function placement(): FacilityViewPlacement {
  return {
    id: 'sawmill',
    x: 100,
    y: 200,
    railAccessX: 135,
    railAccessY: 165,
    railAccessRadius: 120,
  };
}

function gameObject() {
  const listeners: Record<string, (...args: any[]) => void> = {};
  const stub = {
    listeners,
    setDepth: jest.fn().mockReturnThis(),
    setOrigin: jest.fn().mockReturnThis(),
    setScale: jest.fn().mockReturnThis(),
    setPosition: jest.fn().mockReturnThis(),
    setText: jest.fn().mockReturnThis(),
    setColor: jest.fn().mockReturnThis(),
    setVisible: jest.fn().mockReturnThis(),
    setRadius: jest.fn().mockReturnThis(),
    setStrokeStyle: jest.fn().mockReturnThis(),
    setInteractive: jest.fn().mockReturnThis(),
    on: jest.fn((event: string, callback: (...args: any[]) => void) => {
      listeners[event] = callback;
      return stub;
    }),
    destroy: jest.fn(),
  };
  return stub;
}

function sceneHarness() {
  const surfaces = Array.from({ length: 3 }, () => {
    const g: Record<string, jest.Mock> = {};
    for (const method of ['setDepth', 'clear', 'lineStyle', 'fillStyle', 'strokeCircle', 'fillCircle', 'fillRect',
      'fillRoundedRect', 'fillEllipse', 'lineBetween', 'strokeRect', 'destroy']) g[method] = jest.fn(() => g);
    return g;
  });
  const marker = gameObject();
  const labels = [gameObject(), gameObject()];
  const scene = {
    add: {
      graphics: jest.fn().mockImplementation(() => surfaces.shift()),
      circle: jest.fn().mockReturnValue(marker),
      text: jest.fn()
        .mockImplementation(() => labels.shift()!),
    },
  };
  const [ground, buildings, graphics] = surfaces;
  return { scene, ground, buildings, graphics, marker };
}

describe('FacilityView', () => {
  afterEach(() => jest.restoreAllMocks());

  it('renders world-sized roofs with screen-scaled labels and reserves access diagnostics for selection', () => {
    const harness = sceneHarness();
    const view = new FacilityView(
      harness.scene as any,
      placement(),
      inspection(),
    );
    harness.graphics.fillRect.mockClear();

    view.update(inspection(), 0.25, false);

    expect(harness.scene.add.text).toHaveBeenNthCalledWith(
      1,
      100,
      200,
      'Sawmill',
      expect.any(Object),
    );
    expect(harness.scene.add.text).toHaveBeenNthCalledWith(
      2,
      100,
      200,
      'Needs logs',
      expect.any(Object),
    );
    expect((view as any).nameText.setScale).toHaveBeenLastCalledWith(4);
    expect((view as any).statusText.setScale).toHaveBeenLastCalledWith(4);
    expect(harness.graphics.strokeCircle).not.toHaveBeenCalled();
    expect(harness.graphics.fillCircle).not.toHaveBeenCalled();
    expect(harness.buildings.fillRect).toHaveBeenCalled();
    expect((view as any).statusText.setVisible).toHaveBeenLastCalledWith(false);
    const roofCalls = harness.buildings.fillRect.mock.calls.slice();
    view.update(inspection(), 0.5, true);
    expect(harness.buildings.fillRect.mock.calls).toEqual(roofCalls);
    expect(harness.graphics.strokeCircle).toHaveBeenCalledWith(135, 165, 120);
    expect(harness.graphics.fillRect).toHaveBeenCalledTimes(2);
    expect((view as any).statusText.setVisible).toHaveBeenLastCalledWith(true);
    expect((view as any).hitArea).toEqual(expect.objectContaining({
      x: 282,
      y: 282,
      radius: 282,
    }));
  });

  it('visually distinguishes connected access and selects through a UI-only event', () => {
    const harness = sceneHarness();
    const emit = jest.spyOn(EventBus, 'emit');
    const view = new FacilityView(
      harness.scene as any,
      placement(),
      inspection(),
    );
    view.update(inspection(), 1, true);
    const disconnectedStyle = harness.graphics.lineStyle.mock.calls.at(-1);

    view.update(inspection({ railConnected: true }), 1, true);
    const connectedStyle = harness.graphics.lineStyle.mock.calls.at(-1);
    const stopPropagation = jest.fn();
    harness.marker.listeners.pointerdown(
      { x: 100, y: 200 },
      0,
      0,
      { stopPropagation },
    );

    expect(connectedStyle).not.toEqual(disconnectedStyle);
    expect(emit).toHaveBeenCalledWith('facility:selected', {
      facilityId: 'sawmill',
    });
    expect(stopPropagation).toHaveBeenCalled();
  });

  it('lets the active track tool own pointer gestures through a facility marker', () => {
    const harness = sceneHarness();
    const emit = jest.spyOn(EventBus, 'emit');
    const view = new FacilityView(
      harness.scene as any,
      placement(),
      inspection(),
    );
    const stopPropagation = jest.fn();

    view.setSelectionEnabled(false);
    harness.marker.listeners.pointerdown(
      { x: 100, y: 200 },
      0,
      0,
      { stopPropagation },
    );

    expect(emit).not.toHaveBeenCalledWith(
      'facility:selected',
      expect.anything(),
    );
    expect(stopPropagation).not.toHaveBeenCalled();
  });

  it('destroys every presentation object without mutating the supplied DTO', () => {
    const harness = sceneHarness();
    const dto = inspection();
    const before = JSON.stringify(dto);
    const view = new FacilityView(harness.scene as any, placement(), dto);

    view.update(dto, 0.5, false);
    view.destroy();

    expect(JSON.stringify(dto)).toBe(before);
    expect(harness.graphics.destroy).toHaveBeenCalled();
    expect(harness.ground.destroy).toHaveBeenCalled();
    expect(harness.buildings.destroy).toHaveBeenCalled();
    expect(harness.marker.destroy).toHaveBeenCalled();
    expect((view as any).nameText.destroy).toHaveBeenCalled();
    expect((view as any).statusText.destroy).toHaveBeenCalled();
  });
});
