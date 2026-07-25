/**
 * @jest-environment jsdom
 */
import { WorldManager } from '../../src/managers/WorldManager';
import { GameStateManager } from '../../src/managers/GameStateManager';
import WorldScene from '../../src/scenes/WorldScene';

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
    const framedX = centerOn.mock.calls[0][0];
    expect(framedX).toBeLessThan(recommendation.x);
    expect((recommendation.x - framedX) * recommendation.zoom * 0.5)
      .toBeCloseTo(29, 10);
    expect(centerOn.mock.calls[0][1]).toBe(recommendation.y);
    expect(setZoom.mock.invocationCallOrder[0])
      .toBeLessThan(centerOn.mock.invocationCallOrder[0]);
  });

  it('renders two survey sites and both persisted corridor guides', () => {
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
    expect(graphics.fillCircle).toHaveBeenCalledTimes(2);
    expect(scene.add.text).toHaveBeenCalledTimes(4);
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
    const labels = Array.from({ length: 4 }, () => ({
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

    expect(renderedLabels).toHaveLength(4);
    for (const label of renderedLabels) {
      expect(label.setScale).toHaveBeenCalledWith(4);
    }
  });
});
