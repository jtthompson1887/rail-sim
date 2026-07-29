import {
  Scene,
  Mesh,
  TransformNode,
  PBRMaterial,
  DynamicTexture,
  Color3,
} from '@babylonjs/core';
import { CabInteriorBuilder } from './CabInteriorBuilder';
import {
  buildCabInstrumentState,
  CAB_GAUGE_FACE_DEFS,
  type CabInstrumentState,
  type CabGaugeDef,
} from '../cab/CabInstrumentModel';
import { drawGauge, drawAws, drawNotice, type CanvasLike } from '../cab/CabGaugeArtist';
import type { CabWorldSnapshot } from '../model/CabWorldSnapshot';

const GAUGE_TEXTURE_SIZE = 512;

/**
 * Babylon-side builder for live cab instruments.
 *
 * Creates dynamic gauge textures and updates needles and control levers each
 * frame from the pure {@link CabInstrumentModel}.
 */
export class CabInstrumentBuilder {
  private readonly needleMeshes = new Map<string, Mesh>();
  private readonly dynamicTextures = new Map<string, DynamicTexture>();
  private lastAwsActive = false;
  private awsMaterial?: PBRMaterial;
  private awsTexture?: DynamicTexture;

  constructor(
    private readonly scene: Scene,
    private readonly cabInteriorBuilder: CabInteriorBuilder,
  ) {}

  /** Build gauge textures and resolve needle/control nodes. */
  build(): void {
    this.collectNeedles();
    this.createGaugeTextures();
    this.createAwsTexture();
    this.createNoticeTexture();
  }

  /** Update needles and levers from the current snapshot. */
  update(snapshot: CabWorldSnapshot): void {
    const state = buildCabInstrumentState(snapshot);

    this.updateNeedle('gaugeSpeedoNeedle', state.speed.angleRad);
    this.updateNeedle('needleBrakePipe', state.brakePipe.angleRad);
    this.updateNeedle('needleMainRes', state.mainReservoir.angleRad);
    this.updateNeedle('needleBrakeCyl', state.brakeCylinder.angleRad);
    this.updateNeedle('needleAmmeter', state.ammeter.angleRad);

    this.updateLeverPivot('powerPivot', state.powerLever.angleRad, 'x');
    this.updateLeverPivot('brakePivot', state.brakeLever.angleRad, 'x');
    this.updateLeverMesh('reverserStub', state.reverser.angleRad, 'x');

    if (state.awsActive !== this.lastAwsActive && this.awsTexture) {
      this.redrawAws(state.awsActive);
      this.lastAwsActive = state.awsActive;
    }
  }

  private updateNeedle(id: string, angleRad: number): void {
    const mesh = this.needleMeshes.get(id);
    if (!mesh) return;
    mesh.rotation.y = angleRad;
  }

  private updateLeverPivot(id: string, angleRad: number, axis: 'x'): void {
    const node = this.cabInteriorBuilder.getNode(id) as TransformNode | undefined;
    if (!node) return;
    if (axis === 'x') {
      node.rotation.x = angleRad;
    }
  }

  private updateLeverMesh(id: string, angleRad: number, axis: 'x'): void {
    const mesh = this.cabInteriorBuilder.getNode(id) as Mesh | undefined;
    if (!mesh) return;
    if (axis === 'x') {
      mesh.rotation.x = angleRad;
    }
  }

  private collectNeedles(): void {
    const ids = [
      'gaugeSpeedoNeedle',
      'needleBrakePipe',
      'needleMainRes',
      'needleBrakeCyl',
      'needleAmmeter',
    ];
    for (const id of ids) {
      const node = this.cabInteriorBuilder.getNode(id);
      if (node instanceof Mesh) {
        this.needleMeshes.set(id, node);
      }
    }
  }

  private createGaugeTextures(): void {
    for (const face of CAB_GAUGE_FACE_DEFS) {
      const material = this.cabInteriorBuilder.getMaterial(face.materialId);
      if (!material) continue;

      const texture = this.buildDynamicTexture(
        `gaugeFace_${face.materialId}`,
        (ctx) => drawGauge(ctx, {
          size: GAUGE_TEXTURE_SIZE,
          min: face.gauge.min,
          max: face.gauge.max,
          startAngleDeg: face.gauge.startAngleDeg,
          sweepAngleDeg: face.gauge.sweepAngleDeg,
          unit: face.gauge.unit,
          majorTicks: face.gauge.majorTicks,
          title: face.label,
        }),
      );

      material.albedoColor = new Color3(1, 1, 1);
      material.albedoTexture = texture;
      material.useAlphaFromAlbedoTexture = false;
      this.dynamicTextures.set(face.materialId, texture);
    }
  }

  private createAwsTexture(): void {
    this.awsMaterial = this.cabInteriorBuilder.getMaterial('dynAws');
    if (!this.awsMaterial) return;

    this.awsTexture = this.buildDynamicTexture('awsFace', (ctx) => drawAws(ctx, {
      size: GAUGE_TEXTURE_SIZE,
      active: false,
    }));
    this.awsMaterial.albedoColor = new Color3(1, 1, 1);
    this.awsMaterial.albedoTexture = this.awsTexture;
    this.awsMaterial.useAlphaFromAlbedoTexture = false;
  }

  private createNoticeTexture(): void {
    const material = this.cabInteriorBuilder.getMaterial('dynNotice');
    if (!material) return;

    const texture = this.buildDynamicTexture('noticePlate', (ctx) => drawNotice(ctx, {
      size: GAUGE_TEXTURE_SIZE,
      text: 'NO SMOKING',
    }));

    material.albedoColor = new Color3(1, 1, 1);
    material.albedoTexture = texture;
    material.useAlphaFromAlbedoTexture = false;
    this.dynamicTextures.set('dynNotice', texture);
  }

  private redrawAws(active: boolean): void {
    if (!this.awsTexture) return;
    const ctx = this.awsTexture.getContext() as unknown as CanvasLike;
    drawAws(ctx, { size: GAUGE_TEXTURE_SIZE, active });
    this.awsTexture.update();
  }

  private buildDynamicTexture(
    name: string,
    draw: (ctx: CanvasLike) => void,
  ): DynamicTexture {
    const texture = new DynamicTexture(
      name,
      { width: GAUGE_TEXTURE_SIZE, height: GAUGE_TEXTURE_SIZE },
      this.scene,
      false,
    );
    const ctx = texture.getContext() as unknown as CanvasLike;
    draw(ctx);
    texture.update();
    return texture;
  }
}
