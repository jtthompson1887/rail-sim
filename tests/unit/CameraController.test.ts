/**
 * Tests for CameraController input locking.
 */

import {
  CameraController,
  clampCameraZoom,
} from '../../src/systems/CameraController';
import { GameConfig } from '../../src/config/GameConfig';

const { makeScene } = require('../../__mocks__/phaser');

describe('CameraController', () => {
  let scene: any;
  let controller: CameraController;
  let inputCallbacks: Map<string, Array<(...args: any[]) => void>>;

  beforeEach(() => {
    scene = makeScene();
    inputCallbacks = new Map();
    scene.input.on = jest.fn((
      event: string,
      callback: (pointer: any) => void,
    ) => {
      const callbacks = inputCallbacks.get(event) ?? [];
      callbacks.push(callback);
      inputCallbacks.set(event, callbacks);
    });
    controller = new CameraController(scene);
  });

  describe('shared zoom bounds', () => {
    it.each([
      [0.05, GameConfig.CAMERA.MIN_ZOOM],
      [0.75, 0.75],
      [3, GameConfig.CAMERA.MAX_ZOOM],
    ])('constrains %s to %s', (requested, expected) => {
      expect(clampCameraZoom(requested)).toBe(expected);
    });
  });

  describe('setInputLockOwner', () => {
    it('starts with camera as the lock owner', () => {
      expect(controller.getInputLockOwner()).toBe('camera');
    });

    it('changes lock owner to editor-tool', () => {
      controller.setInputLockOwner('editor-tool');
      expect(controller.getInputLockOwner()).toBe('editor-tool');
    });

    it('changes lock owner to ui', () => {
      controller.setInputLockOwner('ui');
      expect(controller.getInputLockOwner()).toBe('ui');
    });

    it('changes lock owner to object-drag', () => {
      controller.setInputLockOwner('object-drag');
      expect(controller.getInputLockOwner()).toBe('object-drag');
    });

    it('can change back to camera', () => {
      controller.setInputLockOwner('editor-tool');
      controller.setInputLockOwner('camera');
      expect(controller.getInputLockOwner()).toBe('camera');
    });

    it('keeps panning when a healthy draggable emits dragstart', () => {
      const fire = (event: string, ...args: any[]) => {
        for (const callback of inputCallbacks.get(event) ?? []) {
          callback(...args);
        }
      };
      const pointer = {
        id: 0,
        x: 100,
        y: 100,
        button: 0,
        leftButtonDown: () => true,
        middleButtonDown: () => false,
      };
      fire('pointerdown', pointer);
      fire('dragstart', pointer, { derailed: false });
      pointer.x = 80;
      fire('pointermove', pointer);

      expect(scene.cameras.main.scrollX).toBe(20);
    });

    it('suppresses left panning while object-drag owns input', () => {
      const fire = (event: string, ...args: any[]) => {
        for (const callback of inputCallbacks.get(event) ?? []) {
          callback(...args);
        }
      };
      const pointer = {
        id: 0,
        x: 100,
        y: 100,
        button: 0,
        leftButtonDown: () => true,
        middleButtonDown: () => false,
      };
      controller.setInputLockOwner('object-drag');
      fire('pointerdown', pointer);
      fire('dragstart', pointer, { derailed: true });
      pointer.x = 80;
      fire('pointermove', pointer);

      expect(scene.cameras.main.scrollX).toBe(0);
    });
  });

  describe('backward compatibility - setBlockPan', () => {
    it('setBlockPan(true) changes owner to editor-tool', () => {
      controller.setBlockPan(true);
      expect(controller.getInputLockOwner()).toBe('editor-tool');
    });

    it('setBlockPan(false) changes owner to camera', () => {
      controller.setBlockPan(true);
      controller.setBlockPan(false);
      expect(controller.getInputLockOwner()).toBe('camera');
    });
  });

  describe('edge scrolling configuration', () => {
    it('can enable edge scrolling', () => {
      controller.setEdgeScrollEnabled(true);
      // No error should be thrown
      expect(controller.getInputLockOwner()).toBe('camera');
    });

    it('can disable edge scrolling', () => {
      controller.setEdgeScrollEnabled(false);
      // No error should be thrown
      expect(controller.getInputLockOwner()).toBe('camera');
    });
  });
});
