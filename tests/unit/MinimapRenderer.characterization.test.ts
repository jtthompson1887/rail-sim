import { MinimapRenderer } from '../../src/ui/MinimapRenderer';

const { makeScene } = require('../../__mocks__/phaser');

function graphicsSurface() {
  const surface: Record<string, jest.Mock> = {};
  for (const method of [
    'setDepth', 'setScrollFactor', 'clear', 'fillStyle', 'fillRect', 'lineStyle',
    'strokeRect', 'beginPath', 'moveTo', 'lineTo', 'strokePath', 'destroy',
  ]) {
    surface[method] = jest.fn(() => surface);
  }
  return surface;
}

function minimapTrack(
  uuid: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
  connected: boolean,
) {
  return {
    getUUID: () => uuid,
    hasNext: () => connected,
    hasPrevious: () => false,
    getCurvePath: () => ({
      getPoint: (t: number) => ({
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      }),
    }),
  };
}

describe('MinimapRenderer overview contract', () => {
  it('draws the minimap frame but no paths when the world has no tracks', () => {
    const scene = makeScene();
    scene.scale = { width: 1000, height: 700 };
    const graphics = graphicsSurface();
    scene.add.graphics.mockReturnValue(graphics);
    const renderer = new MinimapRenderer(
      scene,
      { tracks: [] } as any,
      { isSelected: jest.fn() } as any,
    );

    renderer.draw();

    expect(graphics.fillRect).toHaveBeenCalledWith(804, 564, 180, 120);
    expect(graphics.strokeRect).toHaveBeenCalledWith(804, 564, 180, 120);
    expect(graphics.beginPath).not.toHaveBeenCalled();
    renderer.destroy();
  });

  it('maps tracks into the panel and distinguishes selected, connected, and open paths', () => {
    const scene = makeScene();
    scene.scale = { width: 1000, height: 700 };
    const graphics = graphicsSurface();
    scene.add.graphics.mockReturnValue(graphics);
    const selected = minimapTrack('selected', { x: 0, y: 0 }, { x: 100, y: 50 }, false);
    const connected = minimapTrack('connected', { x: 100, y: 50 }, { x: 200, y: 100 }, true);
    const open = minimapTrack('open', { x: 50, y: 100 }, { x: 150, y: 0 }, false);
    const selectionManager = {
      isSelected: jest.fn((uuid: string) => uuid === 'selected'),
    };
    const renderer = new MinimapRenderer(
      scene,
      { tracks: [selected, connected, open] } as any,
      selectionManager as any,
    );

    renderer.draw();

    expect(graphics.lineStyle).toHaveBeenCalledWith(2, 0xffffff, 0.9);
    expect(graphics.lineStyle).toHaveBeenCalledWith(1, 0x00ff88, 0.9);
    expect(graphics.lineStyle).toHaveBeenCalledWith(1, 0xff4444, 0.9);
    expect(graphics.strokePath).toHaveBeenCalledTimes(3);
    expect(graphics.lineTo).toHaveBeenCalledTimes(24);
    expect(selectionManager.isSelected).toHaveBeenCalledTimes(3);
    for (const [x, y] of [
      ...graphics.moveTo.mock.calls,
      ...graphics.lineTo.mock.calls,
    ]) {
      expect(x).toBeGreaterThanOrEqual(804);
      expect(x).toBeLessThanOrEqual(984);
      expect(y).toBeGreaterThanOrEqual(564);
      expect(y).toBeLessThanOrEqual(684);
    }

    renderer.clear();
    expect(graphics.clear).toHaveBeenCalledTimes(2);
    renderer.destroy();
    expect(graphics.destroy).toHaveBeenCalledTimes(1);
  });

  it('uses a non-zero extent for a one-point world so coordinates stay finite', () => {
    const scene = makeScene();
    const graphics = graphicsSurface();
    scene.add.graphics.mockReturnValue(graphics);
    const pointTrack = minimapTrack('point', { x: 40, y: 60 }, { x: 40, y: 60 }, false);
    const renderer = new MinimapRenderer(
      scene,
      { tracks: [pointTrack] } as any,
      { isSelected: () => false } as any,
    );

    renderer.draw();

    for (const [x, y] of [...graphics.moveTo.mock.calls, ...graphics.lineTo.mock.calls]) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
    renderer.destroy();
  });
});
