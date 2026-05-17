import fs from 'node:fs/promises';
import path from 'node:path';

export const defaultUrls = {
  guideIndex: 'https://example.com/ai-guide',
  booking: 'https://example.com/booking',
  bootcamp: 'https://example.com/ai-bootcamp',
  workshop: 'https://example.com/workshop',
  cases: 'https://example.com/cases',
  pricing: 'https://example.com/pricing',
  workBreakdown: 'https://example.com/ai-work-breakdown',
  promptTemplates: 'https://example.com/prompt-templates',
  agentChecklist: 'https://example.com/agent-checklist',
  automationUseCases: 'https://example.com/automation-use-cases',
  consultForm: 'https://example.com/consult-form'
};

export function argValue(name, argv = process.argv) {
  const prefix = `--${name}=`;
  const hit = argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

export function hasFlag(name, argv = process.argv) {
  return argv.includes(`--${name}`);
}

export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

export async function loadUrlConfig(filePath) {
  if (!filePath) return {};
  return readJson(path.resolve(filePath));
}

export function resolveBlueprintUrls(blueprint, urlConfig = {}) {
  const urls = {
    ...defaultUrls,
    ...(blueprint.assumptions?.externalUrls ?? {}),
    ...urlConfig
  };
  let serialized = JSON.stringify(blueprint);

  for (const [key, defaultUrl] of Object.entries(defaultUrls)) {
    const replacement = urls[key];
    if (typeof replacement === 'string' && replacement.length > 0) {
      serialized = serialized.split(defaultUrl).join(replacement);
    }
  }

  const resolved = JSON.parse(serialized);
  resolved.assumptions = resolved.assumptions ?? {};
  resolved.assumptions.externalUrls = urls;
  return resolved;
}

export function collectUrls(value, urls = new Set()) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/https?:\/\/[^\s"'）)]+/g)) {
      urls.add(match[0]);
    }
    return urls;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, urls);
    return urls;
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectUrls(item, urls);
  }

  return urls;
}

export function validateBlueprint(blueprint, { strictUrls = false } = {}) {
  const errors = [];
  const warnings = [];

  for (const key of ['tags', 'forms', 'scenarios', 'autoReplies']) {
    if (!Array.isArray(blueprint[key])) {
      errors.push(`${key} must be an array`);
    }
  }

  if (!blueprint.richMenu?.areas || !Array.isArray(blueprint.richMenu.areas)) {
    errors.push('richMenu.areas must be an array');
  }

  const tagNames = new Set();
  for (const tag of blueprint.tags ?? []) {
    if (!tag.name) errors.push('tag.name is required');
    if (tagNames.has(tag.name)) errors.push(`duplicate tag: ${tag.name}`);
    tagNames.add(tag.name);
  }

  for (const form of blueprint.forms ?? []) {
    if (!form.name) errors.push('form.name is required');
    if (form.onSubmitTagName && !tagNames.has(form.onSubmitTagName)) {
      errors.push(`form "${form.name}" references missing tag: ${form.onSubmitTagName}`);
    }
  }

  const scenarioNames = new Set();
  for (const scenario of blueprint.scenarios ?? []) {
    if (!scenario.name) errors.push('scenario.name is required');
    if (scenarioNames.has(scenario.name)) errors.push(`duplicate scenario: ${scenario.name}`);
    scenarioNames.add(scenario.name);
    if (scenario.triggerType === 'tag_added' && !tagNames.has(scenario.triggerTagName)) {
      errors.push(`scenario "${scenario.name}" references missing trigger tag: ${scenario.triggerTagName}`);
    }
    if (!Array.isArray(scenario.steps) || scenario.steps.length === 0) {
      errors.push(`scenario "${scenario.name}" must have at least one step`);
    }
  }

  for (const reply of blueprint.autoReplies ?? []) {
    if (!reply.keyword) errors.push('autoReply.keyword is required');
    for (const tagName of reply.tagNames ?? []) {
      if (!tagNames.has(tagName)) {
        errors.push(`autoReply "${reply.keyword}" references missing tag: ${tagName}`);
      }
    }
  }

  const urls = [...collectUrls(blueprint)];
  const exampleUrls = urls.filter((url) => url.includes('example.com'));
  if (exampleUrls.length > 0) {
    const message = `example.com URLs remain: ${[...new Set(exampleUrls)].join(', ')}`;
    if (strictUrls) errors.push(message);
    else warnings.push(message);
  }

  return { errors, warnings };
}

export function toLineRichMenuPayload(richMenu) {
  return {
    size: richMenu.size,
    selected: richMenu.selected,
    name: richMenu.name,
    chatBarText: richMenu.chatBarText,
    areas: richMenu.areas.map((area) => ({
      bounds: area.bounds,
      action: area.action
    }))
  };
}
