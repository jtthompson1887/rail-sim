/** @jest-environment node */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const { createFileStorage } = require('../../native/electron/storage.cjs');

describe('Electron app-private file storage', () => {
  let root: string;
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'rail-sim-storage-')); });
  afterEach(async () => {
    expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()));
    await fs.rm(root, { recursive: true, force: true });
  });

  it('atomically replaces files, ignores abandoned pending files, and survives reopening', async () => {
    const storage = createFileStorage(root);
    expect(await storage.read('world-test.slot-a')).toBeNull();
    await storage.write('world-test.slot-a', 'generation one');
    await storage.write('world-test.slot-a', 'generation two');
    const interrupted = 'world-test.slot-a.pending-00000000-0000-4000-8000-000000000001';
    await fs.writeFile(path.join(root, interrupted), 'incomplete');
    expect(await createFileStorage(root).read('world-test.slot-a')).toBe('generation two');
    expect(await fs.readdir(root)).not.toContain(interrupted);
    expect(await storage.list('world-')).toEqual(['world-test.slot-a']);
    await storage.remove('world-test.slot-a');
    await storage.remove('missing');
    expect(await storage.read('world-test.slot-a')).toBeNull();
  });

  it.each(['../outside', '..', '.', 'C:\\private', '/absolute', 'bad/key', 'x'.repeat(231)])(
    'rejects escaping or unsupported storage keys: %s', async (key) => {
      const storage = createFileStorage(root);
      await expect(storage.write(key, 'data')).rejects.toThrow('Invalid app-private save key');
      await expect(storage.read(key)).rejects.toThrow('Invalid app-private save key');
    },
  );

  it('rejects invalid prefixes and non-string contents', async () => {
    const storage = createFileStorage(root);
    await expect(storage.list('../')).rejects.toThrow('Invalid save prefix');
    await expect(storage.write('world-key', 5)).rejects.toThrow('storage limit');
    expect(await createFileStorage(path.join(root, 'missing')).list('world-')).toEqual([]);
  });
});
