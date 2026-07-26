import { ToolbarButton } from '../../src/ui/ToolbarButton';
import { makeUiScene, simulatePointer } from '../helpers/PhaserUiHarness';

describe('ToolbarButton', () => {
  let scene: any;
  let container: any;
  let rectangle: any;
  let text: any;

  beforeEach(() => {
    ({ scene, container, rectangle, text } = makeUiScene());
  });

  function lastNode(mock: jest.Mock) {
    return mock.mock.results[mock.mock.results.length - 1].value;
  }

  it('creates a labelled, interactive button inside a container', () => {
    const onPress = jest.fn();
    const button = new ToolbarButton(scene, 120, 240, {
      label: 'Place',
      tooltip: 'Place track',
      width: 160,
      height: 56,
      color: 0x1a3a5c,
      activeColor: 0x2a8cff,
      labelFontSize: '22px',
      onPress,
    });

    const bg = lastNode(rectangle);
    const label = lastNode(text);
    const cont = lastNode(container);

    expect(cont.setDepth).toHaveBeenCalledWith(600);
    expect(cont.setScrollFactor).toHaveBeenCalledWith(0);
    expect(bg.setStrokeStyle).toHaveBeenCalledWith(2, 0xffffff, 0.3);
    expect(bg.setInteractive).toHaveBeenCalledWith({ useHandCursor: true });
    expect(label.setText).toHaveBeenLastCalledWith('Place');
    expect(label.setOrigin).toHaveBeenCalledWith(0.5);
    expect(cont._children).toContain(bg);
    expect(cont._children).toContain(label);

    button.destroy();
  });

  it('fires onPress when pointerdown occurs on the background', () => {
    const onPress = jest.fn();
    new ToolbarButton(scene, 0, 0, { label: 'Test', onPress });
    const bg = lastNode(rectangle);

    simulatePointer(bg, 'pointerdown');

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('highlights on hover and restores on leave while inactive', () => {
    new ToolbarButton(scene, 0, 0, { label: 'Hover' });
    const bg = lastNode(rectangle);

    simulatePointer(bg, 'pointerover');
    expect(bg.setFillStyle).toHaveBeenLastCalledWith(0x1a3a5c, 1);

    simulatePointer(bg, 'pointerout');
    expect(bg.setFillStyle).toHaveBeenLastCalledWith(0x1a3a5c, 0.92);
  });

  it('does not highlight on hover when active', () => {
    const button = new ToolbarButton(scene, 0, 0, { label: 'Active' });
    const bg = lastNode(rectangle);

    button.setActive(true);
    const callsAfterActivation = bg.setFillStyle.mock.calls.length;

    simulatePointer(bg, 'pointerover');
    expect(bg.setFillStyle).toHaveBeenCalledTimes(callsAfterActivation);

    button.destroy();
  });

  it('toggles active visual state with setActive', () => {
    const button = new ToolbarButton(scene, 0, 0, {
      label: 'Toggle',
      color: 0x111111,
      activeColor: 0x222222,
    });
    const bg = lastNode(rectangle);

    button.setActive(true);
    expect(bg.setFillStyle).toHaveBeenLastCalledWith(0x222222, 1);
    expect(bg.setStrokeStyle).toHaveBeenLastCalledWith(2, 0xffffff, 0.8);

    button.setActive(false);
    expect(bg.setFillStyle).toHaveBeenLastCalledWith(0x111111, 0.92);
    expect(bg.setStrokeStyle).toHaveBeenLastCalledWith(2, 0xffffff, 0.3);

    button.destroy();
  });

  it('shows and hides the container', () => {
    const button = new ToolbarButton(scene, 0, 0, { label: 'Visible' });
    const cont = lastNode(container);

    button.setVisible(false);
    expect(cont.setVisible).toHaveBeenLastCalledWith(false);

    button.setVisible(true);
    expect(cont.setVisible).toHaveBeenLastCalledWith(true);

    button.destroy();
  });

  it('destroys the container and its children', () => {
    const button = new ToolbarButton(scene, 0, 0, { label: 'Delete me' });
    const cont = lastNode(container);

    button.destroy();
    expect(cont.destroy).toHaveBeenCalledTimes(1);
  });
});
