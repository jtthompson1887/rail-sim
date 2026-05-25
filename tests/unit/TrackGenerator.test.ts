/**
 * Tests for TrackGenerator.
 */

import TrackGenerator from '../../src/systems/TrackGenerator';
import TrackManager from '../../src/managers/TrackManager';
import RailTrack from '../../src/entities/RailTrack';

const { makeScene } = require('../../__mocks__/phaser');

describe('TrackGenerator', () => {
  let scene: any;
  let trackManager: TrackManager;
  let generator: TrackGenerator;

  beforeEach(() => {
    scene = makeScene();
    trackManager = new TrackManager(scene);
    generator = new TrackGenerator(scene, trackManager, 'test-seed-42');
  });

  describe('constructor', () => {
    it('creates without throwing', () => {
      expect(() => new TrackGenerator(scene, trackManager, 'seed')).not.toThrow();
    });

    it('works without a seed (uses timestamp)', () => {
      expect(() => new TrackGenerator(scene, trackManager)).not.toThrow();
    });
  });

  describe('generateTracks()', () => {
    it('throws when no startPoint/startAngle and no previous track', () => {
      expect(() => generator.generateTracks({ sections: 3 })).toThrow('Must provide startPoint and startAngle');
    });

    it('generates the correct number of straight track sections', () => {
      const Phaser = require('phaser');
      const tracks = generator.generateTracks({
        startPoint: new Phaser.Math.Vector2(0, 0),
        startAngle: 0,
        sections: 5,
        curveProbability: 0, // force straight
      });
      expect(tracks).toHaveLength(5);
    });

    it('adds all generated tracks to the TrackManager', () => {
      const Phaser = require('phaser');
      generator.generateTracks({
        startPoint: new Phaser.Math.Vector2(0, 0),
        startAngle: 0,
        sections: 3,
        curveProbability: 0,
      });
      expect(trackManager.tracks).toHaveLength(3);
    });

    it('returns RailTrack instances', () => {
      const Phaser = require('phaser');
      const tracks = generator.generateTracks({
        startPoint: new Phaser.Math.Vector2(0, 0),
        startAngle: 0,
        sections: 2,
      });
      tracks.forEach((t) => expect(t instanceof RailTrack).toBe(true));
    });

    it('generates curved sections when curveProbability=1', () => {
      const Phaser = require('phaser');
      // Deterministic: all sections will be curved
      const tracks = generator.generateTracks({
        startPoint: new Phaser.Math.Vector2(0, 0),
        startAngle: 0,
        sections: 4,
        curveProbability: 1,
        minCurveAngle: 20,
        maxCurveAngle: 30,
      });
      expect(tracks).toHaveLength(4);
    });

    it('generates 1 section correctly', () => {
      const Phaser = require('phaser');
      const tracks = generator.generateTracks({
        startPoint: new Phaser.Math.Vector2(100, 200),
        startAngle: Math.PI / 4,
        sections: 1,
      });
      expect(tracks).toHaveLength(1);
    });

    it('continues from previous track when no startPoint given', () => {
      const Phaser = require('phaser');
      // First generate a track to set lastTrack
      generator.generateTracks({
        startPoint: new Phaser.Math.Vector2(0, 0),
        startAngle: 0,
        sections: 2,
        curveProbability: 0,
      });
      // Now continue without startPoint/startAngle
      const tracks = generator.generateTracks({ sections: 2, curveProbability: 0 });
      expect(tracks).toHaveLength(2);
    });

    it('accepts custom minLength and maxLength', () => {
      const Phaser = require('phaser');
      expect(() => generator.generateTracks({
        startPoint: new Phaser.Math.Vector2(0, 0),
        startAngle: 0,
        sections: 3,
        minLength: 50,
        maxLength: 100,
        curveProbability: 0,
      })).not.toThrow();
    });
  });

  describe('continueFromTrack()', () => {
    it('continues track generation from the end of a given track', () => {
      const Phaser = require('phaser');
      // Create a RailTrack to continue from
      const p0 = new Phaser.Math.Vector2(0, 0);
      const p1 = new Phaser.Math.Vector2(50, 0);
      const p2 = new Phaser.Math.Vector2(100, 0);
      const p3 = new Phaser.Math.Vector2(150, 0);
      const startTrack = new RailTrack(scene, p0, p1, p2, p3);

      const tracks = generator.continueFromTrack(startTrack, 3, { curveProbability: 0 });
      expect(tracks).toHaveLength(3);
    });

    it('does not throw with default params', () => {
      const Phaser = require('phaser');
      const p0 = new Phaser.Math.Vector2(0, 0);
      const p3 = new Phaser.Math.Vector2(100, 0);
      const track = new RailTrack(scene, p0, p0, p3, p3);
      expect(() => generator.continueFromTrack(track, 2)).not.toThrow();
    });
  });
});
