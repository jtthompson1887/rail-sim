import EditorUIScene from '../../src/scenes/EditorUIScene';
import { EventBus } from '../../src/services/EventBus';
import { EditorToolbar } from '../../src/ui/EditorToolbar';

describe('EditorUIScene construction UI boundary', () => {
  const startedScenes: EditorUIScene[] = [];

  function startEditorUI(data: {
    visible: boolean;
    companyCash: number;
    saveState: 'saved' | 'unsaved' | 'saving';
    saveErrorMessage?: string;
    economyTick?: number;
    constructionIndexBps?: number;
  }): EditorUIScene {
    const scene = new EditorUIScene();
    (scene.input as any).off = jest.fn();
    (scene.input.keyboard as any).off = jest.fn();
    scene.init({
      trackManager: { getTrack: jest.fn(), tracks: [] } as any,
      selectionManager: { selectedUUIDs: [] } as any,
      economyTick: data.economyTick ?? 0,
      constructionIndexBps: data.constructionIndexBps ?? 10_000,
      ...data,
    });
    scene.create();
    startedScenes.push(scene);
    return scene;
  }

  afterEach(() => {
    for (const scene of startedScenes.splice(0)) {
      const shutdown = (scene.events.once as jest.Mock).mock.calls.at(-1)?.[1];
      shutdown?.();
    }
    jest.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('reports every visible editor panel as an input-blocking screen bound', () => {
    const scene = new EditorUIScene();
    (scene as any).toolbar = {
      screenBounds: { left: 0, right: 72, top: 0, bottom: 1080 },
    };
    (scene as any).propertiesPanel = {
      containsScreenPoint: jest.fn((x: number) => x >= 1700),
    };
    (scene as any).constructionInspector = {
      containsScreenPoint: jest.fn((_x: number, y: number) => y >= 700),
    };
    (scene as any).facilityInspector = {
      containsScreenPoint: jest.fn((x: number, y: number) => x > 1400 && y < 700),
    };
    (scene as any).companyHud = {
      containsScreenPoint: jest.fn((x: number, y: number) => x < 400 && y < 80),
    };
    (scene as any).vehiclePurchasePanel = {
      containsScreenPoint: jest.fn((x: number, y: number) => x > 1300 && y > 700),
    };
    (scene as any).trainInspector = {
      containsScreenPoint: jest.fn((x: number, y: number) => x > 1250 && y > 500),
    };
    (scene as any).freightObjectiveCard = {
      containsScreenPoint: jest.fn((x: number, y: number) => x < 500 && y < 300),
    };
    (scene as any).minimapRenderer = {
      containsScreenPoint: jest.fn((x: number, y: number) => x >= 1084 && y >= 584),
    };
    (scene as any).minimapVisible = true;

    expect(scene.containsScreenPoint(40, 500)).toBe(true);
    expect(scene.containsScreenPoint(1800, 500)).toBe(true);
    expect(scene.containsScreenPoint(900, 800)).toBe(true);
    expect(scene.containsScreenPoint(1500, 300)).toBe(true);
    expect(scene.containsScreenPoint(200, 30)).toBe(true);
    expect(scene.containsScreenPoint(1400, 800)).toBe(true);
    expect(scene.containsScreenPoint(1300, 600)).toBe(true);
    expect(scene.containsScreenPoint(450, 250)).toBe(true);
    expect(scene.containsScreenPoint(1174, 644)).toBe(true);
    expect(scene.containsScreenPoint(900, 400)).toBe(false);
  });

  it('blocks the real minimap interaction boundary only while editor UI is visible', () => {
    const scene = startEditorUI({
      visible: true,
      companyCash: 875_000,
      saveState: 'saved',
    });
    jest.spyOn((scene as any).propertiesPanel, 'containsScreenPoint')
      .mockReturnValue(false);
    jest.spyOn((scene as any).constructionInspector, 'containsScreenPoint')
      .mockReturnValue(false);
    jest.spyOn((scene as any).companyHud, 'containsScreenPoint')
      .mockReturnValue(false);

    expect(scene.containsScreenPoint(1814, 1004)).toBe(true);
    expect(scene.containsScreenPoint(1723, 1004)).toBe(false);

    EventBus.emit('ui:toolbar-visible', { visible: false });

    expect(scene.containsScreenPoint(1814, 1004)).toBe(false);
  });

  it('hides, disables, and clears all editor overlays when play mode begins', () => {
    const scene = new EditorUIScene();
    const hidden = () => ({ setVisible: jest.fn(), clear: jest.fn() });
    (scene as any).toolbar = hidden();
    (scene as any).propertiesPanel = hidden();
    (scene as any).constructionInspector = hidden();
    (scene as any).companyHud = hidden();
    (scene as any).facilityInspector = hidden();
    (scene as any).vehiclePurchasePanel = hidden();
    (scene as any).trainInspector = hidden();
    (scene as any).freightObjectiveCard = hidden();
    (scene as any).validationHint = hidden();

    (scene as any).visibleHandler({ visible: false });

    for (const key of [
      'toolbar',
      'propertiesPanel',
      'constructionInspector',
      'validationHint',
    ]) {
      expect((scene as any)[key].setVisible).toHaveBeenCalledWith(false);
    }
    expect((scene as any).companyHud.setVisible).toHaveBeenCalledWith(true);
    expect((scene as any).facilityInspector.setVisible)
      .toHaveBeenCalledWith(true);
    expect((scene as any).vehiclePurchasePanel.setVisible)
      .toHaveBeenCalledWith(false);
    expect((scene as any).trainInspector.setVisible)
      .toHaveBeenCalledWith(true);
    expect((scene as any).freightObjectiveCard.setVisible)
      .toHaveBeenCalledWith(true);
    expect((scene as any).constructionInspector.clear).toHaveBeenCalled();
    expect((scene as any).validationHint.clear).toHaveBeenCalled();
  });

  it('yields the vehicle purchase panel during a construction decision and restores it afterward', () => {
    const scene = new EditorUIScene();
    (scene as any).vehiclePurchasePanel = { setVisible: jest.fn() };
    (scene as any).editorControlsVisible = true;

    (scene as any).constructionPreviewHandler({
      phase: 'review',
      preview: {},
    });
    expect((scene as any).vehiclePurchasePanel.setVisible)
      .toHaveBeenLastCalledWith(false);

    (scene as any).constructionPreviewHandler({
      phase: 'committed',
      preview: null,
    });
    expect((scene as any).vehiclePurchasePanel.setVisible)
      .toHaveBeenLastCalledWith(true);
  });

  it('hydrates a failed startup save into the HUD and Retry Save action', () => {
    startEditorUI({
      visible: true,
      companyCash: 875_000,
      saveState: 'unsaved',
      saveErrorMessage: 'Could not save the world. Retry Save is available.',
    });

    const retry = document.querySelector(
      '[data-testid="editor-retry-save"]',
    ) as HTMLButtonElement | null;
    expect(retry?.style.display).toBe('block');
    expect(retry?.disabled).toBe(false);
    expect(document.querySelector('[data-testid="company-cash"]')?.textContent)
      .toBe('£875,000');
    expect(document.querySelector('[data-testid="company-save-state"]')?.textContent)
      .toBe('Unsaved');
    expect(document.querySelector('[data-testid="company-economy-time"]')?.textContent)
      .toBe('Day 1 · Tick 0');
  });

  it('consumes the startup save error once after toolbar creation and removes its listener on shutdown', () => {
    const showToast = jest.spyOn(
      EditorToolbar.prototype as any,
      'showToast',
    );
    const message = 'Could not save the world. Retry Save is available.';
    const scene = startEditorUI({
      visible: true,
      companyCash: 875_000,
      saveState: 'unsaved',
      saveErrorMessage: message,
    });

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(message, 'error');
    expect((scene as any).initialSaveErrorMessage).toBeNull();

    const shutdown = (scene.events.once as jest.Mock).mock.calls.at(-1)?.[1];
    shutdown?.();
    startedScenes.splice(startedScenes.indexOf(scene), 1);
    EventBus.emit('ui:toast', { message: 'after shutdown', type: 'info' });
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it('keeps saved startup quiet and play startup controls hidden', () => {
    const showToast = jest.spyOn(
      EditorToolbar.prototype as any,
      'showToast',
    );
    startEditorUI({
      visible: false,
      companyCash: 875_000,
      saveState: 'saved',
    });

    const retry = document.querySelector(
      '[data-testid="editor-retry-save"]',
    ) as HTMLButtonElement | null;
    expect(retry?.style.display).toBe('none');
    expect(document.querySelector('[data-testid="company-hud"]')
      ?.getAttribute('aria-hidden')).toBe('false');
    expect(showToast).not.toHaveBeenCalled();
  });

  it.each([
    ['desktop', 1280, 720],
    ['mobile', 375, 667],
  ])(
    'keeps facility inspection readable and restores the Build purchase panel at %s',
    (_layout, width, height) => {
      Object.defineProperty(window, 'innerWidth', {
        value: width,
        configurable: true,
      });
      Object.defineProperty(window, 'innerHeight', {
        value: height,
        configurable: true,
      });
      startEditorUI({
        visible: true,
        companyCash: 1_000_000,
        saveState: 'saved',
      });
      window.dispatchEvent(new Event('resize'));
      const facility = document.querySelector(
        '[data-testid="facility-inspector"]',
      ) as HTMLElement;
      const purchase = document.querySelector(
        '[data-testid="vehicle-purchase-panel"]',
      ) as HTMLElement;

      EventBus.emit('facility:inspection', {
        id: 'sawmill',
        name: 'Sawmill',
        status: { code: 'working', label: 'Working' },
        produces: ['structural-timber'],
        needs: ['logs'],
        inputRows: [{
          productId: 'logs',
          displayName: 'Logs',
          unitLabel: 'tonne',
          requiredQuantity: 10,
          availableQuantity: 10,
          missingQuantity: 0,
        }],
        outputRows: [{
          productId: 'structural-timber',
          displayName: 'Structural Timber',
          unitLabel: 'tonne',
          cycleQuantity: 8,
        }],
        inventories: [],
        quotes: [],
        railConnected: true,
      });

      expect(facility.dataset.layout).toBe(_layout);
      expect(purchase.dataset.layout).toBe(_layout);
      expect(facility.getAttribute('aria-hidden')).toBe('false');
      expect(purchase.getAttribute('aria-hidden')).toBe('true');

      EventBus.emit('facility:deselected', { facilityId: 'sawmill' });

      expect(facility.getAttribute('aria-hidden')).toBe('true');
      expect(purchase.getAttribute('aria-hidden')).toBe('false');
    },
  );

  it('draws the minimap in the fixed UI layer only while editor controls are visible', () => {
    const scene = startEditorUI({
      visible: true,
      companyCash: 875_000,
      saveState: 'saved',
    });
    const minimap = (scene as any).minimapRenderer;
    const draw = jest.spyOn(minimap, 'draw');
    const clear = jest.spyOn(minimap, 'clear');

    (scene as any).update(0, 16);
    expect(draw).toHaveBeenCalledTimes(1);

    EventBus.emit('ui:toolbar-visible', { visible: false });
    (scene as any).update(16, 16);
    expect(draw).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalled();
  });
});
