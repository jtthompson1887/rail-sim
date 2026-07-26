/**
 * Pure canvas-style gauge artist.
 *
 * This module deliberately does not import Babylon or the DOM.  It expects a
 * context object that implements the subset of the HTML Canvas 2-D API used
 * below, which makes it trivial to unit test with a mock context.
 */

export interface CanvasLike {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  save(): void;
  restore(): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  arc(
    x: number,
    y: number,
    r: number,
    startAngle: number,
    endAngle: number,
    anticlockwise?: boolean,
  ): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  fill(): void;
  fillText(text: string, x: number, y: number): void;
}

export interface GaugeDrawOptions {
  /** Size of the square texture in pixels. */
  size: number;
  /** Minimum displayed value. */
  min: number;
  /** Maximum displayed value. */
  max: number;
  /** Start angle in degrees, measured clockwise from the top. */
  startAngleDeg: number;
  /** Sweep angle in degrees. */
  sweepAngleDeg: number;
  /** Unit label rendered below the centre. */
  unit: string;
  /** Number of major tick/label positions. */
  majorTicks: number;
  /** Optional face title rendered above the centre. */
  title?: string;
  /** Background colour. */
  backgroundColor?: string;
  /** Scale/tick colour. */
  scaleColor?: string;
  /** Label colour. */
  labelColor?: string;
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Convert an instrument angle (clockwise from top) to a canvas arc angle
 * (radians, 0 right, positive clockwise, up is -PI/2).
 */
function canvasAngle(deg: number): number {
  return degToRad(deg - 90);
}

/**
 * Draw a circular gauge face into the supplied canvas-like context.
 */
export function drawGauge(ctx: CanvasLike, options: GaugeDrawOptions): void {
  const {
    size,
    min,
    max,
    startAngleDeg,
    sweepAngleDeg,
    unit,
    majorTicks,
    title,
    backgroundColor = '#111111',
    scaleColor = '#cccccc',
    labelColor = '#cccccc',
  } = options;

  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.42;

  ctx.clearRect(0, 0, size, size);

  ctx.fillStyle = backgroundColor;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = scaleColor;
  ctx.lineWidth = Math.max(2, size / 128);

  // Outer arc.
  ctx.beginPath();
  ctx.arc(
    cx,
    cy,
    radius * 0.92,
    canvasAngle(startAngleDeg),
    canvasAngle(startAngleDeg + sweepAngleDeg),
  );
  ctx.stroke();

  // Major ticks and labels.
  ctx.fillStyle = labelColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.max(10, Math.floor(size / 18))}px sans-serif`;

  const range = max - min;
  for (let i = 0; i < majorTicks; i++) {
    const t = majorTicks > 1 ? i / (majorTicks - 1) : 1;
    const value = min + t * range;
    const angleDeg = startAngleDeg + t * sweepAngleDeg;
    const angleRad = canvasAngle(angleDeg);

    const inner = radius * 0.72;
    const outer = radius * 0.9;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angleRad) * inner, cy + Math.sin(angleRad) * inner);
    ctx.lineTo(cx + Math.cos(angleRad) * outer, cy + Math.sin(angleRad) * outer);
    ctx.stroke();

    const labelRadius = radius * 0.55;
    const labelX = cx + Math.cos(angleRad) * labelRadius;
    const labelY = cy + Math.sin(angleRad) * labelRadius;
    const label = formatTick(value, range);
    ctx.fillText(label, labelX, labelY);
  }

  // Unit and title.
  ctx.font = `bold ${Math.max(12, Math.floor(size / 14))}px sans-serif`;
  ctx.fillText(unit, cx, cy + size * 0.12);
  if (title) {
    ctx.font = `${Math.max(10, Math.floor(size / 20))}px sans-serif`;
    ctx.fillText(title, cx, cy - size * 0.12);
  }
}

function formatTick(value: number, range: number): string {
  if (Math.abs(range) >= 1000) {
    return Math.round(value).toString();
  }
  if (Math.abs(range) <= 10) {
    return value.toFixed(1);
  }
  return Math.round(value).toString();
}

export interface AwsDrawOptions {
  size: number;
  active: boolean;
  /** Number of yellow segments when active. */
  segments?: number;
}

/**
 * Draw an AWS sunflower face: black when inactive, segmented yellow ring when
 * active.
 */
export function drawAws(ctx: CanvasLike, options: AwsDrawOptions): void {
  const { size, active, segments = 8 } = options;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.42;

  ctx.clearRect(0, 0, size, size);

  if (!active) {
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#e6b800';
  const angleStep = (Math.PI * 2) / (segments * 2);
  for (let i = 0; i < segments * 2; i += 2) {
    ctx.beginPath();
    ctx.arc(
      cx,
      cy,
      radius * 0.85,
      i * angleStep,
      (i + 1) * angleStep,
    );
    ctx.arc(
      cx,
      cy,
      radius * 0.55,
      (i + 1) * angleStep,
      i * angleStep,
      true,
    );
    ctx.fill();
  }

  ctx.fillStyle = '#e6b800';
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.25, 0, Math.PI * 2);
  ctx.fill();
}

export interface NoticeDrawOptions {
  size: number;
  text: string;
  backgroundColor?: string;
  textColor?: string;
}

/**
 * Draw a rectangular notice plate with centered text.
 */
export function drawNotice(ctx: CanvasLike, options: NoticeDrawOptions): void {
  const {
    size,
    text,
    backgroundColor = '#e5ddc8',
    textColor = '#1a1a1a',
  } = options;

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.max(10, Math.floor(size / 8))}px sans-serif`;
  wrapText(ctx, text, size / 2, size / 2, size * 0.9, size / 6);
}

function wrapText(
  ctx: CanvasLike,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): void {
  const words = text.split(' ');
  let line = '';
  let currentY = y - ((words.length * lineHeight) / 2);

  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (line && estimateWidth(ctx, testLine) > maxWidth) {
      ctx.fillText(line, x, currentY);
      line = word;
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) {
    ctx.fillText(line, x, currentY);
  }
}

function estimateWidth(ctx: CanvasLike, text: string): number {
  // Approximate average character width at 0.6em.  Mock contexts in tests can
  // override this by providing a `measureText` method, but the fallback keeps
  // the function free of DOM dependencies.
  const fontSize = parseFloat(ctx.font) || 16;
  return text.length * fontSize * 0.6;
}
