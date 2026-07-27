import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const apiSource = readFileSync(new URL('../../lib/api.ts', import.meta.url), 'utf8')
const pageSource = readFileSync(new URL('../../app/ai-concierge/page.tsx', import.meta.url), 'utf8')
const settingsSource = readFileSync(new URL('./concierge-settings.tsx', import.meta.url), 'utf8')
const faqSource = readFileSync(new URL('./faq-editor.tsx', import.meta.url), 'utf8')
const logSource = readFileSync(new URL('./usage-log.tsx', import.meta.url), 'utf8')

test('every concierge request is scoped by the selected LINE account', () => {
  const block = apiSource.slice(apiSource.indexOf('aiConcierge: {'))
  const endpointCount = [...block.matchAll(/\/api\/ai-concierge\//g)].length
  const accountScopeCount = [...block.matchAll(/lineAccountId=/g)].length
  assert.equal(endpointCount, 9)
  assert.equal(accountScopeCount, endpointCount)
  assert.match(pageSource, /selectedAccountId/)
})

test('management UI exposes complete operational and empty states', () => {
  assert.match(settingsSource, /設定を保存/)
  assert.match(settingsSource, /AI優先順/)
  assert.match(faqSource, /FAQはまだありません/)
  assert.match(logSource, /利用ログはまだありません/)
  assert.match(pageSource, /読み込み中/)
  assert.match(pageSource, /setError/)
})

test('provider status is shown without an API key field', () => {
  assert.match(settingsSource, /未設定/)
  assert.doesNotMatch(settingsSource, /API_KEY|apiKey|type="password"/)
  assert.doesNotMatch(pageSource, /API_KEY|apiKey|type="password"/)
})
