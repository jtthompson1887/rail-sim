import {
  cameraToWorldPoint,
  worldToCameraPoint,
} from '../e2e/helpers/CameraCoordinates';

describe('browser camera coordinates', () => {
  it('round-trips the production camera equation at non-unit zoom', () => {
    const camera = {
      scrollX: -4_800,
      scrollY: 1_250,
      zoom: 0.42,
      width: 1_920,
      height: 1_400,
    };
    const worldPoint = { x: -3_500, y: 2_750 };
    const cameraPoint = worldToCameraPoint(worldPoint, camera);

    expect(cameraToWorldPoint(
      cameraPoint,
      camera,
    )).toEqual(worldPoint);
    expect(cameraPoint.x).toBeCloseTo(1_102.8);
    expect(cameraPoint.y).toBeCloseTo(1_036);
  });
});
