/**
 * @jest-environment jsdom
 */
import { WorldManager } from '../../src/managers/WorldManager';
import { GameStateManager } from '../../src/managers/GameStateManager';
import WorldScene from '../../src/scenes/WorldScene';
import { GameConfig } from '../../src/config/GameConfig';
import { EventBus } from '../../src/services/EventBus';

describe('WorldScene persisted opportunity view', () => {
  beforeEach(() => {
    localStorage.clear();
    WorldManager.reset();
  });

  it('sets persisted zoom before centring on the persisted recommendation', () => {
    const created = WorldManager.tryCreateNew(
      'Camera',
      'real-terrain-alpha',
      'temperate',
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    GameStateManager.enterCreate(created.world.id);
    const recommendation = created.world.starterOpportunity.recommendedCamera;
    const scene = new WorldScene() as any;
    const setZoom = jest.fn();
    const centerOn = jest.fn();
    scene.scale = { width: 960, height: 540 };
    scene.cameras = { main: { setZoom, centerOn } };

    scene.applyStarterOpportunityCamera();

    expect(setZoom).toHaveBeenCalledWith(recommendation.zoom * 0.5);
    const desktopZoom = setZoom.mock.calls[0][0];
    expect(desktopZoom).toBeGreaterThanOrEqual(GameConfig.CAMERA.MIN_ZOOM);
    expect(desktopZoom).toBeLessThanOrEqual(GameConfig.CAMERA.MAX_ZOOM);
    const framedX = centerOn.mock.calls[0][0];
    expect(framedX).toBeLessThan(recommendation.x);
    expect((recommendation.x - framedX) * recommendation.zoom * 0.5)
      .toBeCloseTo(29, 10);
    expect(centerOn.mock.calls[0][1]).toBe(recommendation.y);
    expect(setZoom.mock.invocationCallOrder[0])
      .toBeLessThan(centerOn.mock.invocationCallOrder[0]);
  });

  it('starts a 375x667 world inside the same configured zoom bounds as input controls', () => {
    const created = WorldManager.tryCreateNew(
      'Mobile camera',
      'real-terrain-alpha',
      'temperate',
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    GameStateManager.enterCreate(created.world.id);
    const scene = new WorldScene() as any;
    const setZoom = jest.fn();
    scene.scale = { width: 375, height: 667 };
    scene.cameras = { main: { setZoom, centerOn: jest.fn() } };

    scene.applyStarterOpportunityCamera();

    expect(setZoom).toHaveBeenCalledWith(GameConfig.CAMERA.MIN_ZOOM);
  });

  it('renders both persisted corridor guides without duplicate facility labels', () => {
    const created = WorldManager.tryCreateNew(
      'Survey',
      'real-terrain-beta',
      'temperate',
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const scene = new WorldScene() as any;
    const graphics = {
      setDepth: jest.fn().mockReturnThis(),
      lineStyle: jest.fn().mockReturnThis(),
      beginPath: jest.fn().mockReturnThis(),
      moveTo: jest.fn().mockReturnThis(),
      lineTo: jest.fn().mockReturnThis(),
      strokePath: jest.fn().mockReturnThis(),
      fillStyle: jest.fn().mockReturnThis(),
      fillCircle: jest.fn().mockReturnThis(),
    };
    const text = {
      setOrigin: jest.fn().mockReturnThis(),
      setDepth: jest.fn().mockReturnThis(),
      setScale: jest.fn().mockReturnThis(),
    };
    scene.add.graphics = jest.fn().mockReturnValue(graphics);
    scene.add.text = jest.fn().mockReturnValue(text);

    scene.renderStarterOpportunitySurvey();

    expect(graphics.beginPath).toHaveBeenCalledTimes(2);
    expect(graphics.strokePath).toHaveBeenCalledTimes(2);
    expect(graphics.fillCircle).not.toHaveBeenCalled();
    expect(scene.add.text).toHaveBeenCalledTimes(2);
    const direct = created.world.starterOpportunity.corridors[0];
    expect(scene.add.text.mock.calls[0][0]).toBeCloseTo(
      (direct.waypoints[0].x + direct.waypoints[1].x) / 2,
      10,
    );
    expect(scene.add.text.mock.calls[0][1]).toBeCloseTo(
      (direct.waypoints[0].y + direct.waypoints[1].y) / 2 + 34,
      10,
    );
  });

  it('keeps survey labels readable at the generated overview zoom', () => {
    const created = WorldManager.tryCreateNew(
      'Readable survey',
      'real-terrain-beta',
      'temperate',
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const scene = new WorldScene() as any;
    const graphics = {
      setDepth: jest.fn().mockReturnThis(),
      lineStyle: jest.fn().mockReturnThis(),
      beginPath: jest.fn().mockReturnThis(),
      moveTo: jest.fn().mockReturnThis(),
      lineTo: jest.fn().mockReturnThis(),
      strokePath: jest.fn().mockReturnThis(),
      fillStyle: jest.fn().mockReturnThis(),
      fillCircle: jest.fn().mockReturnThis(),
    };
    const labels = Array.from({ length: 2 }, () => ({
      setOrigin: jest.fn().mockReturnThis(),
      setDepth: jest.fn().mockReturnThis(),
      setScale: jest.fn().mockReturnThis(),
    }));
    scene.add.graphics = jest.fn().mockReturnValue(graphics);
    scene.add.text = jest.fn()
      .mockImplementation(() => labels.shift()!);
    scene.cameras = { main: { zoom: 0.25 } };

    scene.renderStarterOpportunitySurvey();
    const renderedLabels = scene.starterOpportunityLabels;
    scene.updateStarterOpportunityLabelScale();

    expect(renderedLabels).toHaveLength(2);
    for (const label of renderedLabels) {
      expect(label.setScale).toHaveBeenCalledWith(4);
    }
  });

  it('keeps survey bands, markers, and label offsets at exact screen-pixel sizes', () => {
    const created = WorldManager.tryCreateNew(
      'Readable survey geometry',
      'real-terrain-beta',
      'temperate',
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const scene = new WorldScene() as any;
    const graphics = {
      setDepth: jest.fn().mockReturnThis(),
      lineStyle: jest.fn().mockReturnThis(),
      beginPath: jest.fn().mockReturnThis(),
      moveTo: jest.fn().mockReturnThis(),
      lineTo: jest.fn().mockReturnThis(),
      strokePath: jest.fn().mockReturnThis(),
      fillStyle: jest.fn().mockReturnThis(),
      fillCircle: jest.fn().mockReturnThis(),
    };
    const text = {
      setOrigin: jest.fn().mockReturnThis(),
      setDepth: jest.fn().mockReturnThis(),
      setScale: jest.fn().mockReturnThis(),
    };
    scene.add.graphics = jest.fn().mockReturnValue(graphics);
    scene.add.text = jest.fn().mockReturnValue(text);
    scene.cameras = { main: { zoom: 0.1 } };

    scene.renderStarterOpportunitySurvey();

    expect(graphics.lineStyle.mock.calls.map((call: unknown[]) => call[0]))
      .toEqual([240, 240]);
    expect(graphics.fillCircle).not.toHaveBeenCalled();

    const direct = created.world.starterOpportunity.corridors[0];
    const directMidY = (
      direct.waypoints[0].y + direct.waypoints[1].y
    ) / 2;
    expect(scene.add.text.mock.calls[0][1]).toBeCloseTo(
      directMidY + 340,
      10,
    );

  });

  it('renders all seven generated facilities by their economy names', () => {
    const created = WorldManager.tryCreateNew(
      'Facilities',
      'facility-view-seed',
      'temperate',
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const scene = new WorldScene() as any;
    const createdViews: any[] = [];
    scene.trackManager = {
      getTracksInRadius: jest.fn().mockReturnValue([]),
    };
    scene.createFacilityView = jest.fn((
      placement: unknown,
      inspection: { name: string },
    ) => {
      const view = {
        placement,
        inspection,
        update: jest.fn(),
        setSelected: jest.fn(),
        setSelectionEnabled: jest.fn(),
        destroy: jest.fn(),
      };
      createdViews.push(view);
      return view;
    });

    scene.renderFacilities();

    expect(createdViews.map((view) => view.inspection.name)).toEqual([
      'Managed Forest',
      'Sawmill',
      'Quarry',
      'Cement Works',
      'Port Interchange',
      'Prefabrication Plant',
      'Town Construction Market',
    ]);
    expect(scene.facilityViews).toHaveLength(7);
  });

  it('uses the exact endpoint-in-access-radius test without creating railway objects', () => {
    const created = WorldManager.tryCreateNew(
      'Rail access',
      'facility-rail-seed',
      'temperate',
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const facility = created.world.economy.facilities[0];
    const addTrack = jest.fn();
    const createStation = jest.fn();
    const candidate = {
      getControlPoints: () => ({
        p0: {
          x: facility.railAccess.x + facility.railAccess.radius - 1,
          y: facility.railAccess.y,
        },
        p1: { x: 0, y: 0 },
        p2: { x: 0, y: 0 },
        p3: {
          x: facility.railAccess.x + facility.railAccess.radius + 1,
          y: facility.railAccess.y,
        },
      }),
    };
    const scene = new WorldScene() as any;
    scene.trackManager = {
      getTracksInRadius: jest.fn().mockReturnValue([candidate]),
      addTrack,
      createStation,
    };

    expect(scene.isFacilityRailConnected(facility)).toBe(true);
    expect(scene.trackManager.getTracksInRadius).toHaveBeenCalledWith(
      facility.railAccess,
      facility.railAccess.radius,
    );
    expect(addTrack).not.toHaveBeenCalled();
    expect(createStation).not.toHaveBeenCalled();
    expect(created.world.tracks).toHaveLength(0);
    expect(created.world.stations).toHaveLength(0);
  });

  it('selects one facility, publishes its inspection, and clears stale selection', () => {
    const created = WorldManager.tryCreateNew(
      'Selection',
      'facility-select-seed',
      'temperate',
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const scene = new WorldScene() as any;
    const views = created.world.economy.facilities.map((facility) => ({
      facilityId: facility.id,
      setSelected: jest.fn(),
      update: jest.fn(),
      destroy: jest.fn(),
    }));
    scene.facilityViews = views;
    scene.selectionManager = { clearSelection: jest.fn() };
    scene.trainManager = {
      selectedTrain: { id: 'already-selected-train' },
      deselectTrain: jest.fn(),
    };
    scene.trackManager = {
      getTracksInRadius: jest.fn().mockReturnValue([]),
    };
    const emit = jest.spyOn(EventBus, 'emit');

    scene.facilitySelectedHandler({ facilityId: 'sawmill' });

    expect(views.find((view) => view.facilityId === 'sawmill')?.setSelected)
      .toHaveBeenCalledWith(true);
    expect(views.filter((view) => view.facilityId !== 'sawmill')
      .every((view) => view.setSelected.mock.calls.at(-1)?.[0] === false))
      .toBe(true);
    expect(scene.selectionManager.clearSelection).toHaveBeenCalled();
    expect(scene.trainManager.deselectTrain).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      'facility:inspection',
      expect.objectContaining({
        id: 'sawmill',
        status: { code: 'waiting-input', label: 'Needs logs' },
      }),
    );

    scene.clearFacilitySelection();
    expect(emit).toHaveBeenCalledWith('facility:deselected', {
      facilityId: 'sawmill',
    });
  });

  it('clears an existing facility before auto-selecting a live train in Operate mode', () => {
    const scene = new WorldScene() as any;
    const facility = {
      facilityId: 'sawmill',
      setSelected: jest.fn(),
      setSelectionEnabled: jest.fn(),
    };
    const train = { id: 'live-train' };
    scene.activeEditorTool = { cancel: jest.fn() };
    scene.selectionManager = { clearSelection: jest.fn() };
    scene.facilityViews = [facility];
    scene.selectedFacilityId = 'sawmill';
    scene.inputManager = { setupClickHandling: jest.fn() };
    scene.trainManager = {
      trains: [train],
      selectTrain: jest.fn(),
    };
    const emit = jest.spyOn(EventBus, 'emit');

    scene.activatePlayMode();

    expect(scene.selectedFacilityId).toBeNull();
    expect(facility.setSelected).toHaveBeenCalledWith(false);
    expect(emit).toHaveBeenCalledWith('facility:deselected', {
      facilityId: 'sawmill',
    });
    expect(scene.trainManager.selectTrain).toHaveBeenCalledWith(train);
    expect(facility.setSelected.mock.invocationCallOrder[0])
      .toBeLessThan(scene.trainManager.selectTrain.mock.invocationCallOrder[0]);
  });

  it('clears a facility when returning to Build with the track tool armed', () => {
    const scene = new WorldScene() as any;
    const facility = {
      facilityId: 'sawmill',
      setSelected: jest.fn(),
      setSelectionEnabled: jest.fn(),
    };
    scene.facilityViews = [facility];
    scene.selectedFacilityId = 'sawmill';
    scene.activeTool = 'place-track';
    scene.trainManager = { trains: [] };
    scene.cameraController = { stopFollow: jest.fn() };
    scene.syncTrainsSaveAndReport = jest.fn();
    const emit = jest.spyOn(EventBus, 'emit');

    scene.activateCreateMode();

    expect(scene.selectedFacilityId).toBeNull();
    expect(facility.setSelected).toHaveBeenCalledWith(false);
    expect(facility.setSelectionEnabled).toHaveBeenCalledWith(false);
    expect(emit).toHaveBeenCalledWith('facility:deselected', {
      facilityId: 'sawmill',
    });

    emit.mockRestore();
  });
});
