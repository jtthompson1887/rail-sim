/**
 * @jest-environment jsdom
 */

import { ScheduleSystem } from '../../src/systems/ScheduleSystem';
import { EventBus } from '../../src/services/EventBus';
import { GameStateManager } from '../../src/managers/GameStateManager';
import type { LevelObjective } from '../../src/config/LevelData';

// Use a counter to generate unique IDs per test, avoiding EventBus cross-test pollution
let testCounter = 0;
function uniqueId(prefix = 'id') {
  return `${prefix}_${++testCounter}_${Date.now()}`;
}

function makeDeliveryObjective(overrides: Partial<LevelObjective> = {}): LevelObjective {
  return {
    id: uniqueId('obj'),
    type: 'delivery',
    description: 'Deliver passengers',
    targetStationId: uniqueId('st'),
    passengerCount: 10,
    scoreReward: 500,
    ...overrides,
  };
}

function makeTimedObjective(overrides: Partial<LevelObjective> = {}): LevelObjective {
  return {
    id: uniqueId('obj'),
    type: 'timed',
    description: 'Deliver in time',
    passengerCount: 5,
    timeLimitSecs: 60,
    scoreReward: 1000,
    ...overrides,
  };
}

describe('ScheduleSystem', () => {
  let sys: ScheduleSystem;

  beforeEach(() => {
    localStorage.clear();
    GameStateManager.startLevel(uniqueId('level'));
  });

  afterEach(() => {
    if (sys) {
      sys.destroy();
    }
  });

  describe('initialization', () => {
    it('activates all objectives on construction', () => {
      sys = new ScheduleSystem([makeDeliveryObjective()]);
      expect(sys.getObjectives()[0].status).toBe('active');
    });

    it('starts with zero progress', () => {
      sys = new ScheduleSystem([makeDeliveryObjective()]);
      expect(sys.getObjectives()[0].progress).toBe(0);
    });
  });

  describe('delivery objectives', () => {
    it('tracks passenger delivery progress', () => {
      const obj = makeDeliveryObjective({ passengerCount: 10 });
      sys = new ScheduleSystem([obj]);
      EventBus.emit('passenger:delivered', { stationId: obj.targetStationId!, count: 5 });
      expect(sys.getObjectives()[0].progress).toBe(5);
    });

    it('ignores deliveries to wrong station', () => {
      const obj = makeDeliveryObjective({ targetStationId: uniqueId('correct_st') });
      sys = new ScheduleSystem([obj]);
      EventBus.emit('passenger:delivered', { stationId: uniqueId('wrong_st'), count: 10 });
      expect(sys.getObjectives()[0].progress).toBe(0);
    });

    it('completes delivery objective when passengerCount is reached', () => {
      const obj = makeDeliveryObjective({ passengerCount: 5 });
      sys = new ScheduleSystem([obj]);
      EventBus.emit('passenger:delivered', { stationId: obj.targetStationId!, count: 5 });
      expect(sys.getObjectives()[0].status).toBe('completed');
    });

    it('emits objective:completed when delivery is done', () => {
      const cb = jest.fn();
      EventBus.on('objective:completed', cb);
      const obj = makeDeliveryObjective({ passengerCount: 3, scoreReward: 500 });
      sys = new ScheduleSystem([obj]);
      EventBus.emit('passenger:delivered', { stationId: obj.targetStationId!, count: 3 });
      expect(cb).toHaveBeenCalledWith({ objectiveId: obj.id, score: 500 });
      EventBus.off('objective:completed', cb);
    });

    it('adds score to GameStateManager when completed', () => {
      const obj = makeDeliveryObjective({ passengerCount: 1, scoreReward: 250 });
      sys = new ScheduleSystem([obj]);
      EventBus.emit('passenger:delivered', { stationId: obj.targetStationId!, count: 1 });
      expect(GameStateManager.score).toBe(250);
    });

    it('does not complete again if already completed', () => {
      const obj = makeDeliveryObjective({ passengerCount: 3 });
      sys = new ScheduleSystem([obj]);
      EventBus.emit('passenger:delivered', { stationId: obj.targetStationId!, count: 3 });
      expect(sys.getObjectives()[0].status).toBe('completed');
      const progressAfter = sys.getObjectives()[0].progress;
      EventBus.emit('passenger:delivered', { stationId: obj.targetStationId!, count: 3 });
      // Status stays completed, progress doesn't change (objective is no longer active)
      expect(sys.getObjectives()[0].status).toBe('completed');
    });

    it('accumulates deliveries from multiple events', () => {
      const obj = makeDeliveryObjective({ passengerCount: 10 });
      sys = new ScheduleSystem([obj]);
      EventBus.emit('passenger:delivered', { stationId: obj.targetStationId!, count: 4 });
      EventBus.emit('passenger:delivered', { stationId: obj.targetStationId!, count: 6 });
      expect(sys.getObjectives()[0].status).toBe('completed');
    });
  });

  describe('timed objectives', () => {
    it('tracks elapsed time progress', () => {
      const obj = makeTimedObjective({ timeLimitSecs: 60 });
      sys = new ScheduleSystem([obj]);
      sys.update(30);
      expect(sys.getObjectives()[0].progress).toBeCloseTo(30);
    });

    it('completes timed objective when passengers delivered in time', () => {
      const obj = makeTimedObjective({ passengerCount: 3, timeLimitSecs: 60 });
      sys = new ScheduleSystem([obj]);
      EventBus.emit('passenger:delivered', { stationId: uniqueId('any_st'), count: 3 });
      sys.update(60);
      expect(sys.getObjectives()[0].status).toBe('completed');
    });

    it('fails timed objective when time runs out without enough passengers', () => {
      const obj = makeTimedObjective({ passengerCount: 10, timeLimitSecs: 30 });
      sys = new ScheduleSystem([obj]);
      sys.update(30);
      expect(sys.getObjectives()[0].status).toBe('failed');
    });

    it('emits objective:failed when timed objective fails', () => {
      const cb = jest.fn();
      EventBus.on('objective:failed', cb);
      const obj = makeTimedObjective({ passengerCount: 10, timeLimitSecs: 10 });
      sys = new ScheduleSystem([obj]);
      sys.update(10);
      expect(cb).toHaveBeenCalledWith({ objectiveId: obj.id });
      EventBus.off('objective:failed', cb);
    });

    it('does not update already-completed timed objectives', () => {
      const obj = makeTimedObjective({ passengerCount: 0, timeLimitSecs: 60 });
      sys = new ScheduleSystem([obj]);
      sys.update(60); // completes (0 passengers needed, 0 delivered >= 0)
      expect(sys.getObjectives()[0].status).toBe('completed');
      sys.update(30); // should not change
      expect(sys.getObjectives()[0].status).toBe('completed');
    });
  });

  describe('game over', () => {
    it('triggers game over (won) when all objectives are completed', () => {
      const cb = jest.fn();
      EventBus.on('game:over', cb);
      const obj = makeDeliveryObjective({ passengerCount: 1 });
      sys = new ScheduleSystem([obj]);
      EventBus.emit('passenger:delivered', { stationId: obj.targetStationId!, count: 1 });
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ won: true }));
      EventBus.off('game:over', cb);
    });

    it('triggers game over (lost) when any objective fails', () => {
      const cb = jest.fn();
      EventBus.on('game:over', cb);
      const obj = makeTimedObjective({ passengerCount: 99, timeLimitSecs: 1 });
      sys = new ScheduleSystem([obj]);
      sys.update(1);
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ won: false }));
      EventBus.off('game:over', cb);
    });

    it('does not trigger game over while objectives are still active', () => {
      const cb = jest.fn();
      EventBus.on('game:over', cb);
      const obj = makeDeliveryObjective({ passengerCount: 10 });
      sys = new ScheduleSystem([obj]);
      sys.update(1);
      expect(cb).not.toHaveBeenCalled();
      EventBus.off('game:over', cb);
    });

    it('handles mixed objectives: one completed, one failed → lost', () => {
      const gameOverEvents: any[] = [];
      const cb = (data: any) => { gameOverEvents.push(data); };
      EventBus.on('game:over', cb);
      const delivObj = makeDeliveryObjective({ passengerCount: 1, scoreReward: 200 });
      const timedObj = makeTimedObjective({ passengerCount: 99, timeLimitSecs: 1 });
      sys = new ScheduleSystem([delivObj, timedObj]);
      EventBus.emit('passenger:delivered', { stationId: delivObj.targetStationId!, count: 1 });
      sys.update(1);
      // Find the relevant game:over event (should have won:false)
      const lostEvent = gameOverEvents.find((e) => e.won === false);
      expect(lostEvent).toBeDefined();
      EventBus.off('game:over', cb);
    });
  });

  describe('getObjectives()', () => {
    it('returns a list of all tracked objectives', () => {
      sys = new ScheduleSystem([makeDeliveryObjective(), makeTimedObjective()]);
      expect(sys.getObjectives()).toHaveLength(2);
    });
  });

  describe('destroy()', () => {
    it('stops receiving passenger:delivered events after destroy', () => {
      const obj = makeDeliveryObjective({ passengerCount: 5 });
      sys = new ScheduleSystem([obj]);
      sys.destroy();
      EventBus.emit('passenger:delivered', { stationId: obj.targetStationId!, count: 5 });
      // Should not have progressed since handler was removed
      expect(sys.getObjectives()[0].progress).toBe(0);
      // Re-assign to null so afterEach doesn't call destroy again
      sys = null as any;
    });
  });
});
