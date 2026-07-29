import { CabPerformanceMonitor } from '../../src/cab3d/quality/CabPerformanceMonitor';

describe('CabPerformanceMonitor', () => {
  function makeClock(initial = 0) {
    let t = initial;
    return {
      now: () => t,
      advance: (ms: number) => { t += ms; },
      set: (ms: number) => { t = ms; },
    };
  }

  function makeFps(values: number[]) {
    let index = 0;
    return () => values[index++] ?? 0;
  }

  it('does nothing before start is called', () => {
    const clock = makeClock();
    const getFps = jest.fn().mockReturnValue(60);
    const monitor = new CabPerformanceMonitor(getFps, clock.now, 3000);

    monitor.update();
    expect(getFps).not.toHaveBeenCalled();
  });

  it('completes after the configured duration and reports the selected tier', () => {
    const clock = makeClock();
    const monitor = new CabPerformanceMonitor(makeFps([60, 60, 60]), clock.now, 3000);
    const onComplete = jest.fn();

    monitor.start(onComplete);

    monitor.update();
    clock.advance(1000);
    monitor.update();
    clock.advance(1000);
    monitor.update();
    clock.advance(1001); // exceed 3000ms total
    monitor.update();

    expect(monitor.isRunning()).toBe(false);
    expect(onComplete).toHaveBeenCalledWith('ultra');
  });

  it('averages samples and selects the matching tier', () => {
    // Average 35 fps -> medium (30-44)
    const clock = makeClock();
    const monitor = new CabPerformanceMonitor(makeFps([30, 40]), clock.now, 3000);
    const onComplete = jest.fn();

    monitor.start(onComplete);
    monitor.update();
    clock.advance(1500);
    monitor.update();
    clock.advance(1501);
    monitor.update();

    expect(onComplete).toHaveBeenCalledWith('medium');
  });

  it('can be cancelled before completion', () => {
    const clock = makeClock();
    const getFps = jest.fn().mockReturnValue(60);
    const monitor = new CabPerformanceMonitor(getFps, clock.now, 3000);
    const onComplete = jest.fn();

    monitor.start(onComplete);
    monitor.cancel();
    clock.advance(4000);
    monitor.update();

    expect(monitor.isRunning()).toBe(false);
    expect(onComplete).not.toHaveBeenCalled();
    expect(getFps).not.toHaveBeenCalled();
  });

  it('restarts cleanly when start is called again', () => {
    const clock = makeClock();
    const monitor = new CabPerformanceMonitor(makeFps([20]), clock.now, 3000);
    const first = jest.fn();
    const second = jest.fn();

    monitor.start(first);
    clock.advance(3001);
    monitor.update();
    expect(first).toHaveBeenCalledWith('low');

    monitor.start(second);
    expect(monitor.isRunning()).toBe(true);
    clock.advance(3001);
    monitor.update();
    expect(second).toHaveBeenCalledWith('low');
  });

  it('ignores zero or negative fps samples', () => {
    // (60 + 70) / 2 = 65 -> ultra; 0 and -5 are skipped
    const clock = makeClock();
    const monitor = new CabPerformanceMonitor(
      makeFps([60, 0, -5, 70]),
      clock.now,
      3000,
    );
    const onComplete = jest.fn();

    monitor.start(onComplete);
    monitor.update();
    clock.advance(750);
    monitor.update();
    clock.advance(750);
    monitor.update();
    clock.advance(750);
    monitor.update();
    clock.advance(751);
    monitor.update();

    expect(onComplete).toHaveBeenCalledWith('ultra');
  });

  it('defaults to low when no positive samples were collected', () => {
    const clock = makeClock();
    const monitor = new CabPerformanceMonitor(makeFps([0, 0, 0]), clock.now, 3000);
    const onComplete = jest.fn();

    monitor.start(onComplete);
    monitor.update();
    clock.advance(1000);
    monitor.update();
    clock.advance(1000);
    monitor.update();
    clock.advance(1001);
    monitor.update();

    expect(onComplete).toHaveBeenCalledWith('low');
  });
});
