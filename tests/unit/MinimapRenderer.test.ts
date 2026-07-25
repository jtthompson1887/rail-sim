import { MinimapRenderer } from '../../src/ui/MinimapRenderer';

describe('MinimapRenderer', () => {
  it('draws at fixed lower-right screen coordinates in the UI scene', () => {
    const graphics: any = {
      setDepth: jest.fn(() => graphics),
      setScrollFactor: jest.fn(() => graphics),
      setScale: jest.fn(() => graphics),
      setPosition: jest.fn(() => graphics),
      clear: jest.fn(() => graphics),
      fillStyle: jest.fn(() => graphics),
      fillRect: jest.fn(() => graphics),
      lineStyle: jest.fn(() => graphics),
      strokeRect: jest.fn(() => graphics),
      beginPath: jest.fn(() => graphics),
      moveTo: jest.fn(() => graphics),
      lineTo: jest.fn(() => graphics),
      strokePath: jest.fn(() => graphics),
      destroy: jest.fn(),
    };
    const scene: any = {
      add: { graphics: jest.fn(() => graphics) },
      scale: { width: 1280, height: 720 },
      cameras: { main: { zoom: 1 } },
    };
    const trackManager: any = { tracks: [] };
    const selectionManager: any = { isSelected: jest.fn(() => false) };

    const renderer = new MinimapRenderer(scene, trackManager, selectionManager);
    renderer.draw();

    expect(graphics.fillRect).toHaveBeenCalledWith(1084, 584, 180, 120);
  });

  it('keeps a single track inside the minimap bounds', () => {
    const graphics: any = {
      setDepth: jest.fn(() => graphics),
      clear: jest.fn(() => graphics),
      fillStyle: jest.fn(() => graphics),
      fillRect: jest.fn(() => graphics),
      lineStyle: jest.fn(() => graphics),
      strokeRect: jest.fn(() => graphics),
      beginPath: jest.fn(() => graphics),
      moveTo: jest.fn(() => graphics),
      lineTo: jest.fn(() => graphics),
      strokePath: jest.fn(() => graphics),
      destroy: jest.fn(),
    };
    const scene: any = {
      add: { graphics: jest.fn(() => graphics) },
      scale: { width: 1280, height: 720 },
    };
    const curve = {
      getPoint: (t: number) => ({ x: t * 400, y: t * 100 }),
    };
    const track: any = {
      getCurvePath: () => curve,
      getUUID: () => 'track-1',
      hasNext: () => false,
      hasPrevious: () => false,
    };
    const renderer = new MinimapRenderer(
      scene,
      { tracks: [track] } as any,
      { isSelected: () => false } as any,
    );

    renderer.draw();

    const routePoints = [
      ...graphics.moveTo.mock.calls,
      ...graphics.lineTo.mock.calls,
    ];
    expect(routePoints).toHaveLength(9);
    for (const [x, y] of routePoints) {
      expect(x).toBeGreaterThanOrEqual(1084);
      expect(x).toBeLessThanOrEqual(1264);
      expect(y).toBeGreaterThanOrEqual(584);
      expect(y).toBeLessThanOrEqual(704);
    }
  });
});
