import {
  Scene,
  TransformNode,
  Mesh,
  MeshBuilder,
  Vector3,
  Color3,
  PBRMaterial,
} from '@babylonjs/core';
import type { CabWorldSnapshot } from '../model/CabWorldSnapshot';
import type { SceneryObjectDef } from '../model/CabWorldSnapshot';
import { buildSceneryMatrixBuffers } from '../world/SceneryMatrices';
import { CabConfig } from '../CabConfig';

export type SceneryType = SceneryObjectDef['type'];

interface Position3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Babylon-side instanced scenery builder.
 *
 * One low-poly prototype Mesh is created per `SceneryType` and rendered via
 * `thinInstanceSetBuffer` using pre-built 16-float matrices produced by
 * {@link buildSceneryMatrixBuffers}.
 *
 * The builder disposes and rebuilds its prototype pool when the eye crosses a
 * world chunk boundary.
 */
export class SceneryInstanceBuilder {
  private root: TransformNode | null = null;
  private prototypes: Map<SceneryType, Mesh> = new Map();
  private materials: Map<SceneryType, PBRMaterial> = new Map();
  private lastEyeChunkKey: string | null = null;
  private lastScenery: ReadonlyArray<SceneryObjectDef> | null = null;

  constructor(private readonly scene: Scene) {}

  build(snapshot: CabWorldSnapshot, eyePosition: Position3 | null): void {
    if (
      !snapshot.valid
      || !snapshot.scenery
      || snapshot.scenery.length === 0
      || !eyePosition
      || !snapshot.terrain
    ) {
      this.dispose();
      return;
    }

    const chunkKey = this.eyeChunkKey(eyePosition);
    if (this.lastEyeChunkKey !== chunkKey) {
      this.disposeRoot();
      this.lastEyeChunkKey = chunkKey;
    }

    if (this.lastScenery === snapshot.scenery && this.root) {
      return;
    }

    const buffers = buildSceneryMatrixBuffers(
      snapshot.scenery,
      snapshot.terrain.getHeightAt,
    );

    if (!this.root) {
      this.root = new TransformNode('sceneryRoot', this.scene);
    }

    const presentTypes = new Set<SceneryType>();
    for (const [type, matrixBuffer] of buffers) {
      presentTypes.add(type);
      this.setPrototypeBuffer(type, matrixBuffer);
    }

    // Hide prototypes for scenery types that have disappeared from this chunk.
    for (const [type, mesh] of this.prototypes) {
      if (!presentTypes.has(type)) {
        mesh.setEnabled(false);
      }
    }

    this.lastScenery = snapshot.scenery;
  }

  /** Release the root node, all prototypes and cached materials. */
  dispose(): void {
    this.disposeRoot();
    for (const material of this.materials.values()) {
      material.dispose();
    }
    this.materials.clear();
    this.lastEyeChunkKey = null;
    this.lastScenery = null;
  }

  private eyeChunkKey(eyePosition: Position3): string {
    const worldX = eyePosition.x;
    const worldY = -eyePosition.z;
    const chunkSize = CabConfig.SCENERY_CHUNK_SIZE_M;
    const chunkX = Math.floor(worldX / chunkSize) * chunkSize;
    const chunkY = Math.floor(worldY / chunkSize) * chunkSize;
    return `${chunkX}:${chunkY}`;
  }

  private setPrototypeBuffer(type: SceneryType, matrixBuffer: Float32Array): void {
    let mesh = this.prototypes.get(type);
    if (!mesh) {
      mesh = this.createPrototype(type);
      mesh.parent = this.root;
      mesh.isPickable = false;
      this.prototypes.set(type, mesh);
    }
    mesh.setEnabled(true);
    mesh.thinInstanceSetBuffer('matrix', matrixBuffer, 16);
  }

  private createPrototype(type: SceneryType): Mesh {
    switch (type) {
      case 'tree_oak':
        return this.createOakPrototype();
      case 'tree_pine':
        return this.createPinePrototype();
      case 'tree_birch':
        return this.createBirchPrototype();
      case 'tree_dead':
        return this.createDeadTreePrototype();
      case 'rock_boulder':
        return this.createRockPrototype(1.2, 4);
      case 'rock_outcrop':
        return this.createOutcropPrototype();
      case 'rock_cluster':
        return this.createRockPrototype(0.9, 4);
      case 'terrain_pond':
        return this.createPondPrototype();
      case 'terrain_cliff':
        return this.createCliffPrototype();
      case 'terrain_mound':
        return this.createMoundPrototype();
    }
  }

  private createOakPrototype(): Mesh {
    const trunk = MeshBuilder.CreateCylinder(
      'oakTrunk',
      {
        height: 2.2,
        diameterTop: 0.22,
        diameterBottom: 0.32,
        tessellation: 6,
      },
      this.scene,
    );
    trunk.position.y = 1.1;
    trunk.material = this.trunkMaterial();

    const foliage = MeshBuilder.CreateSphere(
      'oakFoliage',
      { diameter: 2.6, segments: 6 },
      this.scene,
    );
    foliage.position.y = 2.4;
    foliage.material = this.foliageMaterial(0x2d6a1e);

    return this.mergeMeshes([trunk, foliage], 'oakPrototype');
  }

  private createPinePrototype(): Mesh {
    const trunk = MeshBuilder.CreateCylinder(
      'pineTrunk',
      {
        height: 2.5,
        diameterTop: 0.16,
        diameterBottom: 0.28,
        tessellation: 6,
      },
      this.scene,
    );
    trunk.position.y = 1.25;
    trunk.material = this.trunkMaterial();

    const foliage = MeshBuilder.CreateCylinder(
      'pineFoliage',
      {
        height: 3.5,
        diameterTop: 0.8,
        diameterBottom: 2.6,
        tessellation: 7,
      },
      this.scene,
    );
    foliage.position.y = 4.0;
    foliage.material = this.foliageMaterial(0x1a5c14);

    return this.mergeMeshes([trunk, foliage], 'pinePrototype');
  }

  private createBirchPrototype(): Mesh {
    const trunk = MeshBuilder.CreateCylinder(
      'birchTrunk',
      {
        height: 2.8,
        diameterTop: 0.14,
        diameterBottom: 0.22,
        tessellation: 6,
      },
      this.scene,
    );
    trunk.position.y = 1.4;
    trunk.material = this.birchTrunkMaterial();

    const foliage = MeshBuilder.CreateSphere(
      'birchFoliage',
      { diameter: 2.2, segments: 6 },
      this.scene,
    );
    foliage.position.y = 3.0;
    foliage.material = this.foliageMaterial(0x5aaa38);

    return this.mergeMeshes([trunk, foliage], 'birchPrototype');
  }

  private createDeadTreePrototype(): Mesh {
    const trunk = MeshBuilder.CreateCylinder(
      'deadTrunk',
      {
        height: 3.2,
        diameterTop: 0.14,
        diameterBottom: 0.26,
        tessellation: 5,
      },
      this.scene,
    );
    trunk.position.y = 1.6;
    trunk.material = this.trunkMaterial(0x3a2a1a);

    const branches: Mesh[] = [trunk];
    for (let i = 0; i < 3; i++) {
      const branch = MeshBuilder.CreateBox(
        `deadBranch${i}`,
        { width: 0.08, height: 0.9, depth: 0.08 },
        this.scene,
      );
      branch.position.y = 1.8 + i * 0.5;
      branch.position.x = i % 2 === 0 ? 0.25 : -0.25;
      branch.rotation.z = i % 2 === 0 ? 0.5 : -0.5;
      branch.material = trunk.material;
      branches.push(branch);
    }

    return this.mergeMeshes(branches, 'deadTreePrototype');
  }

  private createRockPrototype(diameter: number, segments: number): Mesh {
    const mesh = MeshBuilder.CreateSphere(
      'rock',
      { diameter, segments },
      this.scene,
    );
    mesh.position.y = diameter / 2;
    mesh.material = this.rockMaterial();
    return mesh;
  }

  private createOutcropPrototype(): Mesh {
    const mesh = MeshBuilder.CreateBox(
      'outcrop',
      { width: 1.4, height: 1.0, depth: 1.4 },
      this.scene,
    );
    mesh.position.y = 0.5;
    mesh.material = this.rockMaterial(0x5a5850);
    return mesh;
  }

  private createPondPrototype(): Mesh {
    const mesh = MeshBuilder.CreateCylinder(
      'pond',
      { diameter: 3.0, height: 0.05, tessellation: 12 },
      this.scene,
    );
    mesh.position.y = 0.025;
    mesh.material = this.waterMaterial();
    return mesh;
  }

  private createCliffPrototype(): Mesh {
    const mesh = MeshBuilder.CreateBox(
      'cliff',
      { width: 3.0, height: 4.0, depth: 0.6 },
      this.scene,
    );
    mesh.position.y = 2.0;
    mesh.material = this.rockMaterial(0x6a6050);
    return mesh;
  }

  private createMoundPrototype(): Mesh {
    const mesh = MeshBuilder.CreateSphere(
      'mound',
      { diameter: 2.0, segments: 5 },
      this.scene,
    );
    mesh.position.y = 1.0;
    mesh.material = this.foliageMaterial(0x4a6a2a);
    return mesh;
  }

  private mergeMeshes(meshes: Mesh[], name: string): Mesh {
    const merged = Mesh.MergeMeshes(
      meshes,
      true,
      true,
      undefined,
      false,
      true,
    );
    if (!merged) {
      throw new Error(`Failed to merge scenery prototype: ${name}`);
    }
    merged.name = name;
    merged.position = Vector3.Zero();
    merged.rotation = Vector3.Zero();
    return merged;
  }

  private colorFromHex(color: number): Color3 {
    return Color3.FromInts(
      (color >> 16) & 0xff,
      (color >> 8) & 0xff,
      color & 0xff,
    );
  }

  private trunkMaterial(color = 0x5c3a1e): PBRMaterial {
    const mat = new PBRMaterial('sceneryTrunk', this.scene);
    mat.albedoColor = this.colorFromHex(color);
    mat.metallic = 0.0;
    mat.roughness = 0.95;
    return mat;
  }

  private birchTrunkMaterial(): PBRMaterial {
    const mat = new PBRMaterial('sceneryBirchTrunk', this.scene);
    mat.albedoColor = this.colorFromHex(0xe8e0d0);
    mat.metallic = 0.0;
    mat.roughness = 0.95;
    return mat;
  }

  private foliageMaterial(color: number): PBRMaterial {
    const mat = new PBRMaterial('sceneryFoliage', this.scene);
    mat.albedoColor = this.colorFromHex(color);
    mat.metallic = 0.0;
    mat.roughness = 0.85;
    return mat;
  }

  private rockMaterial(color = 0x6a6860): PBRMaterial {
    const mat = new PBRMaterial('sceneryRock', this.scene);
    mat.albedoColor = this.colorFromHex(color);
    mat.metallic = 0.1;
    mat.roughness = 0.9;
    return mat;
  }

  private waterMaterial(): PBRMaterial {
    const mat = new PBRMaterial('sceneryWater', this.scene);
    mat.albedoColor = this.colorFromHex(0x2a6aaa);
    mat.alpha = 0.72;
    mat.roughness = 0.08;
    mat.metallic = 0.0;
    mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    mat.backFaceCulling = false;
    return mat;
  }

  private disposeRoot(): void {
    this.root?.dispose();
    this.root = null;
    for (const mesh of this.prototypes.values()) {
      mesh.dispose();
    }
    this.prototypes.clear();
  }
}
