/**
 * Comprehensive manual mock for the 'phaser' module.
 * Provides enough of the Phaser API surface for unit and integration tests
 * to exercise game logic without a real browser environment.
 */

'use strict';

// ---------------------------------------------------------------------------
// Math.Vector2
// ---------------------------------------------------------------------------
class Vector2 {
  constructor(x = 0, y = 0) {
    // Handle being constructed with a Vector2-like object
    if (x !== null && typeof x === 'object' && 'x' in x) {
      this.x = x.x;
      this.y = x.y !== undefined ? x.y : 0;
    } else {
      this.x = typeof x === 'number' ? x : 0;
      this.y = typeof y === 'number' ? y : 0;
    }
  }
  copy(v) { this.x = v.x; this.y = v.y; return this; }
  subtract(v) { this.x -= v.x; this.y -= v.y; return this; }
  add(v) { this.x += v.x; this.y += v.y; return this; }
  scale(s) { this.x *= s; this.y *= s; return this; }
  length() { return Math.sqrt(this.x * this.x + this.y * this.y); }
  normalize() {
    const len = this.length();
    if (len > 0) { this.x /= len; this.y /= len; }
    return this;
  }
  clone() { return new Vector2(this.x, this.y); }
  distance(v) {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  dot(v) { return this.x * v.x + this.y * v.y; }
}

// ---------------------------------------------------------------------------
// Curves.Path – simplified linear path for testing
// ---------------------------------------------------------------------------
class CurvePath {
  constructor(x = 0, y = 0) {
    this._start = new Vector2(x, y);
    this._end = new Vector2(x, y);
  }
  splineTo(points) {
    if (points && points.length > 0) {
      const last = points[points.length - 1];
      this._end = new Vector2(last.x, last.y);
    }
    return this;
  }
  getLength() {
    const dx = this._end.x - this._start.x;
    const dy = this._end.y - this._start.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  getPoint(t) {
    return new Vector2(
      this._start.x + (this._end.x - this._start.x) * t,
      this._start.y + (this._end.y - this._start.y) * t,
    );
  }
  getTangent(_t) {
    const dx = this._end.x - this._start.x;
    const dy = this._end.y - this._start.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return new Vector2(dx / len, dy / len);
  }
  getStartPoint() { return new Vector2(this._start.x, this._start.y); }
  getEndPoint() { return new Vector2(this._end.x, this._end.y); }
}

// ---------------------------------------------------------------------------
// Matter body stub
// ---------------------------------------------------------------------------
function makeMatterBody(x = 0, y = 0) {
  return {
    position: { x, y },
    mass: 1000,
    force: { x: 0, y: 0 },
    isStatic: false,
    friction: 0,
    restitution: 0,
    angle: 0,
  };
}

// ---------------------------------------------------------------------------
// Base GameObject
// ---------------------------------------------------------------------------
class GameObject {
  constructor(scene, x = 0, y = 0) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.rotation = 0;
    this.angle = 0;
    this._depth = 0;
    this._alpha = 1;
    this._active = true;
  }
  setDepth(d) { this._depth = d; return this; }
  setOrigin() { return this; }
  setAlpha(a) { this._alpha = a; return this; }
  setScale(x, _y) {
    this.displayWidth = (x || 1) * 100;
    this.displayHeight = (_y !== undefined ? _y : x || 1) * 50;
    return this;
  }
  setInteractive() { return this; }
  on() { return this; }
  destroy() { this._active = false; }
}

// ---------------------------------------------------------------------------
// GameObjects.Container
// ---------------------------------------------------------------------------
class Container extends GameObject {
  constructor(scene, x = 0, y = 0) {
    super(scene, x, y);
    this._children = [];
    this.displayWidth = 100;
    this.displayHeight = 50;
  }
  add(child) {
    if (Array.isArray(child)) this._children.push(...child);
    else this._children.push(child);
    return this;
  }
  remove(child, destroy = false) {
    if (Array.isArray(child)) {
      if (destroy) child.forEach((c) => c && c.destroy && c.destroy());
      this._children = this._children.filter((c) => !child.includes(c));
    } else {
      if (destroy && child && child.destroy) child.destroy();
      this._children = this._children.filter((c) => c !== child);
    }
    return this;
  }
  setSize(w, h) { this.displayWidth = w; this.displayHeight = h; return this; }
  setPosition(x, y) { this.x = x; this.y = y; return this; }
  getBounds() {
    return { x: this.x - 50, y: this.y - 25, width: 100, height: 50, left: this.x - 50, right: this.x + 50, top: this.y - 25, bottom: this.y + 25 };
  }
}

// ---------------------------------------------------------------------------
// GameObjects.Image
// ---------------------------------------------------------------------------
class Image extends GameObject {
  constructor(scene, x, y, key) {
    super(scene, x, y);
    this._key = key;
    this.displayWidth = 100;
    this.displayHeight = 50;
  }
  setOrigin() { return this; }
  setDepth(d) { this._depth = d; return this; }
}

// ---------------------------------------------------------------------------
// GameObjects.Sprite
// ---------------------------------------------------------------------------
class Sprite extends GameObject {
  constructor(scene, x, y, key) {
    super(scene, x, y);
    this._key = key;
    this.displayWidth = 100;
    this.displayHeight = 50;
    this.body = makeMatterBody(x, y);
  }
  setTexture(key) { this._key = key; return this; }
  setTint() { return this; }
  clearTint() { return this; }
  setMass(m) { this.body.mass = m; return this; }
  setFrictionAir() { return this; }
  setAngle(a) { this.angle = a; this.rotation = a * (Math.PI / 180); return this; }
  setExistingBody(body) { this.body = body; return this; }
  setScale(x, y) {
    this.displayWidth = (x || 1) * 100;
    this.displayHeight = (y !== undefined ? y : x || 1) * 50;
    return this;
  }
  setPosition(x, y) {
    this.x = x;
    this.y = y;
    if (this.body && this.body.position) {
      this.body.position.x = x;
      this.body.position.y = y;
    }
    return this;
  }
  setVelocity(x, y) {
    this._velocity = { x, y };
    return this;
  }
  setAngularVelocity(v) {
    this._angularVelocity = v;
    return this;
  }
}

// ---------------------------------------------------------------------------
// Physics.Matter.Image (extends Sprite, gains a scene reference)
// ---------------------------------------------------------------------------
class MatterImage extends Sprite {
  constructor(scene, x, y, key) {
    super(scene, x, y, key);
    this.parentTrain = undefined;
  }
}

// ---------------------------------------------------------------------------
// GameObjects.Arc (circle)
// ---------------------------------------------------------------------------
class Arc extends Container {
  constructor(scene, x, y, radius, color, alpha) {
    super(scene, x, y);
    this.radius = radius;
    this._color = color;
    this._alpha = alpha;
    this._listeners = {};
  }
  setStrokeStyle() { return this; }
  setInteractive() { return this; }
  on(event, cb) { this._listeners[event] = cb; return this; }
}

// ---------------------------------------------------------------------------
// GameObjects.Text
// ---------------------------------------------------------------------------
class Text extends Container {
  constructor(scene, x, y, content, style) {
    super(scene, x, y);
    this._text = Array.isArray(content) ? content.join('\n') : String(content);
    this._style = style;
  }
  setText(t) { this._text = String(t); return this; }
  setOrigin() { return this; }
}

// ---------------------------------------------------------------------------
// GameObjects.Graphics
// ---------------------------------------------------------------------------
class Graphics extends GameObject {
  constructor(scene) {
    super(scene, 0, 0);
  }
  setDepth(d) { this._depth = d; return this; }
  lineStyle() { return this; }
  fillStyle() { return this; }
  beginPath() { return this; }
  moveTo() { return this; }
  lineTo() { return this; }
  strokePath() { return this; }
  fillPath() { return this; }
  fillCircle() { return this; }
  fillRect() { return this; }
  strokeRect() { return this; }
  clear() { return this; }
}

// ---------------------------------------------------------------------------
// Geom.Rectangle
// ---------------------------------------------------------------------------
class Rectangle {
  constructor(x, y, width, height) {
    this.x = x; this.y = y; this.width = width; this.height = height;
    this.left = x; this.right = x + width;
    this.top = y; this.bottom = y + height;
  }
  setTo(x, y, w, h) {
    this.x = x; this.y = y; this.width = w; this.height = h;
    this.left = x; this.right = x + w;
    this.top = y; this.bottom = y + h;
    return this;
  }
  contains(px, py) {
    return px >= this.left && px <= this.right && py >= this.top && py <= this.bottom;
  }
  static Overlaps(a, b) {
    return !(b.left > a.right || b.right < a.left || b.top > a.bottom || b.bottom < a.top);
  }
}

// ---------------------------------------------------------------------------
// Scene factory – creates a fully cross-referenced scene mock
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Fluent game-object stub – suitable for add.rectangle / add.container returns
// ---------------------------------------------------------------------------
function makeFluentStub() {
  const stub = {
    setStrokeStyle: jest.fn().mockReturnThis(),
    setDepth: jest.fn().mockReturnThis(),
    setScrollFactor: jest.fn().mockReturnThis(),
    setInteractive: jest.fn().mockReturnThis(),
    setVisible: jest.fn().mockReturnThis(),
    setAlpha: jest.fn().mockReturnThis(),
    setFillStyle: jest.fn().mockReturnThis(),
    setOrigin: jest.fn().mockReturnThis(),
    setText: jest.fn().mockReturnThis(),
    setColor: jest.fn().mockReturnThis(),
    on: jest.fn().mockReturnThis(),
    off: jest.fn().mockReturnThis(),
    add: jest.fn().mockReturnThis(),
    destroy: jest.fn(),
    _children: [],
  };
  return stub;
}

function makeScene(overrides = {}) {
  const scene = {};

  const arc = { setInteractive: jest.fn().mockReturnThis(), on: jest.fn().mockReturnThis(), setStrokeStyle: jest.fn().mockReturnThis(), _alpha: 0.5 };
  const text = { setOrigin: jest.fn().mockReturnThis(), setText: jest.fn().mockReturnThis() };
  const image = { setOrigin: jest.fn().mockReturnThis(), setScale: jest.fn().mockReturnThis(), setDepth: jest.fn().mockReturnThis(), rotation: 0 };
  const graphics = new Graphics(scene);
  graphics.setDepth = jest.fn().mockReturnThis();
  const mockBody = makeMatterBody();

  // MatterImage with scene reference so matterScaling works
  const matterImage = new MatterImage(scene, 0, 0, '');

  Object.assign(scene, {
    add: {
      existing: jest.fn(),
      image: jest.fn().mockReturnValue(image),
      circle: jest.fn().mockReturnValue(arc),
      text: jest.fn().mockReturnValue(makeFluentStub()),
      graphics: jest.fn().mockReturnValue(graphics),
      rectangle: jest.fn().mockImplementation(() => makeFluentStub()),
      container: jest.fn().mockImplementation(() => makeFluentStub()),
    },
    matter: {
      add: {
        image: jest.fn().mockImplementation((x, y, key) => {
          const img = new MatterImage(scene, x || 0, y || 0, key || '');
          return img;
        }),
      },
      bodies: {
        rectangle: jest.fn().mockImplementation(() => makeMatterBody()),
      },
      world: {
        remove: jest.fn(),
        get scene() { return scene; }, // lazy getter to avoid circular issues
      },
    },
    cameras: {
      main: {
        scrollX: 0, scrollY: 0, zoom: 1, width: 1920, height: 1080,
    getWorldPoint: jest.fn((x, y) => new Vector2(x, y)),
        startFollow: jest.fn(),
        stopFollow: jest.fn(),
      },
    },
    scale: { width: 1920, height: 1080 },
    input: {
      keyboard: {
        addKey: jest.fn().mockReturnValue({ isDown: false }),
        createCursorKeys: jest.fn().mockReturnValue({}),
        on: jest.fn(),
      },
      on: jest.fn(),
      setDraggable: jest.fn(),
      addPointer: jest.fn(),
    },
    events: {
      once: jest.fn(),
      on: jest.fn(),
      emit: jest.fn(),
    },
    tweens: {
      add: jest.fn(),
    },
    sound: {
      volume: 1,
      mute: false,
      add: jest.fn().mockReturnValue({ play: jest.fn(), stop: jest.fn() }),
      play: jest.fn(),
    },
    cache: { audio: { exists: jest.fn().mockReturnValue(false) } },
    ...overrides,
  });

  return scene;
}

// ---------------------------------------------------------------------------
// RandomDataGenerator
// ---------------------------------------------------------------------------
class RandomDataGenerator {
  constructor(seeds) {
    this._seed = seeds ? seeds[0] : '0';
    this._state = 42;
  }
  frac() {
    this._state = (this._state * 16807 + 1) % 2147483647;
    return (this._state - 1) / 2147483646;
  }
  between(min, max) {
    return Math.floor(this.frac() * (max - min + 1)) + min;
  }
}

// ---------------------------------------------------------------------------
// Phaser namespace export
// ---------------------------------------------------------------------------
const Phaser = {
  Math: {
    Vector2,
    RadToDeg: (rad) => rad * (180 / Math.PI),
    DegToRad: (deg) => deg * (Math.PI / 180),
    Clamp: (val, min, max) => Math.max(min, Math.min(max, val)),
    Distance: {
      Between: (x1, y1, x2, y2) => Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2),
    },
    Angle: {
      BetweenPoints: (p1, p2) => Math.atan2(p2.y - p1.y, p2.x - p1.x),
    },
    RND: {
      between: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
    },
    RandomDataGenerator,
  },
  GameObjects: {
    Container,
    GameObject,
    Image,
    Sprite,
    Arc,
    Text,
    Graphics,
  },
  Physics: {
    Matter: {
      Image: MatterImage,
    },
  },
  Curves: {
    Path: CurvePath,
  },
  Geom: {
    Rectangle,
  },
  Input: {
    Keyboard: {
      KeyCodes: { Q: 81, E: 69 },
    },
    Pointer: class Pointer {
      constructor() { this.x = 0; this.y = 0; this.button = 0; }
      middleButtonDown() { return false; }
    },
  },
  Cameras: {
    Controls: {
      SmoothedKeyControl: class SmoothedKeyControl {
        constructor() {}
        update() {}
      },
    },
  },
  Scenes: {
    Events: {
      SHUTDOWN: 'shutdown',
    },
  },
  Scale: {
    FIT: 'FIT',
    RESIZE: 'RESIZE',
    CENTER_BOTH: 'CENTER_BOTH',
  },
  Scene: class Scene {
    constructor() {
      Object.assign(this, makeScene());
    }
  },
};

module.exports = Phaser;
module.exports.default = Phaser;
module.exports.makeScene = makeScene;
module.exports.makeMatterBody = makeMatterBody;
module.exports.CurvePath = CurvePath;
module.exports.Vector2 = Vector2;
module.exports.MatterImage = MatterImage;
module.exports.Container = Container;
module.exports.Sprite = Sprite;
