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

  beforeEach(() => {
    scene = makeScene();
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
