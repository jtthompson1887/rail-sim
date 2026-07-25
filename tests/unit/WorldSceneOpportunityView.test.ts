/**
 * @jest-environment jsdom
 */
import { WorldManager } from '../../src/managers/WorldManager';
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
    const recommendation = created.world.starterOpportunity.recommendedCamera;
    const scene = new WorldScene() as any;
    const setZoom = jest.fn();
    const centerOn = jest.fn();
    scene.cameras = { main: { setZoom, centerOn } };

    scene.applyStarterOpportunityCamera();

    expect(setZoom).toHaveBeenCalledWith(recommendation.zoom);
    expect(centerOn).toHaveBeenCalledWith(
      recommendation.x,
      recommendation.y,
    );
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
    };
    scene.add.graphics = jest.fn().mockReturnValue(graphics);
    scene.add.text = jest.fn().mockReturnValue(text);

    scene.renderStarterOpportunitySurvey();

    expect(graphics.beginPath).toHaveBeenCalledTimes(2);
    expect(graphics.strokePath).toHaveBeenCalledTimes(2);
    expect(graphics.fillCircle).toHaveBeenCalledTimes(2);
    expect(scene.add.text).toHaveBeenCalledTimes(4);
  });
});
