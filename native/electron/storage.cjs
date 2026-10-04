const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function createFileStorage(root) {
  const directory = path.resolve(root);
  let cleanupPromise;
  function cleanAbandonedWrites() {
    if (!cleanupPromise) cleanupPromise = (async () => {
      let entries;
      try { entries = await fs.readdir(directory, { withFileTypes: true }); }
      catch (error) { if (error.code === 'ENOENT') return; throw error; }
      for (const entry of entries) {
        if (!entry.isFile() || !/^[a-zA-Z0-9._-]+\.pending-[0-9a-f-]{36}$/.test(entry.name)) continue;
        const target = path.resolve(directory, entry.name);
        if (path.dirname(target) !== directory) throw new Error('Temporary save path escapes app storage');
        await fs.unlink(target).catch((error) => { if (error.code !== 'ENOENT') throw error; });
      }
    })();
    return cleanupPromise;
  }
  function resolveKey(key) {
    if (typeof key !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(key) || key.length > 230 || key === '.' || key === '..') {
      throw new Error('Invalid app-private save key');
    }
    const target = path.resolve(directory, key);
    if (path.dirname(target) !== directory) throw new Error('Save path escapes app storage');
    return target;
  }
  return {
    async read(key) {
      await cleanAbandonedWrites();
      try { return await fs.readFile(resolveKey(key), 'utf8'); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async write(key, value) {
      await cleanAbandonedWrites();
      const target = resolveKey(key);
      if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 64 * 1024 * 1024) {
        throw new Error('Save exceeds the app-private storage limit');
      }
      await fs.mkdir(directory, { recursive: true });
      const temporary = `${target}.pending-${crypto.randomUUID()}`;
      try {
        const file = await fs.open(temporary, 'wx', 0o600);
        try { await file.writeFile(value, 'utf8'); await file.sync(); }
        finally { await file.close(); }
        await fs.rename(temporary, target);
      } finally {
        await fs.unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
      }
    },
    async remove(key) {
      await cleanAbandonedWrites();
      try { await fs.unlink(resolveKey(key)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    },
    async list(prefix) {
      await cleanAbandonedWrites();
      if (typeof prefix !== 'string' || !/^[a-zA-Z0-9._-]*$/.test(prefix)) throw new Error('Invalid save prefix');
      try {
        return (await fs.readdir(directory, { withFileTypes: true }))
          .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && !entry.name.includes('.pending-'))
          .map((entry) => entry.name);
      } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    },
  };
}
module.exports = { createFileStorage };
