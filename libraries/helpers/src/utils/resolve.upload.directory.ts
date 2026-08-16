import { existsSync } from 'fs';
import { dirname, isAbsolute, join } from 'path';

function findRepoRoot(startDir: string): string {
  let dir = startDir;
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Could not locate the repo root (pnpm-workspace.yaml) above ${startDir}`
      );
    }
    dir = parent;
  }
  return dir;
}

// UPLOAD_DIRECTORY is read by two independent Node processes (backend and
// frontend) that don't share a cwd, so a relative value must resolve against
// the monorepo root rather than process.cwd() — otherwise each process would
// pick a different directory and the frontend couldn't find what the backend
// wrote. An absolute value (e.g. the `/uploads` used inside the prod Docker
// container) is returned untouched.
export const resolveUploadDirectory = (dir: string) =>
  isAbsolute(dir) ? dir : join(findRepoRoot(process.cwd()), dir);
