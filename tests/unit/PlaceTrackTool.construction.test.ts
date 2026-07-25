import { PlaceTrackTool } from '../../src/systems/tools/PlaceTrackTool';
import { EventBus } from '../../src/services/EventBus';
import { WorldManager } from '../../src/managers/WorldManager';
import type { ConstructionProposal } from '../../src/systems/ConstructionAnalyzer';
import type { TrackGeometryDef } from '../../src/systems/TrackGeometry';

const { makeScene } = require('../../__mocks__/phaser');

function geometry(x0 = 0, y0 = 0, x3 = 300, y3 = 0): TrackGeometryDef {
  return {
    geometryVersion: 1,
    p0: { x: x0, y: y0 },
    p1: { x: x0 + (x3 - x0) / 3, y: y0 + (y3 - y0) / 3 },
    p2: { x: x0 + (x3 - x0) * 2 / 3, y: y0 + (y3 - y0) * 2 / 3 },
    p3: { x: x3, y: y3 },
  };
}

function proposal(
  proposalGeometry: TrackGeometryDef,
  overrides: Partial<ConstructionProposal> = {},
): ConstructionProposal {
  return {
    geometry: proposalGeometry,
    verticalProfile: {
      profileVersion: 1,
      knots: [{ t: 0, elevation: 12 }, { t: 1, elevation: 12 }],
    },
    length: 300,
    minimumRadius: Infinity,
    maximumGradePercent: 0,
    maximumGradeT: 0,
    structures: [{
      type: 'surface',
      startT: 0,
      endT: 1,
      startElevation: 12,
      endElevation: 12,
    }],
    costs: {
      track: 3000,
      earthworks: 0,
      bridge: 0,
      tunnel: 0,
      total: 3000,
    },
    valid: true,
    reasonCode: 'ok',
    remedy: '',
    ...overrides,
  };
}

describe('PlaceTrackTool construction proposal persistence', () => {
  let scene: any;
  let graphics: any;
  let trackManager: any;
  let snapSystem: any;
  let terrainValidator: any;
  let tool: PlaceTrackTool;
  let emitSpy: jest.SpyInstance;

  beforeEach(() => {
    scene = makeScene();
    const image = scene.add.image();
    image.setAlpha = jest.fn().mockReturnValue(image);
    image.setTint = jest.fn().mockReturnValue(image);
    graphics = scene.add.graphics();
    for (const method of [
      'clear', 'fillStyle', 'fillCircle', 'lineStyle',
      'beginPath', 'moveTo', 'lineTo', 'strokePath', 'destroy',
    ]) {
      graphics[method] = jest.fn().mockReturnValue(graphics);
    }
    trackManager = { addTrack: jest.fn() };
    snapSystem = { snapPoint: jest.fn((x, y) => ({ x, y })) };
    terrainValidator = { canPlaceTrack: jest.fn() };
    WorldManager.createNew('PlaceTrackTool construction');
    emitSpy = jest.spyOn(EventBus, 'emit');
    tool = new PlaceTrackTool(scene, trackManager, snapSystem, terrainValidator);
  });

  afterEach(() => {
    emitSpy.mockRestore();
    WorldManager.reset();
  });

  it('previews surface, engineered structure, and invalid proposals', () => {
    snapSystem.snapPoint.mockReturnValue({ x: 40, y: 60 });
    tool.onPointerDown(43, 64, {} as any);
    expect(graphics.fillCircle).toHaveBeenCalledWith(40, 60, 6);

    terrainValidator.canPlaceTrack
      .mockReturnValueOnce(proposal(geometry(40, 60, 340, 60)))
      .mockReturnValueOnce(proposal(geometry(40, 60, 340, 160), {
        structures: [{
          type: 'tunnel',
          startT: 0,
          endT: 1,
          startElevation: 12,
          endElevation: 12,
        }],
      }))
      .mockReturnValueOnce(proposal(geometry(40, 60, 340, 260), {
        valid: false,
        reasonCode: 'grade',
        remedy: 'Choose endpoints with less elevation difference.',
      }));

    tool.onPointerMove(340, 60, {} as any);
    expect(graphics.lineStyle).toHaveBeenLastCalledWith(2, 0x00ff88, 0.6);
    tool.onPointerMove(340, 160, {} as any);
    expect(graphics.lineStyle).toHaveBeenLastCalledWith(2, 0xffcc00, 0.6);
    tool.onPointerMove(340, 260, {} as any);
    expect(graphics.lineStyle).toHaveBeenLastCalledWith(2, 0xff4444, 0.6);
    expect(emitSpy).toHaveBeenCalledWith('ui:validation-hint', {
      state: 'error',
      message: 'Choose endpoints with less elevation difference.',
    });
  });

  it('rejects invalid placement without mutating the world', () => {
    terrainValidator.canPlaceTrack.mockReturnValue(proposal(geometry(), {
      valid: false,
      reasonCode: 'out-of-bounds',
      remedy: 'Keep the entire route inside the terrain boundary.',
    }));

    tool.onPointerDown(0, 0, {} as any);
    tool.onPointerDown(300, 0, {} as any);

    expect(trackManager.addTrack).not.toHaveBeenCalled();
    expect(WorldManager.world!.tracks).toEqual([]);
    expect(emitSpy).toHaveBeenCalledWith('ui:toast', {
      message: 'Cannot place track: Keep the entire route inside the terrain boundary.',
      type: 'error',
    });
  });

  it('persists exact proposal profile, structures, and subtotal without neighbour reshape', () => {
    const build = proposal(geometry(), {
      verticalProfile: {
        profileVersion: 1,
        knots: [
          { t: 0, elevation: 5 },
          { t: 0.5, elevation: 8 },
          { t: 1, elevation: 5 },
        ],
      },
      structures: [
        {
          type: 'surface',
          startT: 0,
          endT: 0.5,
          startElevation: 5,
          endElevation: 8,
        },
        {
          type: 'bridge',
          startT: 0.5,
          endT: 1,
          startElevation: 8,
          endElevation: 5,
        },
      ],
      costs: {
        track: 3000,
        earthworks: 0,
        bridge: 1321,
        tunnel: 0,
        total: 4321,
      },
    });
    terrainValidator.canPlaceTrack.mockReturnValue(build);

    tool.onPointerDown(0, 0, {} as any);
    tool.onPointerDown(300, 0, {} as any);

    expect(trackManager.addTrack).toHaveBeenCalledTimes(1);
    expect(WorldManager.world!.tracks).toEqual([
      expect.objectContaining({
        geometryVersion: 1,
        verticalProfile: build.verticalProfile,
        structures: build.structures,
        paidBuildCost: 4321,
      }),
    ]);
    expect(terrainValidator).not.toHaveProperty('snapToFlushConnection');
  });

  it('cancels cleanly and advertises only the left pointer button', () => {
    tool.onPointerDown(10, 20, {} as any);
    tool.deactivate();
    terrainValidator.canPlaceTrack.mockClear();
    tool.onPointerMove(50, 60, {} as any);

    expect(terrainValidator.canPlaceTrack).not.toHaveBeenCalled();
    expect(tool.wantsPointerButton(0)).toBe(true);
    expect(tool.wantsPointerButton(1)).toBe(false);
    tool.destroy();
    expect(graphics.destroy).toHaveBeenCalled();
  });
});
