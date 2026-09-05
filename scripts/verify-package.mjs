import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { listFiles, PackageManager } from '@vscode/vsce';

const files = await listFiles({ packageManager: PackageManager.None });
const allowed = /^(package\.json|package\.nls(?:\.[a-z]+)?\.json|README\.md|CHANGELOG\.md|LICENSE|dist\/extension\.js|media\/(icon\.png|view-icon\.svg|walkthrough\/[a-z]+\.md)|l10n\/bundle\.l10n\.[a-z]+\.json)$/;
assert.deepEqual(files.filter((file) => !allowed.test(file)), [], 'Unexpected files in VSIX');
for (const required of ['package.json', 'README.md', 'LICENSE', 'dist/extension.js', 'media/icon.png']) {
  assert(files.includes(required), `Missing runtime file: ${required}`);
}
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
assert.equal(manifest.version, lock.version);
assert.equal(manifest.version, lock.packages[''].version);
console.log(`Verified ${files.length} allowed package files for v${manifest.version}`);
