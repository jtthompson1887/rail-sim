import EditorUIScene from '../../src/scenes/EditorUIScene';

describe('EditorUIScene construction UI boundary', () => {
  it('reports every visible editor panel as an input-blocking screen bound', () => {
    const scene = new EditorUIScene();
    (scene as any).toolbar = {
      screenBounds: { left: 0, right: 72, top: 0, bottom: 1080 },
    };
    (scene as any).propertiesPanel = {
      containsScreenPoint: jest.fn((x: number) => x >= 1700),
    };
    (scene as any).constructionInspector = {
      containsScreenPoint: jest.fn((_x: number, y: number) => y >= 700),
    };
    (scene as any).companyHud = {
      containsScreenPoint: jest.fn((x: number, y: number) => x < 400 && y < 80),
    };

    expect(scene.containsScreenPoint(40, 500)).toBe(true);
    expect(scene.containsScreenPoint(1800, 500)).toBe(true);
    expect(scene.containsScreenPoint(900, 800)).toBe(true);
    expect(scene.containsScreenPoint(200, 30)).toBe(true);
    expect(scene.containsScreenPoint(900, 400)).toBe(false);
  });

  it('hides, disables, and clears all editor overlays when play mode begins', () => {
    const scene = new EditorUIScene();
    const hidden = () => ({ setVisible: jest.fn(), clear: jest.fn() });
    (scene as any).toolbar = hidden();
    (scene as any).propertiesPanel = hidden();
    (scene as any).constructionInspector = hidden();
    (scene as any).companyHud = hidden();
    (scene as any).validationHint = hidden();

    (scene as any).visibleHandler({ visible: false });

    for (const key of [
      'toolbar',
      'propertiesPanel',
      'constructionInspector',
      'companyHud',
      'validationHint',
    ]) {
      expect((scene as any)[key].setVisible).toHaveBeenCalledWith(false);
    }
    expect((scene as any).constructionInspector.clear).toHaveBeenCalled();
    expect((scene as any).validationHint.clear).toHaveBeenCalled();
  });
});
