import { CabLookController } from '../../src/cab3d/camera/CabLookController';
import { degToRad } from '../../src/cab3d/model/CabCoordinate';

describe('CabLookController', () => {
  it('springs yaw to the target angle', () => {
    const controller = new CabLookController();
    const targetYaw = degToRad(45);
    const targetPitch = degToRad(1);

    // Step at 16 ms for 1 second.
    let state = controller.update(16, 0, 0);
    for (let i = 0; i < 62; i++) {
      state = controller.update(16, targetYaw, targetPitch);
    }

    expect(state.yaw).toBeCloseTo(targetYaw, 2);
    expect(state.pitch).toBeCloseTo(targetPitch, 2);
  });

  it('clamps yaw to +/- 120 degrees', () => {
    const controller = new CabLookController();
    const state = controller.update(1000, degToRad(200), 0);
    expect(state.yaw).toBeCloseTo(degToRad(120), 5);
  });

  it('clamps pitch to -35..+25 degrees', () => {
    const controller = new CabLookController();
    const tooHigh = controller.update(1000, 0, degToRad(45));
    expect(tooHigh.pitch).toBeCloseTo(degToRad(25), 5);

    const tooLow = controller.update(1000, 0, degToRad(-45));
    expect(tooLow.pitch).toBeCloseTo(degToRad(-35), 5);
  });

  it('springs back to centre when no input is given', () => {
    const controller = new CabLookController();
    controller.update(1000, degToRad(90), degToRad(20));
    const state = controller.update(1000, 0, 0);

    expect(state.yaw).toBeLessThan(degToRad(90));
    expect(state.pitch).toBeLessThan(degToRad(20));
  });
});
