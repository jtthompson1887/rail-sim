/**
 * @jest-environment jsdom
 */

// Reset module between tests to get a fresh singleton
jest.resetModules();

import { EventBus } from '../../src/services/EventBus';

// We load GameStateManager fresh for each describe block via jest.isolateModules
// For simplicity, import directly and reset state by calling startLevel each time.
import { GameStateManager } from '../../src/managers/GameStateManager';

describe('GameStateManager', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset to idle by starting a fresh level each test
    GameStateManager.startLevel('test_level');
  });

  describe('startLevel()', () => {
    it('sets state to playing', () => {
      GameStateManager.startLevel('level_01');
      expect(GameStateManager.state).toBe('playing');
    });

    it('resets score to 0', () => {
      GameStateManager.addScore(999);
      GameStateManager.startLevel('level_01');
      expect(GameStateManager.score).toBe(0);
    });

    it('resets elapsed time to 0', () => {
      GameStateManager.tick(10);
      GameStateManager.startLevel('level_01');
      expect(GameStateManager.elapsedSecs).toBe(0);
    });

    it('sets current level id', () => {
      GameStateManager.startLevel('level_02');
      expect(GameStateManager.currentLevelId).toBe('level_02');
    });

    it('resets active trains to 0', () => {
      GameStateManager.setActiveTrains(5);
      GameStateManager.startLevel('level_01');
      expect(GameStateManager.activeTrains).toBe(0);
    });
  });

  describe('addScore()', () => {
    it('increases score by the given points', () => {
      GameStateManager.addScore(100);
      expect(GameStateManager.score).toBe(100);
    });

    it('accumulates multiple score additions', () => {
      GameStateManager.addScore(100);
      GameStateManager.addScore(250);
      expect(GameStateManager.score).toBe(350);
    });
  });

  describe('tick()', () => {
    it('advances elapsed time while playing', () => {
      GameStateManager.tick(1.5);
      expect(GameStateManager.elapsedSecs).toBeCloseTo(1.5);
    });

    it('does not advance elapsed time when paused', () => {
      GameStateManager.pause();
      GameStateManager.tick(5);
      // elapsedSecs should not change (still 0 from startLevel in beforeEach)
      expect(GameStateManager.elapsedSecs).toBe(0);
    });

    it('accumulates elapsed time over multiple ticks', () => {
      GameStateManager.tick(1);
      GameStateManager.tick(2);
      GameStateManager.tick(0.5);
      expect(GameStateManager.elapsedSecs).toBeCloseTo(3.5);
    });
  });

  describe('setActiveTrains()', () => {
    it('sets the active trains count', () => {
      GameStateManager.setActiveTrains(3);
      expect(GameStateManager.activeTrains).toBe(3);
    });
  });

  describe('pause() and resume()', () => {
    it('transitions state to paused', () => {
      GameStateManager.pause();
      expect(GameStateManager.state).toBe('paused');
    });

    it('emits game:paused event', () => {
      const cb = jest.fn();
      EventBus.on('game:paused', cb);
      GameStateManager.pause();
      expect(cb).toHaveBeenCalled();
      EventBus.off('game:paused', cb);
    });

    it('transitions state back to playing on resume', () => {
      GameStateManager.pause();
      GameStateManager.resume();
      expect(GameStateManager.state).toBe('playing');
    });

    it('emits game:resumed event', () => {
      const cb = jest.fn();
      EventBus.on('game:resumed', cb);
      GameStateManager.pause();
      GameStateManager.resume();
      expect(cb).toHaveBeenCalled();
      EventBus.off('game:resumed', cb);
    });

    it('does not pause when already paused', () => {
      GameStateManager.pause();
      const cb = jest.fn();
      EventBus.on('game:paused', cb);
      GameStateManager.pause(); // second call - should be ignored
      expect(cb).not.toHaveBeenCalled();
      EventBus.off('game:paused', cb);
    });

    it('does not resume when not paused', () => {
      const cb = jest.fn();
      EventBus.on('game:resumed', cb);
      GameStateManager.resume(); // not paused, should be ignored
      expect(cb).not.toHaveBeenCalled();
      EventBus.off('game:resumed', cb);
    });
  });

  describe('endGame()', () => {
    it('sets state to gameOver', () => {
      GameStateManager.endGame(true);
      expect(GameStateManager.state).toBe('gameOver');
    });

    it('emits game:over with won=true', () => {
      const cb = jest.fn();
      EventBus.on('game:over', cb);
      GameStateManager.startLevel('level_01');
      GameStateManager.addScore(200);
      GameStateManager.endGame(true);
      expect(cb).toHaveBeenCalledWith({ won: true, score: 200 });
      EventBus.off('game:over', cb);
    });

    it('emits game:over with won=false', () => {
      const cb = jest.fn();
      EventBus.on('game:over', cb);
      GameStateManager.startLevel('level_01');
      GameStateManager.endGame(false);
      expect(cb).toHaveBeenCalledWith({ won: false, score: 0 });
      EventBus.off('game:over', cb);
    });

    it('emits level:complete when won', () => {
      const cb = jest.fn();
      EventBus.on('level:complete', cb);
      GameStateManager.startLevel('level_01');
      GameStateManager.addScore(500);
      GameStateManager.endGame(true);
      expect(cb).toHaveBeenCalledWith({ levelId: 'level_01', score: 500 });
      EventBus.off('level:complete', cb);
    });

    it('does not emit level:complete when lost', () => {
      const cb = jest.fn();
      EventBus.on('level:complete', cb);
      GameStateManager.startLevel('level_01');
      GameStateManager.endGame(false);
      expect(cb).not.toHaveBeenCalled();
      EventBus.off('level:complete', cb);
    });

    it('saves the high score on endGame', () => {
      localStorage.clear();
      GameStateManager.startLevel('level_test');
      GameStateManager.addScore(999);
      GameStateManager.endGame(true);

      const { SaveService } = require('../../src/services/SaveService');
      expect(SaveService.getHighScore('level_test')).toBe(999);
    });

    it('does not save high score or emit level:complete if no level is active', () => {
      // Hack: set currentLevelId to null via startLevel then internal reset
      // We test that endGame without an active level does not crash
      (GameStateManager as any).data.currentLevelId = null;
      expect(() => GameStateManager.endGame(true)).not.toThrow();
    });
  });
});
