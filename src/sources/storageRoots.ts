import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/** Product data directories that may contain a User/workspaceStorage tree. */
const PRODUCT_DIRS = ['Code', 'Code - Insiders', 'VSCodium', 'Cursor', 'Windsurf'];

/**
 * Candidate workspaceStorage roots for this platform, including every
 * known VS Code variant. Only existing directories are returned.
 */
export async function detectStorageRoots(extraRoots: string[] = []): Promise<string[]> {
  const home = os.homedir();
  const bases: string[] = [];

  switch (process.platform) {
    case 'darwin':
      bases.push(path.join(home, 'Library', 'Application Support'));
      break;
    case 'win32':
      if (process.env.APPDATA) {
        bases.push(process.env.APPDATA);
      }
      break;
    default:
      bases.push(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'));
      break;
  }

  const candidates = bases.flatMap((base) =>
    PRODUCT_DIRS.map((product) => path.join(base, product, 'User', 'workspaceStorage')),
  );
  candidates.push(...extraRoots);

  const existing: string[] = [];
  for (const root of candidates) {
    try {
      const stat = await fs.stat(root);
      if (stat.isDirectory()) {
        existing.push(root);
      }
    } catch {
      // root not present for this variant — skip
    }
  }
  return [...new Set(existing)];
}

/** List the per-workspace storage directories under a workspaceStorage root. */
export async function listWorkspaceStorageDirs(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => path.join(root, e.name));
  } catch {
    return [];
  }
}
