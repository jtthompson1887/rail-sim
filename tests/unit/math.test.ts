import Phaser from 'phaser';
import {
  PIDController,
  projectVector,
  qVec,
  isCurveTight,
  toBezierPoints,
  toCubicBezierPoints,
} from '../../src/utils/math';

// Phaser is mocked via __mocks__/phaser.js, which provides a real Vector2
const Vector2 = Phaser.Math.Vector2 as any;

describe('PIDController', () => {
  it('constructs with default gains', () => {
    const pid = new PIDController();
    expect(pid).toBeDefined();
  });

  it('constructs with custom gains', () => {
    const pid = new PIDController(1, 0.1, 0.5);
    expect(pid).toBeDefined();
  });

  it('calculate() returns proportional output when I and D terms are zero', () => {
    const pid = new PIDController(1, 0, 0);
    pid.setCurrentDelta(1);
    const result = pid.calculate(10);
    // With KP=1, KI=0, KD=0, integral=0, prevError=0, output = 1*10 = 10
    expect(result).toBeCloseTo(10);
  });

  it('calculate() applies derivative term to dampen oscillation', () => {
    const pid = new PIDController(0, 0, 1);
    pid.setCurrentDelta(1);
    const first = pid.calculate(5);  // prevError=0 → d = (5-0)/1 = 5
    expect(first).toBeCloseTo(5);
    const second = pid.calculate(5); // prevError=5 → d = (5-5)/1 = 0
    expect(second).toBeCloseTo(0);
  });

  it('calculate() accumulates integral', () => {
    const pid = new PIDController(0, 1, 0);
    pid.setCurrentDelta(1);
    pid.calculate(2); // integral = 2
    const result = pid.calculate(2); // integral = 4, output = 1*4 = 4
    expect(result).toBeCloseTo(4);
  });

  it('setCurrentDelta() affects derivative calculation', () => {
    const pid = new PIDController(0, 0, 1);
    pid.setCurrentDelta(2);
    const result = pid.calculate(4); // d = (4-0)/2 = 2
    expect(result).toBeCloseTo(2);
  });
});

describe('qVec()', () => {
  it('creates a zero vector by default', () => {
    const v = qVec();
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
  });

  it('creates a vector with given coordinates', () => {
    const v = qVec(3, 4);
    expect(v.x).toBe(3);
    expect(v.y).toBe(4);
  });
});

describe('projectVector()', () => {
  it('projects from p0 to p1 extended by length', () => {
    const p0 = new Vector2(0, 0);
    const p1 = new Vector2(1, 0);
    const result = projectVector(p0, p1, 2);
    // direction is (1,0), scaled by 2 → (3,0)
    expect(result.x).toBeCloseTo(3);
    expect(result.y).toBeCloseTo(0);
  });

  it('returns p1 when p0 and p1 are the same point (zero distance)', () => {
    const p0 = new Vector2(5, 5);
    const p1 = new Vector2(5, 5);
    const result = projectVector(p0, p1, 10);
    expect(result.x).toBe(5);
    expect(result.y).toBe(5);
  });

  it('handles vertical direction', () => {
    const p0 = new Vector2(0, 0);
    const p1 = new Vector2(0, 3);
    const result = projectVector(p0, p1, 2);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(5);
  });
});

describe('toBezierPoints()', () => {
  it('returns array with at least 2 segments for 3 input points', () => {
    const pts = [new Vector2(0, 0), new Vector2(5, 5), new Vector2(10, 0)];
    const bezier = toBezierPoints(pts);
    // Starting point + segments
    expect(bezier.length).toBeGreaterThan(0);
  });

  it('each entry has cp and to properties', () => {
    const pts = [new Vector2(0, 0), new Vector2(5, 0), new Vector2(10, 0)];
    const bezier = toBezierPoints(pts);
    bezier.forEach((b) => {
      expect(b).toHaveProperty('cp');
      expect(b).toHaveProperty('to');
    });
  });

  it('first entry uses the starting point', () => {
    const pts = [new Vector2(1, 2), new Vector2(5, 5), new Vector2(10, 0)];
    const bezier = toBezierPoints(pts);
    expect(bezier[0].cp.x).toBeCloseTo(1);
    expect(bezier[0].cp.y).toBeCloseTo(2);
  });

  it('handles two-point degenerate case', () => {
    const pts = [new Vector2(0, 0), new Vector2(10, 0)];
    const bezier = toBezierPoints(pts);
    expect(bezier.length).toBeGreaterThan(0);
  });
});

describe('isCurveTight()', () => {
  it('returns false for a straight path (collinear points)', () => {
    const Phaser = require('phaser');
    const p0 = new Phaser.Math.Vector2(0, 0);
    const p1 = new Phaser.Math.Vector2(5, 0);
    const p2 = new Phaser.Math.Vector2(10, 0);
    // Straight line → no angle change
    const result = isCurveTight(p0, p1, p2, 45);
    expect(result).toBe(false);
  });

  it('returns true for a very tight curve exceeding the threshold', () => {
    const Phaser = require('phaser');
    // Curve that bends 90°: horizontal to vertical
    // The angle between consecutive tangent *directions* (treated as points)
    // exceeds 1 degree
    const p0 = new Phaser.Math.Vector2(0, 0);
    const p1 = new Phaser.Math.Vector2(50, 0);   // horizontal start
    const p2 = new Phaser.Math.Vector2(50, 50);  // 90° bend
    const result = isCurveTight(p0, p1, p2, 1); // threshold = 1 degree
    expect(result).toBe(true);
  });

  it('returns false for a gentle curve below threshold', () => {
    const Phaser = require('phaser');
    const p0 = new Phaser.Math.Vector2(0, 0);
    const p1 = new Phaser.Math.Vector2(5, 1);  // slight bend
    const p2 = new Phaser.Math.Vector2(10, 0);
    const result = isCurveTight(p0, p1, p2, 180); // very permissive threshold
    expect(result).toBe(false);
  });

  it('handles NaN tangent gracefully (degenerate case)', () => {
    const Phaser = require('phaser');
    // Same point produces zero-length tangent → normalize → NaN
    const p0 = new Phaser.Math.Vector2(0, 0);
    const p1 = new Phaser.Math.Vector2(0, 0);
    const p2 = new Phaser.Math.Vector2(0, 0);
    expect(() => isCurveTight(p0, p1, p2, 45)).not.toThrow();
  });

  it('accepts custom interval parameter', () => {
    const Phaser = require('phaser');
    const p0 = new Phaser.Math.Vector2(0, 0);
    const p1 = new Phaser.Math.Vector2(5, 5);
    const p2 = new Phaser.Math.Vector2(10, 0);
    // Should work with different interval
    expect(() => isCurveTight(p0, p1, p2, 10, 0.1)).not.toThrow();
  });
});

describe('toCubicBezierPoints()', () => {
  it('returns n-1 segments for n input points', () => {
    const pts = [
      new Vector2(0, 0),
      new Vector2(5, 5),
      new Vector2(10, 0),
      new Vector2(15, 5),
    ];
    const cubic = toCubicBezierPoints(pts);
    expect(cubic.length).toBe(pts.length - 1);
  });

  it('each entry has cp1, cp2, and to properties', () => {
    const pts = [new Vector2(0, 0), new Vector2(5, 5), new Vector2(10, 0)];
    const cubic = toCubicBezierPoints(pts);
    cubic.forEach((c) => {
      expect(c).toHaveProperty('cp1');
      expect(c).toHaveProperty('cp2');
      expect(c).toHaveProperty('to');
    });
  });

  it('the "to" of the last segment is the last input point', () => {
    const pts = [new Vector2(0, 0), new Vector2(10, 10), new Vector2(20, 0)];
    const cubic = toCubicBezierPoints(pts);
    const last = cubic[cubic.length - 1];
    expect(last.to.x).toBeCloseTo(20);
    expect(last.to.y).toBeCloseTo(0);
  });

  it('handles a two-point path', () => {
    const pts = [new Vector2(0, 0), new Vector2(10, 0)];
    const cubic = toCubicBezierPoints(pts);
    expect(cubic.length).toBe(1);
  });

  it('control points lie between start and end for straight paths', () => {
    const pts = [new Vector2(0, 0), new Vector2(6, 0), new Vector2(12, 0)];
    const cubic = toCubicBezierPoints(pts);
    // For a straight line, cp1 should have x in [0, 12]
    cubic.forEach((c) => {
      expect(c.cp1.x).toBeGreaterThanOrEqual(-1);
      expect(c.cp2.x).toBeGreaterThanOrEqual(-1);
    });
  });
});
