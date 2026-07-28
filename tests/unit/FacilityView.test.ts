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
  const graphics = {
    setDepth: jest.fn().mockReturnThis(),
    clear: jest.fn().mockReturnThis(),
    lineStyle: jest.fn().mockReturnThis(),
    fillStyle: jest.fn().mockReturnThis(),
    strokeCircle: jest.fn().mockReturnThis(),
    fillCircle: jest.fn().mockReturnThis(),
    fillRect: jest.fn().mockReturnThis(),
    destroy: jest.fn(),
  };
  const marker = gameObject();
  const labels = [gameObject(), gameObject()];
  const scene = {
    add: {
      graphics: jest.fn().mockReturnValue(graphics),
      circle: jest.fn().mockReturnValue(marker),
      text: jest.fn()
        .mockImplementation(() => labels.shift()!),
    },
  };
  return { scene, graphics, marker };
}

describe('FacilityView', () => {
  afterEach(() => jest.restoreAllMocks());

  it('renders a named marker, status, compact inventory, and screen-scaled access ring', () => {
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
    expect(harness.graphics.strokeCircle).toHaveBeenCalledWith(135, 165, 120);
    expect(harness.graphics.fillCircle).toHaveBeenCalledWith(100, 200, 48);
    expect(harness.graphics.fillRect).toHaveBeenCalledTimes(2);
    expect((view as any).hitArea).toEqual(expect.objectContaining({
      x: 48,
      y: 48,
      radius: 48,
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
    expect(harness.marker.destroy).toHaveBeenCalled();
    expect((view as any).nameText.destroy).toHaveBeenCalled();
    expect((view as any).statusText.destroy).toHaveBeenCalled();
  });
});
