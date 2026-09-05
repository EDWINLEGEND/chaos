import fs from 'node:fs';
import path from 'node:path';

let cachedRepoRoot: string | null = null;

export function getRepoRoot(): string {
  if (cachedRepoRoot) {
    return cachedRepoRoot;
  }

  let dir = process.cwd();
  while (dir !== '/' && dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      cachedRepoRoot = dir;
      return dir;
    }
    dir = path.dirname(dir);
  }

  cachedRepoRoot = process.cwd();
  return cachedRepoRoot;
}
