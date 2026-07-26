import {
  Scene,
  TransformNode,
  Mesh,
  MeshBuilder,
  Vector3,
  PBRMaterial,
  Color3,
  Space,
} from '@babylonjs/core';
import {
  CAB_PARTS,
  CAB_MATERIALS,
  getCabPartBuildOrder,
  type CabPart,
  type CabMaterialDef,
} from '../cab/CabPartLibrary';
import { degToRad } from '../model/CabCoordinate';

/**
 * Babylon-side builder for the static cab interior.
 *
 * Walks the frozen part tables from {@link CabPartLibrary} and creates meshes
 * parented to the supplied body/eye node. All materials are PBR; dynamic
 * instrument faces use plain placeholder colours in this phase.
 */
export class CabInteriorBuilder {
  private root: TransformNode | null = null;
  private readonly materialCache = new Map<string, PBRMaterial>();
  private readonly createdNodes = new Map<string, TransformNode | Mesh>();

  constructor(private readonly scene: Scene) {}

  /** Build the entire cab interior under the given parent node. */
  build(parent: TransformNode): void {
    this.dispose();

    this.root = new TransformNode('cabInteriorRoot', this.scene);
    this.root.parent = parent;

    const ordered = getCabPartBuildOrder(CAB_PARTS);

    for (const part of ordered) {
      const node = this.createPart(part);
      const parentNode = part.parent
        ? this.createdNodes.get(part.parent)
        : this.root;
      node.parent = parentNode ?? this.root;
      this.createdNodes.set(part.id, node);
    }
  }

  /** Look up a created node by its cab part id. */
  getNode(id: string): TransformNode | Mesh | undefined {
    return this.createdNodes.get(id);
  }

  /** Look up a created material by its cab material id. */
  getMaterial(id: string): PBRMaterial | undefined {
    return this.materialCache.get(id);
  }

  /** Release all meshes, nodes and materials owned by this builder. */
  dispose(): void {
    this.root?.dispose();
    this.root = null;
    this.createdNodes.clear();

    for (const material of this.materialCache.values()) {
      material.dispose(false, true);
    }
    this.materialCache.clear();
  }

  private createPart(part: CabPart): TransformNode | Mesh {
    if (part.kind === 'node') {
      const node = new TransformNode(part.id, this.scene);
      node.position = this.vectorFrom(part.position);
      node.rotation = this.rotationFrom(part.rotationDeg);
      return node;
    }

    const mesh = this.createMeshForPart(part);
    mesh.position = this.vectorFrom(part.position);
    mesh.rotation = this.rotationFrom(part.rotationDeg);

    if (part.id.toLowerCase().includes('needle')) {
      const halfLength = (part.size[2] ?? 1) / 2;
      mesh.setPivotPoint(new Vector3(0, 0, -halfLength), Space.LOCAL);
    }

    if (part.material) {
      mesh.material = this.getOrCreateMaterial(part.material);
    }

    mesh.isPickable = false;
    return mesh;
  }

  private createMeshForPart(part: CabPart): Mesh {
    switch (part.kind) {
      case 'box':
        return MeshBuilder.CreateBox(
          part.id,
          {
            width: part.size[0] ?? 1,
            height: part.size[1] ?? 1,
            depth: part.size[2] ?? 1,
          },
          this.scene,
        );
      case 'cylinder':
        return MeshBuilder.CreateCylinder(
          part.id,
          {
            diameter: part.size[0] ?? 1,
            height: part.size[1] ?? 1,
          },
          this.scene,
        );
      case 'sphere':
        return MeshBuilder.CreateSphere(
          part.id,
          { diameter: part.size[0] ?? 1 },
          this.scene,
        );
      case 'plane':
        return MeshBuilder.CreatePlane(
          part.id,
          {
            width: part.size[0] ?? 1,
            height: part.size[1] ?? 1,
            sideOrientation:
              part.material === 'glassScreen' ? Mesh.DOUBLESIDE : Mesh.FRONTSIDE,
          },
          this.scene,
        );
      default:
        throw new Error(`Unexpected cab part kind for ${part.id}`);
    }
  }

  private getOrCreateMaterial(materialId: string): PBRMaterial {
    if (this.materialCache.has(materialId)) {
      return this.materialCache.get(materialId)!;
    }

    const def = CAB_MATERIALS[materialId];
    if (!def) {
      throw new Error(`Cab material ${materialId} not found`);
    }

    const mat = new PBRMaterial(def.id, this.scene);
    mat.albedoColor = Color3.FromHexString(def.baseColor);
    mat.metallic = def.metallic;
    mat.roughness = def.roughness;

    if (def.alpha !== undefined && def.alpha < 1) {
      mat.alpha = def.alpha;
      mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
      mat.backFaceCulling = false;
    } else {
      mat.transparencyMode = PBRMaterial.PBRMATERIAL_OPAQUE;
    }

    if (def.emissiveColor) {
      mat.emissiveColor = Color3.FromHexString(def.emissiveColor);
      mat.emissiveIntensity = def.emissiveIntensity ?? 1;
    }

    this.materialCache.set(materialId, mat);
    return mat;
  }

  private vectorFrom(values: readonly number[]): Vector3 {
    return new Vector3(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0);
  }

  private rotationFrom(degrees: readonly number[]): Vector3 {
    return new Vector3(
      degToRad(degrees[0] ?? 0),
      degToRad(degrees[1] ?? 0),
      degToRad(degrees[2] ?? 0),
    );
  }
}
