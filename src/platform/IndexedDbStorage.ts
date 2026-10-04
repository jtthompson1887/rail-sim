import type { StoragePort } from '../persistence/StoragePort';

export class IndexedDbStorage implements StoragePort {
  readonly kind = 'indexeddb' as const;
  private constructor(private readonly database: IDBDatabase) {}

  static open(name = 'rail-sim-durable-saves'): Promise<IndexedDbStorage> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('files');
      request.onsuccess = () => resolve(new IndexedDbStorage(request.result));
      request.onerror = () => reject(request.error ?? new Error('Could not open save database'));
      request.onblocked = () => reject(new Error('Save database is blocked by another app window'));
    });
  }

  read(key: string): Promise<string | null> {
    return this.transaction('readonly', (store) => store.get(key)).then((value) => value ?? null);
  }
  write(key: string, value: string): Promise<void> {
    return this.transaction('readwrite', (store) => store.put(value, key)).then(() => undefined);
  }
  remove(key: string): Promise<void> {
    return this.transaction('readwrite', (store) => store.delete(key)).then(() => undefined);
  }
  list(prefix: string): Promise<string[]> {
    return this.transaction('readonly', (store) => store.getAllKeys())
      .then((keys) => keys.filter((key) => typeof key === 'string' && key.startsWith(prefix)) as string[]);
  }
  private transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction('files', mode);
      const request = operation(transaction.objectStore('files'));
      // A successful request is not a committed transaction.
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? request.error ?? new Error('Save transaction failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Save transaction interrupted'));
    });
  }
}
