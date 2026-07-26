import {
  Scene,
  TransformNode,
  Mesh,
  VertexData,
  MeshBuilder,
  PBRMaterial,
  Color3,
  RawTexture,
  Texture,
  Constants,
  Vector3,
} from '@babylonjs/core';
import { buildTerrainVertexData, snapToGrid } from '../world/TerrainGeometry';
import { worldToBabylon } from '../model/CabCoordinate';
import { CabConfig } from '../CabConfig';
import type { CabWorldSnapshot } from '../model/CabWorldSnapshot';

interface Position3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Babylon-side terrain and water mesh builder.
 *
 * Builds three LOD rings centred on the driver eye, re-centred when the eye
 * crosses a 64 m boundary.  Water is a simple translucent plane with a
 * placeholder scrolling normal map.
 */
export class TerrainMeshBuilder {
  private root: TransformNode | null = null;
  private waterBumpTexture: RawTexture | null = null;
  private lastOriginX: number | null = null;
  private lastOriginY: number | null = null;
  private lastFarTerrainRing: boolean | null = null;

  constructor(private readonly scene: Scene) {}

  /**
   * Rebuild the terrain rings when the eye has moved far enough.
   */
  build(
    snapshot: CabWorldSnapshot,
    eyePosition: Position3 | null,
  ): void {
    if (!snapshot.valid || !snapshot.terrain) {
      this.dispose();
      return;
    }

    const eye = eyePosition ?? { x: 0, y: 0, z: 0 };
    const worldX = eye.x;
    const worldY = -eye.z;

    const originX = snapToGrid(worldX, CabConfig.TERRAIN_REBUILD_DISTANCE_M);
    const originY = snapToGrid(worldY, CabConfig.TERRAIN_REBUILD_DISTANCE_M);
    const farTerrainRing = snapshot.farTerrainRing ?? true;

    if (
      this.root &&
      this.lastOriginX === originX &&
      this.lastOriginY === originY &&
      this.lastFarTerrainRing === farTerrainRing
    ) {
      return;
    }

    this.dispose();

    this.root = new TransformNode('terrainRoot', this.scene);
    const rootPos = worldToBabylon(originX, originY, 0);
    this.root.position = new Vector3(rootPos.x, rootPos.y, rootPos.z);

    const activeRings = farTerrainRing
      ? CabConfig.TERRAIN_RINGS
      : CabConfig.TERRAIN_RINGS.slice(0, -1);

    const vertexData = buildTerrainVertexData({
      originX,
      originY,
      rings: activeRings,
      getHeightAt: snapshot.terrain.getHeightAt,
      biome: snapshot.biome,
      skirtDepth: CabConfig.TERRAIN_SKIRT_DEPTH_M,
    });

    const terrain = new Mesh('terrain', this.scene);
    const vd = new VertexData();
    vd.positions = vertexData.positions;
    vd.normals = vertexData.normals;
    vd.colors = vertexData.colors;
    vd.indices = vertexData.indices;
    vd.applyToMesh(terrain);
    terrain.useVertexColors = true;
    terrain.material = this.createTerrainMaterial();
    terrain.parent = this.root;
    terrain.receiveShadows = true;

    const farRing = activeRings[activeRings.length - 1];
    const water = MeshBuilder.CreateGround(
      'water',
      {
        width: farRing.extent,
        height: farRing.extent,
        subdivisions: 1,
      },
      this.scene,
    );
    water.material = this.createWaterMaterial();
    water.parent = this.root;

    this.lastOriginX = originX;
    this.lastOriginY = originY;
    this.lastFarTerrainRing = farTerrainRing;
  }

  /** Scroll the water normal map placeholder. */
  update(elapsedSecs: number): void {
    if (this.waterBumpTexture) {
      this.waterBumpTexture.uOffset =
        elapsedSecs * CabConfig.TERRAIN_WATER_SCROLL_U;
      this.waterBumpTexture.vOffset =
        elapsedSecs * CabConfig.TERRAIN_WATER_SCROLL_V;
    }
  }

  /** Release all meshes, materials and GPU buffers. */
  dispose(): void {
    this.root?.dispose();
    this.root = null;
    this.waterBumpTexture = null;
    this.lastOriginX = null;
    this.lastOriginY = null;
    this.lastFarTerrainRing = null;
  }

  private createTerrainMaterial(): PBRMaterial {
    const mat = new PBRMaterial('terrainMat', this.scene);
    mat.albedoColor = new Color3(1, 1, 1);
    mat.roughness = 0.9;
    mat.metallic = 0.0;
    mat.alpha = 1.0;
    mat.backFaceCulling = false;
    mat.transparencyMode = PBRMaterial.PBRMATERIAL_OPAQUE;
    return mat;
  }

  private createWaterMaterial(): PBRMaterial {
    const mat = new PBRMaterial('waterMat', this.scene);
    mat.albedoColor = new Color3(0.1, 0.35, 0.6);
    mat.alpha = CabConfig.TERRAIN_WATER_ALPHA;
    mat.roughness = CabConfig.TERRAIN_WATER_ROUGHNESS;
    mat.metallic = 0.0;
    mat.backFaceCulling = false;
    mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;

    const size = 4;
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 128;
      data[i + 1] = 128;
      data[i + 2] = 255;
      data[i + 3] = 255;
    }

    const bump = new RawTexture(
      data,
      size,
      size,
      Constants.TEXTUREFORMAT_RGBA,
      this.scene,
      false,
      false,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
    this.waterBumpTexture = bump;
    mat._bumpTexture = bump;

    return mat;
  }
}
