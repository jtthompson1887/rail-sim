import Phaser from 'phaser';
import RailTrack from '../../src/entities/RailTrack';
import { TrackSerializer } from '../../src/utils/TrackSerializer';

const { makeScene } = require('../../__mocks__/phaser');

describe('TrackSerializer exact cubic persistence', () => {
  it('serializes the four stored control points without resampling', () => {
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

    expect(TrackSerializer.toTrackDef(track)).toEqual(expect.objectContaining({
      geometryVersion: 1,
      p0: { x: controls.p0.x, y: controls.p0.y },
      p1: { x: controls.p1.x, y: controls.p1.y },
      p2: { x: controls.p2.x, y: controls.p2.y },
      p3: { x: controls.p3.x, y: controls.p3.y },
    }));
  });
});
