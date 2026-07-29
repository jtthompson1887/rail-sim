import Phaser from 'phaser';
import RailTrack from '../../src/entities/RailTrack';

const { makeScene } = require('../../__mocks__/phaser');

describe('RailTrackRenderer mixed engineering structures', () => {
  it('supports tunnel styling with the default Phaser scene image stub', () => {
    const scene = makeScene();
    const track = new RailTrack(
      scene,
      new Phaser.Math.Vector2(0, 0),
      new Phaser.Math.Vector2(133.333333, 0),
      new Phaser.Math.Vector2(266.666667, 0),
      new Phaser.Math.Vector2(400, 0),
    );

    expect(() => track.setConstructionData(
      {
        profileVersion: 1,
        knots: [{ t: 0, elevation: 0 }, { t: 1, elevation: 0 }],
      },
      [
        {
          type: 'tunnel',
          startT: 0,
          endT: 1,
          startElevation: 0,
          endElevation: 0,
        },
      ],
      1234,
    )).not.toThrow();
  });

  it('keeps photographic track textures narrow across the route', () => {
    const scene = makeScene();
    const images: any[] = [];
    scene.add.image.mockImplementation((_x: number, _y: number, texture: string) => {
      const image: any = {
        texture,
        rotation: 0,
        setOrigin: jest.fn(() => image),
        setScale: jest.fn(() => image),
        setDepth: jest.fn(() => image),
        setAlpha: jest.fn(() => image),
        setTint: jest.fn(() => image),
        destroy: jest.fn(),
      };
      images.push(image);
      return image;
    });

    new RailTrack(
      scene,
      new Phaser.Math.Vector2(0, 0),
      new Phaser.Math.Vector2(133.333333, 0),
      new Phaser.Math.Vector2(266.666667, 0),
      new Phaser.Math.Vector2(400, 0),
    );

    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      const [alongTrackScale, acrossTrackScale] = image.setScale.mock.calls[0];
      expect(alongTrackScale).toBe(0.05);
      expect(acrossTrackScale).toBeGreaterThan(0);
      expect(acrossTrackScale).toBeLessThanOrEqual(alongTrackScale * 0.5);
    }
  });

  it('styles only sprites whose own t lies in a tunnel interval', () => {
    const scene = makeScene();
    const images: any[] = [];
    scene.add.image.mockImplementation((x: number, y: number, texture: string) => {
      const image: any = {
        x,
        y,
        texture,
        alpha: 1,
        tint: null,
        rotation: 0,
        setOrigin: jest.fn(() => image),
        setScale: jest.fn(() => image),
        setDepth: jest.fn(() => image),
        setAlpha: jest.fn((alpha: number) => {
          image.alpha = alpha;
          return image;
        }),
        setTint: jest.fn((tint: number) => {
          image.tint = tint;
          return image;
        }),
        destroy: jest.fn(),
      };
      images.push(image);
      return image;
    });
    const track = new RailTrack(
      scene,
      new Phaser.Math.Vector2(0, 0),
      new Phaser.Math.Vector2(133.333333, 0),
      new Phaser.Math.Vector2(266.666667, 0),
      new Phaser.Math.Vector2(400, 0),
    );
    images.length = 0;

    track.setConstructionData(
      {
        profileVersion: 1,
        knots: [{ t: 0, elevation: 0 }, { t: 1, elevation: 0 }],
      },
      [
        {
          type: 'surface',
          startT: 0,
          endT: 0.5,
          startElevation: 0,
          endElevation: 0,
        },
        {
          type: 'tunnel',
          startT: 0.5,
          endT: 1,
          startElevation: 0,
          endElevation: 0,
        },
      ],
      1234,
    );

    const surfaceImages = images.filter((image) => image.x < 200);
    const tunnelImages = images.filter((image) => image.x >= 200);
    expect(surfaceImages.length).toBeGreaterThan(0);
    expect(tunnelImages.length).toBeGreaterThan(0);
    expect(surfaceImages.every((image) => image.alpha === 1 && image.tint === null)).toBe(true);
    expect(tunnelImages.every(
      (image) => image.alpha === 0.45 && image.tint === 0x334455,
    )).toBe(true);
  });
});
