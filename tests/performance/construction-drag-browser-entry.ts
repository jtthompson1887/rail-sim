import Phaser from 'phaser';
import TrackManager from '../../src/managers/TrackManager';
import { WorldManager } from '../../src/managers/WorldManager';
import { CommandStack } from '../../src/systems/CommandStack';
import { ConstructionAnalyzer } from '../../src/systems/ConstructionAnalyzer';
import { ConstructionEconomy } from '../../src/systems/ConstructionEconomy';
import { ConstructionService } from '../../src/systems/ConstructionService';
import { SnapSystem } from '../../src/systems/SnapSystem';
import { PlaceTrackTool } from '../../src/systems/tools/PlaceTrackTool';

declare global {
  interface Window {
    __constructionBenchmarkGame: Phaser.Game;
    __prepareConstructionDragBenchmark: () => Promise<void>;
    __beginConstructionDragMeasurement: () => void;
    __finishConstructionDragBenchmark: () => {
      samples: number;
      p95Ms: number;
    };
  }
}

let readyTool: PlaceTrackTool | null = null;
let readyResolve: (() => void) | null = null;
let durations: number[] = [];
let collecting = false;
const sceneReady = new Promise<void>((resolve) => {
  readyResolve = resolve;
});

class ConstructionBenchmarkScene extends Phaser.Scene {
  constructor() {
    super({ key: 'ConstructionBenchmarkScene' });
  }

  create(): void {
    WorldManager.reset();
    const world = WorldManager.createNew(
      'Construction benchmark',
      'construction-browser-benchmark',
    );
    // The benchmark never commits; this simply keeps every valid preview
    // affordable while retaining a real schema-5 company state.
    world.company.cash = 1_000_000_000;

    const trackManager = new TrackManager(this);
    const snapSystem = new SnapSystem(trackManager);
    snapSystem.gridEnabled = false;
    snapSystem.midpointEnabled = false;
    const analyzer = new ConstructionAnalyzer({
      getHeightAt: (x, y) => (
        Math.sin(x / 470) * 24
        + Math.cos(y / 390) * 18
      ),
    });
    const service = new ConstructionService(trackManager, analyzer);
    const economy = new ConstructionEconomy(world.company);
    const commandStack = new CommandStack();

    readyTool = new PlaceTrackTool(
      this,
      trackManager,
      snapSystem,
      service,
      economy,
      commandStack,
    );
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      readyTool?.onPointerDown(worldPoint.x, worldPoint.y, pointer);
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const startedAt = performance.now();
      readyTool?.onPointerMove(worldPoint.x, worldPoint.y, pointer);
      if (collecting) durations.push(performance.now() - startedAt);
    });
    readyResolve?.();
  }
}

window.__constructionBenchmarkGame = new Phaser.Game({
  type: Phaser.CANVAS,
  parent: 'game',
  width: 1920,
  height: 1080,
  backgroundColor: '#000000',
  banner: false,
  audio: { noAudio: true },
  scene: [ConstructionBenchmarkScene],
});

window.__prepareConstructionDragBenchmark = async () => {
  await sceneReady;
  durations = [];
  collecting = false;
};

window.__beginConstructionDragMeasurement = () => {
  durations = [];
  collecting = true;
};

window.__finishConstructionDragBenchmark = () => {
  collecting = false;
  durations.sort((left, right) => left - right);
  const result = {
    samples: durations.length,
    p95Ms: durations[Math.ceil(durations.length * 0.95) - 1],
  };
  readyTool?.destroy();
  readyTool = null;
  WorldManager.reset();
  return result;
};

export {};
