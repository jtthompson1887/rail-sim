import Phaser from 'phaser';
import type { FacilityInspectionDto } from '../economy/FacilityPresentation';
import type { FacilityId } from '../economy/EconomyData';
import { EventBus } from '../services/EventBus';
import { drawFacilityArt, facilityArtKey } from '../presentation/FacilityArt';

const MARKER_RADIUS_PX = 12;
const NAME_OFFSET_PX = 13;
const STATUS_OFFSET_PX = 9;
const BAR_OFFSET_PX = 28;
const BAR_WIDTH_PX = 70;
const BAR_HEIGHT_PX = 5;
const RING_WIDTH_PX = 2;

export interface FacilityViewPlacement {
  readonly id: FacilityId;
  readonly x: number;
  readonly y: number;
  readonly railAccessX: number;
  readonly railAccessY: number;
  readonly railAccessRadius: number;
}

/** A read-only map representation driven exclusively by inspection DTOs. */
export class FacilityView {
  readonly facilityId: FacilityId;
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly ground: Phaser.GameObjects.Graphics;
  private readonly buildings: Phaser.GameObjects.Graphics;
  private readonly hitTarget: Phaser.GameObjects.Arc;
  private readonly hitArea: Phaser.Geom.Circle;
  private readonly nameText: Phaser.GameObjects.Text;
  private readonly statusText: Phaser.GameObjects.Text;
  private current: FacilityInspectionDto;
  private selected = false;
  private selectionEnabled = true;
  private renderedArtKey = '';

  constructor(
    private readonly scene: Phaser.Scene,
    readonly placement: FacilityViewPlacement,
    inspection: FacilityInspectionDto,
  ) {
    this.facilityId = placement.id;
    this.current = inspection;
    this.ground = scene.add.graphics().setDepth(-15);
    this.buildings = scene.add.graphics().setDepth(32);
    this.graphics = scene.add.graphics().setDepth(34);
    this.hitArea = new Phaser.Geom.Circle(
      MARKER_RADIUS_PX,
      MARKER_RADIUS_PX,
      MARKER_RADIUS_PX,
    );
    this.hitTarget = scene.add.circle(
      placement.x,
      placement.y - 170,
      MARKER_RADIUS_PX,
      0xffffff,
      0.001,
    ).setInteractive(this.hitArea, Phaser.Geom.Circle.Contains);
    this.hitTarget.on('pointerdown', (
      _pointer: Phaser.Input.Pointer,
      _localX: number,
      _localY: number,
      event: Phaser.Types.Input.EventData,
    ) => {
      if (!this.selectionEnabled) return;
      event.stopPropagation();
      EventBus.emit('facility:selected', { facilityId: this.facilityId });
    });
    this.nameText = scene.add.text(
      placement.x,
      placement.y,
      inspection.name,
      {
        fontFamily: 'Verdana',
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#314b43',
        backgroundColor: '#e0d9bdd9',
        padding: { x: 5, y: 2 },
      },
    ).setOrigin(0.5, 1).setDepth(35);
    this.statusText = scene.add.text(
      placement.x,
      placement.y,
      inspection.status.label,
      {
        fontFamily: 'Verdana',
        fontSize: '11px',
        color: '#bfe7fb',
        backgroundColor: '#06131fe6',
        padding: { x: 4, y: 2 },
      },
    ).setOrigin(0.5, 0).setDepth(35);
    this.update(inspection, 1, false);
  }

  update(
    inspection: FacilityInspectionDto,
    cameraZoom: number,
    selected = this.selected,
  ): void {
    if (!Number.isFinite(cameraZoom) || cameraZoom <= 0) return;
    this.current = inspection;
    this.selected = selected;
    const scale = 1 / cameraZoom;
    const {
      x,
      y,
      railAccessX,
      railAccessY,
      railAccessRadius,
    } = this.placement;
    const colour = inspection.railConnected ? 0x69df9a : 0xffc66d;
    const statusColour = inspection.status.code === 'working'
      ? '#9af0b6'
      : inspection.status.code === 'output-full'
        ? '#ff9b86'
        : '#ffe39a';
    const key = facilityArtKey(inspection);
    if (key !== this.renderedArtKey) {
      drawFacilityArt(this.ground, this.buildings, inspection, x, y);
      this.renderedArtKey = key;
    }
    this.graphics.clear();
    if (selected) {
      this.graphics.lineStyle(RING_WIDTH_PX * scale, colour, 0.8);
      this.graphics.strokeCircle(railAccessX, railAccessY, railAccessRadius);
    }

    const stock = inspection.inventories.reduce(
      (sum, slot) => sum + slot.quantity,
      0,
    );
    const capacity = inspection.inventories.reduce(
      (sum, slot) => sum + slot.capacity,
      0,
    );
    const barX = x - BAR_WIDTH_PX * scale / 2;
    const barY = y + BAR_OFFSET_PX * scale;
    if (selected) {
      this.graphics.fillStyle(0x0d2535, 0.95);
      this.graphics.fillRect(barX, barY, BAR_WIDTH_PX * scale, BAR_HEIGHT_PX * scale);
      this.graphics.fillStyle(colour, 0.95);
      this.graphics.fillRect(barX, barY, BAR_WIDTH_PX * scale * (capacity > 0 ? stock / capacity : 0), BAR_HEIGHT_PX * scale);
    }

    this.nameText
      .setText(inspection.name)
      .setPosition(x, y - 382 - NAME_OFFSET_PX * scale)
      .setScale(scale);
    this.statusText
      .setText(inspection.status.label)
      .setColor(statusColour)
      .setPosition(x, y + STATUS_OFFSET_PX * scale)
      .setScale(scale)
      .setVisible(selected);
    const hitRadius = Math.max(282, MARKER_RADIUS_PX * scale);
    this.hitTarget.setRadius(hitRadius);
    this.hitArea.setTo(hitRadius, hitRadius, hitRadius);
  }

  setSelected(selected: boolean): void {
    this.update(this.current, this.scene.cameras.main.zoom, selected);
  }

  setSelectionEnabled(enabled: boolean): void {
    this.selectionEnabled = enabled;
  }

  destroy(): void {
    this.ground.destroy();
    this.buildings.destroy();
    this.graphics.destroy();
    this.hitTarget.destroy();
    this.nameText.destroy();
    this.statusText.destroy();
  }
}
