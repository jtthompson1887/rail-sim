import Phaser from 'phaser';
import type {
  TrainPhysicsMetrics,
} from '../physics/TrainPhysicsHarness';
import type { TrainPhysicsConfig } from '../physics/TrainPhysicsConfig';

export interface TrainPhysicsLabReport {
  scenarioId: string;
  baseline: TrainPhysicsMetrics;
  candidate: TrainPhysicsMetrics;
  replayMatches: boolean;
  allMetricsFinite: boolean;
}

function metricsAreFinite(metrics: TrainPhysicsMetrics): boolean {
  return Object.keys(metrics).every((key) => {
    const value = metrics[key as keyof TrainPhysicsMetrics];
    return (
    key === 'derailmentTick'
    || key === 'replayHash'
    || (typeof value === 'number' && Number.isFinite(value))
    );
  });
}

export function mergeTrainPhysicsLabConfig(
  base: Readonly<TrainPhysicsConfig>,
  overrides: Partial<TrainPhysicsConfig>,
): TrainPhysicsConfig {
  return {
    ...base,
    ...overrides,
    coupler: { ...base.coupler, ...(overrides.coupler ?? {}) },
    derailment: { ...base.derailment, ...(overrides.derailment ?? {}) },
  };
}

export function buildTrainPhysicsLabReport(
  scenarioId: string,
  baseline: TrainPhysicsMetrics,
  candidate: TrainPhysicsMetrics,
): TrainPhysicsLabReport {
  return {
    scenarioId,
    baseline,
    candidate,
    replayMatches: baseline.replayHash === candidate.replayHash,
    allMetricsFinite: metricsAreFinite(baseline) && metricsAreFinite(candidate),
  };
}

export class TrainPhysicsLabOverlay {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly title: Phaser.GameObjects.Text;
  private readonly metrics: Phaser.GameObjects.Text;
  private readonly help: Phaser.GameObjects.Text;

  constructor(private readonly scene: Phaser.Scene) {
    this.graphics = scene.add.graphics().setDepth(1000).setScrollFactor(0);
    this.title = scene.add.text(24, 18, 'Rail Dynamics Laboratory', {
      color: '#e8f4ff',
      fontFamily: 'monospace',
      fontSize: '24px',
      fontStyle: 'bold',
    }).setDepth(1001).setScrollFactor(0);
    this.metrics = scene.add.text(24, 58, 'Preparing scenario…', {
      color: '#b8d7ef',
      fontFamily: 'monospace',
      fontSize: '15px',
      lineSpacing: 5,
    }).setDepth(1001).setScrollFactor(0);
    this.help = scene.add.text(
      24,
      scene.scale.height - 42,
      'SPACE pause/resume  ·  → single fixed tick  ·  R run  ·  E export JSON',
      {
        color: '#8fb1c8',
        fontFamily: 'monospace',
        fontSize: '13px',
      },
    ).setDepth(1001).setScrollFactor(0);
    this.drawFrame();
  }

  update(
    scenarioId: string,
    baseline: TrainPhysicsMetrics,
    candidate: TrainPhysicsMetrics,
  ): void {
    const report = buildTrainPhysicsLabReport(scenarioId, baseline, candidate);
    this.title.setText(`Rail Dynamics Laboratory · ${scenarioId}`);
    this.metrics.setText([
      `replay       ${candidate.replayHash}  ${report.replayMatches ? 'MATCH' : 'DIFF'}`,
      `bogie error  F ${candidate.maxFrontBogieError.toFixed(5)}  R ${candidate.maxRearBogieError.toFixed(5)}`,
      `wheelbase    ${candidate.maxWheelbaseError.toFixed(5)} world units`,
      `transition   ${candidate.maxTransitionJump.toFixed(5)} world units`,
      `coupler peak ${(candidate.maxCouplerForceN / 1000).toFixed(1)} kN`,
      `acceleration ${candidate.maxAccelerationMps2.toFixed(2)} m/s²`,
      `jerk         ${candidate.maxJerkMps3.toFixed(2)} m/s³`,
      `derail tick  ${candidate.derailmentTick ?? 'none'}`,
      `runtime      ${candidate.durationMs.toFixed(1)} ms`,
    ]);
    this.metrics.setColor(report.allMetricsFinite ? '#b8d7ef' : '#ff6b6b');
  }

  destroy(): void {
    this.graphics.destroy();
    this.title.destroy();
    this.metrics.destroy();
    this.help.destroy();
  }

  private drawFrame(): void {
    const width = Math.min(540, this.scene.scale.width - 48);
    this.graphics.fillStyle(0x061522, 0.94);
    this.graphics.fillRoundedRect(12, 10, width, 300, 12);
    this.graphics.lineStyle(2, 0x3aaee8, 0.5);
    this.graphics.strokeRoundedRect(12, 10, width, 300, 12);
  }
}
