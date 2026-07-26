import Phaser from 'phaser';
import type TrackManager from '../managers/TrackManager';
import type { SelectionManager } from '../systems/SelectionManager';

const MAP_WIDTH = 180;
const MAP_HEIGHT = 120;
const MAP_MARGIN = 16;
const MAP_PADDING = 4;

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

  get screenBounds(): { left: number; right: number; top: number; bottom: number } {
    const left = this.scene.scale.width - MAP_WIDTH - MAP_MARGIN;
    const top = this.scene.scale.height - MAP_HEIGHT - MAP_MARGIN;
    return {
      left,
      right: left + MAP_WIDTH,
      top,
      bottom: top + MAP_HEIGHT,
    };
  }

  containsScreenPoint(x: number, y: number): boolean {
    const bounds = this.screenBounds;
    return x >= bounds.left && x <= bounds.right
      && y >= bounds.top && y <= bounds.bottom;
  }

  draw(): void {
    const { left: mapX, top: mapY } = this.screenBounds;
    const mapW = MAP_WIDTH;
    const mapH = MAP_HEIGHT;

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
    const worldW = maxX - minX;
    const worldH = maxY - minY;
    const innerW = mapW - MAP_PADDING * 2;
    const innerH = mapH - MAP_PADDING * 2;
    let scale = Math.min(
      worldW > 0 ? innerW / worldW : Infinity,
      worldH > 0 ? innerH / worldH : Infinity,
    );
    if (!Number.isFinite(scale)) scale = 1;
    const originX = mapX + MAP_PADDING + (innerW - worldW * scale) / 2;
    const originY = mapY + MAP_PADDING + (innerH - worldH * scale) / 2;

    const toMap = (x: number, y: number) => ({
      mx: originX + (x - minX) * scale,
      my: originY + (y - minY) * scale,
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
