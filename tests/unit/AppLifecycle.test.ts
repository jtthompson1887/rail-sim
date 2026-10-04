import { installAppLifecycle } from '../../src/platform/AppLifecycle';
import { App } from '@capacitor/app';

jest.mock('@capacitor/app', () => ({ App: { addListener: jest.fn() } }));

describe('app lifecycle pause/save boundary', () => {
  let hidden = false;
  let cleanup: (() => void) | undefined;
  beforeEach(() => {
    hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    delete (window as any).Capacitor;
  });
  afterEach(() => { cleanup?.(); cleanup = undefined; jest.clearAllMocks(); });
  const visibility = (value: boolean) => {
    hidden = value;
    document.dispatchEvent(new Event('visibilitychange'));
  };

  it('pauses and saves once per background transition and cleans listeners up', async () => {
    const port = { onBackground: jest.fn().mockResolvedValue(undefined), onForeground: jest.fn() };
    cleanup = await installAppLifecycle(port);
    visibility(true);
    visibility(true);
    visibility(false);
    expect(port.onBackground).toHaveBeenCalledTimes(1);
    expect(port.onForeground).toHaveBeenCalledTimes(1);
    cleanup(); cleanup = undefined;
    visibility(true);
    expect(port.onBackground).toHaveBeenCalledTimes(1);
  });

  it('starts backgrounded sessions paused and reports failed flushes', async () => {
    hidden = true;
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const port = { onBackground: jest.fn().mockRejectedValue(new Error('disk full')), onForeground: jest.fn() };
    cleanup = await installAppLifecycle(port);
    await Promise.resolve();
    expect(port.onBackground).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('Background save failed', expect.any(Error));
    log.mockRestore();
  });

  it('combines native and browser events without resuming while either remains backgrounded', async () => {
    (window as any).Capacitor = { isNativePlatform: () => true };
    let nativeState: (state: { isActive: boolean }) => void;
    const remove = jest.fn().mockResolvedValue(undefined);
    (App.addListener as jest.Mock).mockImplementation(async (_event, callback) => {
      nativeState = callback;
      return { remove };
    });
    const port = { onBackground: jest.fn(), onForeground: jest.fn() };
    cleanup = await installAppLifecycle(port);
    nativeState({ isActive: false });
    visibility(true);
    visibility(false);
    expect(port.onBackground).toHaveBeenCalledTimes(1);
    expect(port.onForeground).not.toHaveBeenCalled();
    nativeState({ isActive: true });
    expect(port.onForeground).toHaveBeenCalledTimes(1);
    cleanup(); cleanup = undefined;
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
