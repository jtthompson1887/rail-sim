/**
 * @jest-environment jsdom
 */
import WorldSelectScene from '../../src/scenes/WorldSelectScene';
import { SaveService } from '../../src/services/SaveService';

describe('WorldSelectScene incompatible save rows', () => {
  it.each([
    ['trusted-storage-key'],
    [''],
  ])('deletes by trusted storageId %j rather than the embedded world id', (storageId) => {
    const scene = new WorldSelectScene() as any;
    let deleteHandler: (() => void) | undefined;
    const fluent = {
      setStrokeStyle: jest.fn().mockReturnThis(),
      setOrigin: jest.fn().mockReturnThis(),
      setInteractive: jest.fn().mockReturnThis(),
      setPadding: jest.fn().mockReturnThis(),
      on: jest.fn().mockImplementation((event: string, handler: () => void) => {
        if (event === 'pointerdown') deleteHandler = handler;
        return fluent;
      }),
    };
    scene.add.rectangle = jest.fn().mockReturnValue(fluent);
    scene.add.text = jest.fn().mockReturnValue(fluent);
    scene.scene = { restart: jest.fn() };
    const deleteSpy = jest.spyOn(SaveService, 'deleteWorld').mockImplementation();

    scene.renderIncompatibleWorldRow({
      compatible: false,
      id: 'untrusted-embedded-id',
      storageId,
      name: 'Mismatched save',
      updatedAt: 0,
      message: 'Incompatible',
      action: 'Start a new world.',
    }, 100, 100, 400, 120);
    deleteHandler!();

    expect(deleteSpy).toHaveBeenCalledWith(storageId);
    deleteSpy.mockRestore();
  });
});
