import Phaser from 'phaser';
import * as Matter from 'matter-js';
import {
  runTrainPhysicsScenario,
  type TrainPhysicsMetrics,
  type TrainPhysicsScenario,
} from '../../src/physics/TrainPhysicsHarness';
import {
  FORTY_CAR_SCENARIO,
  MIXED_POWER_SCENARIO,
  SAFE_CURVE_SCENARIO,
  TRAIN_PHYSICS_SCENARIOS,
} from '../../src/physics/TrainPhysicsScenarios';
import {
  TRAIN_PHYSICS_CONFIG,
  type TrainPhysicsConfig,
} from '../../src/physics/TrainPhysicsConfig';
import {
  TrainPhysicsLabOverlay,
  buildTrainPhysicsLabReport,
  mergeTrainPhysicsLabConfig,
} from '../../src/ui/TrainPhysicsLabOverlay';

declare global {
  interface Window {
    __prepareTrainPhysicsLab(scenarioId: string): Promise<void>;
    __stepTrainPhysicsLab(ticks: number): TrainPhysicsMetrics;
    __runTrainPhysicsLab(): TrainPhysicsMetrics;
    __setTrainPhysicsOverrides(overrides: Partial<TrainPhysicsConfig>): void;
    __trainPhysicsLabReport: ReturnType<typeof buildTrainPhysicsLabReport> | null;
  }
}

let overlay: TrainPhysicsLabOverlay | null = null;
let selectedScenario: TrainPhysicsScenario = SAFE_CURVE_SCENARIO;
let candidateConfig: TrainPhysicsConfig = mergeTrainPhysicsLabConfig(
  TRAIN_PHYSICS_CONFIG,
  {},
);
let readyResolve: (() => void) | null = null;
const ready = new Promise<void>((resolve) => { readyResolve = resolve; });

function scenarioById(id: string): TrainPhysicsScenario {
  const scenarios = [
    ...TRAIN_PHYSICS_SCENARIOS,
    MIXED_POWER_SCENARIO,
    FORTY_CAR_SCENARIO,
  ];
  const scenario = scenarios.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`Unknown train physics scenario "${id}"`);
  return scenario;
}

function runScenario(scenario: TrainPhysicsScenario): TrainPhysicsMetrics {
  const baseline = runTrainPhysicsScenario(scenario, TRAIN_PHYSICS_CONFIG);
  const candidate = runTrainPhysicsScenario(scenario, candidateConfig);
  window.__trainPhysicsLabReport = buildTrainPhysicsLabReport(
    scenario.id,
    baseline,
    candidate,
  );
  overlay?.update(scenario.id, baseline, candidate);
  return candidate;
}

class TrainPhysicsLabScene extends Phaser.Scene {
  constructor() {
    super({ key: 'TrainPhysicsLabScene' });
  }

  create(): void {
    const graphics = this.add.graphics();
    graphics.lineStyle(14, 0x233b4d, 1);
    const displayCurve = new Phaser.Curves.CubicBezier(
      new Phaser.Math.Vector2(90, 520),
      new Phaser.Math.Vector2(360, 100),
      new Phaser.Math.Vector2(920, 900),
      new Phaser.Math.Vector2(1450, 360),
    );
    const displayPoints = displayCurve.getPoints(96);
    graphics.strokePoints(displayPoints, false, false);
    graphics.lineStyle(3, 0x80d8ff, 0.8);
    graphics.strokePoints(displayPoints, false, false);

    const bogieVector = Matter.Vector.create(36, 0);
    const chassis = this.add.rectangle(760, 500, 170, 44, 0xf6c64b)
      .setStrokeStyle(3, 0x1b2632);
    this.add.circle(chassis.x - bogieVector.x, chassis.y, 9, 0x111820);
    this.add.circle(chassis.x + bogieVector.x, chassis.y, 9, 0x111820);
    this.add.line(0, 0, 845, 500, 915, 500, 0xff7e67)
      .setOrigin(0)
      .setLineWidth(3);

    overlay = new TrainPhysicsLabOverlay(this);
    this.input.keyboard.on('keydown-R', () => runScenario(selectedScenario));
    this.input.keyboard.on('keydown-RIGHT', () => window.__stepTrainPhysicsLab(1));
    this.input.keyboard.on('keydown-E', () => {
      if (!window.__trainPhysicsLabReport) return;
      const json = JSON.stringify(window.__trainPhysicsLabReport, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const anchor = document.createElement('a');
      anchor.href = URL.createObjectURL(blob);
      anchor.download = `${selectedScenario.id}-train-physics.json`;
      anchor.click();
      URL.revokeObjectURL(anchor.href);
    });
    runScenario(selectedScenario);
    readyResolve?.();
  }
}

new Phaser.Game({
  type: Phaser.CANVAS,
  parent: 'game',
  width: 1600,
  height: 900,
  backgroundColor: '#09111a',
  banner: false,
  audio: { noAudio: true },
  scene: [TrainPhysicsLabScene],
});

window.__trainPhysicsLabReport = null;
window.__prepareTrainPhysicsLab = async (scenarioId: string) => {
  await ready;
  selectedScenario = scenarioById(scenarioId);
};
window.__stepTrainPhysicsLab = (ticks: number) => {
  const tickCount = Math.max(1, Math.floor(ticks));
  const steppedScenario: TrainPhysicsScenario = {
    ...selectedScenario,
    id: selectedScenario.id,
    durationSeconds: tickCount * TRAIN_PHYSICS_CONFIG.fixedStepSeconds,
  };
  return runScenario(steppedScenario);
};
window.__runTrainPhysicsLab = () => runScenario(selectedScenario);
window.__setTrainPhysicsOverrides = (overrides) => {
  candidateConfig = mergeTrainPhysicsLabConfig(TRAIN_PHYSICS_CONFIG, overrides);
};

export {};
