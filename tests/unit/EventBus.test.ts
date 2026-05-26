import { EventBus } from '../../src/services/EventBus';

// Re-import to reset singleton state between tests via module re-evaluation
// EventBus is a singleton, so we test it directly but clear listeners each time.

describe('EventBus', () => {
  afterEach(() => {
    // Remove all listeners by emitting with no active ones; we do this by
    // calling off for each registered callback.
  });

  it('calls listener when event is emitted', () => {
    const cb = jest.fn();
    EventBus.on('game:paused', cb);
    EventBus.emit('game:paused', {});
    expect(cb).toHaveBeenCalledWith({});
    EventBus.off('game:paused', cb);
  });

  it('does not call listener after off()', () => {
    const cb = jest.fn();
    EventBus.on('game:resumed', cb);
    EventBus.off('game:resumed', cb);
    EventBus.emit('game:resumed', {});
    expect(cb).not.toHaveBeenCalled();
  });

  it('supports multiple listeners for the same event', () => {
    const cb1 = jest.fn();
    const cb2 = jest.fn();
    EventBus.on('game:paused', cb1);
    EventBus.on('game:paused', cb2);
    EventBus.emit('game:paused', {});
    expect(cb1).toHaveBeenCalled();
    expect(cb2).toHaveBeenCalled();
    EventBus.off('game:paused', cb1);
    EventBus.off('game:paused', cb2);
  });

  it('passes typed payload to listener', () => {
    const cb = jest.fn();
    EventBus.on('train:derailed', cb);
    EventBus.emit('train:derailed', { trainId: 'train-abc' });
    expect(cb).toHaveBeenCalledWith({ trainId: 'train-abc' });
    EventBus.off('train:derailed', cb);
  });

  it('does not throw if off() is called for an event with no listeners', () => {
    const cb = jest.fn();
    expect(() => EventBus.off('game:over', cb)).not.toThrow();
  });

  it('does not throw if emit() is called for an event with no listeners', () => {
    expect(() => EventBus.emit('game:paused', {})).not.toThrow();
  });

  it('handles junction:toggled event with full payload', () => {
    const cb = jest.fn();
    EventBus.on('junction:toggled', cb);
    EventBus.emit('junction:toggled', { junctionId: 'j1', state: 'left' });
    expect(cb).toHaveBeenCalledWith({ junctionId: 'j1', state: 'left' });
    EventBus.off('junction:toggled', cb);
  });

  it('handles passenger:delivered event', () => {
    const cb = jest.fn();
    EventBus.on('passenger:delivered', cb);
    EventBus.emit('passenger:delivered', { stationId: 'st1', count: 5 });
    expect(cb).toHaveBeenCalledWith({ stationId: 'st1', count: 5 });
    EventBus.off('passenger:delivered', cb);
  });

  it('handles objective:completed event', () => {
    const cb = jest.fn();
    EventBus.on('objective:completed', cb);
    EventBus.emit('objective:completed', { objectiveId: 'obj1', score: 500 });
    expect(cb).toHaveBeenCalledWith({ objectiveId: 'obj1', score: 500 });
    EventBus.off('objective:completed', cb);
  });

  it('handles objective:failed event', () => {
    const cb = jest.fn();
    EventBus.on('objective:failed', cb);
    EventBus.emit('objective:failed', { objectiveId: 'obj2' });
    expect(cb).toHaveBeenCalledWith({ objectiveId: 'obj2' });
    EventBus.off('objective:failed', cb);
  });

  it('handles level:complete event', () => {
    const cb = jest.fn();
    EventBus.on('level:complete', cb);
    EventBus.emit('level:complete', { levelId: 'level_01', score: 1000 });
    expect(cb).toHaveBeenCalledWith({ levelId: 'level_01', score: 1000 });
    EventBus.off('level:complete', cb);
  });

  it('handles train:selected and train:deselected events', () => {
    const sel = jest.fn();
    const desel = jest.fn();
    EventBus.on('train:selected', sel);
    EventBus.on('train:deselected', desel);
    EventBus.emit('train:selected', { trainId: 't1' });
    EventBus.emit('train:deselected', {});
    expect(sel).toHaveBeenCalledWith({ trainId: 't1' });
    expect(desel).toHaveBeenCalledWith({});
    EventBus.off('train:selected', sel);
    EventBus.off('train:deselected', desel);
  });

  it('removes only the specified listener when multiple are registered', () => {
    const cb1 = jest.fn();
    const cb2 = jest.fn();
    EventBus.on('game:over', cb1);
    EventBus.on('game:over', cb2);
    EventBus.off('game:over', cb1);
    EventBus.emit('game:over', { won: true, score: 100 });
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalled();
    EventBus.off('game:over', cb2);
  });

  it('handles audio events', () => {
    const sfx = jest.fn();
    const bgm = jest.fn();
    EventBus.on('audio:play-sfx', sfx);
    EventBus.on('audio:play-bgm', bgm);
    EventBus.emit('audio:play-sfx', { key: 'click' });
    EventBus.emit('audio:play-bgm', { key: 'menu_music' });
    expect(sfx).toHaveBeenCalledWith({ key: 'click' });
    expect(bgm).toHaveBeenCalledWith({ key: 'menu_music' });
    EventBus.off('audio:play-sfx', sfx);
    EventBus.off('audio:play-bgm', bgm);
  });
});
