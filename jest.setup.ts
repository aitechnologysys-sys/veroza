// Runs before every test file (jest.config.ts `setupFiles`).
import 'reflect-metadata';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Constructing the storage layer resolves UPLOAD_DIRECTORY (which is always
// set in real deployments). Tests that build repositories need a value; give
// them a throwaway directory so nothing is ever written inside the repo.
if (!process.env.UPLOAD_DIRECTORY) {
  process.env.UPLOAD_DIRECTORY = mkdtempSync(join(tmpdir(), 'postaryx-test-uploads-'));
}
