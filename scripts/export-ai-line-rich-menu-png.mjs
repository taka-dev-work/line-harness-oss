#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { argValue } from './ai-line-crm-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const inputPath = path.resolve(argValue('in') ?? path.join(rootDir, 'generated', 'ai-line-rich-menu.svg'));
const outPath = path.resolve(argValue('out') ?? path.join(rootDir, 'generated', 'ai-line-rich-menu.png'));

await fs.access(inputPath);
await fs.mkdir(path.dirname(outPath), { recursive: true });

await sharp(inputPath, { density: 144 })
  .resize(2500, 1686, { fit: 'fill' })
  .png({ compressionLevel: 9 })
  .toFile(outPath);

const metadata = await sharp(outPath).metadata();
if (metadata.width !== 2500 || metadata.height !== 1686) {
  throw new Error(`Invalid rich menu PNG size: ${metadata.width}x${metadata.height}. Expected 2500x1686.`);
}

console.log(`Rich menu PNG written: ${outPath}`);
console.log(`Size: ${metadata.width}x${metadata.height}`);
