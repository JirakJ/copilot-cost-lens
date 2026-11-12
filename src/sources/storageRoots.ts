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

/**
 * Copilot Chat global-storage dirs next to the given workspaceStorage roots
 * (`<User>/globalStorage/github.copilot-chat`). Only existing ones.
 */
export async function detectCopilotGlobalStorageDirs(workspaceStorageRoots: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const root of workspaceStorageRoots) {
    const globalStorage = path.join(path.dirname(root), 'globalStorage');
    let names: string[];
    try {
      names = await fs.readdir(globalStorage);
    } catch {
      continue;
    }
    // extension ids are case-insensitive; the folder is lower-case today
    for (const name of names) {
      if (name.toLowerCase() === 'github.copilot-chat') {
        found.push(path.join(globalStorage, name));
      }
    }
  }
  return [...new Set(found)];
}
