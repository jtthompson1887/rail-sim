import { Filesystem } from '@capacitor/filesystem';
import { createCapacitorStorage } from '../../src/platform/CapacitorStorage';

jest.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' }, Encoding: { UTF8: 'utf8' },
  Filesystem: { mkdir: jest.fn(), stat: jest.fn(), readFile: jest.fn(), writeFile: jest.fn(),
    deleteFile: jest.fn(), readdir: jest.fn() },
}));

describe('Capacitor app-private filesystem adapter', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (Filesystem.mkdir as jest.Mock).mockResolvedValue(undefined);
  });

  it('uses Data/UTF8 and enumerates only matching files', async () => {
    const storage = await createCapacitorStorage();
    (Filesystem.readFile as jest.Mock).mockResolvedValue({ data: 'world data' });
    (Filesystem.readdir as jest.Mock).mockResolvedValue({ files: [
      { name: 'world-a.slot-a', type: 'file' }, { name: 'other', type: 'file' },
      { name: 'world-directory', type: 'directory' },
    ] });
    await storage.write('world-a.slot-a', 'world data');
    expect(Filesystem.writeFile).toHaveBeenCalledWith({ path: 'rail-sim-saves/world-a.slot-a', directory: 'DATA', encoding: 'utf8', data: 'world data' });
    expect(await storage.read('world-a.slot-a')).toBe('world data');
    expect(await storage.list('world-')).toEqual(['world-a.slot-a']);
    await storage.remove('world-a.slot-a');
    expect(Filesystem.deleteFile).toHaveBeenCalledWith({ path: 'rail-sim-saves/world-a.slot-a', directory: 'DATA' });
  });

  it('distinguishes missing files from permission and device errors', async () => {
    const storage = await createCapacitorStorage();
    (Filesystem.readFile as jest.Mock).mockRejectedValue({ code: 'OS-PLUG-FILE-0008' });
    expect(await storage.read('missing')).toBeNull();
    (Filesystem.deleteFile as jest.Mock).mockRejectedValue({ code: 'OS-PLUG-FILE-0008' });
    await expect(storage.remove('missing')).resolves.toBeUndefined();
    const denied = new Error('permission denied');
    (Filesystem.readFile as jest.Mock).mockRejectedValue(denied);
    (Filesystem.deleteFile as jest.Mock).mockRejectedValue(denied);
    await expect(storage.read('world-a')).rejects.toBe(denied);
    await expect(storage.remove('world-a')).rejects.toBe(denied);
    await expect(storage.write('../outside', 'data')).rejects.toThrow('Invalid app-private save key');
    await expect(storage.list('../')).rejects.toThrow('Invalid app-private save prefix');
  });

  it('accepts an existing directory but does not swallow directory creation errors', async () => {
    (Filesystem.mkdir as jest.Mock).mockRejectedValue(new Error('already exists'));
    (Filesystem.stat as jest.Mock).mockResolvedValue({ type: 'directory' });
    expect((await createCapacitorStorage()).kind).toBe('capacitor');
    (Filesystem.stat as jest.Mock).mockResolvedValue({ type: 'file' });
    await expect(createCapacitorStorage()).rejects.toThrow('already exists');
    (Filesystem.stat as jest.Mock).mockRejectedValue(new Error('denied'));
    await expect(createCapacitorStorage()).rejects.toThrow('already exists');
  });
});
