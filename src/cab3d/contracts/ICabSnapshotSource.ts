import type { CabWorldSnapshot } from '../model/CabWorldSnapshot';

/**
 * Snapshot source contract.
 *
 * Adapters implement this to read the live Phaser/Matter world and produce a
 * plain, frozen data object that the renderer consumes.
 */
export interface ICabSnapshotSource {
  capture(time: number, delta: number): Readonly<CabWorldSnapshot>;
}
