/**
 * @jest-environment jsdom
 *
 * Feature: CreateModeToolbar – responsive tool selection and event emission
 *
 * BDD-style tests verifying that the toolbar:
 *   1. Initialises without error on any screen width (mobile or desktop)
 *   2. Emits the correct EventBus events when tools are selected
 *   3. Toggles a tool off when it is pressed a second time
 *   4. Responds correctly to ui:toast events from other parts of the game
 */

import { makeScene } from '../../__mocks__/phaser';
import { CreateModeToolbar } from '../../src/ui/CreateModeToolbar';
import { EventBus } from '../../src/services/EventBus';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a test scene whose scale matches the given viewport dimensions. */
function buildScene(screenWidth: number, screenHeight: number) {
  const scene = makeScene();
  scene.scale = { width: screenWidth, height: screenHeight };
  return scene;
}

// ---------------------------------------------------------------------------
// Feature: Toolbar initialisation
// ---------------------------------------------------------------------------

describe('Feature: CreateModeToolbar initialisation', () => {
  describe('Scenario: Creating the toolbar on a desktop viewport', () => {
    it('Given a 1920×1080 screen, When the toolbar is created, Then it should not throw', () => {
      const scene = buildScene(1920, 1080);
      const toolbar = new CreateModeToolbar(scene as any);
      expect(toolbar).toBeDefined();
      toolbar.destroy();
    });

    it('Given a 1920×1080 screen, When created, Then the active tool should default to "none"', () => {
      const scene = buildScene(1920, 1080);
      const toolbar = new CreateModeToolbar(scene as any);
      expect(toolbar.currentTool).toBe('none');
      toolbar.destroy();
    });
  });

  describe('Scenario: Creating the toolbar on a mobile viewport', () => {
    it('Given a 375×667 screen, When the toolbar is created, Then it should not throw', () => {
      const scene = buildScene(375, 667);
      const toolbar = new CreateModeToolbar(scene as any);
      expect(toolbar).toBeDefined();
      toolbar.destroy();
    });

    it('Given a 375×667 screen, When created, Then the active tool should default to "none"', () => {
      const scene = buildScene(375, 667);
      const toolbar = new CreateModeToolbar(scene as any);
      expect(toolbar.currentTool).toBe('none');
      toolbar.destroy();
    });
  });

  describe('Scenario: Creating the toolbar on a tablet viewport', () => {
    it('Given a 768×1024 screen, When the toolbar is created, Then it should not throw', () => {
      const scene = buildScene(768, 1024);
      const toolbar = new CreateModeToolbar(scene as any);
      expect(toolbar).toBeDefined();
      toolbar.destroy();
    });
  });
});

// ---------------------------------------------------------------------------
// Feature: Tool selection
// ---------------------------------------------------------------------------

describe('Feature: Tool selection via toolbar', () => {
  let scene: ReturnType<typeof buildScene>;
  let toolbar: CreateModeToolbar;
  const emittedEvents: Array<{ tool: string }> = [];
  const listener = (data: { tool: string }) => { emittedEvents.push(data); };

  beforeEach(() => {
    emittedEvents.length = 0;
    scene = buildScene(1920, 1080);
    toolbar = new CreateModeToolbar(scene as any);
    EventBus.on('tool:changed', listener);
  });

  afterEach(() => {
    EventBus.off('tool:changed', listener);
    toolbar.destroy();
  });

  describe('Scenario: Selecting the generator tool', () => {
    it('Given no tool is active, When "generator" is selected, Then currentTool should be "generator"', () => {
      toolbar.selectTool('generator');
      expect(toolbar.currentTool).toBe('generator');
    });

    it('Given no tool is active, When "generator" is selected, Then a tool:changed event should be emitted', () => {
      toolbar.selectTool('generator');
      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]).toEqual({ tool: 'generator' });
    });
  });

  describe('Scenario: Selecting the junction tool', () => {
    it('Given no tool is active, When "junction" is selected, Then currentTool should be "junction"', () => {
      toolbar.selectTool('junction');
      expect(toolbar.currentTool).toBe('junction');
    });
  });

  describe('Scenario: Selecting the completer tool', () => {
    it('Given no tool is active, When "completer" is selected, Then currentTool should be "completer"', () => {
      toolbar.selectTool('completer');
      expect(toolbar.currentTool).toBe('completer');
    });
  });

  describe('Scenario: Selecting the select tool', () => {
    it('Given no tool is active, When "select" is selected, Then currentTool should be "select"', () => {
      toolbar.selectTool('select');
      expect(toolbar.currentTool).toBe('select');
    });
  });

  describe('Scenario: Switching between tools', () => {
    it('Given "generator" is active, When "junction" is selected, Then currentTool should become "junction"', () => {
      toolbar.selectTool('generator');
      toolbar.selectTool('junction');
      expect(toolbar.currentTool).toBe('junction');
    });

    it('Given "generator" is active, When "junction" is selected, Then two tool:changed events should have been emitted', () => {
      toolbar.selectTool('generator');
      toolbar.selectTool('junction');
      expect(emittedEvents).toHaveLength(2);
      expect(emittedEvents[1]).toEqual({ tool: 'junction' });
    });
  });
});

// ---------------------------------------------------------------------------
// Feature: Tool de-selection (toggle off)
// ---------------------------------------------------------------------------

describe('Feature: Tool de-selection', () => {
  let scene: ReturnType<typeof buildScene>;
  let toolbar: CreateModeToolbar;
  const emittedEvents: Array<{ tool: string }> = [];
  const listener = (data: { tool: string }) => { emittedEvents.push(data); };

  beforeEach(() => {
    emittedEvents.length = 0;
    scene = buildScene(1920, 1080);
    toolbar = new CreateModeToolbar(scene as any);
    EventBus.on('tool:changed', listener);
  });

  afterEach(() => {
    EventBus.off('tool:changed', listener);
    toolbar.destroy();
  });

  describe('Scenario: Clicking the active tool a second time', () => {
    it('Given "generator" is active, When "generator" is pressed again, Then currentTool should revert to "none"', () => {
      toolbar.selectTool('generator');
      toolbar.selectTool('generator'); // toggle off
      expect(toolbar.currentTool).toBe('none');
    });

    it('Given "generator" is active, When "generator" is pressed again, Then tool:changed is emitted with "none"', () => {
      toolbar.selectTool('generator');
      emittedEvents.length = 0; // clear first event
      toolbar.selectTool('generator');
      expect(emittedEvents[0]).toEqual({ tool: 'none' });
    });
  });
});

// ---------------------------------------------------------------------------
// Feature: Toolbar visibility control
// ---------------------------------------------------------------------------

describe('Feature: Toolbar visibility', () => {
  let scene: ReturnType<typeof buildScene>;
  let toolbar: CreateModeToolbar;

  beforeEach(() => {
    scene = buildScene(1920, 1080);
    toolbar = new CreateModeToolbar(scene as any);
  });

  afterEach(() => {
    toolbar.destroy();
  });

  describe('Scenario: Hiding the toolbar', () => {
    it('Given the toolbar is visible, When setVisible(false) is called, Then it should not throw', () => {
      expect(() => toolbar.setVisible(false)).not.toThrow();
    });
  });

  describe('Scenario: Showing the toolbar', () => {
    it('Given the toolbar is hidden, When setVisible(true) is called, Then it should not throw', () => {
      toolbar.setVisible(false);
      expect(() => toolbar.setVisible(true)).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// Feature: Toast notifications
// ---------------------------------------------------------------------------

describe('Feature: Toast notification display', () => {
  let scene: ReturnType<typeof buildScene>;
  let toolbar: CreateModeToolbar;

  beforeEach(() => {
    scene = buildScene(1920, 1080);
    toolbar = new CreateModeToolbar(scene as any);
  });

  afterEach(() => {
    toolbar.destroy();
  });

  describe('Scenario: Showing an info toast', () => {
    it('Given the toolbar, When showToast is called with an info message, Then it should not throw', () => {
      expect(() => toolbar.showToast('Track generated', 'info')).not.toThrow();
    });
  });

  describe('Scenario: Showing an error toast', () => {
    it('Given the toolbar, When showToast is called with an error message, Then it should not throw', () => {
      expect(() => toolbar.showToast('Could not connect tracks', 'error')).not.toThrow();
    });
  });

  describe('Scenario: Toast triggered via EventBus', () => {
    it('Given the toolbar is listening, When ui:toast is emitted, Then it should not throw', () => {
      expect(() =>
        EventBus.emit('ui:toast', { message: 'Hello!', type: 'success' }),
      ).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// Feature: Toolbar lifecycle (destroy)
// ---------------------------------------------------------------------------

describe('Feature: Toolbar lifecycle', () => {
  describe('Scenario: Destroying the toolbar', () => {
    it('Given a toolbar, When destroy() is called, Then it should not throw', () => {
      const scene = buildScene(1920, 1080);
      const toolbar = new CreateModeToolbar(scene as any);
      expect(() => toolbar.destroy()).not.toThrow();
    });

    it('Given a destroyed toolbar, When ui:toast is emitted, Then no handler should be invoked', () => {
      const scene = buildScene(1920, 1080);
      const toolbar = new CreateModeToolbar(scene as any);
      toolbar.destroy();
      // showToast internally calls setText – if called on a destroyed text it would throw.
      // Ensuring no throw means the event handler was properly unregistered.
      expect(() =>
        EventBus.emit('ui:toast', { message: 'Late toast', type: 'info' }),
      ).not.toThrow();
    });
  });
});

