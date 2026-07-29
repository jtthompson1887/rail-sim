import {
  drawGauge,
  drawAws,
  drawNotice,
  type CanvasLike,
} from '../../src/cab3d/cab/CabGaugeArtist';

class RecordingCanvas implements CanvasLike {
  width = 256;
  height = 256;
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  font = '';
  textAlign: CanvasTextAlign = 'start';
  textBaseline: CanvasTextBaseline = 'alphabetic';

  readonly calls: Array<{ method: string; args: unknown[] }> = [];

  private record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }

  save(): void { this.record('save'); }
  restore(): void { this.record('restore'); }
  clearRect(x: number, y: number, w: number, h: number): void { this.record('clearRect', x, y, w, h); }
  fillRect(x: number, y: number, w: number, h: number): void { this.record('fillRect', x, y, w, h); }
  beginPath(): void { this.record('beginPath'); }
  arc(x: number, y: number, r: number, start: number, end: number, anticlockwise?: boolean): void {
    this.record('arc', x, y, r, start, end, anticlockwise);
  }
  moveTo(x: number, y: number): void { this.record('moveTo', x, y); }
  lineTo(x: number, y: number): void { this.record('lineTo', x, y); }
  stroke(): void { this.record('stroke'); }
  fill(): void { this.record('fill'); }
  fillText(text: string, x: number, y: number): void { this.record('fillText', text, x, y); }
}

describe('drawGauge', () => {
  it('draws a gauge face with background, arc, ticks and labels', () => {
    const ctx = new RecordingCanvas();
    drawGauge(ctx, {
      size: 256,
      min: 0,
      max: 125,
      startAngleDeg: -125,
      sweepAngleDeg: 250,
      unit: 'mph',
      majorTicks: 6,
      title: 'SPEED',
    });

    const methods = ctx.calls.map((call) => call.method);
    expect(methods).toContain('clearRect');
    expect(methods).toContain('arc');
    expect(methods).toContain('stroke');
    expect(methods).toContain('fillText');

    const labels = ctx.calls
      .filter((call) => call.method === 'fillText')
      .map((call) => call.args[0]);
    expect(labels).toContain('mph');
    expect(labels).toContain('SPEED');
    expect(labels.some((label) => typeof label === 'string' && /\d/.test(label))).toBe(true);
  });

  it('renders negative/zero gauges without throwing', () => {
    const ctx = new RecordingCanvas();
    expect(() => drawGauge(ctx, {
      size: 128,
      min: -1000,
      max: 2000,
      startAngleDeg: -130,
      sweepAngleDeg: 260,
      unit: 'A',
      majorTicks: 4,
    })).not.toThrow();
  });

  it('formats small-range gauge ticks to one decimal place', () => {
    const ctx = new RecordingCanvas();
    drawGauge(ctx, {
      size: 128,
      min: 0,
      max: 4,
      startAngleDeg: -120,
      sweepAngleDeg: 240,
      unit: 'bar',
      majorTicks: 5,
    });

    const labels = ctx.calls
      .filter((call) => call.method === 'fillText')
      .map((call) => call.args[0]);
    expect(labels.some((label) => typeof label === 'string' && label.includes('.'))).toBe(true);
  });
});

describe('drawAws', () => {
  it('draws a solid black disc when inactive', () => {
    const ctx = new RecordingCanvas();
    drawAws(ctx, { size: 256, active: false });
    const fills = ctx.calls.filter((call) => call.method === 'fill');
    expect(fills.length).toBe(1);
  });

  it('draws a segmented yellow ring when active', () => {
    const ctx = new RecordingCanvas();
    drawAws(ctx, { size: 256, active: true, segments: 8 });
    const fills = ctx.calls.filter((call) => call.method === 'fill');
    expect(fills.length).toBeGreaterThan(1);
  });
});

describe('drawNotice', () => {
  it('draws a background rectangle and text', () => {
    const ctx = new RecordingCanvas();
    drawNotice(ctx, { size: 256, text: 'NO SMOKING' });
    const methods = ctx.calls.map((call) => call.method);
    expect(methods).toContain('fillRect');
    expect(methods).toContain('fillText');

    const texts = ctx.calls
      .filter((call) => call.method === 'fillText')
      .map((call) => call.args[0]);
    expect(texts.some((label) => typeof label === 'string' && label.includes('NO'))).toBe(true);
  });

  it('wraps long notice text onto multiple lines', () => {
    const ctx = new RecordingCanvas();
    drawNotice(ctx, { size: 64, text: 'NO SMOKING ALARMS TEST' });
    const fillTextCalls = ctx.calls.filter((call) => call.method === 'fillText');
    expect(fillTextCalls.length).toBeGreaterThan(1);
  });
});
