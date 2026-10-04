import Phaser from 'phaser';
import RailTrack from '../../src/entities/RailTrack';

const { makeScene } = require('../../__mocks__/phaser');

describe('RailTrack arc-length index lifecycle', () => {
  it('reuses one index until the track geometry changes', () => {
    const scene = makeScene();
    const track = new RailTrack(
      scene,
      new Phaser.Math.Vector2(0, 0),
      new Phaser.Math.Vector2(100, 0),
      new Phaser.Math.Vector2(200, 0),
      new Phaser.Math.Vector2(300, 0),
    );

    const original = track.getArcLengthIndex();
    expect(track.getArcLengthIndex()).toBe(original);
    expect(original.length).toBeCloseTo(300, 8);

    track.updateTrackVectors(
      new Phaser.Math.Vector2(0, 0),
      new Phaser.Math.Vector2(200, 0),
      new Phaser.Math.Vector2(400, 0),
      new Phaser.Math.Vector2(600, 0),
    );

    const rebuilt = track.getArcLengthIndex();
    expect(rebuilt).not.toBe(original);
    expect(rebuilt.length).toBeCloseTo(600, 8);
  });
});
