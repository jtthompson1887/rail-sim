/**
 * Pure data tables for the 3-D cab interior.
 *
 * All positions are in the cab-local frame: origin on the rail head, track
 * centreline, driver's eye station. +X right, +Y up, +Z forward.
 *
 * This module deliberately contains no Babylon, DOM, or game-state references.
 */

export type CabPartKind = 'box' | 'cylinder' | 'sphere' | 'plane' | 'node';

export interface CabPart {
  /** Unique identifier for this cab part. */
  readonly id: string;
  /** Primitive or node kind. */
  readonly kind: CabPartKind;
  /**
   * Size in metres.
   * - box: [width, height, depth]
   * - cylinder: [diameter, height]
   * - sphere: [diameter]
   * - plane: [width, height]
   * - node: []
   */
  readonly size: readonly number[];
  /** Local position in metres (x, y, z). */
  readonly position: readonly number[];
  /** Local Euler rotation in degrees (pitch, yaw, roll). */
  readonly rotationDeg: readonly number[];
  /** Material id (omit for nodes). */
  readonly material?: string;
  /** Parent node id (omit for root-level parts). */
  readonly parent?: string;
}

export interface CabMaterialDef {
  readonly id: string;
  readonly baseColor: string;
  readonly metallic: number;
  readonly roughness: number;
  readonly alpha?: number;
  readonly emissiveColor?: string;
  readonly emissiveIntensity?: number;
}

/** Driver's eye point in cab-local metres. */
export const CAB_DRIVER_EYE = Object.freeze({ x: -0.58, y: 2.4, z: 0.0 });

/** IDs that make up the sealed cab shell. */
export const CAB_SHELL_IDS = Object.freeze([
  'floor',
  'ceiling',
  'wallLeft',
  'wallRight',
  'bulkheadRear',
]);

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object') {
    Object.freeze(obj);
    Object.keys(obj).forEach((key) => deepFreeze((obj as Record<string, unknown>)[key]));
  }
  return obj;
}

const RAW_PARTS: CabPart[] = [
  // ── 6a. Shell ───────────────────────────────────────────────────────────
  {
    id: 'floor',
    kind: 'box',
    size: [2.6, 0.06, 2.3],
    position: [0, 1.17, 0.25],
    rotationDeg: [0, 0, 0],
    material: 'floorRubber',
  },
  {
    id: 'ceiling',
    kind: 'box',
    size: [2.6, 0.06, 2.3],
    position: [0, 3.27, 0.25],
    rotationDeg: [0, 0, 0],
    material: 'shellCream',
  },
  {
    id: 'wallLeft',
    kind: 'box',
    size: [0.08, 2.1, 2.3],
    position: [-1.3, 2.22, 0.25],
    rotationDeg: [0, 0, 0],
    material: 'shellCream',
  },
  {
    id: 'wallRight',
    kind: 'box',
    size: [0.08, 2.1, 2.3],
    position: [1.3, 2.22, 0.25],
    rotationDeg: [0, 0, 0],
    material: 'shellCream',
  },
  {
    id: 'bulkheadRear',
    kind: 'box',
    size: [2.6, 2.1, 0.08],
    position: [0, 2.22, -0.94],
    rotationDeg: [0, 0, 0],
    material: 'shellGrey',
  },

  // ── 6b. Front assembly ──────────────────────────────────────────────────
  {
    id: 'frontAssembly',
    kind: 'node',
    size: [],
    position: [0, 2.3, 1.32],
    rotationDeg: [-8, 0, 0],
  },
  {
    id: 'screenSill',
    kind: 'box',
    size: [2.44, 0.14, 0.12],
    position: [0, -0.62, 0],
    rotationDeg: [0, 0, 0],
    material: 'frameAlloy',
    parent: 'frontAssembly',
  },
  {
    id: 'screenHeader',
    kind: 'box',
    size: [2.44, 0.16, 0.12],
    position: [0, 0.63, 0],
    rotationDeg: [0, 0, 0],
    material: 'frameAlloy',
    parent: 'frontAssembly',
  },
  {
    id: 'screenPostL',
    kind: 'box',
    size: [0.14, 1.4, 0.12],
    position: [-1.15, 0, 0],
    rotationDeg: [0, 0, 0],
    material: 'frameAlloy',
    parent: 'frontAssembly',
  },
  {
    id: 'screenPostR',
    kind: 'box',
    size: [0.14, 1.4, 0.12],
    position: [1.15, 0, 0],
    rotationDeg: [0, 0, 0],
    material: 'frameAlloy',
    parent: 'frontAssembly',
  },
  {
    id: 'screenPillarC',
    kind: 'box',
    size: [0.1, 1.26, 0.11],
    position: [0, 0, 0],
    rotationDeg: [0, 0, 0],
    material: 'frameAlloy',
    parent: 'frontAssembly',
  },
  {
    id: 'glassL',
    kind: 'plane',
    size: [1.05, 1.2],
    position: [-0.575, 0, 0.005],
    rotationDeg: [0, 0, 0],
    material: 'glassScreen',
    parent: 'frontAssembly',
  },
  {
    id: 'glassR',
    kind: 'plane',
    size: [1.05, 1.2],
    position: [0.575, 0, 0.005],
    rotationDeg: [0, 0, 0],
    material: 'glassScreen',
    parent: 'frontAssembly',
  },
  {
    id: 'frontPanelLower',
    kind: 'box',
    size: [2.44, 0.5, 0.1],
    position: [0, -0.94, 0],
    rotationDeg: [0, 0, 0],
    material: 'shellGrey',
    parent: 'frontAssembly',
  },
  {
    id: 'sunVisorL',
    kind: 'box',
    size: [0.95, 0.03, 0.24],
    position: [-0.6, 0.58, -0.14],
    rotationDeg: [-25, 0, 0],
    material: 'visorDark',
    parent: 'frontAssembly',
  },
  {
    id: 'sunVisorR',
    kind: 'box',
    size: [0.95, 0.03, 0.24],
    position: [0.6, 0.58, -0.14],
    rotationDeg: [-25, 0, 0],
    material: 'visorDark',
    parent: 'frontAssembly',
  },
  {
    id: 'wiperPivotL',
    kind: 'node',
    size: [],
    position: [-0.575, -0.52, 0.07],
    rotationDeg: [0, 0, 0],
    parent: 'frontAssembly',
  },
  {
    id: 'wiperArmL',
    kind: 'box',
    size: [0.03, 0.9, 0.03],
    position: [0, 0.45, 0],
    rotationDeg: [0, 0, 0],
    material: 'frameDark',
    parent: 'wiperPivotL',
  },
  {
    id: 'wiperBladeL',
    kind: 'box',
    size: [0.7, 0.025, 0.025],
    position: [0, 0.86, 0.015],
    rotationDeg: [0, 0, 0],
    material: 'rubberBlack',
    parent: 'wiperPivotL',
  },
  {
    id: 'wiperPivotR',
    kind: 'node',
    size: [],
    position: [0.575, -0.52, 0.07],
    rotationDeg: [0, 0, 0],
    parent: 'frontAssembly',
  },
  {
    id: 'wiperArmR',
    kind: 'box',
    size: [0.03, 0.9, 0.03],
    position: [0, 0.45, 0],
    rotationDeg: [0, 0, 0],
    material: 'frameDark',
    parent: 'wiperPivotR',
  },
  {
    id: 'wiperBladeR',
    kind: 'box',
    size: [0.7, 0.025, 0.025],
    position: [0, 0.86, 0.015],
    rotationDeg: [0, 0, 0],
    material: 'rubberBlack',
    parent: 'wiperPivotR',
  },

  // ── 6c. Desk assembly ───────────────────────────────────────────────────
  {
    id: 'deskAssembly',
    kind: 'node',
    size: [],
    position: [-0.58, 0, 0],
    rotationDeg: [0, 0, 0],
  },
  {
    id: 'deskTop',
    kind: 'box',
    size: [1.3, 0.05, 0.6],
    position: [0, 2.0, 0.92],
    rotationDeg: [-6, 0, 0],
    material: 'deskDark',
    parent: 'deskAssembly',
  },
  {
    id: 'deskLip',
    kind: 'box',
    size: [1.3, 0.05, 0.06],
    position: [0, 2.02, 0.6],
    rotationDeg: [0, 0, 0],
    material: 'frameAlloy',
    parent: 'deskAssembly',
  },
  {
    id: 'deskFace',
    kind: 'box',
    size: [1.3, 0.52, 0.05],
    position: [0, 1.74, 1.21],
    rotationDeg: [0, 0, 0],
    material: 'shellGrey',
    parent: 'deskAssembly',
  },
  {
    id: 'deskPedestal',
    kind: 'box',
    size: [1.24, 0.56, 0.52],
    position: [0, 1.48, 0.96],
    rotationDeg: [0, 0, 0],
    material: 'shellGrey',
    parent: 'deskAssembly',
  },
  {
    id: 'deskCheekL',
    kind: 'box',
    size: [0.05, 0.84, 0.6],
    position: [-0.65, 1.6, 0.92],
    rotationDeg: [0, 0, 0],
    material: 'shellGrey',
    parent: 'deskAssembly',
  },
  {
    id: 'deskCheekR',
    kind: 'box',
    size: [0.05, 0.84, 0.6],
    position: [0.65, 1.6, 0.92],
    rotationDeg: [0, 0, 0],
    material: 'shellGrey',
    parent: 'deskAssembly',
  },

  // ── 6d. Instrument panel ────────────────────────────────────────────────
  {
    id: 'instrumentPanel',
    kind: 'node',
    size: [],
    position: [-0.58, 2.03, 0.92],
    rotationDeg: [-6, 0, 0],
  },
  {
    id: 'gaugeSpeedo',
    kind: 'cylinder',
    size: [0.15, 0.03],
    position: [-0.02, 0.015, 0.02],
    rotationDeg: [0, 0, 0],
    material: 'bezelDark',
    parent: 'instrumentPanel',
  },
  {
    id: 'gaugeSpeedoFace',
    kind: 'cylinder',
    size: [0.132, 0.002],
    position: [-0.02, 0.031, 0.02],
    rotationDeg: [0, 0, 0],
    material: 'dynSpeedo',
    parent: 'instrumentPanel',
  },
  {
    id: 'gaugeSpeedoNeedle',
    kind: 'box',
    size: [0.006, 0.002, 0.058],
    position: [-0.02, 0.033, 0.049],
    rotationDeg: [0, 0, 0],
    material: 'needleOrange',
    parent: 'instrumentPanel',
  },
  {
    id: 'gaugeBrakeDuplex',
    kind: 'cylinder',
    size: [0.11, 0.028],
    position: [0.2, 0.014, 0.02],
    rotationDeg: [0, 0, 0],
    material: 'bezelDark',
    parent: 'instrumentPanel',
  },
  {
    id: 'gaugeBrakeDuplexFace',
    kind: 'cylinder',
    size: [0.096, 0.002],
    position: [0.2, 0.029, 0.02],
    rotationDeg: [0, 0, 0],
    material: 'dynBrakeDuplex',
    parent: 'instrumentPanel',
  },
  {
    id: 'needleBrakePipe',
    kind: 'box',
    size: [0.005, 0.002, 0.042],
    position: [0.2, 0.031, 0.041],
    rotationDeg: [0, 0, 0],
    material: 'needleRed',
    parent: 'instrumentPanel',
  },
  {
    id: 'needleMainRes',
    kind: 'box',
    size: [0.005, 0.002, 0.042],
    position: [0.2, 0.033, 0.041],
    rotationDeg: [0, 0, 0],
    material: 'needleWhite',
    parent: 'instrumentPanel',
  },
  {
    id: 'gaugeBrakeCyl',
    kind: 'cylinder',
    size: [0.09, 0.026],
    position: [0.36, 0.013, 0.02],
    rotationDeg: [0, 0, 0],
    material: 'bezelDark',
    parent: 'instrumentPanel',
  },
  {
    id: 'gaugeBrakeCylFace',
    kind: 'cylinder',
    size: [0.078, 0.002],
    position: [0.36, 0.027, 0.02],
    rotationDeg: [0, 0, 0],
    material: 'dynBrakeCyl',
    parent: 'instrumentPanel',
  },
  {
    id: 'needleBrakeCyl',
    kind: 'box',
    size: [0.005, 0.002, 0.034],
    position: [0.36, 0.029, 0.037],
    rotationDeg: [0, 0, 0],
    material: 'needleRed',
    parent: 'instrumentPanel',
  },
  {
    id: 'awsSunflower',
    kind: 'cylinder',
    size: [0.08, 0.024],
    position: [-0.24, 0.012, 0.02],
    rotationDeg: [0, 0, 0],
    material: 'bezelDark',
    parent: 'instrumentPanel',
  },
  {
    id: 'awsSunflowerFace',
    kind: 'cylinder',
    size: [0.068, 0.002],
    position: [-0.24, 0.025, 0.02],
    rotationDeg: [0, 0, 0],
    material: 'dynAws',
    parent: 'instrumentPanel',
  },
  {
    id: 'gaugeAmmeter',
    kind: 'cylinder',
    size: [0.09, 0.026],
    position: [-0.42, 0.013, 0.02],
    rotationDeg: [0, 0, 0],
    material: 'bezelDark',
    parent: 'instrumentPanel',
  },
  {
    id: 'gaugeAmmeterFace',
    kind: 'cylinder',
    size: [0.078, 0.002],
    position: [-0.42, 0.027, 0.02],
    rotationDeg: [0, 0, 0],
    material: 'dynAmmeter',
    parent: 'instrumentPanel',
  },
  {
    id: 'needleAmmeter',
    kind: 'box',
    size: [0.005, 0.002, 0.034],
    position: [-0.42, 0.029, 0.037],
    rotationDeg: [0, 0, 0],
    material: 'needleWhite',
    parent: 'instrumentPanel',
  },

  // ── 6e. Controls ────────────────────────────────────────────────────────
  {
    id: 'powerQuadrant',
    kind: 'box',
    size: [0.2, 0.05, 0.3],
    position: [-1.16, 2.0, 0.8],
    rotationDeg: [0, 0, 0],
    material: 'frameAlloy',
  },
  {
    id: 'powerPivot',
    kind: 'node',
    size: [],
    position: [-1.16, 2.03, 0.72],
    rotationDeg: [0, 0, 0],
  },
  {
    id: 'powerLever',
    kind: 'cylinder',
    size: [0.028, 0.3],
    position: [0, 0.15, 0],
    rotationDeg: [0, 0, 0],
    material: 'chromeShaft',
    parent: 'powerPivot',
  },
  {
    id: 'powerKnob',
    kind: 'sphere',
    size: [0.07],
    position: [0, 0.3, 0],
    rotationDeg: [0, 0, 0],
    material: 'bakelite',
    parent: 'powerPivot',
  },
  {
    id: 'brakeQuadrant',
    kind: 'box',
    size: [0.18, 0.05, 0.26],
    position: [-0.06, 2.0, 0.82],
    rotationDeg: [0, 0, 0],
    material: 'frameAlloy',
  },
  {
    id: 'brakePivot',
    kind: 'node',
    size: [],
    position: [-0.06, 2.03, 0.76],
    rotationDeg: [0, 0, 0],
  },
  {
    id: 'brakeLever',
    kind: 'cylinder',
    size: [0.026, 0.26],
    position: [0, 0.13, 0],
    rotationDeg: [0, 0, 0],
    material: 'chromeShaft',
    parent: 'brakePivot',
  },
  {
    id: 'brakeKnob',
    kind: 'sphere',
    size: [0.064],
    position: [0, 0.26, 0],
    rotationDeg: [0, 0, 0],
    material: 'bakelite',
    parent: 'brakePivot',
  },
  {
    id: 'reverserBody',
    kind: 'box',
    size: [0.11, 0.04, 0.11],
    position: [-1.16, 2.01, 1.08],
    rotationDeg: [0, 0, 0],
    material: 'frameAlloy',
  },
  {
    id: 'reverserStub',
    kind: 'cylinder',
    size: [0.02, 0.1],
    position: [-1.16, 2.06, 1.08],
    rotationDeg: [0, 0, 0],
    material: 'chromeShaft',
  },
  {
    id: 'hornHigh',
    kind: 'cylinder',
    size: [0.046, 0.014],
    position: [-0.86, 2.03, 0.68],
    rotationDeg: [0, 0, 0],
    material: 'buttonRed',
  },
  {
    id: 'hornLow',
    kind: 'cylinder',
    size: [0.046, 0.014],
    position: [-0.78, 2.03, 0.68],
    rotationDeg: [0, 0, 0],
    material: 'buttonYellow',
  },
  {
    id: 'awsReset',
    kind: 'cylinder',
    size: [0.04, 0.016],
    position: [-0.7, 2.03, 0.68],
    rotationDeg: [0, 0, 0],
    material: 'buttonBlack',
  },
  {
    id: 'dsdPedal',
    kind: 'box',
    size: [0.18, 0.035, 0.24],
    position: [-0.58, 1.27, 0.52],
    rotationDeg: [-12, 0, 0],
    material: 'frameDark',
  },

  // ── 6f. Seats ───────────────────────────────────────────────────────────
  {
    id: 'seatPedestalD',
    kind: 'cylinder',
    size: [0.16, 0.42],
    position: [-0.58, 1.41, -0.1],
    rotationDeg: [0, 0, 0],
    material: 'frameDark',
  },
  {
    id: 'seatBaseD',
    kind: 'box',
    size: [0.5, 0.12, 0.48],
    position: [-0.58, 1.68, -0.1],
    rotationDeg: [0, 0, 0],
    material: 'moquette',
  },
  {
    id: 'seatBackD',
    kind: 'box',
    size: [0.5, 0.58, 0.1],
    position: [-0.58, 2.0, -0.36],
    rotationDeg: [-9, 0, 0],
    material: 'moquette',
  },
  {
    id: 'seatHeadD',
    kind: 'box',
    size: [0.3, 0.2, 0.09],
    position: [-0.58, 2.34, -0.39],
    rotationDeg: [-9, 0, 0],
    material: 'moquette',
  },

  // ── 6g. Detail ──────────────────────────────────────────────────────────
  {
    id: 'grabHandleL',
    kind: 'cylinder',
    size: [0.03, 0.34],
    position: [-1.24, 2.7, 0.1],
    rotationDeg: [0, 0, 90],
    material: 'chromeShaft',
  },
  {
    id: 'roofLampHousing',
    kind: 'box',
    size: [0.34, 0.06, 0.16],
    position: [0, 3.22, 0.3],
    rotationDeg: [0, 0, 0],
    material: 'frameDark',
  },
  {
    id: 'roofLampLens',
    kind: 'plane',
    size: [0.28, 0.12],
    position: [0, 3.185, 0.3],
    rotationDeg: [90, 0, 0],
    material: 'lampEmissive',
  },
  {
    id: 'noticePlate',
    kind: 'plane',
    size: [0.2, 0.14],
    position: [1.25, 2.55, 0.2],
    rotationDeg: [0, -90, 0],
    material: 'dynNotice',
  },
  {
    id: 'fireExtinguisher',
    kind: 'cylinder',
    size: [0.11, 0.42],
    position: [1.18, 1.44, -0.6],
    rotationDeg: [0, 0, 0],
    material: 'extRed',
  },
];

const RAW_MATERIALS: Record<string, CabMaterialDef> = {
  shellCream: { id: 'shellCream', baseColor: '#C9C4B4', metallic: 0.0, roughness: 0.75 },
  shellGrey: { id: 'shellGrey', baseColor: '#9C9A93', metallic: 0.0, roughness: 0.7 },
  floorRubber: { id: 'floorRubber', baseColor: '#1E2124', metallic: 0.0, roughness: 0.92 },
  deskDark: { id: 'deskDark', baseColor: '#2E3338', metallic: 0.05, roughness: 0.55 },
  frameAlloy: { id: 'frameAlloy', baseColor: '#4A4E52', metallic: 0.35, roughness: 0.4 },
  frameDark: { id: 'frameDark', baseColor: '#26292C', metallic: 0.3, roughness: 0.5 },
  glassScreen: { id: 'glassScreen', baseColor: '#FFFFFF', metallic: 0.0, roughness: 0.03, alpha: 0.07 },
  chromeShaft: { id: 'chromeShaft', baseColor: '#B8BCC0', metallic: 0.9, roughness: 0.2 },
  bakelite: { id: 'bakelite', baseColor: '#17191B', metallic: 0.0, roughness: 0.35 },
  bezelDark: { id: 'bezelDark', baseColor: '#1A1C1E', metallic: 0.6, roughness: 0.3 },
  moquette: { id: 'moquette', baseColor: '#23404F', metallic: 0.0, roughness: 0.95 },
  visorDark: { id: 'visorDark', baseColor: '#3A3630', metallic: 0.0, roughness: 0.85 },
  rubberBlack: { id: 'rubberBlack', baseColor: '#111214', metallic: 0.0, roughness: 0.95 },
  needleOrange: { id: 'needleOrange', baseColor: '#FF7A18', metallic: 0.0, roughness: 0.4, emissiveColor: '#FF7A18', emissiveIntensity: 0.15 },
  needleRed: { id: 'needleRed', baseColor: '#D42B1F', metallic: 0.0, roughness: 0.4 },
  needleWhite: { id: 'needleWhite', baseColor: '#ECECEC', metallic: 0.0, roughness: 0.4 },
  buttonRed: { id: 'buttonRed', baseColor: '#B4241C', metallic: 0.0, roughness: 0.45 },
  buttonYellow: { id: 'buttonYellow', baseColor: '#D6A31A', metallic: 0.0, roughness: 0.45 },
  buttonBlack: { id: 'buttonBlack', baseColor: '#141517', metallic: 0.0, roughness: 0.45 },
  lampEmissive: { id: 'lampEmissive', baseColor: '#FFF1D0', metallic: 0.0, roughness: 0.6, emissiveColor: '#FFF1D0', emissiveIntensity: 1.6 },
  extRed: { id: 'extRed', baseColor: '#A81E14', metallic: 0.1, roughness: 0.45 },

  // Dynamic instrument placeholders (live textures in Phase 7).
  dynSpeedo: { id: 'dynSpeedo', baseColor: '#E8E8E8', metallic: 0.0, roughness: 0.6 },
  dynBrakeDuplex: { id: 'dynBrakeDuplex', baseColor: '#E0E0E0', metallic: 0.0, roughness: 0.6 },
  dynBrakeCyl: { id: 'dynBrakeCyl', baseColor: '#E0E0E0', metallic: 0.0, roughness: 0.6 },
  dynAws: { id: 'dynAws', baseColor: '#2A2A2A', metallic: 0.0, roughness: 0.6 },
  dynAmmeter: { id: 'dynAmmeter', baseColor: '#E0E0E0', metallic: 0.0, roughness: 0.6 },
  dynNotice: { id: 'dynNotice', baseColor: '#E5DDC8', metallic: 0.0, roughness: 0.7 },
};

export const CAB_PARTS = deepFreeze(RAW_PARTS) as ReadonlyArray<CabPart>;
export const CAB_MATERIALS = deepFreeze(RAW_MATERIALS) as Readonly<Record<string, CabMaterialDef>>;

/**
 * Return the cab parts in an order where every parent appears before its
 * children. Throws if the part graph contains a cycle or a missing parent.
 */
export function getCabPartBuildOrder(
  parts: ReadonlyArray<CabPart>,
): ReadonlyArray<CabPart> {
  const byId = new Map(parts.map((part) => [part.id, part]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const order: CabPart[] = [];

  function visit(id: string): void {
    if (visiting.has(id)) {
      throw new Error(`Cab part graph contains a cycle at ${id}`);
    }
    if (visited.has(id)) return;

    const part = byId.get(id);
    if (!part) {
      throw new Error(`Cab part ${id} not found`);
    }

    visiting.add(id);
    if (part.parent) visit(part.parent);
    visiting.delete(id);
    visited.add(id);
    order.push(part);
  }

  for (const part of parts) visit(part.id);
  return order;
}
