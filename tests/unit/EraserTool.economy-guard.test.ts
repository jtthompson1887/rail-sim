import { EraserTool } from '../../src/systems/tools/EraserTool';
import { EventBus } from '../../src/services/EventBus';

const { makeScene } = require('../../__mocks__/phaser');

describe('EraserTool economy guard', () => {
  it('rejects direct pointer deletion without changing live or command state', () => {
    const scene = makeScene();
    const track = { getUUID: () => 'paid-track' };
    const trackManager = {
      getClosestTrack: jest.fn(() => track),
    };
    const commandStack = { push: jest.fn() };
    const selectionManager = { clearSelection: jest.fn() };
    const emitSpy = jest.spyOn(EventBus, 'emit');
    const tool = new EraserTool(
      scene,
      trackManager as any,
      commandStack as any,
      selectionManager as any,
    );

    tool.onPointerDown(10, 20, {} as any);

    expect(trackManager.getClosestTrack).not.toHaveBeenCalled();
    expect(commandStack.push).not.toHaveBeenCalled();
    expect(selectionManager.clearSelection).not.toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith('ui:toast', {
      message: 'Erase unavailable — select tracks to review the exact refund.',
      type: 'info',
    });
    emitSpy.mockRestore();
  });
});
