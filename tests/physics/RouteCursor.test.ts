import Phaser from 'phaser';
import Junction from '../../src/entities/Junction';
import RailTrack from '../../src/entities/RailTrack';
import { connectPorts } from '../../src/entities/TrackPort';
import {
  RouteCursor,
  RouteTraversalError,
  TrackGraphRouteResolver,
} from '../../src/physics/RouteCursor';

const { makeScene } = require('../../__mocks__/phaser');

function straightTrack(
  scene: Phaser.Scene,
  uuid: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
): RailTrack {
  const track = new RailTrack(
    scene,
    new Phaser.Math.Vector2(start.x, start.y),
    new Phaser.Math.Vector2(start.x + (end.x - start.x) / 3, start.y + (end.y - start.y) / 3),
    new Phaser.Math.Vector2(start.x + 2 * (end.x - start.x) / 3, start.y + 2 * (end.y - start.y) / 3),
    new Phaser.Math.Vector2(end.x, end.y),
  );
  track.setUUID(uuid);
  return track;
}

describe('RouteCursor', () => {
  it('crosses a connected end port without a world-space jump', () => {
    const scene = makeScene();
    const first = straightTrack(scene, 'first', { x: 0, y: 0 }, { x: 100, y: 0 });
    const second = straightTrack(scene, 'second', { x: 100, y: 0 }, { x: 200, y: 0 });
    connectPorts(first.endPort, second.startPort);
    const resolver = new TrackGraphRouteResolver([first, second]);
    const cursor = new RouteCursor({ trackUUID: 'first', distance: 0, direction: 1 }, resolver);

    const before = cursor.movedBy(99.95).pose().point;
    const after = cursor.movedBy(100.05).pose().point;

    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeCloseTo(0.1, 6);
    expect(cursor.movedBy(101).state).toEqual({
      trackUUID: 'second',
      distance: 1,
      direction: 1,
    });
  });

  it('traverses the same connection in reverse', () => {
    const scene = makeScene();
    const first = straightTrack(scene, 'first', { x: 0, y: 0 }, { x: 100, y: 0 });
    const second = straightTrack(scene, 'second', { x: 100, y: 0 }, { x: 200, y: 0 });
    connectPorts(first.endPort, second.startPort);
    const resolver = new TrackGraphRouteResolver([first, second]);
    const cursor = new RouteCursor({ trackUUID: 'second', distance: 50, direction: -1 }, resolver);

    expect(cursor.movedBy(60).state).toEqual({
      trackUUID: 'first',
      distance: 90,
      direction: -1,
    });
  });

  it('uses the junction active branch when more than one continuation exists', () => {
    const scene = makeScene();
    const main = straightTrack(scene, 'main', { x: 0, y: 0 }, { x: 100, y: 0 });
    const left = straightTrack(scene, 'left', { x: 100, y: 0 }, { x: 200, y: 50 });
    const right = straightTrack(scene, 'right', { x: 100, y: 0 }, { x: 200, y: -50 });
    connectPorts(main.endPort, left.startPort);
    connectPorts(main.endPort, right.startPort);
    const junction = new Junction(scene, main, left, right, 1);
    const resolver = new TrackGraphRouteResolver([main, left, right], [junction]);
    const cursor = new RouteCursor({ trackUUID: 'main', distance: 0, direction: 1 }, resolver);

    junction.branchState = 'left';
    expect(cursor.movedBy(101).state.trackUUID).toBe('left');
    junction.branchState = 'right';
    expect(cursor.movedBy(101).state.trackUUID).toBe('right');
  });

  it('stops at an unconnected endpoint and replays an exact boundary on the current track', () => {
    const scene = makeScene();
    const first = straightTrack(scene, 'first', { x: 0, y: 0 }, { x: 100, y: 0 });
    const second = straightTrack(scene, 'second', { x: 100, y: 0 }, { x: 200, y: 0 });
    connectPorts(first.endPort, second.startPort);
    const resolver = new TrackGraphRouteResolver([first, second]);
    const cursor = new RouteCursor({ trackUUID: 'first', distance: 0, direction: 1 }, resolver);

    expect(cursor.movedBy(100).state).toEqual({
      trackUUID: 'first',
      distance: 100,
      direction: 1,
    });
    expect(cursor.movedBy(100.001).state.trackUUID).toBe('second');
    expect(cursor.movedBy(1_000).state).toEqual({
      trackUUID: 'second',
      distance: 100,
      direction: 1,
    });
  });

  it('fails with a typed route-cycle error after bounded zero-length traversal', () => {
    const scene = makeScene();
    const first = straightTrack(scene, 'first', { x: 0, y: 0 }, { x: 0, y: 0 });
    const second = straightTrack(scene, 'second', { x: 0, y: 0 }, { x: 0, y: 0 });
    connectPorts(first.endPort, second.startPort);
    connectPorts(second.endPort, first.startPort);
    const resolver = new TrackGraphRouteResolver([first, second]);
    const cursor = new RouteCursor({ trackUUID: 'first', distance: 0, direction: 1 }, resolver);

    expect(() => cursor.movedBy(1)).toThrow(RouteTraversalError);
    try {
      cursor.movedBy(1);
    } catch (error) {
      expect(error).toMatchObject({ code: 'route-cycle' });
    }
  });
});
