import { IndexedDbStorage } from '../../src/platform/IndexedDbStorage';

describe('IndexedDB commit acknowledgements', () => {
  let openRequest: any;
  let transaction: any;
  let request: any;
  let database: any;
  beforeEach(() => {
    request = { result: undefined, error: null };
    const store = {
      get: jest.fn(() => request), put: jest.fn(() => request), delete: jest.fn(() => request),
      getAllKeys: jest.fn(() => request),
    };
    transaction = { objectStore: jest.fn(() => store), error: null };
    database = { createObjectStore: jest.fn(), transaction: jest.fn(() => transaction) };
    openRequest = { result: database, error: null };
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true, value: { open: jest.fn(() => openRequest) },
    });
  });
  async function open(): Promise<IndexedDbStorage> {
    const opened = IndexedDbStorage.open('test-durable-storage');
    openRequest.onupgradeneeded();
    openRequest.onsuccess();
    const storage = await opened;
    expect(database.createObjectStore).toHaveBeenCalledWith('files');
    return storage;
  }

  it('acknowledges writes only when the transaction commits', async () => {
    const storage = await open();
    let committed = false;
    const saved = storage.write('world-a', 'data').then(() => { committed = true; });
    request.result = 'world-a';
    await Promise.resolve();
    expect(committed).toBe(false);
    transaction.oncomplete();
    await saved;
    expect(committed).toBe(true);
    expect(database.transaction).toHaveBeenCalledWith('files', 'readwrite');
  });

  it('reads absence, filters file keys, and commits deletes', async () => {
    const storage = await open();
    const read = storage.read('missing');
    request.result = undefined;
    transaction.oncomplete();
    expect(await read).toBeNull();
    const list = storage.list('world-');
    request.result = ['world-a', 'settings', 1, 'world-b'];
    transaction.oncomplete();
    expect(await list).toEqual(['world-a', 'world-b']);
    const removed = storage.remove('world-a');
    transaction.oncomplete();
    await expect(removed).resolves.toBeUndefined();
  });

  it('propagates quota errors and interrupted transactions rather than reporting success', async () => {
    const storage = await open();
    const failedWrite = storage.write('world-a', 'data');
    transaction.error = new Error('quota');
    transaction.onerror();
    await expect(failedWrite).rejects.toThrow('quota');
    transaction.error = null;
    const interrupted = storage.write('world-a', 'data');
    transaction.onabort();
    await expect(interrupted).rejects.toThrow('interrupted');
  });

  it('reports blocked and failed database initialization', async () => {
    const blocked = IndexedDbStorage.open();
    openRequest.onblocked();
    await expect(blocked).rejects.toThrow('blocked');
    const failed = IndexedDbStorage.open();
    openRequest.error = new Error('storage unavailable');
    openRequest.onerror();
    await expect(failed).rejects.toThrow('storage unavailable');
  });
});
