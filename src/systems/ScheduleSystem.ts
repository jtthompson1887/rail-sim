import type { LevelObjective } from '../config/LevelData';
import { EventBus } from '../services/EventBus';
import { GameStateManager } from '../managers/GameStateManager';

export type ObjectiveStatus = 'pending' | 'active' | 'completed' | 'failed';

interface TrackedObjective {
  def: LevelObjective;
  status: ObjectiveStatus;
  progress: number;
}

export class ScheduleSystem {
  private objectives: TrackedObjective[];
  private passengersDelivered: Map<string, number> = new Map();

  constructor(objectives: LevelObjective[]) {
    this.objectives = objectives.map((def) => ({ def, status: 'pending' as ObjectiveStatus, progress: 0 }));
    this.activateObjectives();

    EventBus.on('passenger:delivered', ({ stationId, count }) => {
      const prev = this.passengersDelivered.get(stationId) ?? 0;
      this.passengersDelivered.set(stationId, prev + count);
      this.checkDeliveryObjectives(stationId);
    });
  }

  private activateObjectives(): void {
    this.objectives.forEach((obj) => { obj.status = 'active'; });
  }

  private checkDeliveryObjectives(stationId: string): void {
    for (const obj of this.objectives) {
      if (obj.status !== 'active' || obj.def.type !== 'delivery') continue;
      if (obj.def.targetStationId !== stationId) continue;
      const total = this.passengersDelivered.get(stationId) ?? 0;
      obj.progress = total;
      if (total >= (obj.def.passengerCount ?? 0)) {
        obj.status = 'completed';
        GameStateManager.addScore(obj.def.scoreReward);
        EventBus.emit('objective:completed', { objectiveId: obj.def.id, score: obj.def.scoreReward });
      }
    }
    this.checkGameOver();
  }

  update(deltaSecs: number): void {
    for (const obj of this.objectives) {
      if (obj.status !== 'active' || obj.def.type !== 'timed') continue;
      obj.progress += deltaSecs;
      if (obj.progress >= (obj.def.timeLimitSecs ?? Infinity)) {
        const delivered = Array.from(this.passengersDelivered.values()).reduce((a, b) => a + b, 0);
        if (delivered >= (obj.def.passengerCount ?? 0)) {
          obj.status = 'completed';
          GameStateManager.addScore(obj.def.scoreReward);
          EventBus.emit('objective:completed', { objectiveId: obj.def.id, score: obj.def.scoreReward });
        } else {
          obj.status = 'failed';
          EventBus.emit('objective:failed', { objectiveId: obj.def.id });
        }
      }
    }
    this.checkGameOver();
  }

  private checkGameOver(): void {
    const allDone = this.objectives.every((o) => o.status === 'completed' || o.status === 'failed');
    if (!allDone) return;
    const won = this.objectives.every((o) => o.status === 'completed');
    GameStateManager.endGame(won);
  }

  getObjectives(): TrackedObjective[] { return this.objectives; }
}
