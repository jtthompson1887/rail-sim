import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

/**
 * Static architecture test for the `src/cab3d` isolation contract.
 *
 * It parses every TypeScript file under `src/` and inspects every import,
 * export-from, and dynamic import.  Violations are collected and reported in
 * a single assertion so the output is easy to read.
 */

const SRC_DIR = path.resolve(__dirname, '..', '..', 'src');

function findTsFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...findTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      result.push(full);
    }
  }
  return result;
}

function extractModuleSpecifiers(filePath: string): string[] {
  const source = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const specifiers: string[] = [];

  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }

    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push((node.arguments[0] as ts.StringLiteral).text);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

function isInCab3dRenderer(relativePath: string): boolean {
  return relativePath.startsWith('cab3d/renderer/');
}

function isInCab3dAdapters(relativePath: string): boolean {
  return relativePath.startsWith('cab3d/adapters/');
}

function isInCab3d(relativePath: string): boolean {
  return relativePath.startsWith('cab3d/');
}

const FORBIDDEN_STATE_MODULES = [
  'SaveService',
  'WorldManager',
  'EconomySystem',
  'CommandStack',
];

function isPublicCab3dImport(specifier: string): boolean {
  return specifier === '../cab3d' || specifier === '../cab3d/index';
}

describe('Cab3d isolation rules', () => {
  const files = findTsFiles(SRC_DIR);

  it('obeys the source-isolation contract for all src/**/*.ts files', () => {
    const failures: string[] = [];

    for (const file of files) {
      const relative = path.relative(SRC_DIR, file).replace(/\\/g, '/');
      const specifiers = extractModuleSpecifiers(file);

      for (const imp of specifiers) {
        // Rule: Babylon imports only in src/cab3d/renderer, root barrel only.
        if (imp.startsWith('@babylonjs/')) {
          if (!isInCab3dRenderer(relative)) {
            failures.push(`${relative}: Babylon import '${imp}' outside cab3d/renderer`);
          }
          if (imp !== '@babylonjs/core' && imp !== '@babylonjs/materials') {
            failures.push(`${relative}: deep Babylon import '${imp}'`);
          }
        }

        // Rule: inside cab3d, Phaser and manager/entity/scene imports only in adapters.
        if (isInCab3d(relative)) {
          const isRestrictedExternal =
            imp === 'phaser'
            || imp.includes('/managers/')
            || imp.includes('/entities/')
            || imp.includes('/scenes/');
          if (isRestrictedExternal && !isInCab3dAdapters(relative)) {
            failures.push(`${relative}: restricted external import '${imp}' outside cab3d/adapters`);
          }
        }

        // Rule: no forbidden state modules inside cab3d.
        if (isInCab3d(relative)) {
          const forbidden = FORBIDDEN_STATE_MODULES.find((m) => imp.includes(m))
            || (imp.includes('/commands/') ? 'src/commands' : undefined);
          if (forbidden) {
            failures.push(`${relative}: forbidden import '${imp}' (${forbidden})`);
          }
        }

        // Rule: only WorldScene may import the cab3d public barrel.
        if (!isInCab3d(relative) && isPublicCab3dImport(imp)) {
          if (relative !== 'scenes/WorldScene.ts') {
            failures.push(`${relative}: imports cab3d barrel but is not scenes/WorldScene.ts`);
          }
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
