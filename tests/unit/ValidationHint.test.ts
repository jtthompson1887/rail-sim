import { ValidationHint } from '../../src/ui/ValidationHint';
import { EventBus } from '../../src/services/EventBus';
import { makeUiScene, findHandler, simulatePointer } from '../helpers/PhaserUiHarness';

describe('ValidationHint', () => {
  let hint: ValidationHint;
  let { scene, container, rectangle, text, tweensAdd, killTweensOf } = makeUiScene();

  beforeEach(() => {
    jest.useFakeTimers();
    ({ scene, container, rectangle, text, tweensAdd, killTweensOf } = makeUiScene());
    hint = new ValidationHint(scene);
  });

  afterEach(() => {
    hint.destroy();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('builds a hidden bottom-centre pill with ok styling', () => {
    const pill = rectangle.mock.results[0].value;
    const label = text.mock.results[0].value;
    const cont = container.mock.results[0].value;

    expect(pill.setFillStyle).toHaveBeenCalledWith(0x00c966, 0.92);
    expect(label.setColor).toHaveBeenCalledWith('#ffffff');
    expect(cont.setAlpha).toHaveBeenCalledWith(0);
    expect(cont._children).toContain(pill);
    expect(cont._children).toContain(label);
  });

  it('shows warnings and errors without auto-hiding', () => {
    const cont = container.mock.results[0].value;

    EventBus.emit('ui:validation-hint', { state: 'warning', message: 'Tunnel required' });

    const pill = rectangle.mock.results[0].value;
    const label = text.mock.results[0].value;
    expect(pill.setFillStyle).toHaveBeenLastCalledWith(0xffcc00, 0.92);
    expect(label.setColor).toHaveBeenLastCalledWith('#1a1a00');
    expect(label.setText).toHaveBeenLastCalledWith('Tunnel required');
    expect(killTweensOf).toHaveBeenCalledWith(cont);
    expect(tweensAdd).toHaveBeenCalledWith(expect.objectContaining({
      targets: cont,
      alpha: 1,
      duration: 180,
      ease: 'Quad.easeOut',
    }));

    EventBus.emit('ui:validation-hint', { state: 'error', message: 'Cannot place' });
    expect(pill.setFillStyle).toHaveBeenLastCalledWith(0xff4444, 0.92);
    expect(label.setColor).toHaveBeenLastCalledWith('#ffffff');

    jest.advanceTimersByTime(10_000);
    // No extra fade-out call should have been made; only the two animateIn calls.
    expect(tweensAdd).toHaveBeenCalledTimes(2);
  });

  it('shows an ok message then fades out after the hide delay', () => {
    const cont = container.mock.results[0].value;

    EventBus.emit('ui:validation-hint', { state: 'ok', message: 'Track placed' });

    expect(tweensAdd).toHaveBeenCalledWith(expect.objectContaining({
      targets: cont,
      alpha: 1,
      duration: 180,
      ease: 'Quad.easeOut',
    }));

    jest.advanceTimersByTime(1999);
    expect(tweensAdd).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1);
    expect(tweensAdd).toHaveBeenCalledTimes(2);
    expect(tweensAdd).toHaveBeenLastCalledWith(expect.objectContaining({
      targets: cont,
      alpha: 0,
      duration: 250,
      ease: 'Quad.easeIn',
    }));
  });

  it('hides immediately for an empty ok message', () => {
    const cont = container.mock.results[0].value;

    EventBus.emit('ui:validation-hint', { state: 'ok', message: '' });

    expect(tweensAdd).toHaveBeenCalledTimes(1);
    expect(tweensAdd).toHaveBeenCalledWith(expect.objectContaining({
      targets: cont,
      alpha: 0,
      duration: 250,
      ease: 'Quad.easeIn',
    }));
    jest.advanceTimersByTime(10_000);
    expect(tweensAdd).toHaveBeenCalledTimes(1);
  });

  it('resets the hide timer on repeated ok messages', () => {
    EventBus.emit('ui:validation-hint', { state: 'ok', message: 'A' });
    jest.advanceTimersByTime(1500);
    EventBus.emit('ui:validation-hint', { state: 'ok', message: 'B' });
    jest.advanceTimersByTime(1500);

    // First timer would have fired at 2000ms, but was cleared by the second message.
    expect(tweensAdd).toHaveBeenCalledTimes(2); // two animateIn calls
    jest.advanceTimersByTime(500);
    expect(tweensAdd).toHaveBeenCalledTimes(3); // second fade-out now fires
  });

  it('can be disabled and re-enabled without leaking timers', () => {
    const label = text.mock.results[0].value;

    (hint as any).setVisible(false);

    EventBus.emit('ui:validation-hint', { state: 'ok', message: 'Ignored' });
    expect(label.setText).not.toHaveBeenLastCalledWith('Ignored');
    expect(tweensAdd).not.toHaveBeenCalled();

    (hint as any).setVisible(true);
    EventBus.emit('ui:validation-hint', { state: 'ok', message: 'Visible again' });
    expect(label.setText).toHaveBeenLastCalledWith('Visible again');
    expect(tweensAdd).toHaveBeenCalled();
  });

  it('cancels a pending hide timer when the UI is disabled', () => {
    const cont = container.mock.results[0].value;

    EventBus.emit('ui:validation-hint', { state: 'ok', message: 'Track placed' });
    expect(tweensAdd).toHaveBeenCalledTimes(1);

    (hint as any).setVisible(false);
    jest.advanceTimersByTime(10_000);

    // No fade-out tween should run because the timer was cancelled.
    expect(tweensAdd).toHaveBeenCalledTimes(1);
    expect(cont.setAlpha).toHaveBeenLastCalledWith(0);
  });

  it('repositions and rescales for a mobile viewport', () => {
    const cont = container.mock.results[0].value;
    const pill = rectangle.mock.results[0].value;
    const label = text.mock.results[0].value;

    scene.scale.width = 375;
    scene.scale.height = 667;
    (hint as any).resize();

    expect(cont.setPosition).toHaveBeenLastCalledWith(187.5, 647);
    expect(pill.setSize).toHaveBeenLastCalledWith(318.75, 13);
    expect(label.setWordWrapWidth).toHaveBeenLastCalledWith(312.75);
  });

  it('unsubscribes and destroys cleanly', () => {
    const cont = container.mock.results[0].value;

    hint.destroy();
    EventBus.emit('ui:validation-hint', { state: 'ok', message: 'After destroy' });

    expect(tweensAdd).not.toHaveBeenCalled();
    expect(cont.destroy).toHaveBeenCalled();
  });
});
