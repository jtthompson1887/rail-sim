import type { StoragePort } from '../persistence/StoragePort';
import { IndexedDbStorage } from './IndexedDbStorage';

export interface ElectronSaveBridge {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  onBeforeClose?(callback: () => Promise<void>): () => void;
}
declare global {
  interface Window { railSimStorage?: ElectronSaveBridge; }
}

export async function createPlatformStorage(): Promise<StoragePort> {
  if (window.railSimStorage) {
    const bridge = window.railSimStorage;
    return {
      kind: 'electron', read: (key) => bridge.read(key), write: (key, value) => bridge.write(key, value),
      remove: (key) => bridge.remove(key), list: (prefix) => bridge.list(prefix),
    };
  }
  const capacitor = (window as any).Capacitor;
  if (capacitor?.isNativePlatform?.()) {
    const { createCapacitorStorage } = await import(/* webpackChunkName: "mobile-platform" */ './CapacitorStorage');
    return createCapacitorStorage();
  }
  return IndexedDbStorage.open();
}
