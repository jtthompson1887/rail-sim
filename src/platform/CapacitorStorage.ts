import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import type { StoragePort } from '../persistence/StoragePort';

const DIRECTORY = Directory.Data;
const ROOT = 'rail-sim-saves';
function pathFor(key: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(key) || key === '.' || key === '..' || key.length > 230) {
    throw new Error('Invalid app-private save key');
  }
  return `${ROOT}/${key}`;
}
function isMissing(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return code === 'OS-PLUG-FILE-0008' || code === 'ENOENT';
}

export async function createCapacitorStorage(): Promise<StoragePort> {
  // mkdir is allowed to fail only if this exact directory already exists.
  try { await Filesystem.mkdir({ path: ROOT, directory: DIRECTORY, recursive: true }); }
  catch (error) {
    const stat = await Filesystem.stat({ path: ROOT, directory: DIRECTORY }).catch(() => { throw error; });
    if (stat.type !== 'directory') throw error;
  }
  return {
    kind: 'capacitor',
    async read(key) {
      try {
        const file = await Filesystem.readFile({ path: pathFor(key), directory: DIRECTORY, encoding: Encoding.UTF8 });
        return typeof file.data === 'string' ? file.data : file.data.text();
      } catch (error) { if (isMissing(error)) return null; throw error; }
    },
    async write(key, value) {
      // Alternating slots retain another complete generation if a device stops mid-write.
      await Filesystem.writeFile({ path: pathFor(key), directory: DIRECTORY, encoding: Encoding.UTF8, data: value });
    },
    async remove(key) {
      try { await Filesystem.deleteFile({ path: pathFor(key), directory: DIRECTORY }); }
      catch (error) { if (!isMissing(error)) throw error; }
    },
    async list(prefix) {
      if (!/^[a-zA-Z0-9._-]*$/.test(prefix)) throw new Error('Invalid app-private save prefix');
      const { files } = await Filesystem.readdir({ path: ROOT, directory: DIRECTORY });
      return files.filter((file) => file.type === 'file' && file.name.startsWith(prefix)).map((file) => file.name);
    },
  };
}
