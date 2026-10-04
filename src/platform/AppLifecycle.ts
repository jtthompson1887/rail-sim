export interface AppLifecyclePort {
  /** Backgrounded sessions must pause, save, and never advance elapsed wall time on resume. */
  onBackground(): void | Promise<void>;
  onForeground(): void;
}

export async function installAppLifecycle(port: AppLifecyclePort): Promise<() => void> {
  // Historical acceptance fixtures deliberately manipulate the prototype's localStorage map during reload.
  if (typeof __RAIL_SIM_TEST_CONTROLS__ !== 'undefined' && __RAIL_SIM_TEST_CONTROLS__
    && new URL(window.location.href).searchParams.get('legacyAcceptanceFixture') === '1') return () => undefined;
  let active = true;
  let nativeActive = true;
  const change = (nextActive: boolean) => {
    if (nextActive === active) return;
    active = nextActive;
    if (active) port.onForeground();
    else Promise.resolve(port.onBackground()).catch((error) => console.error('Background save failed', error));
  };
  const visibility = () => change(!document.hidden && nativeActive);
  document.addEventListener('visibilitychange', visibility);
  visibility();
  let removeNative: (() => Promise<void>) | null = null;
  if ((window as any).Capacitor?.isNativePlatform?.()) {
    const { App } = await import(/* webpackChunkName: "mobile-platform" */ '@capacitor/app');
    const listener = await App.addListener('appStateChange', ({ isActive }) => {
      nativeActive = isActive;
      visibility();
    });
    removeNative = () => listener.remove();
  }
  return () => {
    document.removeEventListener('visibilitychange', visibility);
    void removeNative?.();
  };
}
