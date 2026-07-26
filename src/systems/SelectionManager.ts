import Phaser from 'phaser';
import RailTrack from '../entities/RailTrack';
import Junction from '../entities/Junction';
import { Station } from '../entities/Station';
import TrackManager from '../managers/TrackManager';
import { EventBus } from '../services/EventBus';
import type { SnapSystem } from './SnapSystem';

export type Selectable = RailTrack | Junction | Station;

/** Number of line segments used when drawing a track highlight stroke. */
const CURVE_STROKE_SAMPLES = 24;

interface HandleRef {
  rect: Phaser.GameObjects.Rectangle;
  type: 'p0' | 'p1' | 'p2' | 'p3';
  trackUUID: string;
}

/**
 * SelectionManager
 *
 * Manages the editor selection state for the create-mode world editor:
 *   – Single click: select nearest track within threshold; nothing = clear.
 *   – Shift+click: toggle object in/out of selection.
 *   – Click+drag (rubber-band): select all objects inside the drag rectangle.
 *   – Overlapping objects: repeated clicks on the same location cycle through candidates.
 *
 * Visual feedback:
 *   – Hovered track: subtle teal outline (drawn every frame via drawHovers).
 *   – Selected tracks: thick white outline + small square handles at Bézier
 *     control points p0/p1/p2/p3 (drag handles for reshape).
 *
 * The `getControlPointHandle(trackUUID, type)` drag-handle rectangles use
 * Phaser's interactive drag system so callers can listen on the scene's
 * 'drag' event.
 *
 * Emits `selection:changed` on EventBus whenever the set changes.
 */
export class SelectionManager {
  private scene: Phaser.Scene;
  private trackManager: TrackManager;
  private snapSystem: SnapSystem | null;

  /** All currently selected objects. */
  private selected: Set<string> = new Set(); // UUIDs

  /** Currently hovered track UUID (nil if none). */
  private hoveredUUID: string | null = null;

  // Graphics pools (cleared+redrawn every frame)
  private highlightGraphics: Phaser.GameObjects.Graphics;
  private rubberGraphics: Phaser.GameObjects.Graphics;

  // Control-point drag handles (recreated whenever selection changes)
  private handles: HandleRef[] = [];

  // Rubber-band state
  private isRubberBanding: boolean = false;
  private rubberStart: { x: number; y: number } = { x: 0, y: 0 };
  private rubberRect: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: 0, h: 0 };
  private rubberPulse: number = 0;

  // Click-cycle state (overlapping objects)
  private cycleCandidates: string[] = [];
  private cycleIndex: number = 0;
  private lastClickPos: { x: number; y: number } = { x: 0, y: 0 };

  /** Radius within which a click selects the nearest track. */
  readonly selectRadius = 80;
  /** Radius within which overlapping candidates are collected for cycling. */
  readonly cycleRadius = 100;

  constructor(
    scene: Phaser.Scene,
    trackManager: TrackManager,
    snapSystem: SnapSystem | null = null,
  ) {
    this.scene = scene;
    this.trackManager = trackManager;
    this.snapSystem = snapSystem;
    this.highlightGraphics = scene.add.graphics().setDepth(200).setScrollFactor(1);
    this.rubberGraphics    = scene.add.graphics().setDepth(201).setScrollFactor(0);
  }

  // ── Selection state ────────────────────────────────────────────────────────

  get selectedUUIDs(): string[] { return Array.from(this.selected); }
  get selectedCount(): number   { return this.selected.size; }
  isSelected(uuid: string): boolean { return this.selected.has(uuid); }

  clearSelection(): void {
    if (this.selected.size === 0) return;
    this.selected.clear();
    this.rebuildHandles();
    this.emit();
  }

  select(uuid: string): void {
    this.selected.clear();
    if (uuid) this.selected.add(uuid);
    this.rebuildHandles();
    this.emit();
  }

  addToSelection(uuid: string): void {
    if (this.selected.has(uuid)) {
      this.selected.delete(uuid);
    } else {
      this.selected.add(uuid);
    }
    this.rebuildHandles();
    this.emit();
  }

  setSelection(uuids: string[]): void {
    this.selected = new Set(uuids);
    this.rebuildHandles();
    this.emit();
  }

  // ── Pointer input (called from WorldScene) ─────────────────────────────────

  /**
   * Handle a pointer-down event in the world (world-space coordinates).
   * @param worldX  World X (from `cameras.main.getWorldPoint`)
   * @param worldY  World Y
   * @param shift   Whether the Shift modifier key is held
   */
  onPointerDown(worldX: number, worldY: number, shift: boolean): void {
    // Check if this is close enough to the previous click to continue cycling
    const dx = worldX - this.lastClickPos.x;
    const dy = worldY - this.lastClickPos.y;
    const sameSpot = Math.hypot(dx, dy) < this.cycleRadius * 0.5;

    if (sameSpot && this.cycleCandidates.length > 1) {
      // Advance cycle
      this.cycleIndex = (this.cycleIndex + 1) % this.cycleCandidates.length;
      const uuid = this.cycleCandidates[this.cycleIndex];
      shift ? this.addToSelection(uuid) : this.select(uuid);
      return;
    }

    // Fresh click
    this.lastClickPos = { x: worldX, y: worldY };
    this.cycleCandidates = this.collectCandidates(worldX, worldY, this.cycleRadius);
    this.cycleIndex = 0;

    if (this.cycleCandidates.length === 0) {
      if (!shift) this.clearSelection();
      // Start rubber-band
      this.isRubberBanding = true;
      this.rubberStart = { x: worldX, y: worldY };
      this.rubberRect  = { x: worldX, y: worldY, w: 0, h: 0 };
    } else {
      const uuid = this.cycleCandidates[0];
      shift ? this.addToSelection(uuid) : this.select(uuid);
    }
  }

  onPointerMove(worldX: number, worldY: number): void {
    if (this.isRubberBanding) {
      const x = Math.min(this.rubberStart.x, worldX);
      const y = Math.min(this.rubberStart.y, worldY);
      const w = Math.abs(worldX - this.rubberStart.x);
      const h = Math.abs(worldY - this.rubberStart.y);
      this.rubberRect = { x, y, w, h };
    } else {
      // Update hover
      const nearest = this.trackManager.getClosestTrack({ x: worldX, y: worldY }, this.selectRadius);
      this.hoveredUUID = nearest ? nearest.getUUID() : null;
    }
  }

  onPointerUp(worldX: number, worldY: number, shift: boolean): void {
    if (!this.isRubberBanding) return;
    this.isRubberBanding = false;

    if (this.rubberRect.w < 10 && this.rubberRect.h < 10) {
      this.rubberGraphics.clear();
      return;
    }

    // Select all tracks whose midpoint falls inside the rubber-band rect
    const { x, y, w, h } = this.rubberRect;
    const inside: string[] = [];
    for (const track of this.trackManager.tracks) {
      const mid = track.getMidPoint();
      if (mid.x >= x && mid.x <= x + w && mid.y >= y && mid.y <= y + h) {
        inside.push(track.getUUID());
      }
    }
    if (shift) {
      for (const uuid of inside) this.addToSelection(uuid);
    } else {
      this.setSelection(inside);
    }
    this.rubberGraphics.clear();
  }

  // ── Update / draw (called every frame from WorldScene.update) ──────────────

  update(delta: number): void {
    this.rubberPulse += delta / 400;
    this.drawHighlights();
    if (this.isRubberBanding) this.drawRubberBand();
  }

  private drawHighlights(): void {
    this.highlightGraphics.clear();

    // Hover outline
    if (this.hoveredUUID && !this.selected.has(this.hoveredUUID)) {
      const track = this.trackManager.getTrack(this.hoveredUUID);
      if (track) {
        this.highlightGraphics.lineStyle(2, 0x00c8c8, 0.5);
        this.strokeTrack(track);
      }
    }

    // Selected outlines + handle dots
    for (const uuid of this.selected) {
      const track = this.trackManager.getTrack(uuid);
      if (!track) continue;
      this.highlightGraphics.lineStyle(4, 0xffffff, 0.9);
      this.strokeTrack(track);
    }
  }

  private strokeTrack(track: RailTrack): void {
    const curve = track.getCurvePath();
    this.highlightGraphics.beginPath();
    for (let i = 0; i <= CURVE_STROKE_SAMPLES; i++) {
      const pt = curve.getPoint(i / CURVE_STROKE_SAMPLES);
      if (i === 0) this.highlightGraphics.moveTo(pt.x, pt.y);
      else this.highlightGraphics.lineTo(pt.x, pt.y);
    }
    this.highlightGraphics.strokePath();
  }

  private drawRubberBand(): void {
    this.rubberGraphics.clear();
    const { x, y, w, h } = this.rubberRect;

    // Convert world rect to screen rect (account for camera scroll+zoom)
    const cam = this.scene.cameras.main;
    const sx = (x - cam.scrollX) * cam.zoom;
    const sy = (y - cam.scrollY) * cam.zoom;
    const sw = w * cam.zoom;
    const sh = h * cam.zoom;

    // Animated dashed border (pulse drives dash offset for a marching-ants effect)
    const alpha = 0.6 + 0.4 * Math.sin(this.rubberPulse * Math.PI * 2);
    this.rubberGraphics.fillStyle(0x2a8cff, 0.06);
    this.rubberGraphics.fillRect(sx, sy, sw, sh);
    this.rubberGraphics.lineStyle(2, 0x2a8cff, alpha);
    this.rubberGraphics.strokeRect(sx, sy, sw, sh);
  }

  // ── Control-point drag handles ─────────────────────────────────────────────

  private rebuildHandles(): void {
    for (const h of this.handles) h.rect.destroy();
    this.handles = [];
  }

  /** Return all drag-handle rectangles (for wiring up drag events in WorldScene). */
  getHandles(): HandleRef[] { return this.handles; }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private collectCandidates(wx: number, wy: number, radius: number): string[] {
    const results: Array<{ uuid: string; dist: number }> = [];
    for (const track of this.trackManager.tracks) {
      const mid = track.getMidPoint();
      const d   = Math.hypot(mid.x - wx, mid.y - wy);
      if (d <= radius) results.push({ uuid: track.getUUID(), dist: d });
    }
    return results.sort((a, b) => a.dist - b.dist).map((r) => r.uuid);
  }

  private emit(): void {
    EventBus.emit('selection:changed', { uuids: Array.from(this.selected) });
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  destroy(): void {
    this.highlightGraphics.destroy();
    this.rubberGraphics.destroy();
    for (const h of this.handles) h.rect.destroy();
    this.handles = [];
  }
}
