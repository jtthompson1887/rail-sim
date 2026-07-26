import * as fs from 'fs';
import * as path from 'path';

/**
 * Verifies that pure `src/cab3d` modules (everything outside `renderer/` and
 * `adapters/`) never touches the DOM, `window`, or `performance.now`.
 */

const SRC_DIR = path.resolve(__dirname, '..', '..', 'src', 'cab3d');

const FORBIDDEN = [
  { name: 'document', pattern: /\bdocument\b/ },
  { name: 'window', pattern: /\bwindow\b/ },
  { name: 'HTMLCanvasElement', pattern: /\bHTMLCanvasElement\b/ },
  { name: 'performance.now()', pattern: /\bperformance\.now\b/ },
];

function findPureFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const relative = path.relative(SRC_DIR, full).replace(/\\/g, '/');
      if (relative === 'renderer' || relative === 'adapters' || relative === 'ui') continue;
      result.push(...findPureFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      result.push(full);
    }
  }
  return result;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('Cab3d purity rules', () => {
  const files = findPureFiles(SRC_DIR);

  it('has no DOM/window/performance references in pure cab3d modules', () => {
    const failures: string[] = [];

    for (const file of files) {
      const source = stripComments(fs.readFileSync(file, 'utf8'));
      for (const { name, pattern } of FORBIDDEN) {
        if (pattern.test(source)) {
          const relative = path.relative(SRC_DIR, file).replace(/\\/g, '/');
          failures.push(`${relative}: contains ${name}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
