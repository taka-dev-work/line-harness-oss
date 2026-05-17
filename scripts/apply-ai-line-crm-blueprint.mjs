#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
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

const apiUrl = (argValue('api-url') ?? process.env.LINE_HARNESS_API_URL ?? '').replace(/\/$/, '');
const apiKey = argValue('api-key') ?? process.env.LINE_HARNESS_API_KEY;
const accountId = argValue('account-id') ?? process.env.LINE_HARNESS_ACCOUNT_ID;
const urlConfigPath = argValue('url-config') ?? process.env.AI_LINE_CRM_URL_CONFIG;
const dryRun = hasFlag('dry-run');
const strictUrls = hasFlag('strict-urls');
const offlineDryRun = dryRun && (!apiUrl || !apiKey);

if (!dryRun && (!apiUrl || !apiKey)) {
  console.error([
    'Missing API credentials.',
    '',
    'Usage:',
    '  LINE_HARNESS_API_URL=https://your-worker.workers.dev \\',
    '  LINE_HARNESS_API_KEY=your-api-key \\',
    '  pnpm crm:seed:ai-line',
    '',
    'Options:',
    '  --dry-run',
    '  --api-url=https://your-worker.workers.dev',
    '  --api-key=your-api-key',
    '  --account-id=line-account-id'
  ].join('\n'));
  process.exit(1);
}

const blueprint = resolveBlueprintUrls(
  await readJson(blueprintPath),
  await loadUrlConfig(urlConfigPath)
);
const validation = validateBlueprint(blueprint, { strictUrls });
for (const warning of validation.warnings) {
  console.warn(`warning: ${warning}`);
}
if (validation.errors.length > 0) {
  for (const error of validation.errors) {
    console.error(`error: ${error}`);
  }
  process.exit(1);
}

if (offlineDryRun) {
  console.log('AI LINE CRM blueprint dry run (offline)');
  console.log('');
  console.log(`tags: ${blueprint.tags.length}`);
  console.log(`forms: ${blueprint.forms.length}`);
  console.log(`scenarios: ${blueprint.scenarios.length}`);
  console.log(`scenario steps: ${blueprint.scenarios.reduce((sum, scenario) => sum + scenario.steps.length, 0)}`);
  console.log(`auto replies: ${blueprint.autoReplies.length}`);
  console.log(`automations: ${blueprint.autoReplies.filter((reply) => Array.isArray(reply.tagNames) && reply.tagNames.length > 0).length}`);
  console.log(`rich menu areas: ${blueprint.richMenu.areas.length}`);
  console.log('');
  console.log('Set LINE_HARNESS_API_URL and LINE_HARNESS_API_KEY to apply this blueprint to a deployed LINE Harness instance.');
  process.exit(0);
}

async function request(method, endpoint, body) {
  if (dryRun && method !== 'GET') {
    console.log(`[dry-run] ${method} ${endpoint}`, body ? JSON.stringify(body, null, 2) : '');
    return { dryRun: true };
  }

  const response = await fetch(`${apiUrl}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { success: false, error: text };
  }

  if (!response.ok || payload.success === false) {
    throw new Error(`${method} ${endpoint} failed: ${response.status} ${JSON.stringify(payload)}`);
  }

  return payload.data ?? payload;
}

async function getList(endpoint) {
  const data = await request('GET', endpoint);
  return Array.isArray(data) ? data : [];
}

async function ensureTags() {
  const existing = new Map((await getList('/api/tags')).map((tag) => [tag.name, tag]));
  const tags = new Map(existing);

  for (const tag of blueprint.tags) {
    if (tags.has(tag.name)) {
      console.log(`tag exists: ${tag.name}`);
      continue;
    }

    const created = await request('POST', '/api/tags', {
      name: tag.name,
      color: tag.color
    });
    tags.set(created.name, created);
    console.log(`tag created: ${created.name}`);
  }

  return tags;
}

async function ensureForms(tagsByName) {
  const existing = new Map((await getList('/api/forms')).map((form) => [form.name, form]));

  for (const form of blueprint.forms) {
    if (existing.has(form.name)) {
      console.log(`form exists: ${form.name}`);
      continue;
    }

    const onSubmitTagId = form.onSubmitTagName ? tagsByName.get(form.onSubmitTagName)?.id : null;
    const created = await request('POST', '/api/forms', {
      name: form.name,
      description: form.description,
      fields: form.fields,
      onSubmitTagId,
      onSubmitMessageType: form.onSubmitMessageType,
      onSubmitMessageContent: form.onSubmitMessageContent,
      saveToMetadata: form.saveToMetadata
    });
    console.log(`form created: ${created.name}`);
  }
}

async function ensureScenarios(tagsByName) {
  const existing = new Map((await getList('/api/scenarios')).map((scenario) => [scenario.name, scenario]));

  for (const scenario of blueprint.scenarios) {
    const triggerTagId = scenario.triggerTagName ? tagsByName.get(scenario.triggerTagName)?.id : null;
    if (scenario.triggerType === 'tag_added' && !triggerTagId) {
      throw new Error(`Missing trigger tag for scenario "${scenario.name}": ${scenario.triggerTagName}`);
    }

    let target = existing.get(scenario.name);
    if (target) {
      console.log(`scenario exists: ${scenario.name}`);
    } else {
      target = await request('POST', '/api/scenarios', {
        name: scenario.name,
        description: scenario.description,
        triggerType: scenario.triggerType,
        triggerTagId,
        isActive: true,
        lineAccountId: accountId ?? null
      });
      console.log(`scenario created: ${target.name}`);
    }

    const detail = target?.id && !target.dryRun
      ? await request('GET', `/api/scenarios/${target.id}`)
      : { steps: [] };
    const existingStepOrders = new Set((detail.steps ?? []).map((step) => step.stepOrder));

    for (let i = 0; i < scenario.steps.length; i += 1) {
      const step = scenario.steps[i];
      const stepOrder = i + 1;
      if (existingStepOrders.has(stepOrder)) {
        console.log(`scenario step exists: ${scenario.name} #${stepOrder}`);
        continue;
      }
      await request('POST', `/api/scenarios/${target.id}/steps`, {
        stepOrder: i + 1,
        delayMinutes: step.delayMinutes,
        messageType: step.messageType,
        messageContent: step.messageContent
      });
      console.log(`scenario step created: ${scenario.name} #${stepOrder}`);
    }
  }
}

async function ensureAutoReplies() {
  const existing = new Map((await getList('/api/auto-replies')).map((reply) => [`${reply.keyword}:${reply.matchType}`, reply]));

  for (const reply of blueprint.autoReplies) {
    const key = `${reply.keyword}:${reply.matchType}`;
    if (existing.has(key)) {
      console.log(`auto-reply exists: ${reply.keyword}`);
      continue;
    }

    const created = await request('POST', '/api/auto-replies', {
      keyword: reply.keyword,
      matchType: reply.matchType,
      responseType: reply.responseType,
      responseContent: reply.responseContent,
      lineAccountId: accountId ?? null
    });
    console.log(`auto-reply created: ${created.keyword}`);
  }
}

async function ensureAutomations(tagsByName) {
  const existing = new Map((await getList('/api/automations')).map((automation) => [automation.name, automation]));
  const taggedReplies = blueprint.autoReplies.filter(
    (reply) => Array.isArray(reply.tagNames) && reply.tagNames.length > 0,
  );

  for (const reply of taggedReplies) {
    const name = `AI CRM タグ付け: ${reply.keyword}`;
    if (existing.has(name)) {
      console.log(`automation exists: ${name}`);
      continue;
    }

    const conditionKey = reply.matchType === 'exact' ? 'keyword_exact' : 'keyword';
    const actions = reply.tagNames.map((tagName) => {
      const tag = tagsByName.get(tagName);
      if (!tag) {
        throw new Error(`Missing tag for automation "${name}": ${tagName}`);
      }
      return {
        type: 'add_tag',
        params: { tagId: tag.id }
      };
    });

    const created = await request('POST', '/api/automations', {
      name,
      description: `AI LINE CRM blueprint: "${reply.keyword}" reply classification`,
      eventType: 'message_received',
      conditions: { [conditionKey]: reply.keyword },
      actions,
      priority: 100,
      lineAccountId: accountId ?? null
    });
    console.log(`automation created: ${created.name ?? name}`);
  }
}

await ensureScenarios(await ensureTags());
const tagsByName = new Map((await getList('/api/tags')).map((tag) => [tag.name, tag]));
await ensureForms(tagsByName);
await ensureAutoReplies();
await ensureAutomations(tagsByName);

console.log('');
console.log('AI LINE CRM blueprint applied.');
console.log('Next: create/upload the rich menu image, then create the rich menu with blueprints/ai-line-crm.json richMenu payload.');
