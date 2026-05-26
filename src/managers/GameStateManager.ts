import { EventBus } from '../services/EventBus';
import { SaveService } from '../services/SaveService';

export type GameState = 'idle' | 'playing' | 'paused' | 'gameOver';
export type WorldMode = 'idle' | 'create' | 'play';

interface GameStateData {
  state: GameState;
  worldMode: WorldMode;
  score: number;
  elapsedSecs: number;
  activeTrains: number;
  currentLevelId: string | null;
  currentWorldId: string | null;
}

class GameStateManagerClass {
  private data: GameStateData = {
    state: 'idle',
    worldMode: 'idle',
    score: 0,
    elapsedSecs: 0,
    activeTrains: 0,
    currentLevelId: null,
    currentWorldId: null,
  };

  get state(): GameState { return this.data.state; }
  get worldMode(): WorldMode { return this.data.worldMode; }
  get score(): number { return this.data.score; }
  get elapsedSecs(): number { return this.data.elapsedSecs; }
  get activeTrains(): number { return this.data.activeTrains; }
  get currentLevelId(): string | null { return this.data.currentLevelId; }
  get currentWorldId(): string | null { return this.data.currentWorldId; }

  // ── Legacy level-based API (kept for backward compat) ─────────────────────

  startLevel(levelId: string): void {
    this.data = {
      state: 'playing',
      worldMode: 'play',
      score: 0,
      elapsedSecs: 0,
      activeTrains: 0,
      currentLevelId: levelId,
      currentWorldId: null,
    };
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

  // ── World-based API ───────────────────────────────────────────────────────

  /**
   * Enter create mode for a world. Freezes play state and opens the editor.
   */
  enterCreate(worldId: string): void {
    this.data.worldMode = 'create';
    this.data.state = 'idle';
    this.data.currentWorldId = worldId;
    this.data.currentLevelId = null;
    EventBus.emit('mode:changed', { mode: 'create' });
  }

  /**
   * Enter play mode for a world. Activates trains and physics.
   */
  enterPlay(worldId: string): void {
    this.data.worldMode = 'play';
    this.data.state = 'playing';
    this.data.currentWorldId = worldId;
    this.data.currentLevelId = null;
    this.data.elapsedSecs = 0;
    EventBus.emit('mode:changed', { mode: 'play' });
  }

  /**
   * Return from play mode back to create mode.
   */
  returnToCreate(): void {
    if (this.data.worldMode === 'play') {
      this.data.state = 'idle';
      this.data.worldMode = 'create';
      EventBus.emit('mode:changed', { mode: 'create' });
    }
  }
}

export const GameStateManager = new GameStateManagerClass();
