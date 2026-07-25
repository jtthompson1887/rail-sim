import { ConstructionAnalyzer } from '../../src/systems/ConstructionAnalyzer';
import type {
  ConstructionPreview,
  ConstructionQuote,
} from '../../src/systems/ConstructionService';
import { deriveAutomaticCubic } from '../../src/systems/TrackGeometry';
import { PlaceTrackTool } from '../../src/systems/tools/PlaceTrackTool';

declare global {
  interface Window {
    __runConstructionDragBenchmark: () => {
      samples: number;
      p95Ms: number;
    };
  }
}

function graphics() {
  return {
    setDepth() { return this; },
    setScrollFactor() { return this; },
    clear() { return this; },
    lineStyle() { return this; },
    fillStyle() { return this; },
    beginPath() { return this; },
    moveTo() { return this; },
    lineTo() { return this; },
    strokePath() { return this; },
    fillCircle() { return this; },
    destroy() {},
  };
}

function createTool(): PlaceTrackTool {
  const analyzer = new ConstructionAnalyzer({
    getHeightAt: (x, y) => Math.sin(x / 470) * 24 + Math.cos(y / 390) * 18,
  });
  const scene = {
    add: { graphics: () => graphics() },
  };
  const snapSystem = {
    endpointEnabled: true,
    gridEnabled: false,
    gridSize: 64,
    snapRadius: 60,
    snapConstructionPoint: (x: number, y: number) => ({
      x,
      y,
      snapped: false,
      type: 'none' as const,
    }),
  };
  const constructionService = {
    createPreview: (
      start: { x: number; y: number },
      end: { x: number; y: number },
      newTrackUUID: string,
    ): ConstructionPreview => {
      const proposal = analyzer.analyze(deriveAutomaticCubic({ start, end }));
      const totalCost = proposal.costs.total;
      const quote = proposal.valid && totalCost > 0 ? {
        quoteId: `browser-${newTrackUUID}`,
        newTrackUUID,
        worldRevision: 0,
        expectedCash: 1_000_000,
        proposal,
        expectedAffectedTracks: [],
        predictedConnections: [],
        topologyCost: 0,
        totalCost,
      } as ConstructionQuote : null;
      return {
        status: quote ? 'committable' : 'engineering-invalid',
        startAnchor: { x: start.x, y: start.y, endpoint: null },
        endAnchor: { x: end.x, y: end.y, endpoint: null },
        proposal,
        quote,
        predictedConnections: [],
        topologyCost: 0,
        totalCost,
        affordable: true,
        message: proposal.remedy,
      };
    },
  };
  return new PlaceTrackTool(
    scene as any,
    {} as any,
    snapSystem as any,
    constructionService as any,
    { canAfford: () => true } as any,
    { push: () => false } as any,
  );
}

function runMoves(tool: PlaceTrackTool, collect: boolean): number[] {
  const pointer = {
    button: 0,
    id: 1,
    rightButtonDown: () => false,
  };
  tool.onPointerDown(-1000, -600, pointer as any);
  const durations: number[] = [];
  for (let index = 0; index < 500; index++) {
    const x = -650 + index * 3.5;
    const y = -600 + Math.sin(index / 11) * 140;
    const start = performance.now();
    tool.onPointerMove(x, y, pointer as any);
    if (collect) durations.push(performance.now() - start);
  }
  return durations;
}

window.__runConstructionDragBenchmark = () => {
  const warmTool = createTool();
  runMoves(warmTool, false);
  warmTool.destroy();

  const measuredTool = createTool();
  const durations = runMoves(measuredTool, true);
  measuredTool.destroy();
  durations.sort((left, right) => left - right);
  return {
    samples: durations.length,
    p95Ms: durations[Math.ceil(durations.length * 0.95) - 1],
  };
};

export {};
