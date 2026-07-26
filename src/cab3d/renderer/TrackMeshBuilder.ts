import {
  Scene,
  TransformNode,
  MeshBuilder,
  Mesh,
  AbstractMesh,
  Vector3,
  Matrix,
  PBRMaterial,
  Color3,
} from '@babylonjs/core';
import type { CabWorldSnapshot } from '../model/CabWorldSnapshot';
import { CabConfig } from '../CabConfig';
import {
  getRailProfile,
  getRailCapProfile,
  getBallastProfile,
  getBridgeDeckProfile,
  getRailCenterPositions,
  getSleeperTransforms,
  getPierTransforms,
  getStructureSegments,
  type CabTrackTransform,
} from '../world/TrackGeometry';
import type { CabTrackSample } from '../model/CabWorldSnapshot';
import { worldToBabylon } from '../model/CabCoordinate';

/**
 * Babylon-side track mesh builder.
 *
 * Creates rails, sleepers, ballast, bridge decks, piers and tunnel bores from a
 * {@link CabWorldSnapshot}.  The whole mesh is parented to a single root node so
 * it can be disposed in one call.
 */
export class TrackMeshBuilder {
  private root: TransformNode | null = null;
  private lastRebuildPosition: { x: number; y: number; z: number } | null = null;
  private leftRail: Mesh | null = null;
  private rightRail: Mesh | null = null;
  private leftCap: Mesh | null = null;
  private rightCap: Mesh | null = null;
  private sleeperMesh: Mesh | null = null;

  constructor(private readonly scene: Scene) {}

  /**
   * Rebuild the track mesh when the eye has moved far enough or when the mesh
   * has not yet been built.
   */
  build(
    snapshot: CabWorldSnapshot,
    eyePosition: { x: number; y: number; z: number } | null,
  ): void {
    if (!snapshot.valid || snapshot.path.length < 2) {
      this.dispose();
      return;
    }

    if (eyePosition && this.lastRebuildPosition && this.root) {
      const dx = eyePosition.x - this.lastRebuildPosition.x;
      const dz = eyePosition.z - this.lastRebuildPosition.z;
      const moved = Math.hypot(dx, dz);
      if (moved < CabConfig.PATH_REBUILD_DISTANCE_M) {
        return;
      }
    }

    this.dispose();
    this.root = new TransformNode('trackRoot', this.scene);
    this.lastRebuildPosition = eyePosition
      ? { ...eyePosition }
      : null;

    this.buildRails(snapshot.path);
    this.buildTrackBed(snapshot.path);
  }

  /** Return the rail and sleeper meshes that should cast shadows. */
  getShadowCasters(): AbstractMesh[] {
    return [
      this.leftRail,
      this.rightRail,
      this.leftCap,
      this.rightCap,
      this.sleeperMesh,
    ].filter((m): m is Mesh => m !== null);
  }

  /** Release all meshes and GPU buffers. */
  dispose(): void {
    this.root?.dispose();
    this.root = null;
    this.leftRail = null;
    this.rightRail = null;
    this.leftCap = null;
    this.rightCap = null;
    this.sleeperMesh = null;
    this.lastRebuildPosition = null;
  }

  private buildRails(path: ReadonlyArray<CabTrackSample>): void {
    const { left, right } = getRailCenterPositions(path);
    const shape = railProfileToVectors();
    const capShape = railCapProfileToVectors();

    const railMaterial = this.createRailMaterial();
    const capMaterial = this.createRailCapMaterial();

    const leftRail = MeshBuilder.ExtrudeShape(
      'leftRail',
      {
        shape,
        path: vectorsFromPoints(left),
        closeShape: true,
        cap: Mesh.NO_CAP,
        firstNormal: Vector3.Up(),
        adjustFrame: true,
      },
      this.scene,
    );
    leftRail.material = railMaterial;
    leftRail.parent = this.root;

    const rightRail = MeshBuilder.ExtrudeShape(
      'rightRail',
      {
        shape,
        path: vectorsFromPoints(right),
        closeShape: true,
        cap: Mesh.NO_CAP,
        firstNormal: Vector3.Up(),
        adjustFrame: true,
      },
      this.scene,
    );
    rightRail.material = railMaterial;
    rightRail.parent = this.root;

    const leftCap = MeshBuilder.ExtrudeShape(
      'leftRailCap',
      {
        shape: capShape,
        path: vectorsFromPoints(left),
        closeShape: true,
        cap: Mesh.NO_CAP,
        firstNormal: Vector3.Up(),
        adjustFrame: true,
      },
      this.scene,
    );
    leftCap.material = capMaterial;
    leftCap.parent = this.root;

    const rightCap = MeshBuilder.ExtrudeShape(
      'rightRailCap',
      {
        shape: capShape,
        path: vectorsFromPoints(right),
        closeShape: true,
        cap: Mesh.NO_CAP,
        firstNormal: Vector3.Up(),
        adjustFrame: true,
      },
      this.scene,
    );
    rightCap.material = capMaterial;
    rightCap.parent = this.root;

    this.leftRail = leftRail;
    this.rightRail = rightRail;
    this.leftCap = leftCap;
    this.rightCap = rightCap;

    for (const mesh of [leftRail, rightRail, leftCap, rightCap]) {
      mesh.receiveShadows = true;
    }
  }

  private buildTrackBed(path: ReadonlyArray<CabTrackSample>): void {
    const segments = getStructureSegments(path);
    const sleeperTransforms: CabTrackTransform[] = [];

    for (const segment of segments) {
      const segmentPath = path.slice(segment.startIndex, segment.endIndex);
      if (segmentPath.length < 2) continue;

      switch (segment.structure) {
        case 'surface':
        case 'cut':
        case 'fill':
          this.buildBallast(segmentPath);
          sleeperTransforms.push(
            ...getSleeperTransforms(
              path,
              CabConfig.SLEEPER_SPACING_M,
              segment.startDistance,
              segment.endDistance,
            ),
          );
          break;
        case 'bridge':
          this.buildBridgeDeck(segmentPath);
          sleeperTransforms.push(
            ...getSleeperTransforms(
              path,
              CabConfig.SLEEPER_SPACING_M,
              segment.startDistance,
              segment.endDistance,
            ),
          );
          this.buildPiers(segmentPath);
          break;
        case 'tunnel':
          this.buildTunnel(segmentPath);
          break;
      }
    }

    if (sleeperTransforms.length > 0) {
      this.buildSleepers(sleeperTransforms);
    }
  }

  private buildBallast(segmentPath: ReadonlyArray<CabTrackSample>): void {
    const shape = profileToVectors(getBallastProfile());
    const mesh = MeshBuilder.ExtrudeShape(
      'ballast',
      {
        shape,
        path: pathToVectors(segmentPath),
        closeShape: true,
        cap: Mesh.NO_CAP,
        firstNormal: Vector3.Up(),
        adjustFrame: true,
      },
      this.scene,
    );
    mesh.material = this.createBallastMaterial();
    mesh.parent = this.root;
  }

  private buildBridgeDeck(segmentPath: ReadonlyArray<CabTrackSample>): void {
    const shape = profileToVectors(getBridgeDeckProfile());
    const mesh = MeshBuilder.ExtrudeShape(
      'bridgeDeck',
      {
        shape,
        path: pathToVectors(segmentPath),
        closeShape: true,
        cap: Mesh.NO_CAP,
        firstNormal: Vector3.Up(),
        adjustFrame: true,
      },
      this.scene,
    );
    mesh.material = this.createBridgeMaterial();
    mesh.parent = this.root;
  }

  private buildSleepers(transforms: CabTrackTransform[]): void {
    const mesh = MeshBuilder.CreateBox(
      'sleepers',
      {
        width: CabConfig.SLEEPER_WIDTH_M,
        height: CabConfig.SLEEPER_HEIGHT_M,
        depth: CabConfig.SLEEPER_LENGTH_M,
      },
      this.scene,
    );
    mesh.material = this.createSleeperMaterial();
    mesh.parent = this.root;
    mesh.receiveShadows = true;

    const matrices = transforms.map((t) =>
      Matrix.RotationYawPitchRoll(t.yaw, 0, 0).multiply(
        Matrix.Translation(t.position.x, t.position.y, t.position.z),
      ),
    );
    mesh.thinInstanceAdd(matrices, true);

    this.sleeperMesh = mesh;
  }

  private buildPiers(segmentPath: ReadonlyArray<CabTrackSample>): void {
    const transforms = getPierTransforms(
      segmentPath,
      CabConfig.PIER_SPACING_M,
      segmentPath[0].distance,
      segmentPath[segmentPath.length - 1].distance,
    );
    if (transforms.length === 0) return;

    const pierHeight = 15;
    const mesh = MeshBuilder.CreateBox(
      'piers',
      {
        width: 0.6,
        height: pierHeight,
        depth: 0.6,
      },
      this.scene,
    );
    mesh.material = this.createBridgeMaterial();
    mesh.parent = this.root;

    const matrices = transforms.map((t) => {
      const pos = {
        x: t.position.x,
        y: t.position.y - pierHeight / 2,
        z: t.position.z,
      };
      return Matrix.RotationYawPitchRoll(t.yaw, 0, 0).multiply(
        Matrix.Translation(pos.x, pos.y, pos.z),
      );
    });
    mesh.thinInstanceAdd(matrices, true);
  }

  private buildTunnel(segmentPath: ReadonlyArray<CabTrackSample>): void {
    const path = pathToVectors(segmentPath);
    const tube = MeshBuilder.CreateTube(
      'tunnelTube',
      {
        path,
        radius: CabConfig.TUNNEL_BORE_RADIUS_M,
        tessellation: 16,
        cap: Mesh.NO_CAP,
        sideOrientation: Mesh.DOUBLESIDE,
      },
      this.scene,
    );
    tube.material = this.createTunnelMaterial();
    tube.parent = this.root;

    this.buildPortalRing(segmentPath[0]);
    this.buildPortalRing(segmentPath[segmentPath.length - 1]);
  }

  private buildPortalRing(sample: CabTrackSample): void {
    const center = worldToBabylon(sample.x, sample.y, sample.elevation);
    const p0 = new Vector3(center.x, center.y, center.z);
    const heading = sample.headingRad;
    const tangent = new Vector3(
      Math.cos(heading),
      0,
      -Math.sin(heading),
    ).normalize();

    const ring = MeshBuilder.CreateTorus(
      'tunnelPortal',
      {
        diameter: CabConfig.TUNNEL_BORE_RADIUS_M * 2,
        thickness: 0.1,
        tessellation: 16,
      },
      this.scene,
    );
    ring.position = p0;
    ring.lookAt(p0.add(tangent));
    ring.material = this.createTunnelMaterial();
    ring.parent = this.root;
  }

  private createRailMaterial(): PBRMaterial {
    const mat = new PBRMaterial('railBody', this.scene);
    mat.albedoColor = Color3.FromHexString('#5A4A3E');
    mat.metallic = 0.55;
    mat.roughness = 0.8;
    return mat;
  }

  private createRailCapMaterial(): PBRMaterial {
    const mat = new PBRMaterial('railCap', this.scene);
    mat.albedoColor = Color3.FromHexString('#C8CCD0');
    mat.metallic = 0.95;
    mat.roughness = 0.14;
    return mat;
  }

  private createBallastMaterial(): PBRMaterial {
    const mat = new PBRMaterial('ballast', this.scene);
    mat.albedoColor = Color3.FromHexString('#3A352E');
    mat.metallic = 1;
    mat.roughness = 0.95;
    return mat;
  }

  private createSleeperMaterial(): PBRMaterial {
    const mat = new PBRMaterial('sleeper', this.scene);
    mat.albedoColor = Color3.FromHexString('#808080');
    mat.metallic = 1;
    mat.roughness = 0.9;
    return mat;
  }

  private createBridgeMaterial(): PBRMaterial {
    const mat = new PBRMaterial('bridge', this.scene);
    mat.albedoColor = Color3.FromHexString('#7A7A7A');
    mat.metallic = 1;
    mat.roughness = 0.85;
    return mat;
  }

  private createTunnelMaterial(): PBRMaterial {
    const mat = new PBRMaterial('tunnel', this.scene);
    mat.albedoColor = Color3.FromHexString('#5A5A5A');
    mat.metallic = 1;
    mat.roughness = 0.95;
    return mat;
  }
}

function railProfileToVectors(): Vector3[] {
  return getRailProfile().map((p) => new Vector3(p.x, p.y, 0));
}

function railCapProfileToVectors(): Vector3[] {
  return getRailCapProfile().map((p) => new Vector3(p.x, p.y, 0));
}

function profileToVectors(profile: ReadonlyArray<{ x: number; y: number }>): Vector3[] {
  return profile.map((p) => new Vector3(p.x, p.y, 0));
}

function vectorsFromPoints(points: ReadonlyArray<{ x: number; y: number; z: number }>): Vector3[] {
  return points.map((p) => new Vector3(p.x, p.y, p.z));
}

function pathToVectors(path: ReadonlyArray<CabTrackSample>): Vector3[] {
  return path.map((s) => worldToBabylon(s.x, s.y, s.elevation)).map(
    (p) => new Vector3(p.x, p.y, p.z),
  );
}
