import TrackManager from '../../src/managers/TrackManager';
import { WorldManager } from '../../src/managers/WorldManager';
import { ConstructionAnalyzer } from '../../src/systems/ConstructionAnalyzer';
import { ConstructionService } from '../../src/systems/ConstructionService';
import { CommandStack } from '../../src/systems/CommandStack';
import { SnapSystem } from '../../src/systems/SnapSystem';
import { PlaceTrackTool } from '../../src/systems/tools/PlaceTrackTool';
import { EventBus } from '../../src/services/EventBus';

const { makeScene } = require('../../__mocks__/phaser');
const pointer = (id = 1): any => ({ id, button: 0, rightButtonDown: () => false });

describe('editable construction drafts', () => {
  let tool: PlaceTrackTool;
  let service: ConstructionService;
  let analyzer: ConstructionAnalyzer;
  let stack: CommandStack;
  let scene: ReturnType<typeof makeScene>;

  beforeEach(() => {
    scene = makeScene();
    const manager = new TrackManager(scene);
    const snap = new SnapSystem(manager);
    snap.gridEnabled = false;
    WorldManager.createNew('Curve editor', 'curve-editor');
    analyzer = new ConstructionAnalyzer({ getHeightAt: () => 0 });
    service = new ConstructionService(manager, analyzer);
    stack = new CommandStack();
    tool = new PlaceTrackTool(scene, manager, snap, service, stack, {
      render: jest.fn(), clear: jest.fn(), destroy: jest.fn(),
    });
  });

  afterEach(() => {
    tool.destroy();
    WorldManager.reset();
    jest.restoreAllMocks();
  });

  function draw(start = { x: 0, y: 0 }, end = { x: 600, y: 0 }): void {
    if (tool.phase === 'idle') tool.onPointerDown(start.x, start.y, pointer());
    tool.onPointerMove(end.x, end.y, pointer());
    tool.onPointerUp(end.x, end.y, pointer());
  }

  function drag(from: { x: number; y: number }, to: { x: number; y: number }): void {
    tool.onPointerDown(from.x, from.y, pointer());
    tool.onPointerMove(to.x, to.y, pointer());
    tool.onPointerUp(to.x, to.y, pointer());
  }

  it('shapes both directions independently, prices the shape, and builds exactly that draft', () => {
    draw();
    const cash = WorldManager.world!.company.cash;
    const initial = tool.previewModel!;
    drag(initial.proposal.geometry.p1, { x: 200, y: -60 });
    drag(tool.previewModel!.proposal.geometry.p2, { x: 400, y: 70 });
    const displayed = tool.previewModel!;
    expect(displayed.proposal.geometry.p1).toEqual({ x: 200, y: -60 });
    expect(displayed.proposal.geometry.p2).toEqual({ x: 400, y: 70 });
    expect(displayed.totalCost).toBeGreaterThan(initial.totalCost);
    expect(displayed.canConfirm).toBe(true);
    expect(WorldManager.world!.company.cash).toBe(cash);
    expect(WorldManager.world!.tracks).toHaveLength(0);
    expect(tool.confirm()).toBe(true);
    expect(WorldManager.world!.tracks[0]).toMatchObject(displayed.proposal.geometry);
    expect(WorldManager.world!.company.cash).toBe(cash - displayed.totalCost);
    expect(tool.phase).toBe('chained');
    expect(stack.undo()).toBe(true);
    expect(WorldManager.world!.company.cash).toBe(cash);
    expect(stack.redo()).toBe(true);
    expect(WorldManager.world!.tracks[0]).toMatchObject(displayed.proposal.geometry);
  });

  it('selects on tap, places the selected direction on the next tap, and ignores hover', () => {
    draw();
    const p1 = tool.previewModel!.proposal.geometry.p1;
    tool.onPointerDown(p1.x, p1.y, pointer());
    tool.onPointerUp(p1.x, p1.y, pointer());
    const selected = tool.previewModel!;
    tool.onPointerMove(200, -60, pointer());
    expect(tool.previewModel).toBe(selected);
    tool.onPointerDown(200, -60, pointer());
    tool.onPointerUp(200, -60, pointer());
    expect(tool.previewModel!.proposal.geometry.p1).toEqual({ x: 200, y: -60 });
    expect(WorldManager.world!.tracks).toHaveLength(0);
  });

  it('keeps handle capture consistent at different camera zooms', () => {
    draw();
    scene.cameras.main.zoom = 0.5;
    const p1 = tool.previewModel!.proposal.geometry.p1;
    tool.onPointerDown(p1.x, p1.y + 40, pointer());
    expect(tool.previewModel!.draft!.selectedHandle).toBe('start-direction');
    tool.onPointerCancel(pointer());
    scene.cameras.main.zoom = 2;
    tool.adjustDraft({ action: 'select', handle: 'end-direction' });
    tool.onPointerDown(p1.x, p1.y + 40, pointer());
    expect(tool.previewModel!.draft!.selectedHandle).toBe('end-direction');
  });

  it('undoes draft gestures and reset without spending money or undoing live infrastructure', () => {
    draw();
    const initial = tool.previewModel!;
    const undo = jest.spyOn(stack, 'undo');
    drag(initial.proposal.geometry.p1, { x: 200, y: -60 });
    const curved = tool.previewModel!;
    tool.adjustDraft({ action: 'reset' });
    expect(tool.previewModel!.proposal.geometry).toEqual(initial.proposal.geometry);
    tool.adjustDraft({ action: 'undo' });
    expect(tool.previewModel!.proposal.geometry).toEqual(curved.proposal.geometry);
    tool.adjustDraft({ action: 'undo' });
    expect(tool.previewModel!.proposal.geometry).toEqual(initial.proposal.geometry);
    expect(tool.previewModel!.totalCost).toBe(initial.totalCost);
    expect(tool.previewModel!.draft!.canUndo).toBe(false);
    expect(undo).not.toHaveBeenCalled();
    expect(WorldManager.world!.tracks).toHaveLength(0);
  });

  it('restores the draft on cancellation and blocks commit during a handle gesture', () => {
    draw();
    const initial = tool.previewModel!;
    const p1 = initial.proposal.geometry.p1;
    tool.onPointerDown(p1.x, p1.y, pointer());
    tool.onPointerMove(200, -60, pointer());
    expect(tool.confirm()).toBe(false);
    tool.onPointerCancel(pointer(2));
    expect(tool.previewModel!.proposal.geometry.p1.y).toBe(-60);
    tool.onPointerCancel(pointer());
    expect(tool.phase).toBe('review');
    expect(tool.previewModel!.proposal.geometry).toEqual(initial.proposal.geometry);
    expect(tool.previewModel!.draft!.canUndo).toBe(false);
    expect(tool.previewModel!.canConfirm).toBe(true);
  });

  it('re-analyzes a control change even when neither endpoint moved', () => {
    draw();
    const analyze = jest.spyOn(analyzer, 'analyzeDetailed');
    tool.adjustDraft({ action: 'select', handle: 'start-direction' });
    tool.adjustDraft({ action: 'rotate', degrees: -5 });
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(tool.previewModel!.proposal.geometry.p0).toEqual({ x: 0, y: 0 });
    expect(tool.previewModel!.proposal.geometry.p3).toEqual({ x: 600, y: 0 });
    expect(tool.previewModel!.proposal.geometry.p1.y).toBeLessThan(0);
  });

  it('keeps joined directions locked but lets the player adjust approach length', () => {
    draw({ x: -600, y: 0 }, { x: 0, y: 0 });
    expect(tool.confirm()).toBe(true);
    draw({ x: 0, y: 0 }, { x: 600, y: 200 });
    expect(tool.previewModel!.draft!.startDirectionLocked).toBe(true);
    tool.adjustDraft({ action: 'select', handle: 'start-direction' });
    const joined = tool.previewModel!.proposal.geometry;
    tool.adjustDraft({ action: 'rotate', degrees: 45 });
    expect(tool.previewModel!.proposal.geometry).toEqual(joined);
    tool.adjustDraft({ action: 'reach', factor: 1.2 });
    expect(tool.previewModel!.proposal.geometry.p1.x).toBeGreaterThan(joined.p1.x);
    expect(tool.previewModel!.proposal.geometry.p1.y).toBe(0);
    drag(tool.previewModel!.proposal.geometry.p1, { x: 280, y: -80 });
    expect(tool.previewModel!.proposal.geometry.p1).toEqual({ x: 280, y: 0 });
  });

  it('allows endpoint repositioning and restores the exact anchors on draft undo', () => {
    draw();
    const initial = tool.previewModel!;
    drag(initial.proposal.geometry.p3, { x: 650, y: 50 });
    expect(tool.previewModel!.proposal.geometry.p3).toEqual({ x: 650, y: 50 });
    expect(tool.previewModel!.proposal.geometry.p2).toEqual({ x: 450, y: 50 });
    tool.adjustDraft({ action: 'undo' });
    expect(tool.previewModel!.proposal.geometry).toEqual(initial.proposal.geometry);
  });

  it('matches the incoming direction at an existing finish endpoint and prices the connection', () => {
    draw({ x: 600, y: 0 }, { x: 1200, y: 0 });
    expect(tool.confirm()).toBe(true);
    tool.cancel();
    draw({ x: 0, y: 0 }, { x: 600, y: 0 });
    expect(tool.previewModel!.draft!.endDirectionLocked).toBe(true);
    drag(tool.previewModel!.proposal.geometry.p2, { x: 350, y: 100 });
    expect(tool.previewModel!.proposal.geometry.p2).toEqual({ x: 350, y: 0 });
    expect(tool.previewModel!.topologyCost).toBe(2500);
    expect(tool.previewModel!.canConfirm).toBe(true);
    expect(tool.confirm()).toBe(true);
    expect(tool.phase).toBe('idle');
    expect(WorldManager.world!.tracks).toHaveLength(2);
  });

  it('keeps an unavailable edit recoverable without enabling its previous quote', () => {
    draw();
    const initial = tool.previewModel!;
    const unavailable = jest.spyOn(service, 'createPreview').mockReturnValue(null);
    drag(initial.proposal.geometry.p1, { x: 200, y: -60 });
    expect(tool.previewModel!.stale).toBe(true);
    expect(tool.previewModel!.canConfirm).toBe(false);
    expect(tool.previewModel!.draft!.canUndo).toBe(true);
    expect(tool.confirm()).toBe(false);
    unavailable.mockRestore();
    tool.adjustDraft({ action: 'undo' });
    expect(tool.previewModel!.proposal.geometry).toEqual(initial.proposal.geometry);
    expect(tool.previewModel!.canConfirm).toBe(true);
  });

  it('blocks invalid reshaped curves and never authorizes a stale priced shape', () => {
    draw();
    drag(tool.previewModel!.proposal.geometry.p1, { x: 0, y: -600 });
    expect(tool.previewModel!.canConfirm).toBe(false);
    expect(tool.confirm()).toBe(false);
    tool.adjustDraft({ action: 'undo' });
    WorldManager.world!.company = {
      ...WorldManager.world!.company,
      cash: WorldManager.world!.company.cash - 1,
    };
    expect(tool.confirm()).toBe(false);
    expect(tool.previewModel!.stale).toBe(true);
    tool.adjustDraft({ action: 'select', handle: 'end-direction' });
    expect(tool.previewModel!.stale).toBe(true);
    expect(tool.previewModel!.canConfirm).toBe(false);
    tool.adjustDraft({ action: 'reach', factor: 1.1 });
    expect(tool.previewModel!.stale).toBe(false);
    expect(tool.previewModel!.cashBefore).toBe(WorldManager.world!.company.cash);
    expect(WorldManager.world!.tracks).toHaveLength(0);
  });

  it('rejects non-finite control points without issuing a construction quote', () => {
    expect(service.createPreview({ x: 0, y: 0 }, { x: 600, y: 0 }, 'bad', {
      p1: { x: NaN, y: 0 }, p2: { x: 400, y: 0 },
    })).toBeNull();
  });

  it('rejects a broad self-crossing curve instead of silently creating a rail crossing', () => {
    const crossing = service.createPreview({ x: 0, y: 0 }, { x: 200, y: 0 }, 'loop', {
      p1: { x: 1000, y: 1000 }, p2: { x: -1000, y: 1000 },
    });
    expect(crossing).not.toBeNull();
    expect(crossing!.proposal.valid).toBe(false);
    expect(crossing!.proposal.remedy).toContain('Curve crosses itself');
    expect(crossing!.quote).toBeNull();
  });

  it('handles shape-panel intents only while a draft is active and detaches on destroy', () => {
    draw();
    EventBus.emit('construction:shape-intent', { action: 'select', handle: 'start-direction' });
    EventBus.emit('construction:shape-intent', { action: 'rotate', degrees: -5 });
    expect(tool.previewModel!.proposal.geometry.p1.y).toBeLessThan(0);
    tool.deactivate();
    EventBus.emit('construction:shape-intent', { action: 'rotate', degrees: -5 });
    expect(tool.phase).toBe('idle');
    expect(tool.previewModel).toBeNull();
    tool.destroy();
  });
});
