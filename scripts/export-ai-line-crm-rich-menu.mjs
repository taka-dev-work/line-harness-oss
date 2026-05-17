#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  argValue,
  loadUrlConfig,
  readJson,
  resolveBlueprintUrls,
  toLineRichMenuPayload,
  validateBlueprint
} from './ai-line-crm-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const blueprintPath = path.join(rootDir, 'blueprints', 'ai-line-crm.json');
const outPath = path.resolve(argValue('out') ?? path.join(rootDir, 'generated', 'ai-line-rich-menu.json'));
const urlConfigPath = argValue('url-config');

const blueprint = resolveBlueprintUrls(
  await readJson(blueprintPath),
  await loadUrlConfig(urlConfigPath)
);
const validation = validateBlueprint(blueprint);
if (validation.errors.length > 0) {
  for (const error of validation.errors) console.error(`error: ${error}`);
  process.exit(1);
}

const payload = toLineRichMenuPayload(blueprint.richMenu);
await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`);

console.log(`Rich menu payload written: ${outPath}`);
console.log('');
console.log('Create it after deployment with:');
console.log('  curl -X POST "$LINE_HARNESS_API_URL/api/rich-menus" \\');
console.log('    -H "Authorization: Bearer $LINE_HARNESS_API_KEY" \\');
console.log('    -H "Content-Type: application/json" \\');
console.log(`    --data @${outPath}`);
