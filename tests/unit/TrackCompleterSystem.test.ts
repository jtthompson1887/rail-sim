import { TrackCompleterSystem } from '../../src/systems/TrackCompleterSystem';
import { EventBus } from '../../src/services/EventBus';

const { makeScene } = require('../../__mocks__/phaser');

describe('TrackCompleterSystem disabled interaction', () => {
  it('reports the same concise reason from activation and direct pointer use', () => {
    const scene = makeScene();
    const system = new TrackCompleterSystem(scene, { tracks: [] } as any);
    const emitSpy = jest.spyOn(EventBus, 'emit');

    system.setActive(true);
    system.onPointerDown({ leftButtonDown: () => true } as any);

    expect(emitSpy).toHaveBeenNthCalledWith(1, 'ui:toast', {
      message: 'Connect unavailable — route completion needs one atomic quote.',
      type: 'info',
    });
    expect(emitSpy).toHaveBeenNthCalledWith(2, 'ui:toast', {
      message: 'Connect unavailable — route completion needs one atomic quote.',
      type: 'info',
    });

    emitSpy.mockRestore();
    system.destroy();
  });
});
