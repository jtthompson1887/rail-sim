import { MinimapRenderer } from '../../src/ui/MinimapRenderer';

function graphicsSurface() {
  const graphics: Record<string, jest.Mock> = {};
  for (const method of [
    'setDepth', 'clear', 'fillStyle', 'fillRect', 'lineStyle', 'strokeRect',
    'beginPath', 'moveTo', 'lineTo', 'strokePath', 'destroy',
  ]) {
    graphics[method] = jest.fn(() => graphics);
  }
  return graphics;
}

function minimapTrack(
  uuid: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  return {
    getCurvePath: () => ({
      getPoint: (t: number) => ({
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      }),
    }),
    getUUID: () => uuid,
    hasNext: () => false,
    hasPrevious: () => false,
  };
}

function createRenderer(
  tracks: ReturnType<typeof minimapTrack>[],
  selectedUUIDs: string[] = [],
) {
  const graphics = graphicsSurface();
  const scene: any = {
    add: { graphics: jest.fn(() => graphics) },
    scale: { width: 1000, height: 700 },
  };
  const renderer = new MinimapRenderer(
    scene,
    { tracks } as any,
    { isSelected: (uuid: string) => selectedUUIDs.includes(uuid) } as any,
  );
  return { graphics, renderer };
}

function pathPoints(graphics: Record<string, jest.Mock>): number[][] {
  return [
    ...graphics.moveTo.mock.calls,
    ...graphics.lineTo.mock.calls,
  ];
}

describe('MinimapRenderer', () => {
  it('keeps the 180 by 120 panel at fixed lower-right screen coordinates', () => {
    const { graphics, renderer } = createRenderer([]);

    renderer.draw();

    expect(graphics.fillRect).toHaveBeenCalledWith(804, 564, 180, 120);
    expect(renderer.screenBounds).toEqual({
      left: 804,
      right: 984,
      top: 564,
      bottom: 684,
    });
  });

  it('fits a horizontal path inside the padded width and centers its zero-height extent', () => {
    const { graphics, renderer } = createRenderer([
      minimapTrack('horizontal', { x: 10, y: 30 }, { x: 210, y: 30 }),
    ]);

    renderer.draw();

    const points = pathPoints(graphics);
    expect(points[0]).toEqual([808, 624]);
    expect(points.at(-1)).toEqual([980, 624]);
  });

  it('fits a vertical path inside the padded height and centers its zero-width extent', () => {
    const { graphics, renderer } = createRenderer([
      minimapTrack('vertical', { x: 40, y: -20 }, { x: 40, y: 80 }),
    ]);

    renderer.draw();

    const points = pathPoints(graphics);
    expect(points[0]).toEqual([894, 568]);
    expect(points.at(-1)).toEqual([894, 680]);
  });

  it('centers a point extent in both axes', () => {
    const { graphics, renderer } = createRenderer([
      minimapTrack('point', { x: 40, y: 60 }, { x: 40, y: 60 }),
    ]);

    renderer.draw();

    for (const point of pathPoints(graphics)) {
      expect(point).toEqual([894, 624]);
    }
  });

  it('keeps every selected two-pixel stroke clear of the panel border', () => {
    const { graphics, renderer } = createRenderer([
      minimapTrack('selected', { x: 0, y: 0 }, { x: 400, y: 100 }),
    ], ['selected']);

    renderer.draw();

    expect(graphics.lineStyle).toHaveBeenCalledWith(2, 0xffffff, 0.9);
    for (const [x, y] of pathPoints(graphics)) {
      expect(x - 1).toBeGreaterThan(804);
      expect(x + 1).toBeLessThan(984);
      expect(y - 1).toBeGreaterThan(564);
      expect(y + 1).toBeLessThan(684);
    }
  });

  it('uses one aspect-preserving transform for multiple tracks', () => {
    const { graphics, renderer } = createRenderer([
      minimapTrack('top', { x: 0, y: 0 }, { x: 200, y: 0 }),
      minimapTrack('bottom', { x: 0, y: 100 }, { x: 200, y: 100 }),
    ]);

    renderer.draw();

    const firstPathStart = graphics.moveTo.mock.calls[0];
    const firstPathEnd = graphics.lineTo.mock.calls[7];
    const secondPathStart = graphics.moveTo.mock.calls[1];
    const secondPathEnd = graphics.lineTo.mock.calls[15];
    expect(firstPathStart).toEqual([808, 581]);
    expect(firstPathEnd).toEqual([980, 581]);
    expect(secondPathStart).toEqual([808, 667]);
    expect(secondPathEnd).toEqual([980, 667]);
  });

  it('reports whether a screen point falls within its current panel bounds', () => {
    const { renderer } = createRenderer([]);

    expect(renderer.containsScreenPoint(804, 564)).toBe(true);
    expect(renderer.containsScreenPoint(984, 684)).toBe(true);
    expect(renderer.containsScreenPoint(803, 624)).toBe(false);
    expect(renderer.containsScreenPoint(894, 685)).toBe(false);
  });
});
