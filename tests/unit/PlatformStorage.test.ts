import { createPlatformStorage } from '../../src/platform/PlatformStorage';
import { IndexedDbStorage } from '../../src/platform/IndexedDbStorage';
import { createCapacitorStorage } from '../../src/platform/CapacitorStorage';
import { MemoryStorage } from '../../src/persistence/StoragePort';

jest.mock('../../src/platform/CapacitorStorage', () => ({ createCapacitorStorage: jest.fn() }));

describe('native storage selection', () => {
  afterEach(() => { delete window.railSimStorage; delete (window as any).Capacitor; jest.restoreAllMocks(); });

  it('uses the Electron bridge before browser or mobile storage', async () => {
    const read = jest.fn().mockResolvedValue('native');
    window.railSimStorage = {
      read, write: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(undefined),
      list: jest.fn().mockResolvedValue(['world-a']),
    };
    const storage = await createPlatformStorage();
    expect(storage.kind).toBe('electron');
    expect(await storage.read('world-a')).toBe('native');
    await storage.write('world-a', 'data'); await storage.remove('world-a');
    expect(await storage.list('world-')).toEqual(['world-a']);
    expect(read).toHaveBeenCalledWith('world-a');
  });

  it('uses a lazily loaded native Capacitor adapter on phones', async () => {
    (window as any).Capacitor = { isNativePlatform: () => true };
    const storage = new MemoryStorage();
    (createCapacitorStorage as jest.Mock).mockResolvedValue(storage);
    expect(await createPlatformStorage()).toBe(storage);
  });

  it('uses IndexedDB for browsers and propagates unavailable-storage errors', async () => {
    const storage = new MemoryStorage();
    const open = jest.spyOn(IndexedDbStorage, 'open').mockResolvedValue(storage as any);
    expect(await createPlatformStorage()).toBe(storage);
    open.mockRejectedValue(new Error('database denied'));
    await expect(createPlatformStorage()).rejects.toThrow('database denied');
  });
});
