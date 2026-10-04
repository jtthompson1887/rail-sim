/** App-private key/value files. Reads return null only when the key is absent. */
export interface StoragePort {
  readonly kind: 'electron' | 'capacitor' | 'indexeddb' | 'memory';
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

/** Useful for deterministic recovery tests and headless simulation tools. */
export class MemoryStorage implements StoragePort {
  readonly kind = 'memory' as const;
  readonly files = new Map<string, string>();
  async read(key: string): Promise<string | null> { return this.files.get(key) ?? null; }
  async write(key: string, value: string): Promise<void> { this.files.set(key, value); }
  async remove(key: string): Promise<void> { this.files.delete(key); }
  async list(prefix: string): Promise<string[]> {
    return [...this.files.keys()].filter((key) => key.startsWith(prefix));
  }
}
