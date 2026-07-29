export interface CameraPoint {
  readonly x: number;
  readonly y: number;
}

export interface BrowserCamera {
  readonly scrollX: number;
  readonly scrollY: number;
  readonly zoom: number;
  readonly width: number;
  readonly height: number;
}

export function cameraToWorldPoint(
  point: CameraPoint,
  camera: BrowserCamera,
): CameraPoint {
  return {
    x: (point.x - camera.width / 2) / camera.zoom
      + camera.scrollX
      + camera.width / 2,
    y: (point.y - camera.height / 2) / camera.zoom
      + camera.scrollY
      + camera.height / 2,
  };
}

export function worldToCameraPoint(
  point: CameraPoint,
  camera: BrowserCamera,
): CameraPoint {
  return {
    x: camera.width / 2
      + (point.x - camera.scrollX - camera.width / 2) * camera.zoom,
    y: camera.height / 2
      + (point.y - camera.scrollY - camera.height / 2) * camera.zoom,
  };
}
