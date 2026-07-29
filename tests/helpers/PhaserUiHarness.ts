/**
 * Phaser UI test harness
 *
 * Provides UI-node stubs that remember the event handlers registered through
 * `.on(...)`, so unit tests can exercise pointer interactions without a real
 * Phaser renderer. Built on top of the existing `__mocks__/phaser` scene factory.
 */

const { makeScene } = require('../../__mocks__/phaser');

export interface UiNode {
  x: number;
  y: number;
  visible: boolean;
  alpha: number;
  width: number;
  height: number;
  text: string;
  color: string;
  fillStyle: any;
  fillAlpha: number;
  strokeStyle: any[];
  _children: UiNode[];
  handlers: Record<string, (...args: any[]) => any>;
  setStrokeStyle: jest.Mock;
  setDepth: jest.Mock;
  setScrollFactor: jest.Mock;
  setVisible: jest.Mock;
  setPosition: jest.Mock;
  setSize: jest.Mock;
  setOrigin: jest.Mock;
  setInteractive: jest.Mock;
  setFillStyle: jest.Mock;
  setAlpha: jest.Mock;
  setScale: jest.Mock;
  setText: jest.Mock;
  setColor: jest.Mock;
  setWordWrapWidth: jest.Mock;
  disableInteractive: jest.Mock;
  add: jest.Mock;
  on: jest.Mock;
  off: jest.Mock;
  destroy: jest.Mock;
  getBounds: () => { left: number; right: number; top: number; bottom: number };
  [key: string]: any;
}

export function uiNode(): UiNode {
  const node: any = {
    x: 0,
    y: 0,
    visible: true,
    alpha: 1,
    width: 0,
    height: 0,
    text: '',
    color: '',
    fillStyle: undefined,
    fillAlpha: 1,
    strokeStyle: [],
    _children: [],
    handlers: {},
    getBounds() {
      return {
        x: this.x - this.width / 2,
        y: this.y - this.height / 2,
        width: this.width,
        height: this.height,
        left: this.x - this.width / 2,
        right: this.x + this.width / 2,
        top: this.y - this.height / 2,
        bottom: this.y + this.height / 2,
      };
    },
  };

  node.setStrokeStyle = jest.fn((...args: any[]) => {
    node.strokeStyle = args;
    return node;
  });
  node.setDepth = jest.fn(() => node);
  node.setScrollFactor = jest.fn(() => node);
  node.setVisible = jest.fn((visible: boolean) => {
    node.visible = visible;
    return node;
  });
  node.setPosition = jest.fn((x: number, y: number) => {
    node.x = x;
    node.y = y;
    return node;
  });
  node.setSize = jest.fn((width: number, height: number) => {
    node.width = width;
    node.height = height;
    return node;
  });
  node.setOrigin = jest.fn(() => node);
  node.setInteractive = jest.fn(() => node);
  node.setFillStyle = jest.fn((fillStyle: any, fillAlpha?: number) => {
    node.fillStyle = fillStyle;
    if (fillAlpha !== undefined) node.fillAlpha = fillAlpha;
    return node;
  });
  node.setAlpha = jest.fn((alpha: number) => {
    node.alpha = alpha;
    return node;
  });
  node.setScale = jest.fn(() => node);
  node.setText = jest.fn((text: string) => {
    node.text = text;
    return node;
  });
  node.setColor = jest.fn((color: string) => {
    node.color = color;
    return node;
  });
  node.setWordWrapWidth = jest.fn((width: number) => {
    node.wordWrapWidth = width;
    return node;
  });
  node.disableInteractive = jest.fn(() => node);
  node.add = jest.fn((child: any) => {
    if (Array.isArray(child)) node._children.push(...child);
    else node._children.push(child);
    return node;
  });
  node.on = jest.fn((event: string, handler: (...args: any[]) => any) => {
    node.handlers[event] = handler;
    return node;
  });
  node.off = jest.fn((event: string, handler: (...args: any[]) => any) => {
    if (node.handlers[event] === handler) delete node.handlers[event];
    return node;
  });
  node.destroy = jest.fn(() => {
    node.visible = false;
  });

  return node as UiNode;
}

export interface UiScene {
  scene: any;
  rectangle: jest.Mock;
  text: jest.Mock;
  container: jest.Mock;
  graphics: jest.Mock;
  tweensAdd: jest.Mock;
  killTweensOf: jest.Mock;
}

export function makeUiScene(options: { width?: number; height?: number } = {}): UiScene {
  const scene = makeScene();
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;
  scene.scale = { width, height };

  const rectangle = jest.fn((x?: number, y?: number, width?: number, height?: number, fillColor?: any, fillAlpha?: number) => {
    const node = uiNode();
    if (x !== undefined) node.x = x;
    if (y !== undefined) node.y = y;
    if (width !== undefined) {
      node.width = width;
      node.height = height ?? width;
    }
    if (fillColor !== undefined) node.setFillStyle(fillColor, fillAlpha ?? 1);
    return node;
  });
  const text = jest.fn((x?: number, y?: number, content?: string, style?: any) => {
    const node = uiNode();
    if (x !== undefined) node.x = x;
    if (y !== undefined) node.y = y;
    if (content !== undefined) node.setText(content);
    if (style?.color) node.setColor(style.color);
    return node;
  });
  const container = jest.fn((x?: number, y?: number, children?: any) => {
    const node = uiNode();
    if (x !== undefined) node.x = x;
    if (y !== undefined) node.y = y;
    if (Array.isArray(children)) node.add(children);
    return node;
  });
  const graphics = jest.fn(() => uiNode());

  scene.add.rectangle = rectangle;
  scene.add.text = text;
  scene.add.container = container;
  scene.add.graphics = graphics;

  const tweensAdd = jest.fn();
  const killTweensOf = jest.fn();
  scene.tweens = { add: tweensAdd, killTweensOf };

  return { scene, rectangle, text, container, graphics, tweensAdd, killTweensOf };
}

export function findHandler(node: UiNode, event: string): ((...args: any[]) => any) | undefined {
  return node.handlers[event];
}

export function simulatePointer(node: UiNode, event: string, ...args: any[]): void {
  const handler = findHandler(node, event);
  if (handler) handler(...args);
}
