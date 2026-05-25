import { EventBus } from '../services/EventBus';
import { SaveService } from '../services/SaveService';

export type GameState = 'idle' | 'playing' | 'paused' | 'gameOver';

interface GameStateData {
  state: GameState;
  score: number;
  elapsedSecs: number;
  activeTrains: number;
  currentLevelId: string | null;
}

class GameStateManagerClass {
  private data: GameStateData = {
    state: 'idle',
    score: 0,
    elapsedSecs: 0,
    activeTrains: 0,
    currentLevelId: null,
  };

  get state(): GameState { return this.data.state; }
  get score(): number { return this.data.score; }
  get elapsedSecs(): number { return this.data.elapsedSecs; }
  get activeTrains(): number { return this.data.activeTrains; }
  get currentLevelId(): string | null { return this.data.currentLevelId; }

  startLevel(levelId: string): void {
    this.data = { state: 'playing', score: 0, elapsedSecs: 0, activeTrains: 0, currentLevelId: levelId };
  }

  addScore(points: number): void {
    this.data.score += points;
  }

  tick(deltaSecs: number): void {
    if (this.data.state === 'playing') {
      this.data.elapsedSecs += deltaSecs;
    }
  }

  setActiveTrains(count: number): void {
    this.data.activeTrains = count;
  }

  pause(): void {
    if (this.data.state === 'playing') {
      this.data.state = 'paused';
      EventBus.emit('game:paused', {});
    }
  }

  resume(): void {
    if (this.data.state === 'paused') {
      this.data.state = 'playing';
      EventBus.emit('game:resumed', {});
    }
  }

  endGame(won: boolean): void {
    this.data.state = 'gameOver';
    if (this.data.currentLevelId) {
      SaveService.setHighScore(this.data.currentLevelId, this.data.score);
      if (won) {
        EventBus.emit('level:complete', { levelId: this.data.currentLevelId, score: this.data.score });
      }
    }
    EventBus.emit('game:over', { won, score: this.data.score });
  }
}

export const GameStateManager = new GameStateManagerClass();
