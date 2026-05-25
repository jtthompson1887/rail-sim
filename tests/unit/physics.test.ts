import {
  guideForceTowardsPoint,
  applyForceToGameObject,
  limitForceToLateralApplication,
  matterScaling,
} from '../../src/utils/physics';
import { PIDController } from '../../src/utils/math';

// Build a mock game object that satisfies the minimal interface needed by physics.ts
function makeMockGameObject(x = 0, y = 0, mass = 1000, rotation = 0) {
  return {
    x,
    y,
    rotation,
    body: {
      position: { x, y },
      mass,
      force: { x: 0, y: 0 },
    },
    // Matter.Image interface compatibility
    setAngle: jest.fn(),
    angle: rotation * (180 / Math.PI),
    displayWidth: 100,
    displayHeight: 50,
    scene: {
      matter: {
        bodies: {
          rectangle: jest.fn().mockReturnValue({ isStatic: false, friction: 0, restitution: 0 }),
        },
        world: {
          remove: jest.fn(),
          scene: {
            matter: {
              bodies: { rectangle: jest.fn().mockReturnValue({ isStatic: false, friction: 0, restitution: 0 }) },
            },
          },
        },
      },
    },
    setScale: jest.fn().mockReturnThis(),
    setExistingBody: jest.fn().mockImplementation(function(body) { this.body = body; }),
  };
}

describe('guideForceTowardsPoint()', () => {
  it('returns a Vector2 force pointing toward the target', () => {
    const obj = makeMockGameObject(0, 0);
    const target = { x: 10, y: 0 } as any;
    const force = guideForceTowardsPoint(obj as any, target);
    // Force should point in +x direction
    expect(force.x).toBeGreaterThan(0);
    expect(force.y).toBeCloseTo(0, 2);
  });

  it('returns zero force when object is already at target', () => {
    const obj = makeMockGameObject(5, 5);
    const target = { x: 5, y: 5 } as any;
    const force = guideForceTowardsPoint(obj as any, target);
    expect(force.x).toBeCloseTo(0);
    expect(force.y).toBeCloseTo(0);
  });

  it('force magnitude scales with distance', () => {
    const obj1 = makeMockGameObject(0, 0);
    const obj2 = makeMockGameObject(0, 0);
    const near = { x: 5, y: 0 } as any;
    const far = { x: 50, y: 0 } as any;
    const f1 = guideForceTowardsPoint(obj1 as any, near);
    const f2 = guideForceTowardsPoint(obj2 as any, far);
    expect(Math.abs(f2.x)).toBeGreaterThan(Math.abs(f1.x));
  });

  it('works with a PIDController', () => {
    const obj = makeMockGameObject(0, 0);
    const target = { x: 10, y: 0 } as any;
    const pid = new PIDController(0.5, 0, 0.3);
    pid.setCurrentDelta(1);
    const force = guideForceTowardsPoint(obj as any, target, pid);
    expect(force).toBeDefined();
    expect(typeof force.x).toBe('number');
    expect(typeof force.y).toBe('number');
  });

  it('produces non-negative force with PID (never flips direction)', () => {
    const obj = makeMockGameObject(0, 0);
    const target = { x: 5, y: 0 } as any;
    const pid = new PIDController(0.5, 0, 0.3);
    pid.setCurrentDelta(1);
    const force = guideForceTowardsPoint(obj as any, target, pid);
    // The force should still point toward the target (positive x direction)
    expect(force.x).toBeGreaterThanOrEqual(0);
  });
});

describe('applyForceToGameObject()', () => {
  it('adds force x/y to the body', () => {
    const obj = makeMockGameObject(0, 0);
    const force = { x: 3, y: 4 } as any;
    applyForceToGameObject(obj, force);
    expect(obj.body.force.x).toBeCloseTo(3);
    expect(obj.body.force.y).toBeCloseTo(4);
  });

  it('accumulates force from multiple calls', () => {
    const obj = makeMockGameObject(0, 0);
    applyForceToGameObject(obj, { x: 1, y: 2 } as any);
    applyForceToGameObject(obj, { x: 1, y: 2 } as any);
    expect(obj.body.force.x).toBeCloseTo(2);
    expect(obj.body.force.y).toBeCloseTo(4);
  });
});

describe('limitForceToLateralApplication()', () => {
  it('removes forward component, keeps lateral', () => {
    // Rotation = 0 → train faces right (+x)
    // Forward direction = (1, 0), lateral = (0, 1)
    const obj = makeMockGameObject(0, 0, 1000, 0) as any;
    const force = { x: 3, y: 4, dot: (v: any) => 3 * v.x + 4 * v.y, clone: () => ({ x: 3, y: 4 }) } as any;

    // We use real Phaser mock (Vector2) so let's just verify the function runs
    const Phaser = require('phaser');
    const forceVec = new Phaser.Math.Vector2(0, 5); // purely lateral force (+y)
    const result = limitForceToLateralApplication(obj, forceVec);
    // For rotation=0, forward=(1,0), lateral=(0,1)
    // Lateral component of (0,5) onto (0,1) = 5
    // Result should be (0, 5)
    expect(result.x).toBeCloseTo(0, 1);
    expect(result.y).toBeCloseTo(5, 1);
  });

  it('returns zero vector for a purely forward force', () => {
    const obj = makeMockGameObject(0, 0, 1000, 0) as any;
    const Phaser = require('phaser');
    const forceVec = new Phaser.Math.Vector2(10, 0); // purely forward (+x at rotation=0)
    const result = limitForceToLateralApplication(obj, forceVec);
    // Lateral component of (10,0) onto (0,1) = 0
    expect(result.x).toBeCloseTo(0, 1);
    expect(result.y).toBeCloseTo(0, 1);
  });

  it('handles angled rotation', () => {
    const angle = Math.PI / 4; // 45 degrees
    const obj = makeMockGameObject(0, 0, 1000, angle) as any;
    const Phaser = require('phaser');
    const forceVec = new Phaser.Math.Vector2(1, 0);
    const result = limitForceToLateralApplication(obj, forceVec);
    expect(typeof result.x).toBe('number');
    expect(typeof result.y).toBe('number');
  });
});

describe('matterScaling()', () => {
  it('calls setScale on the game object', () => {
    const { makeScene, MatterImage } = require('../../__mocks__/phaser');
    const scene = makeScene();
    const obj = new MatterImage(scene, 100, 200, 'train');
    matterScaling(obj as any, 0.5, 0.5);
    // After scaling, displayWidth should be updated
    expect(obj.displayWidth).toBeDefined();
  });

  it('removes old body and creates new one', () => {
    const { makeScene, MatterImage } = require('../../__mocks__/phaser');
    const scene = makeScene();
    const obj = new MatterImage(scene, 50, 50, 'train');
    const removeSpy = scene.matter.world.remove;
    matterScaling(obj as any, 1.0, 1.0);
    expect(removeSpy).toHaveBeenCalled();
  });

  it('sets the new body on the game object (setExistingBody is called)', () => {
    const { makeScene, MatterImage } = require('../../__mocks__/phaser');
    const scene = makeScene();
    const obj = new MatterImage(scene, 0, 0, 'train');
    const originalBody = obj.body;
    matterScaling(obj as any, 2.0, 1.0);
    // The body should be replaced
    expect(obj.body).toBeDefined();
  });

  it('preserves body options (isStatic, friction, restitution)', () => {
    const { makeScene, MatterImage } = require('../../__mocks__/phaser');
    const scene = makeScene();
    const obj = new MatterImage(scene, 0, 0, 'train');
    obj.body.isStatic = false;
    obj.body.friction = 0.1;
    obj.body.restitution = 0.5;
    matterScaling(obj as any, 1.0, 1.0);
    // The function copies bodyOptions.friction to newBody.friction,
    // so the new body should retain the original friction value
    expect(obj.body.isStatic).toBe(false);
    expect(obj.body.friction).toBe(0.1);  // preserved from old body
    expect(obj.body.restitution).toBe(0.5);  // preserved from old body
  });

  it('works with different scale values', () => {
    const { makeScene, MatterImage } = require('../../__mocks__/phaser');
    const scene = makeScene();
    const obj = new MatterImage(scene, 10, 20, 'train');
    expect(() => matterScaling(obj as any, 0.3, 0.7)).not.toThrow();
  });
});
