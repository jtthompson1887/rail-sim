import Phaser from 'phaser';
import RailTrack from '../../src/entities/RailTrack';
import { connectPorts } from '../../src/entities/TrackPort';
import {
  deriveRailVehiclePose,
  type OnRailVehicleState,
  type RailVehicleDefinition,
} from '../../src/physics/RailVehicleModel';
import { RouteCursor, TrackGraphRouteResolver } from '../../src/physics/RouteCursor';

const { makeScene } = require('../../__mocks__/phaser');

const vehicle: RailVehicleDefinition = {
  id: 'test-car',
  massKg: 60_000,
  bodyLength: 120,
  wheelbase: 80,
  frontCouplerOffset: 65,
  rearCouplerOffset: 65,
  maxTractiveEffortN: 0,
  maxBrakeForceN: 120_000,
};

function track(
  scene: Phaser.Scene,
  uuid: string,
  points: Array<{ x: number; y: number }>,
): RailTrack {
  const result = new RailTrack(
    scene,
    new Phaser.Math.Vector2(points[0].x, points[0].y),
    new Phaser.Math.Vector2(points[1].x, points[1].y),
    new Phaser.Math.Vector2(points[2].x, points[2].y),
    new Phaser.Math.Vector2(points[3].x, points[3].y),
  );
  result.setUUID(uuid);
  return result;
}

function state(trackUUID: string, distance: number): OnRailVehicleState {
  return {
    mode: 'on-rail',
    vehicleId: 'vehicle-1',
    centre: { trackUUID, distance, direction: 1 },
    speedMps: 12,
  };
}

function expectPointClose(
  actual: { x: number; y: number },
  expected: { x: number; y: number },
): void {
  expect(Math.hypot(actual.x - expected.x, actual.y - expected.y)).toBeLessThan(0.01);
}

function angleDifference(left: number, right: number): number {
  return Math.abs(Math.atan2(Math.sin(left - right), Math.cos(left - right)));
}

describe('deriveRailVehiclePose', () => {
  it('places both bogies and couplers at independent route offsets on straight rail', () => {
    const scene = makeScene();
    const straight = track(scene, 'straight', [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
      { x: 300, y: 0 },
    ]);
    const resolver = new TrackGraphRouteResolver([straight]);

    const pose = deriveRailVehiclePose(vehicle, state('straight', 150), resolver);

    expectPointClose(pose.centre, { x: 150, y: 0 });
    expectPointClose(pose.frontBogie, { x: 190, y: 0 });
    expectPointClose(pose.rearBogie, { x: 110, y: 0 });
    expectPointClose(pose.frontCoupler, { x: 215, y: 0 });
    expectPointClose(pose.rearCoupler, { x: 85, y: 0 });
    expect(pose.angleRad).toBe(0);
    expect(pose.curvature).toBe(0);
  });

  it.each([
    ['constant-turn curve', [
      { x: 0, y: 0 },
      { x: 0, y: 180 },
      { x: 180, y: 180 },
      { x: 180, y: 0 },
    ]],
    ['S-curve', [
      { x: 0, y: 0 },
      { x: 100, y: 160 },
      { x: 200, y: -160 },
      { x: 300, y: 0 },
    ]],
  ] as const)('aligns the chassis chord while both bogies follow the %s', (_label, points) => {
    const scene = makeScene();
    const curved = track(scene, 'curve', [...points]);
    const resolver = new TrackGraphRouteResolver([curved]);
    const centreDistance = curved.getArcLengthIndex().length / 2;
    const centre = new RouteCursor({
      trackUUID: 'curve',
      distance: centreDistance,
      direction: 1,
    }, resolver);
    const expectedFront = centre.movedBy(vehicle.wheelbase / 2).pose().point;
    const expectedRear = centre.movedBy(-vehicle.wheelbase / 2).pose().point;

    const pose = deriveRailVehiclePose(vehicle, state('curve', centreDistance), resolver);

    expectPointClose(pose.frontBogie, expectedFront);
    expectPointClose(pose.rearBogie, expectedRear);
    expect(angleDifference(
      pose.angleRad,
      Math.atan2(
        pose.frontBogie.y - pose.rearBogie.y,
        pose.frontBogie.x - pose.rearBogie.x,
      ),
    )).toBeLessThan(1e-9);
  });

  it('keeps bogies continuous when the wheelbase straddles a track boundary', () => {
    const scene = makeScene();
    const first = track(scene, 'first', [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 80, y: 0 },
      { x: 120, y: 0 },
    ]);
    const second = track(scene, 'second', [
      { x: 120, y: 0 },
      { x: 160, y: 0 },
      { x: 200, y: 0 },
      { x: 240, y: 0 },
    ]);
    connectPorts(first.endPort, second.startPort);
    const resolver = new TrackGraphRouteResolver([first, second]);

    const pose = deriveRailVehiclePose(vehicle, state('first', 110), resolver);

    expectPointClose(pose.frontBogie, { x: 150, y: 0 });
    expectPointClose(pose.rearBogie, { x: 70, y: 0 });
    expectPointClose(pose.centre, { x: 110, y: 0 });
  });
});
