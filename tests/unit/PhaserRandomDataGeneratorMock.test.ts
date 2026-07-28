import Phaser from 'phaser';

const RealRandomDataGenerator = require(
  '../../node_modules/phaser/src/math/random-data-generator/RandomDataGenerator',
);

describe('manual Phaser RandomDataGenerator mock', () => {
  it.each([
    'playtest-610',
    'playtest-636',
    'terrain-alpha',
    'mixed CASE seed 42',
  ])('matches Phaser 3.60 exactly for string seed %s', (seed) => {
    const mock = new Phaser.Math.RandomDataGenerator([seed]);
    const real = new RealRandomDataGenerator([seed]);

    expect(Array.from({ length: 8 }, () => mock.frac())).toEqual(
      Array.from({ length: 8 }, () => real.frac()),
    );

    const mockRange = new Phaser.Math.RandomDataGenerator([seed]);
    const realRange = new RealRandomDataGenerator([seed]);
    expect([
      mockRange.between(-17, 23),
      mockRange.between(0, 255),
      mockRange.between(4_000, 9_000),
    ]).toEqual([
      realRange.between(-17, 23),
      realRange.between(0, 255),
      realRange.between(4_000, 9_000),
    ]);
  });
});
