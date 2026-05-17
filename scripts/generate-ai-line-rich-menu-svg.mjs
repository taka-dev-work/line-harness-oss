#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  argValue,
  loadUrlConfig,
  readJson,
  resolveBlueprintUrls,
  validateBlueprint
} from './ai-line-crm-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const blueprintPath = path.join(rootDir, 'blueprints', 'ai-line-crm.json');
const outPath = path.resolve(argValue('out') ?? path.join(rootDir, 'generated', 'ai-line-rich-menu.svg'));
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

const labels = Object.fromEntries(blueprint.richMenu.areas.map((area) => [area.action.text ?? area.action.uri, area.label]));
const cells = [
  { label: labels['ガイド'] ?? '無料ガイド', sub: '特典を受け取る', icon: 'GUIDE', x: 0, y: 0, w: 833, h: 843, fill: '#F7FBFF', accent: '#2563EB' },
  { label: labels['AI診断'] ?? 'AI診断', sub: '目的を選ぶ', icon: 'CHECK', x: 833, y: 0, w: 834, h: 843, fill: '#F8FAFC', accent: '#0F766E' },
  { label: labels['導入相談'] ?? '導入相談', sub: '業務を整理する', icon: 'CHAT', x: 1667, y: 0, w: 833, h: 843, fill: '#FFF7ED', accent: '#EA580C' },
  { label: 'AI講座', sub: '実務で使う', icon: 'LEARN', x: 0, y: 843, w: 833, h: 843, fill: '#FFFBEB', accent: '#D97706' },
  { label: '勉強会', sub: 'イベントを見る', icon: 'EVENT', x: 833, y: 843, w: 834, h: 843, fill: '#F0FDF4', accent: '#16A34A' },
  { label: labels['質問'] ?? '質問する', sub: 'まず聞いてみる', icon: 'FAQ', x: 1667, y: 843, w: 833, h: 843, fill: '#FDF2F8', accent: '#DB2777' }
];

function escapeXml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function iconPath(icon, cx, cy, color) {
  if (icon === 'GUIDE') {
    return `<path d="M${cx - 72} ${cy - 78}h104c30 0 54 24 54 54v156H${cx - 72}c-26 0-46-20-46-46V${cy - 32}c0-26 20-46 46-46Z" fill="none" stroke="${color}" stroke-width="16"/><path d="M${cx - 30} ${cy - 24}h78M${cx - 30} ${cy + 26}h78M${cx - 30} ${cy + 76}h48" stroke="${color}" stroke-width="14" stroke-linecap="round"/>`;
  }
  if (icon === 'CHECK') {
    return `<circle cx="${cx}" cy="${cy}" r="94" fill="none" stroke="${color}" stroke-width="16"/><path d="M${cx - 48} ${cy + 2}l34 36 68-78" fill="none" stroke="${color}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  if (icon === 'CHAT') {
    return `<path d="M${cx - 100} ${cy - 72}h200c28 0 50 22 50 50v78c0 28-22 50-50 50h-70l-62 54v-54h-68c-28 0-50-22-50-50v-78c0-28 22-50 50-50Z" fill="none" stroke="${color}" stroke-width="16" stroke-linejoin="round"/><path d="M${cx - 46} ${cy}h92M${cx - 46} ${cy + 46}h64" stroke="${color}" stroke-width="14" stroke-linecap="round"/>`;
  }
  if (icon === 'LEARN') {
    return `<path d="M${cx - 116} ${cy - 20}l116-58 116 58-116 58-116-58Z" fill="none" stroke="${color}" stroke-width="16" stroke-linejoin="round"/><path d="M${cx - 70} ${cy + 22}v58c42 34 98 34 140 0v-58" fill="none" stroke="${color}" stroke-width="16" stroke-linecap="round"/>`;
  }
  if (icon === 'EVENT') {
    return `<rect x="${cx - 104}" y="${cy - 88}" width="208" height="190" rx="22" fill="none" stroke="${color}" stroke-width="16"/><path d="M${cx - 104} ${cy - 30}h208M${cx - 54} ${cy - 116}v52M${cx + 54} ${cy - 116}v52" stroke="${color}" stroke-width="16" stroke-linecap="round"/><circle cx="${cx - 42}" cy="${cy + 28}" r="12" fill="${color}"/><circle cx="${cx + 2}" cy="${cy + 28}" r="12" fill="${color}"/><circle cx="${cx + 46}" cy="${cy + 28}" r="12" fill="${color}"/>`;
  }
  return `<circle cx="${cx}" cy="${cy - 22}" r="88" fill="none" stroke="${color}" stroke-width="16"/><path d="M${cx - 34} ${cy - 44}c4-36 80-38 80 10 0 42-46 42-46 82" fill="none" stroke="${color}" stroke-width="16" stroke-linecap="round"/><circle cx="${cx + 10}" cy="${cy + 76}" r="12" fill="${color}"/>`;
}

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="2500" height="1686" viewBox="0 0 2500 1686">
  <rect width="2500" height="1686" fill="#FFFFFF"/>
  <rect x="0" y="0" width="2500" height="1686" fill="#F8FAFC"/>
  ${cells.map((cell) => {
    const cx = cell.x + cell.w / 2;
    const iconCy = cell.y + 284;
    const labelY = cell.y + 542;
    const subY = cell.y + 646;
    return `
  <g>
    <rect x="${cell.x}" y="${cell.y}" width="${cell.w}" height="${cell.h}" fill="${cell.fill}"/>
    <rect x="${cell.x + 52}" y="${cell.y + 52}" width="${cell.w - 104}" height="${cell.h - 104}" rx="44" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="6"/>
    <rect x="${cell.x + 52}" y="${cell.y + 52}" width="18" height="${cell.h - 104}" rx="9" fill="${cell.accent}"/>
    ${iconPath(cell.icon, cx, iconCy, cell.accent)}
    <text x="${cx}" y="${labelY}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Noto Sans JP', sans-serif" font-size="76" font-weight="800" fill="#0F172A">${escapeXml(cell.label)}</text>
    <text x="${cx}" y="${subY}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Noto Sans JP', sans-serif" font-size="38" font-weight="600" fill="#475569">${escapeXml(cell.sub)}</text>
  </g>`;
  }).join('')}
  <path d="M833 0v1686M1667 0v1686M0 843h2500" stroke="#CBD5E1" stroke-width="4"/>
</svg>
`;

await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, svg);
console.log(`Rich menu SVG written: ${outPath}`);
