#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const workerDistDir = path.join(rootDir, 'apps', 'worker', 'dist');

const removed = [];

async function removeDevVars(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await removeDevVars(entryPath);
      continue;
    }

    if (entry.name.startsWith('.dev.vars')) {
      await fs.rm(entryPath, { force: true });
      removed.push(path.relative(rootDir, entryPath));
    }
  }
}

await removeDevVars(workerDistDir);

if (removed.length > 0) {
  console.log(`Removed secret dev var files from worker build: ${removed.join(', ')}`);
}
