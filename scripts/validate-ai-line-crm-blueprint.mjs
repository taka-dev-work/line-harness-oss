#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  argValue,
  hasFlag,
  loadUrlConfig,
  readJson,
  resolveBlueprintUrls,
  validateBlueprint
} from './ai-line-crm-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const blueprintPath = path.join(rootDir, 'blueprints', 'ai-line-crm.json');
const urlConfigPath = argValue('url-config');
const strictUrls = hasFlag('strict-urls');

const blueprint = resolveBlueprintUrls(
  await readJson(blueprintPath),
  await loadUrlConfig(urlConfigPath)
);
const result = validateBlueprint(blueprint, { strictUrls });

for (const warning of result.warnings) {
  console.warn(`warning: ${warning}`);
}

if (result.errors.length > 0) {
  for (const error of result.errors) {
    console.error(`error: ${error}`);
  }
  process.exit(1);
}

console.log('AI LINE CRM blueprint is valid.');
