import { performance } from 'perf_hooks';
import { ConstructionAnalyzer } from '../../src/systems/ConstructionAnalyzer';
import { deriveAutomaticCubic } from '../../src/systems/TrackGeometry';

const CORPUS_SIZE = 500;
const LOCAL_P95_TARGET_MS = 8;

function representativeGeometry(index: number) {
  const row = index % 25;
  const column = Math.floor(index / 25);
  const start = {
    x: -3000 + column * 240,
    y: -2500 + row * 180,
  };
  const end = {
    x: start.x + 320 + (index % 7) * 48,
    y: start.y + ((index % 9) - 4) * 22,
  };
  return deriveAutomaticCubic({ start, end });
}

function percentile95(durations: number[]): number {
  const sorted = [...durations].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

describe('construction preview analysis benchmark', () => {
  it('records fixed-corpus 500-analysis p95 without a flaky CI wall-clock gate', () => {
    const analyzer = new ConstructionAnalyzer({
      getHeightAt: (x, y) => (
        Math.sin(x / 470) * 24
        + Math.cos(y / 390) * 18
      ),
    });
    const corpus = Array.from(
      { length: CORPUS_SIZE },
      (_, index) => representativeGeometry(index),
    );

    // Warm the exact same paths before timing to avoid module/JIT startup noise.
    for (const geometry of corpus) analyzer.analyze(geometry);

    const durations = corpus.map((geometry) => {
      const start = performance.now();
      analyzer.analyze(geometry);
      return performance.now() - start;
    });
    const p95 = percentile95(durations);

    expect(durations).toHaveLength(CORPUS_SIZE);
    expect(durations.every(Number.isFinite)).toBe(true);
    expect(p95).toBeGreaterThanOrEqual(0);
    if (process.env.RAIL_SIM_LOCAL_PERF_GATE === '1') {
      expect(p95).toBeLessThan(LOCAL_P95_TARGET_MS);
    }
    process.stdout.write(
      `[construction-preview-benchmark] corpus=${CORPUS_SIZE} p95=${p95.toFixed(3)}ms`
      + ` localTarget=${LOCAL_P95_TARGET_MS}ms\n`,
    );
  });
});
