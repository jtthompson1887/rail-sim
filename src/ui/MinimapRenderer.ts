import Phaser from 'phaser';
import type TrackManager from '../managers/TrackManager';
import type { SelectionManager } from '../systems/SelectionManager';

/**
 * MinimapRenderer – draws a small overview of all tracks in screen-space.
 *
 * Extracted from WorldScene to keep the scene focused on orchestration.
 */
export class MinimapRenderer {
  private readonly scene: Phaser.Scene;
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly trackManager: TrackManager;
  private readonly selectionManager: SelectionManager;

  constructor(scene: Phaser.Scene, trackManager: TrackManager, selectionManager: SelectionManager) {
    this.scene = scene;
    this.trackManager = trackManager;
    this.selectionManager = selectionManager;
    this.graphics = scene.add.graphics().setDepth(601);
  }

  draw(): void {
    const { width, height } = this.scene.scale;
    const mapW = 180;
    const mapH = 120;
    const mapX = width - mapW - 16;
    const mapY = height - mapH - 16;

    this.graphics.clear();
    this.graphics.fillStyle(0x06131f, 0.85);
    this.graphics.fillRect(mapX, mapY, mapW, mapH);
    this.graphics.lineStyle(1, 0xffffff, 0.3);
    this.graphics.strokeRect(mapX, mapY, mapW, mapH);

    const tracks = this.trackManager.tracks;
    if (tracks.length === 0) return;

    const sampledTracks = tracks.map((track) => ({
      track,
      points: Array.from(
        { length: 9 },
        (_, index) => track.getCurvePath().getPoint(index / 8),
      ),
    }));
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const { points } of sampledTracks) {
      for (const point of points) {
        minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
      }
    }
    const worldW = Math.max(maxX - minX, 1);
    const worldH = Math.max(maxY - minY, 1);

    const toMap = (x: number, y: number) => ({
      mx: mapX + ((x - minX) / worldW) * mapW,
      my: mapY + ((y - minY) / worldH) * mapH,
    });

    for (const { track: t, points } of sampledTracks) {
      const isConnected = t.hasNext() || t.hasPrevious();
      const isSelected  = this.selectionManager.isSelected(t.getUUID());
      const color = isSelected ? 0xffffff : (isConnected ? 0x00ff88 : 0xff4444);
      this.graphics.lineStyle(isSelected ? 2 : 1, color, 0.9);
      this.graphics.beginPath();
      for (let i = 0; i < points.length; i++) {
        const pt = points[i];
        const { mx, my } = toMap(pt.x, pt.y);
        if (i === 0) this.graphics.moveTo(mx, my);
        else this.graphics.lineTo(mx, my);
      }
      this.graphics.strokePath();
    }
  }

  clear(): void {
    this.graphics.clear();
  }

  destroy(): void {
    this.graphics.destroy();
  }
}
