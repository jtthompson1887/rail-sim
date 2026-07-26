import { SelectionManager } from '../../src/systems/SelectionManager';
import { EventBus } from '../../src/services/EventBus';

const { makeScene } = require('../../__mocks__/phaser');

type Point = { x: number; y: number };

function graphicsSurface() {
  const surface: Record<string, jest.Mock> = {};
  for (const method of [
    'setDepth', 'setScrollFactor', 'clear', 'lineStyle', 'beginPath', 'moveTo',
    'lineTo', 'strokePath', 'fillStyle', 'fillRect', 'strokeRect', 'destroy',
  ]) {
    surface[method] = jest.fn(() => surface);
  }
  return surface;
}

function handleRectangle() {
  const rect: Record<string, jest.Mock> = {};
  for (const method of [
    'setStrokeStyle', 'setDepth', 'setInteractive', 'destroy',
  ]) {
    rect[method] = jest.fn(() => rect);
  }
  return rect;
}

function trackFixture(uuid: string, midpoint: Point, start: Point, end: Point) {
  const p1 = {
    x: start.x + (end.x - start.x) / 3,
    y: start.y + (end.y - start.y) / 3,
  };
  const p2 = {
    x: start.x + (end.x - start.x) * 2 / 3,
    y: start.y + (end.y - start.y) * 2 / 3,
  };
  return {
    getUUID: () => uuid,
    getMidPoint: () => ({ ...midpoint }),
    getControlPoints: () => ({ p0: start, p1, p2, p3: end }),
    getCurvePath: () => ({
      getPoint: (t: number) => ({
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      }),
    }),
  };
}

function selectionHarness(tracks: any[]) {
  const scene = makeScene();
  const highlights = graphicsSurface();
  const rubberBand = graphicsSurface();
  scene.add.graphics
    .mockReturnValueOnce(highlights)
    .mockReturnValueOnce(rubberBand);
  scene.add.rectangle.mockImplementation(() => handleRectangle());

  const byId = new Map(tracks.map((track) => [track.getUUID(), track]));
  const trackManager = {
    tracks,
    getTrack: jest.fn((uuid: string) => byId.get(uuid)),
    getClosestTrack: jest.fn(),
  };
  const manager = new SelectionManager(scene, trackManager as any);
  return { manager, scene, trackManager, highlights, rubberBand };
}

describe('SelectionManager editor interaction lifecycle', () => {
  const first = trackFixture('track-a', { x: 10, y: 10 }, { x: 0, y: 0 }, { x: 20, y: 20 });
  const second = trackFixture('track-b', { x: 25, y: 10 }, { x: 20, y: 0 }, { x: 30, y: 20 });

  it('emits selection transitions without creating reshape handles', () => {
    const { manager, scene } = selectionHarness([first, second]);
    const transitions: string[][] = [];
    const listener = ({ uuids }: { uuids: string[] }) => transitions.push(uuids);
    EventBus.on('selection:changed', listener);

    manager.select('track-a');
    expect(manager.selectedUUIDs).toEqual(['track-a']);
    expect(manager.getHandles()).toEqual([]);
    expect(scene.input.setDraggable).not.toHaveBeenCalled();

    manager.addToSelection('track-b');
    expect(manager.selectedUUIDs).toEqual(['track-a', 'track-b']);
    expect(manager.getHandles()).toEqual([]);

    manager.addToSelection('track-a');
    expect(manager.selectedUUIDs).toEqual(['track-b']);
    manager.clearSelection();
    manager.clearSelection();

    expect(transitions).toEqual([
      ['track-a'],
      ['track-a', 'track-b'],
      ['track-b'],
      [],
    ]);

    EventBus.off('selection:changed', listener);
    manager.destroy();
  });

  it('cycles nearest overlapping candidates on repeated clicks at the same location', () => {
    const { manager } = selectionHarness([second, first]);

    manager.onPointerDown(12, 10, false);
    expect(manager.selectedUUIDs).toEqual(['track-a']);

    manager.onPointerDown(12, 10, false);
    expect(manager.selectedUUIDs).toEqual(['track-b']);

    manager.onPointerDown(12, 10, false);
    expect(manager.selectedUUIDs).toEqual(['track-a']);

    manager.destroy();
  });

  it('keeps a shift-clicked candidate alongside the existing selection', () => {
    const { manager } = selectionHarness([first, second]);
    manager.select('track-b');

    manager.onPointerDown(10, 10, true);

    expect(manager.selectedUUIDs).toEqual(['track-b', 'track-a']);
    manager.destroy();
  });

  it('selects only midpoints inside a reverse-direction rubber band and draws it in screen space', () => {
    const outside = trackFixture('outside', { x: 300, y: 300 }, { x: 290, y: 290 }, { x: 310, y: 310 });
    const { manager, scene, rubberBand } = selectionHarness([first, second, outside]);
    scene.cameras.main.scrollX = -10;
    scene.cameras.main.scrollY = -20;
    scene.cameras.main.zoom = 2;

    manager.onPointerDown(1000, 1000, false);
    manager.onPointerMove(0, 0);
    manager.update(100);

    expect(rubberBand.fillRect).toHaveBeenCalledWith(20, 40, 2000, 2000);

    manager.onPointerUp(0, 0, false);
    expect(manager.selectedUUIDs).toEqual(['track-a', 'track-b', 'outside']);
    expect(rubberBand.clear).toHaveBeenCalled();
    manager.destroy();
  });

  it('does not replace selection after a click-sized empty-space drag', () => {
    const { manager } = selectionHarness([first]);
    manager.select('track-a');

    manager.onPointerDown(500, 500, false);
    manager.onPointerMove(505, 505);
    manager.onPointerUp(505, 505, false);

    expect(manager.selectedUUIDs).toEqual([]);
    manager.destroy();
  });

  it('draws hover and selected outlines without reshape affordances', () => {
    const { manager, trackManager, highlights, rubberBand } = selectionHarness([first]);
    trackManager.getClosestTrack.mockReturnValue(first);

    manager.onPointerMove(10, 10);
    manager.update(16);
    expect(highlights.lineStyle).toHaveBeenCalledWith(2, 0x00c8c8, 0.5);
    expect(highlights.strokePath).toHaveBeenCalledTimes(1);

    manager.select('track-a');
    manager.update(16);
    expect(highlights.lineStyle).toHaveBeenCalledWith(4, 0xffffff, 0.9);
    expect(highlights.fillRect).not.toHaveBeenCalled();

    manager.destroy();
    expect(highlights.destroy).toHaveBeenCalledTimes(1);
    expect(rubberBand.destroy).toHaveBeenCalledTimes(1);
    expect(manager.getHandles()).toEqual([]);
  });
});
