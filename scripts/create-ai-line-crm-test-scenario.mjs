#!/usr/bin/env node
import process from 'node:process';
import { argValue } from './ai-line-crm-utils.mjs';

const apiUrl = (argValue('api-url') ?? process.env.LINE_HARNESS_API_URL ?? '').replace(/\/$/, '');
const apiKey = argValue('api-key') ?? process.env.LINE_HARNESS_API_KEY;
const accountId = argValue('account-id') ?? process.env.LINE_HARNESS_ACCOUNT_ID;

if (!apiUrl || !apiKey) {
  console.error([
    'Missing API credentials.',
    '',
    'Usage:',
    '  LINE_HARNESS_API_URL=http://localhost:5174 \\',
    '  LINE_HARNESS_API_KEY=your-api-key \\',
    '  pnpm crm:test-scenario:ai-line'
  ].join('\n'));
  process.exit(1);
}

async function request(method, endpoint, body) {
  const response = await fetch(`${apiUrl}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok || payload.success === false) {
    throw new Error(`${method} ${endpoint} failed: ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload.data ?? payload;
}

async function getList(endpoint) {
  const data = await request('GET', endpoint);
  return Array.isArray(data) ? data : [];
}

const testTagName = 'テスト_短縮配信';
const scenarioName = 'AI CRM テスト短縮ナーチャリング';
const steps = [
  {
    delayMinutes: 0,
    messageType: 'text',
    messageContent: '【テスト配信 0分】AI CRM短縮テストを開始しました。ここから数分でDay1〜Day7相当の導線を確認できます。'
  },
  {
    delayMinutes: 1,
    messageType: 'text',
    messageContent: '【テスト配信 1分】Day1相当：AIを仕事で使うには、まず業務を分解することが重要です。'
  },
  {
    delayMinutes: 1,
    messageType: 'text',
    messageContent: '【テスト配信 2分】Day3相当：メール返信、SNS構成、議事録整理など、毎日繰り返す作業からAI化しましょう。'
  },
  {
    delayMinutes: 1,
    messageType: 'text',
    messageContent: '【テスト配信 3分】Day5相当：勉強会・ワークショップ導線の確認メッセージです。'
  },
  {
    delayMinutes: 1,
    messageType: 'text',
    messageContent: '【テスト配信 4分】Day7相当：個別相談への誘導確認です。必要な方だけ自然に相談へ進める流れを確認します。'
  }
];

const tags = new Map((await getList('/api/tags')).map((tag) => [tag.name, tag]));
let testTag = tags.get(testTagName);
if (!testTag) {
  testTag = await request('POST', '/api/tags', {
    name: testTagName,
    color: '#111827'
  });
  console.log(`tag created: ${testTagName}`);
} else {
  console.log(`tag exists: ${testTagName}`);
}

const scenarios = new Map((await getList('/api/scenarios')).map((scenario) => [scenario.name, scenario]));
let scenario = scenarios.get(scenarioName);
if (!scenario) {
  scenario = await request('POST', '/api/scenarios', {
    name: scenarioName,
    description: '7日間ナーチャリングを数分で確認するためのローカル/実機テスト用シナリオ。',
    triggerType: 'tag_added',
    triggerTagId: testTag.id,
    isActive: true,
    lineAccountId: accountId ?? null
  });
  console.log(`scenario created: ${scenarioName}`);
} else {
  console.log(`scenario exists: ${scenarioName}`);
}

const detail = await request('GET', `/api/scenarios/${scenario.id}`);
const existingStepOrders = new Set((detail.steps ?? []).map((step) => step.stepOrder));
for (let i = 0; i < steps.length; i += 1) {
  const stepOrder = i + 1;
  if (existingStepOrders.has(stepOrder)) {
    console.log(`scenario step exists: #${stepOrder}`);
    continue;
  }
  const step = steps[i];
  await request('POST', `/api/scenarios/${scenario.id}/steps`, {
    stepOrder,
    delayMinutes: step.delayMinutes,
    messageType: step.messageType,
    messageContent: step.messageContent
  });
  console.log(`scenario step created: #${stepOrder}`);
}

console.log('');
console.log('AI CRM short test scenario is ready.');
console.log(`Apply the "${testTagName}" tag to any friend to start the shortened delivery test.`);
