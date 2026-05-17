#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  argValue,
  hasFlag,
  loadUrlConfig,
  readJson,
  resolveBlueprintUrls,
  validateBlueprint,
  collectUrls
} from './ai-line-crm-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const blueprintPath = path.join(rootDir, 'blueprints', 'ai-line-crm.json');
const urlConfigPath = argValue('url-config') ?? path.join(rootDir, 'config', 'ai-line-crm.urls.local.json');
const productionMode = hasFlag('production');

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

const checks = [];
const urlConfigExists = await exists(urlConfigPath);
checks.push({
  name: 'URL config exists',
  ok: urlConfigExists,
  detail: urlConfigPath
});

let blueprint = await readJson(blueprintPath);
if (urlConfigExists) {
  blueprint = resolveBlueprintUrls(blueprint, await loadUrlConfig(urlConfigPath));
}

const validation = validateBlueprint(blueprint, { strictUrls: urlConfigExists });
checks.push({
  name: 'Blueprint validation',
  ok: validation.errors.length === 0,
  detail: validation.errors.length > 0 ? validation.errors.join('; ') : 'ok'
});

if (productionMode) {
  const urls = [...collectUrls(blueprint)];
  const temporaryUrls = urls.filter((url) =>
    url.includes('localhost') ||
    url.includes('127.0.0.1') ||
    url.includes('trycloudflare.com') ||
    url.includes('YOUR_WORKER_DOMAIN') ||
    url.includes('example.com')
  );
  checks.push({
    name: 'Production URLs are fixed',
    ok: temporaryUrls.length === 0,
    detail: temporaryUrls.length === 0 ? 'ok' : [...new Set(temporaryUrls)].join(', ')
  });
}

checks.push({
  name: 'LINE_HARNESS_API_URL set',
  ok: Boolean(process.env.LINE_HARNESS_API_URL),
  detail: process.env.LINE_HARNESS_API_URL || 'missing'
});

checks.push({
  name: 'LINE_HARNESS_API_KEY set',
  ok: Boolean(process.env.LINE_HARNESS_API_KEY),
  detail: process.env.LINE_HARNESS_API_KEY ? 'set' : 'missing'
});

checks.push({
  name: 'Generated rich menu payload exists',
  ok: await exists(path.join(rootDir, 'generated', 'ai-line-rich-menu.json')),
  detail: 'generated/ai-line-rich-menu.json'
});

checks.push({
  name: 'Generated rich menu SVG exists',
  ok: await exists(path.join(rootDir, 'generated', 'ai-line-rich-menu.svg')),
  detail: 'generated/ai-line-rich-menu.svg'
});

const width = 34;
for (const check of checks) {
  console.log(`${check.ok ? 'OK ' : 'NG '} ${check.name.padEnd(width)} ${check.detail}`);
}

if (validation.warnings.length > 0) {
  for (const warning of validation.warnings) {
    console.warn(`warning: ${warning}`);
  }
}

const failed = checks.filter((check) => !check.ok);
if (failed.length > 0) {
  console.log('');
  console.log('Next action: resolve the NG items above before production seeding.');
  process.exit(1);
}

console.log('');
console.log('AI LINE CRM is ready for production seeding.');
