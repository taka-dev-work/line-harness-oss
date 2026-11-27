// Reads the D1 Time Travel bookmark that a restore would return to.
import { appendFileSync } from 'node:fs';
import { parseWranglerJson } from './schema-drift.mjs';

/** @param {string} stdout output of `wrangler d1 time-travel info <db> --json` */
export function parseBookmark(stdout) {
  const parsed = parseWranglerJson(stdout);
  const bookmark = parsed?.bookmark;
  if (typeof bookmark !== 'string' || bookmark.trim() === '') throw new Error('time-travel info returned no bookmark');
  return bookmark.trim();
}

/** Appends one `key=value` line to a GitHub Actions output file. */
export function appendOutput(file, key, value) {
  if (/[\r\n]/.test(value)) throw new Error(`refusing to write a value with a newline for ${key}`);
  appendFileSync(file, `${key}=${value}\n`);
}
