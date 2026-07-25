import type { ConstructionProposal } from '../../src/systems/ConstructionAnalyzer';
import type {
  ConstructionPreview,
  ConstructionQuote,
} from '../../src/systems/ConstructionService';
import { EventBus } from '../../src/services/EventBus';
import { PlaceTrackTool } from '../../src/systems/tools/PlaceTrackTool';
import { WorldManager } from '../../src/managers/WorldManager';
import TrackManager from '../../src/managers/TrackManager';
import { SnapSystem } from '../../src/systems/SnapSystem';
import { ConstructionAnalyzer } from '../../src/systems/ConstructionAnalyzer';
import { ConstructionService } from '../../src/systems/ConstructionService';
import { ConstructionEconomy } from '../../src/systems/ConstructionEconomy';
import { CommandStack } from '../../src/systems/CommandStack';

const { makeScene } = require('../../__mocks__/phaser');

function proposal(
  valid = true,
  remedy = '',
): ConstructionProposal {
  return {
    geometry: {
      geometryVersion: 1,
      p0: { x: 0, y: 0 },
      p1: { x: 100, y: 0 },
      p2: { x: 200, y: 0 },
      p3: { x: 300, y: 0 },
    },
    verticalProfile: {
      profileVersion: 1,
      knots: [{ t: 0, elevation: 0 }, { t: 1, elevation: 0 }],
    },
    length: 300,
    minimumRadius: Infinity,
    maximumGradePercent: valid ? 2 : 14,
    maximumGradeT: 0.5,
    structures: [{
      type: 'surface',
      startT: 0,
      endT: 1,
      startElevation: 0,
      endElevation: 0,
    }],
    costs: {
      track: 300,
      earthworks: 0,
      bridge: 0,
      tunnel: 0,
      total: 300,
    },
    valid,
    reasonCode: valid ? 'ok' : 'grade',
    remedy,
  };
}

function preview(valid = true): ConstructionPreview {
  const analyzed = proposal(
    valid,
    valid
      ? ''
      : 'Too steep here — move the endpoint downhill or use a shorter section.',
  );
  const quote: ConstructionQuote | null = valid ? {
    quoteId: 'quote-1',
    newTrackUUID: 'new-track',
    worldRevision: 0,
    expectedCash: 10_000,
    proposal: analyzed,
    expectedAffectedTracks: [],
    predictedConnections: [],
    topologyCost: 0,
    totalCost: 300,
  } : null;
  return {
    status: valid ? 'committable' : 'engineering-invalid',
    startAnchor: { x: 0, y: 0, endpoint: null },
    endAnchor: { x: 300, y: 0, endpoint: null },
    proposal: analyzed,
    quote,
    predictedConnections: [],
    topologyCost: 0,
    totalCost: 300,
    affordable: true,
    message: analyzed.remedy,
  };
}

function pointer(button = 0): any {
  return {
    button,
    rightButtonDown: () => button === 2,
  };
}

function makeHarness(options: {
  analyzed?: ConstructionPreview;
  affordable?: boolean;
  pushResult?: boolean;
} = {}) {
  const scene = makeScene();
  const snapSystem = {
    snapPoint: jest.fn((x: number, y: number) => ({
      x,
      y,
      snapped: false,
      type: 'none',
    })),
  };
  const constructionService = {
    createPreview: jest.fn().mockReturnValue(options.analyzed ?? preview()),
  };
  const economy = {
    canAfford: jest.fn().mockReturnValue(options.affordable ?? true),
  };
  const commandStack = {
    push: jest.fn().mockReturnValue(options.pushResult ?? true),
  };
  const overlay = {
    render: jest.fn(),
    clear: jest.fn(),
    destroy: jest.fn(),
  };
  const tool = new PlaceTrackTool(
    scene,
    {} as any,
    snapSystem as any,
    constructionService as any,
    economy as any,
    commandStack as any,
    overlay as any,
  );
  return {
    tool,
    snapSystem,
    constructionService,
    economy,
    commandStack,
    overlay,
  };
}

describe('PlaceTrackTool live construction workflow', () => {
  it('moves idle → dragging → review and caches unchanged geometry/config input', () => {
    const harness = makeHarness();

    expect(harness.tool.phase).toBe('idle');
    harness.tool.onPointerDown(0, 0, pointer());
    expect(harness.tool.phase).toBe('dragging');

    harness.tool.onPointerMove(300, 0, pointer());
    harness.tool.onPointerMove(300, 0, pointer());
    expect(harness.constructionService.createPreview).toHaveBeenCalledTimes(1);
    expect(harness.constructionService.createPreview).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'none', x: 0, y: 0 }),
      expect.objectContaining({ type: 'none', x: 300, y: 0 }),
      expect.any(String),
    );
    expect(harness.overlay.render).toHaveBeenLastCalledWith(
      expect.objectContaining({
        phase: 'dragging',
        canConfirm: false,
        affordable: true,
        message: 'Release to review this section.',
      }),
    );

    harness.tool.onPointerUp(300, 0, pointer());
    expect(harness.tool.phase).toBe('review');
    expect(harness.tool.previewModel).toEqual(expect.objectContaining({
      canConfirm: true,
      message: 'Click or press Enter to build this section.',
    }));
    expect(harness.constructionService.createPreview).toHaveBeenCalledTimes(1);
    harness.tool.onPointerMove(350, 0, pointer());
    expect(harness.constructionService.createPreview).toHaveBeenCalledTimes(1);
  });

  it('keeps one pending UUID while geometry changes and invalidates cache on authority changes', () => {
    WorldManager.createNew('Cache authority', 'cache-authority');
    const harness = makeHarness();
    harness.tool.onPointerDown(0, 0, pointer());
    harness.tool.onPointerMove(300, 0, pointer());
    harness.tool.onPointerMove(350, 0, pointer());
    const firstUUID = harness.constructionService.createPreview.mock.calls[0][2];
    expect(harness.constructionService.createPreview.mock.calls[1][2]).toBe(firstUUID);

    WorldManager.world!.revision += 1;
    harness.tool.onPointerMove(350, 0, pointer());
    WorldManager.world!.company.cash -= 1;
    harness.tool.onPointerMove(350, 0, pointer());

    expect(harness.constructionService.createPreview).toHaveBeenCalledTimes(4);
    WorldManager.reset();
  });

  it('confirms the exact cached quote through CommandStack and chains from p3', () => {
    const analyzed = preview();
    const harness = makeHarness({ analyzed });
    const emit = jest.spyOn(EventBus, 'emit');

    harness.tool.onPointerDown(0, 0, pointer());
    harness.tool.onPointerMove(300, 0, pointer());
    harness.tool.onPointerUp(300, 0, pointer());
    harness.tool.onKeyDown({ code: 'Enter' } as KeyboardEvent);

    expect(harness.commandStack.push).toHaveBeenCalledTimes(1);
    expect((harness.commandStack.push.mock.calls[0][0] as any).quote)
      .toBe(analyzed.quote);
    expect(harness.tool.phase).toBe('chained');
    expect(harness.tool.startAnchor).toEqual(expect.objectContaining({
      x: analyzed.proposal.geometry.p3.x,
      y: analyzed.proposal.geometry.p3.y,
    }));
    const emittedPhases = emit.mock.calls
      .filter(([event]) => event === 'construction:preview')
      .map(([, payload]) => (payload as any).phase);
    expect(emittedPhases).toEqual(expect.arrayContaining(['committed', 'chained']));

    emit.mockRestore();
  });

  it('keeps chained state after the pointer-up paired with click-to-confirm', () => {
    const harness = makeHarness();
    const click = pointer();
    harness.tool.onPointerDown(0, 0, click);
    harness.tool.onPointerMove(300, 0, click);
    harness.tool.onPointerUp(300, 0, click);

    harness.tool.onPointerDown(300, 0, click);
    harness.tool.onPointerUp(300, 0, click);

    expect(harness.commandStack.push).toHaveBeenCalledTimes(1);
    expect(harness.tool.phase).toBe('chained');
    expect(harness.constructionService.createPreview).toHaveBeenCalledTimes(1);
  });

  it('keeps stale review truthful when the authoritative command rejects commit', () => {
    const harness = makeHarness({ pushResult: false });

    harness.tool.onPointerDown(0, 0, pointer());
    harness.tool.onPointerMove(300, 0, pointer());
    harness.tool.onPointerUp(300, 0, pointer());
    harness.tool.onKeyDown({ code: 'Enter' } as KeyboardEvent);

    expect(harness.tool.phase).toBe('review');
    expect(harness.tool.previewModel).toEqual(expect.objectContaining({
      stale: true,
      canConfirm: false,
      message: expect.stringContaining('move'),
    }));
    expect(harness.constructionService.createPreview).toHaveBeenCalledTimes(1);
  });

  it('shows engineering and affordability blockers with confirm disabled', () => {
    const invalidHarness = makeHarness({ analyzed: preview(false) });
    invalidHarness.tool.onPointerDown(0, 0, pointer());
    invalidHarness.tool.onPointerMove(300, 0, pointer());
    expect(invalidHarness.tool.previewModel).toEqual(expect.objectContaining({
      canConfirm: false,
      message: 'Too steep here — move the endpoint downhill or use a shorter section.',
    }));

    const expensive = preview();
    expensive.proposal.structures[0].type = 'tunnel';
    const cashHarness = makeHarness({ analyzed: expensive, affordable: false });
    cashHarness.tool.onPointerDown(0, 0, pointer());
    cashHarness.tool.onPointerMove(300, 0, pointer());
    expect(cashHarness.tool.previewModel).toEqual(expect.objectContaining({
      canConfirm: false,
      message: 'Tunnel section exceeds your cash.',
    }));
  });

  it('right-click steps review back to dragging and Escape cancels to idle', () => {
    const harness = makeHarness();
    harness.tool.onPointerDown(0, 0, pointer());
    harness.tool.onPointerMove(300, 0, pointer());
    harness.tool.onPointerUp(300, 0, pointer());

    expect(harness.tool.wantsPointerButton(2)).toBe(true);
    harness.tool.onPointerDown(300, 0, pointer(2));
    expect(harness.tool.phase).toBe('dragging');

    harness.tool.cancel();
    expect(harness.tool.phase).toBe('idle');
    expect(harness.overlay.clear).toHaveBeenCalled();
  });

  it('commits the displayed canonical geometry and supports undo/redo without direct mutation', () => {
    const scene = makeScene();
    const world = WorldManager.createNew('Live placement', 'live-placement');
    const trackManager = new TrackManager(scene);
    const snapSystem = new SnapSystem(trackManager);
    snapSystem.gridEnabled = false;
    const service = new ConstructionService(
      trackManager,
      new ConstructionAnalyzer({ getHeightAt: () => 0 }),
    );
    const stack = new CommandStack();
    const overlay = {
      render: jest.fn(),
      clear: jest.fn(),
      destroy: jest.fn(),
    };
    const tool = new PlaceTrackTool(
      scene,
      trackManager,
      snapSystem,
      service,
      new ConstructionEconomy(world.company),
      stack,
      overlay as any,
    );
    const startingCash = world.company.cash;

    tool.onPointerDown(0, 0, pointer());
    tool.onPointerMove(300, 0, pointer());
    tool.onPointerUp(300, 0, pointer());
    const displayed = tool.previewModel!;
    expect(trackManager.tracks).toHaveLength(0);
    expect(world.tracks).toHaveLength(0);

    expect(tool.confirm()).toBe(true);
    expect(trackManager.tracks).toHaveLength(1);
    expect(world.tracks).toHaveLength(1);
    expect(world.tracks[0].p0).toEqual(displayed.proposal.geometry.p0);
    expect(world.tracks[0].p1).toEqual(displayed.proposal.geometry.p1);
    expect(world.tracks[0].p2).toEqual(displayed.proposal.geometry.p2);
    expect(world.tracks[0].p3).toEqual(displayed.proposal.geometry.p3);
    expect(world.company.cash).toBe(startingCash - displayed.totalCost);

    const firstGeometry = world.tracks[0];
    tool.onPointerMove(600, 0, pointer());
    tool.onPointerUp(600, 0, pointer());
    const chainedGeometry = tool.previewModel!.proposal.geometry;
    const incoming = {
      x: firstGeometry.p3.x - firstGeometry.p2.x,
      y: firstGeometry.p3.y - firstGeometry.p2.y,
    };
    const outgoing = {
      x: chainedGeometry.p1.x - chainedGeometry.p0.x,
      y: chainedGeometry.p1.y - chainedGeometry.p0.y,
    };
    expect(chainedGeometry.p0).toEqual(firstGeometry.p3);
    expect(incoming.x * outgoing.y - incoming.y * outgoing.x).toBeCloseTo(0);
    expect(incoming.x * outgoing.x + incoming.y * outgoing.y).toBeGreaterThan(0);

    tool.cancel();
    expect(stack.undo()).toBe(true);
    expect(world.tracks).toHaveLength(0);
    expect(world.company.cash).toBe(startingCash);
    expect(stack.redo()).toBe(true);
    expect(world.tracks).toHaveLength(1);
    expect(world.company.cash).toBe(startingCash - displayed.totalCost);

    tool.destroy();
    WorldManager.reset();
  });
});
