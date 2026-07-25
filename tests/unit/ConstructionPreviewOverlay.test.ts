import {
  ConstructionPreviewOverlay,
  INVALID_PREVIEW_STYLE,
  PREVIEW_STRUCTURE_STYLES,
  type ConstructionPreviewModel,
} from '../../src/ui/ConstructionPreviewOverlay';

jest.mock('../../src/entities/RailTrack', () => {
  throw new Error('Construction preview must never import or instantiate RailTrack');
});

function graphics() {
  return {
    setDepth: jest.fn().mockReturnThis(),
    setScrollFactor: jest.fn().mockReturnThis(),
    clear: jest.fn().mockReturnThis(),
    lineStyle: jest.fn().mockReturnThis(),
    fillStyle: jest.fn().mockReturnThis(),
    beginPath: jest.fn().mockReturnThis(),
    moveTo: jest.fn().mockReturnThis(),
    lineTo: jest.fn().mockReturnThis(),
    strokePath: jest.fn().mockReturnThis(),
    fillCircle: jest.fn().mockReturnThis(),
    destroy: jest.fn(),
  };
}

function model(): ConstructionPreviewModel {
  return {
    phase: 'dragging',
    proposal: {
      geometry: {
        geometryVersion: 1,
        p0: { x: 0, y: 0 },
        p1: { x: 100, y: 0 },
        p2: { x: 200, y: 0 },
        p3: { x: 300, y: 0 },
      },
      verticalProfile: {
        profileVersion: 1,
        knots: [{ t: 0, elevation: 0 }, { t: 1, elevation: 20 }],
      },
      length: 300,
      minimumRadius: Infinity,
      maximumGradePercent: 6,
      maximumGradeT: 0.5,
      maximumGradeDistance: 150,
      structures: [
        { type: 'surface', startT: 0, endT: 0.2, startElevation: 0, endElevation: 4 },
        { type: 'cut', startT: 0.2, endT: 0.4, startElevation: 4, endElevation: 8 },
        { type: 'fill', startT: 0.4, endT: 0.6, startElevation: 8, endElevation: 12 },
        { type: 'bridge', startT: 0.6, endT: 0.8, startElevation: 12, endElevation: 16 },
        { type: 'tunnel', startT: 0.8, endT: 1, startElevation: 16, endElevation: 20 },
      ],
      structureLengths: {
        surface: 60,
        cut: 60,
        fill: 60,
        bridge: 60,
        tunnel: 60,
      },
      costs: {
        track: 300,
        earthworks: 20,
        bridge: 30,
        tunnel: 40,
        total: 390,
      },
      valid: true,
      reasonCode: 'ok',
      remedy: '',
    },
    predictedConnections: [{
      kind: 'endpoint-connection',
      existingTrackUUID: 'existing',
      existingEndpoint: 'end',
      newEndpoint: 'start',
      point: { x: 0, y: 0 },
    }],
    engineeringSubtotal: 390,
    topologyCost: 0,
    totalCost: 390,
    cashBefore: 10_000,
    cashAfter: 9_610,
    structureLengths: {
      surface: 60,
      cut: 60,
      fill: 60,
      bridge: 60,
      tunnel: 60,
    },
    affordable: true,
    canConfirm: true,
    stale: false,
    message: '',
    actions: ['confirm', 'backstep', 'cancel'],
  };
}

describe('ConstructionPreviewOverlay', () => {
  it('draws engineering intervals with distinct styles and all markers', () => {
    const gfx = graphics();
    const scene = { add: { graphics: jest.fn().mockReturnValue(gfx) } };
    const overlay = new ConstructionPreviewOverlay(scene as any);

    overlay.render(model());

    for (const style of Object.values(PREVIEW_STRUCTURE_STYLES)) {
      expect(gfx.lineStyle).toHaveBeenCalledWith(
        style.width,
        style.color,
        style.alpha,
      );
    }
    // Start + end + steepest grade + one predicted connection.
    expect(gfx.fillCircle).toHaveBeenCalledTimes(4);
    expect(gfx.lineTo.mock.calls.length).toBeGreaterThan(5);
    expect(gfx.setScrollFactor).toHaveBeenCalledWith(1);
  });

  it('reuses and clears one Graphics object and destroys it on teardown', () => {
    const gfx = graphics();
    const scene = { add: { graphics: jest.fn().mockReturnValue(gfx) } };
    const overlay = new ConstructionPreviewOverlay(scene as any);

    overlay.render(model());
    overlay.clear();
    overlay.destroy();

    expect(scene.add.graphics).toHaveBeenCalledTimes(1);
    expect(gfx.clear).toHaveBeenCalledTimes(2);
    expect(gfx.destroy).toHaveBeenCalledTimes(1);
  });

  it('draws the canonical route when an early-invalid proposal has no intervals', () => {
    const gfx = graphics();
    const scene = { add: { graphics: jest.fn().mockReturnValue(gfx) } };
    const overlay = new ConstructionPreviewOverlay(scene as any);
    const invalid = model();
    invalid.proposal.valid = false;
    invalid.proposal.reasonCode = 'too-short';
    invalid.proposal.structures = [];

    overlay.render(invalid);

    expect(gfx.lineStyle).toHaveBeenCalledWith(
      INVALID_PREVIEW_STYLE.width,
      INVALID_PREVIEW_STYLE.color,
      INVALID_PREVIEW_STYLE.alpha,
    );
    expect(gfx.lineTo.mock.calls.length).toBeGreaterThan(1);
  });
});
