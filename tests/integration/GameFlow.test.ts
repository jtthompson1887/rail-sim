/**
 * @jest-environment jsdom
 *
 * Integration test: Full game flow from level start to game over.
 * Exercises GameStateManager, ScheduleSystem, EventBus, and SaveService together.
 */

import { GameStateManager } from '../../src/managers/GameStateManager';
import { ScheduleSystem } from '../../src/systems/ScheduleSystem';
import { SaveService } from '../../src/services/SaveService';
import { EventBus } from '../../src/services/EventBus';
import type { LevelObjective } from '../../src/config/LevelData';
import { LEVELS } from '../../src/config/LevelData';

let idSeq = 0;
const uid = (prefix = 'id') => `${prefix}_${++idSeq}`;

describe('Integration: Full game flow', () => {
  let systems: ScheduleSystem[] = [];

  beforeEach(() => {
    localStorage.clear();
    systems = [];
  });

  afterEach(() => {
    systems.forEach((s) => s.destroy());
    systems = [];
  });

  function createSys(objectives: LevelObjective[]): ScheduleSystem {
    const s = new ScheduleSystem(objectives);
    systems.push(s);
    return s;
  }

  it('completes a delivery objective and wins the game', () => {
    const events: string[] = [];
    const onCompleted = () => { events.push('objective:completed'); };
    const onGameOver = () => { events.push('game:over'); };
    const onLevelComplete = () => { events.push('level:complete'); };
    EventBus.on('objective:completed', onCompleted);
    EventBus.on('game:over', onGameOver);
    EventBus.on('level:complete', onLevelComplete);

    const stId = uid('st');
    GameStateManager.startLevel(uid('level'));
    createSys([{ id: uid('obj'), type: 'delivery', description: '', targetStationId: stId, passengerCount: 5, scoreReward: 100 }]);
    EventBus.emit('passenger:delivered', { stationId: stId, count: 5 });

    expect(events).toContain('objective:completed');
    expect(events).toContain('game:over');
    expect(events).toContain('level:complete');
    expect(GameStateManager.state).toBe('gameOver');
    expect(GameStateManager.score).toBe(100);

    EventBus.off('objective:completed', onCompleted);
    EventBus.off('game:over', onGameOver);
    EventBus.off('level:complete', onLevelComplete);
  });

  it('fails when a timed objective expires without enough deliveries', () => {
    const gameOverData: any[] = [];
    const cb = (data: any) => { gameOverData.push(data); };
    EventBus.on('game:over', cb);

    GameStateManager.startLevel(uid('level'));
    const sys = createSys([{ id: uid('obj'), type: 'timed', description: '', passengerCount: 20, timeLimitSecs: 30, scoreReward: 500 }]);
    sys.update(30);

    expect(GameStateManager.state).toBe('gameOver');
    expect(gameOverData.some((d) => d.won === false)).toBe(true);

    EventBus.off('game:over', cb);
  });

  it('handles mixed objectives - partial completion leads to loss', () => {
    const gameOverData: any[] = [];
    const cb = (data: any) => { gameOverData.push(data); };
    EventBus.on('game:over', cb);

    const stId = uid('st');
    GameStateManager.startLevel(uid('level'));
    const sys = createSys([
      { id: uid('obj'), type: 'delivery', description: '', targetStationId: stId, passengerCount: 3, scoreReward: 200 },
      { id: uid('obj'), type: 'timed', description: '', passengerCount: 50, timeLimitSecs: 10, scoreReward: 300 },
    ]);

    EventBus.emit('passenger:delivered', { stationId: stId, count: 3 });
    sys.update(10);

    expect(gameOverData.some((d) => d.won === false)).toBe(true);

    EventBus.off('game:over', cb);
  });

  it('pauses and resumes correctly mid-game', () => {
    GameStateManager.startLevel(uid('level'));
    GameStateManager.tick(5);
    GameStateManager.pause();
    GameStateManager.tick(10);
    GameStateManager.resume();
    GameStateManager.tick(3);
    expect(GameStateManager.elapsedSecs).toBeCloseTo(8);
    expect(GameStateManager.state).toBe('playing');
  });

  it('saves high score after winning', () => {
    localStorage.clear();
    const levelId = uid('level');
    const stId = uid('st');
    GameStateManager.startLevel(levelId);
    GameStateManager.addScore(750);
    createSys([{ id: uid('obj'), type: 'delivery', description: '', targetStationId: stId, passengerCount: 1, scoreReward: 0 }]);
    EventBus.emit('passenger:delivered', { stationId: stId, count: 1 });
    expect(SaveService.getHighScore(levelId)).toBe(750);
  });

  it('game score accumulates across multiple deliveries', () => {
    const st1 = uid('st');
    const st2 = uid('st');
    GameStateManager.startLevel(uid('level'));
    createSys([
      { id: uid('obj'), type: 'delivery', description: '', targetStationId: st1, passengerCount: 3, scoreReward: 100 },
      { id: uid('obj'), type: 'delivery', description: '', targetStationId: st2, passengerCount: 3, scoreReward: 200 },
    ]);
    EventBus.emit('passenger:delivered', { stationId: st1, count: 3 });
    EventBus.emit('passenger:delivered', { stationId: st2, count: 3 });
    expect(GameStateManager.score).toBe(300);
  });

  it('elapsed time accumulates correctly during a level', () => {
    GameStateManager.startLevel(uid('level'));
    for (let i = 0; i < 10; i++) {
      GameStateManager.tick(1);
    }
    expect(GameStateManager.elapsedSecs).toBeCloseTo(10);
  });
});

describe('Integration: LEVELS data used with ScheduleSystem', () => {
  const systems: ScheduleSystem[] = [];

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    systems.forEach((s) => s.destroy());
    systems.length = 0;
  });

  it('can create a ScheduleSystem from LEVELS[0] objectives', () => {
    GameStateManager.startLevel(LEVELS[0].id);
    expect(() => {
      const sys = new ScheduleSystem(LEVELS[0].objectives);
      systems.push(sys);
    }).not.toThrow();
  });

  it('all level objectives start as active', () => {
    LEVELS.forEach((level) => {
      GameStateManager.startLevel(level.id);
      const sys = new ScheduleSystem(level.objectives);
      systems.push(sys);
      sys.getObjectives().forEach((obj) => {
        expect(obj.status).toBe('active');
      });
    });
  });
});
