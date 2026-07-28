/**
 * @jest-environment jsdom
 */
import WorldSelectScene from '../../src/scenes/WorldSelectScene';
import { SaveService } from '../../src/services/SaveService';
import { WorldManager } from '../../src/managers/WorldManager';
import {
  MAX_OPPORTUNITY_ATTEMPTS,
  MAX_SITE_CANDIDATES_PER_ATTEMPT,
} from '../../src/config/WorldGeneration';

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

describe('WorldSelectScene generated-world picker', () => {
  function pickerScene() {
    const scene = new WorldSelectScene() as any;
    const objects: Array<{
      kind: 'rectangle' | 'text';
      value?: string;
      handlers: Record<string, () => void>;
      destroyed: boolean;
      setStrokeStyle: jest.Mock;
      setOrigin: jest.Mock;
      setInteractive: jest.Mock;
      setPadding: jest.Mock;
      setDepth: jest.Mock;
      on: jest.Mock;
      destroy: jest.Mock;
    }> = [];
    const makeObject = (kind: 'rectangle' | 'text', value?: string) => {
      const object = {
        kind,
        value,
        handlers: {} as Record<string, () => void>,
        destroyed: false,
        setStrokeStyle: jest.fn(),
        setOrigin: jest.fn(),
        setInteractive: jest.fn(),
        setPadding: jest.fn(),
        setDepth: jest.fn(),
        on: jest.fn(),
        destroy: jest.fn(),
      };
      for (const method of [
        'setStrokeStyle',
        'setOrigin',
        'setInteractive',
        'setPadding',
        'setDepth',
      ] as const) {
        object[method].mockReturnValue(object);
      }
      object.on.mockImplementation((event: string, handler: () => void) => {
        object.handlers[event] = handler;
        return object;
      });
      object.destroy.mockImplementation(() => {
        object.destroyed = true;
      });
      objects.push(object);
      return object;
    };
    scene.scale = { width: 1000, height: 800 };
    scene.add.rectangle = jest.fn().mockImplementation(
      () => makeObject('rectangle'),
    );
    scene.add.text = jest.fn().mockImplementation(
      (_x: number, _y: number, value: string) => makeObject('text', value),
    );
    scene.scene = { start: jest.fn() };
    return { scene, objects };
  }

  it('keeps the failed seed visible and retries it until the user randomises', () => {
    const { scene, objects } = pickerScene();
    const randomUUID = jest.spyOn(global.crypto, 'randomUUID')
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222');
    const createSpy = jest.spyOn(WorldManager, 'tryCreateNew').mockReturnValue({
      ok: false,
      error: {
        code: 'opportunity-exhausted',
        seed: '11111111-1111-4111-8111-111111111111',
        attemptsEvaluated: MAX_OPPORTUNITY_ATTEMPTS,
        maxSiteCandidatesEvaluated: MAX_SITE_CANDIDATES_PER_ATTEMPT,
      },
    });

    scene.showBiomePicker();
    let activeRectangles = objects.filter(
      (object) => object.kind === 'rectangle',
    );
    activeRectangles[activeRectangles.length - 1].handlers.pointerdown();

    expect(createSpy).toHaveBeenLastCalledWith(
      'World 1',
      '11111111-1111-4111-8111-111111111111',
      'temperate',
    );
    expect(objects.some((object) => (
      !object.destroyed
      && object.value === 'Generation failed for seed: 11111111-1111-4111-8111-111111111111'
    ))).toBe(true);
    expect(objects.some((object) => (
      !object.destroyed && object.value === 'Retry Same Seed'
    ))).toBe(true);
    activeRectangles = objects.filter((object) => (
      !object.destroyed && object.kind === 'rectangle'
    ));
    activeRectangles[activeRectangles.length - 1].handlers.pointerdown();
    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(createSpy.mock.calls[1][1]).toBe(
      '11111111-1111-4111-8111-111111111111',
    );

    objects.find((object) => (
      !object.destroyed && object.value === 'Randomise Seed'
    ))!.handlers.pointerdown();
    activeRectangles = objects.filter((object) => (
      !object.destroyed && object.kind === 'rectangle'
    ));
    activeRectangles[activeRectangles.length - 1].handlers.pointerdown();
    expect(createSpy.mock.calls[2][1]).toBe(
      '22222222-2222-4222-8222-222222222222',
    );
    expect(scene.scene.start).not.toHaveBeenCalled();
    randomUUID.mockRestore();
  });
});
