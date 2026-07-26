import Phaser from 'phaser';
import RailTrack from '../../src/entities/RailTrack';
import { TrackSerializer } from '../../src/utils/TrackSerializer';
import type {
  StructureInterval,
  VerticalProfileDef,
} from '../../src/config/WorldData';

const { makeScene } = require('../../__mocks__/phaser');

describe('TrackSerializer exact cubic persistence', () => {
  it('serializes exact cubic and deep-copied engineering output without resampling', () => {
    const scene = makeScene();
    const controls = {
      p0: new Phaser.Math.Vector2(11.25, -30.5),
      p1: new Phaser.Math.Vector2(97.125, 280.75),
      p2: new Phaser.Math.Vector2(412.875, -115.625),
      p3: new Phaser.Math.Vector2(530.5, 41.25),
    };
    const track = new RailTrack(
      scene,
      controls.p0,
      controls.p1,
      controls.p2,
      controls.p3,
    );
    const verticalProfile: VerticalProfileDef = {
      profileVersion: 1,
      knots: [
        { t: 0, elevation: 12.5 },
        { t: 0.4, elevation: 18.75 },
        { t: 1, elevation: 9.25 },
      ],
    };
    const structures: StructureInterval[] = [
      {
        type: 'surface',
        startT: 0,
        endT: 0.4,
        startElevation: 12.5,
        endElevation: 18.75,
      },
      {
        type: 'bridge',
        startT: 0.4,
        endT: 1,
        startElevation: 18.75,
        endElevation: 9.25,
      },
    ];
    track.setConstructionData(verticalProfile, structures, 0);
    verticalProfile.knots[0].elevation = 999;
    structures[0].type = 'tunnel';

    const first = TrackSerializer.toTrackDef(track);
    expect(first).toEqual(expect.objectContaining({
      geometryVersion: 1,
      p0: { x: controls.p0.x, y: controls.p0.y },
      p1: { x: controls.p1.x, y: controls.p1.y },
      p2: { x: controls.p2.x, y: controls.p2.y },
      p3: { x: controls.p3.x, y: controls.p3.y },
      verticalProfile: {
        profileVersion: 1,
        knots: [
          { t: 0, elevation: 12.5 },
          { t: 0.4, elevation: 18.75 },
          { t: 1, elevation: 9.25 },
        ],
      },
      structures: [
        {
          type: 'surface',
          startT: 0,
          endT: 0.4,
          startElevation: 12.5,
          endElevation: 18.75,
        },
        {
          type: 'bridge',
          startT: 0.4,
          endT: 1,
          startElevation: 18.75,
          endElevation: 9.25,
        },
      ],
      paidBuildCost: 0,
    }));
    first.verticalProfile.knots[0].elevation = -500;
    first.structures[0].type = 'fill';
    expect(TrackSerializer.toTrackDef(track).verticalProfile.knots[0].elevation).toBe(12.5);
    expect(TrackSerializer.toTrackDef(track).structures[0].type).toBe('surface');
  });

  it('refuses to emit an incomplete schema-2 track definition', () => {
    const scene = makeScene();
    const track = new RailTrack(
      scene,
      new Phaser.Math.Vector2(0, 0),
      new Phaser.Math.Vector2(100, 0),
      new Phaser.Math.Vector2(200, 0),
      new Phaser.Math.Vector2(300, 0),
    );

    expect(() => TrackSerializer.toTrackDef(track)).toThrow(
      'Track is missing construction engineering data.',
    );
  });
});
