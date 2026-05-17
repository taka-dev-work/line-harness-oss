'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { api, fetchApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import type { ApiResponse, Scenario, Tag, Automation } from '@line-crm/shared'

type FormItem = {
  id: string
  name: string
  description?: string | null
  submitCount?: number
  isActive?: boolean
}

type AutoReplyItem = {
  id: string
  keyword: string
  matchType: 'exact' | 'contains'
  isActive: boolean
}

type CrmSnapshot = {
  friendCount: number | null
  tags: Tag[]
  scenarios: (Scenario & { stepCount?: number })[]
  automations: Automation[]
  forms: FormItem[]
  autoReplies: AutoReplyItem[]
}

const requiredTags = [
  '興味_実務活用',
  '興味_AIエージェント',
  '興味_業務自動化',
  '興味_AI講座',
  '興味_勉強会',
  '温度_低',
  '温度_中',
  '温度_高',
  '商談候補',
  '資料請求済',
]

const requiredScenarios = [
  'AI CRM 共通7日間ナーチャリング',
  'AIエージェント導入相談フォロー',
  '勉強会・ワークショップ参加フォロー',
]

const requiredKeywords = ['1', '2', '3', '4', '5', '6', '7', '8', 'ガイド', 'AI診断', '相談', '導入相談', '質問', '料金']

const stages = [
  { name: '登録', href: '/friends', metric: 'friendCount', note: 'SNS / note / LP からLINEへ集約' },
  { name: '分類', href: '/automations', metric: 'tagAutomation', note: '数字返信とキーワードでタグ付け' },
  { name: '教育', href: '/scenarios', metric: 'scenario', note: '7日間ステップ配信で理解を深める' },
  { name: '相談', href: '/form-submissions', metric: 'form', note: 'フォームと予約へ接続' },
  { name: '商談化', href: '/friends', metric: 'dealTag', note: '商談候補タグで手動フォロー' },
]

function pct(value: number, total: number) {
  if (total <= 0) return 0
  return Math.round((value / total) * 100)
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
      ok ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
    }`}>
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      {label}
    </span>
  )
}

function MetricCard({
  label,
  value,
  sub,
  tone = 'slate',
}: {
  label: string
  value: string
  sub: string
  tone?: 'slate' | 'green' | 'blue' | 'orange'
}) {
  const tones = {
    slate: 'border-slate-200 bg-white',
    green: 'border-emerald-200 bg-emerald-50',
    blue: 'border-sky-200 bg-sky-50',
    orange: 'border-orange-200 bg-orange-50',
  }
  return (
    <div className={`rounded-lg border p-4 ${tones[tone]}`}>
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-black tracking-normal text-slate-950">{value}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{sub}</p>
    </div>
  )
}

function ReadinessRow({ label, current, total, href }: { label: string; current: number; total: number; href: string }) {
  const progress = pct(current, total)
  return (
    <Link href={href} className="block rounded-lg border border-slate-200 bg-white p-4 hover:border-emerald-300 hover:bg-emerald-50/40 transition-colors">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-900">{label}</p>
          <p className="mt-1 text-xs text-slate-500">{current} / {total} configured</p>
        </div>
        <span className="text-sm font-black text-slate-900">{progress}%</span>
      </div>
      <div className="mt-3 h-2 rounded-full bg-slate-100">
        <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${progress}%` }} />
      </div>
    </Link>
  )
}

export default function AiCrmDashboardPage() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const [snapshot, setSnapshot] = useState<CrmSnapshot>({
    friendCount: null,
    tags: [],
    scenarios: [],
    automations: [],
    forms: [],
    autoReplies: [],
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const [friendCountRes, tagsRes, scenariosRes, automationsRes, formsRes, autoRepliesRes] = await Promise.allSettled([
          api.friends.count({ accountId: selectedAccountId ?? undefined }),
          api.tags.list(),
          api.scenarios.list({ accountId: selectedAccountId ?? undefined }),
          api.automations.list({ accountId: selectedAccountId ?? undefined }),
          fetchApi<ApiResponse<FormItem[]>>('/api/forms'),
          fetchApi<ApiResponse<AutoReplyItem[]>>('/api/auto-replies' + (selectedAccountId ? `?accountId=${selectedAccountId}` : '')),
        ])

        setSnapshot({
          friendCount:
            friendCountRes.status === 'fulfilled' && friendCountRes.value.success
              ? friendCountRes.value.data.count
              : null,
          tags: tagsRes.status === 'fulfilled' && tagsRes.value.success ? tagsRes.value.data : [],
          scenarios: scenariosRes.status === 'fulfilled' && scenariosRes.value.success ? scenariosRes.value.data : [],
          automations: automationsRes.status === 'fulfilled' && automationsRes.value.success ? automationsRes.value.data : [],
          forms: formsRes.status === 'fulfilled' && formsRes.value.success ? formsRes.value.data : [],
          autoReplies: autoRepliesRes.status === 'fulfilled' && autoRepliesRes.value.success ? autoRepliesRes.value.data : [],
        })
      } catch {
        setError('AI CRMダッシュボードの読み込みに失敗しました')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [selectedAccountId])

  const computed = useMemo(() => {
    const tagNames = new Set(snapshot.tags.map((tag) => tag.name))
    const scenarioNames = new Set(snapshot.scenarios.map((scenario) => scenario.name))
    const activeScenarioNames = new Set(snapshot.scenarios.filter((scenario) => scenario.isActive).map((scenario) => scenario.name))
    const automationNames = snapshot.automations.map((automation) => automation.name)
    const keywordSet = new Set(snapshot.autoReplies.map((reply) => reply.keyword))

    const tagCount = requiredTags.filter((tag) => tagNames.has(tag)).length
    const scenarioCount = requiredScenarios.filter((scenario) => scenarioNames.has(scenario)).length
    const activeScenarioCount = requiredScenarios.filter((scenario) => activeScenarioNames.has(scenario)).length
    const keywordCount = requiredKeywords.filter((keyword) => keywordSet.has(keyword)).length
    const tagAutomationCount = requiredKeywords.filter((keyword) =>
      automationNames.some((name) => name === `AI CRM タグ付け: ${keyword}`)
    ).length
    const hasConsultForm = snapshot.forms.some((form) => form.name === 'AI相談ヒアリングフォーム')
    const hasDealTag = tagNames.has('商談候補')
    const readinessItems = [
      tagCount / requiredTags.length,
      scenarioCount / requiredScenarios.length,
      keywordCount / requiredKeywords.length,
      tagAutomationCount / requiredKeywords.length,
      hasConsultForm ? 1 : 0,
    ]
    const readiness = Math.round((readinessItems.reduce((sum, item) => sum + item, 0) / readinessItems.length) * 100)

    return {
      tagCount,
      scenarioCount,
      activeScenarioCount,
      keywordCount,
      tagAutomationCount,
      hasConsultForm,
      hasDealTag,
      readiness,
    }
  }, [snapshot])

  const stageStatus = (metric: string) => {
    if (metric === 'friendCount') return (snapshot.friendCount ?? 0) > 0
    if (metric === 'tagAutomation') return computed.tagAutomationCount >= requiredKeywords.length
    if (metric === 'scenario') return computed.activeScenarioCount >= requiredScenarios.length
    if (metric === 'form') return computed.hasConsultForm
    if (metric === 'dealTag') return computed.hasDealTag
    return false
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">AI LINE CRM</p>
            <h1 className="mt-2 text-2xl font-black tracking-normal text-slate-950">導線構築ダッシュボード</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              {selectedAccount
                ? `${selectedAccount.displayName || selectedAccount.name} のAI活用導線を、登録・分類・教育・相談・商談化の流れで確認します。`
                : 'AI活用ガイド、診断、ステップ配信、相談フォーム、商談候補タグの実装状態を確認します。'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <StatusPill ok={computed.readiness >= 90} label={computed.readiness >= 90 ? 'Ready' : 'Setup needed'} />
            <div className="rounded-lg bg-slate-950 px-4 py-3 text-white">
              <p className="text-xs text-slate-300">構築率</p>
              <p className="text-2xl font-black">{loading ? '--' : `${computed.readiness}%`}</p>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="友だち数" value={loading ? '--' : String(snapshot.friendCount ?? '-')} sub="現在のCRM母数" tone="green" />
        <MetricCard label="商談化タグ" value={computed.hasDealTag ? 'ON' : '未作成'} sub="高温度リードの抽出軸" tone="orange" />
        <MetricCard label="目的別シナリオ" value={`${computed.activeScenarioCount}/${requiredScenarios.length}`} sub="有効化済みステップ配信" tone="blue" />
        <MetricCard label="診断キーワード" value={`${computed.keywordCount}/${requiredKeywords.length}`} sub="初回8択とFAQ応答" />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-slate-950">ファネル状態</h2>
              <p className="mt-1 text-sm text-slate-500">公式LINEの役割を、運用フローとして確認します。</p>
            </div>
            <Link href="/scenarios" className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-700">
              シナリオへ
            </Link>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-5">
            {stages.map((stage, index) => {
              const ok = stageStatus(stage.metric)
              return (
                <Link key={stage.name} href={stage.href} className="rounded-lg border border-slate-200 bg-slate-50 p-4 hover:bg-white hover:shadow-sm transition">
                  <div className="flex items-center justify-between">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-sm font-black text-slate-900 ring-1 ring-slate-200">
                      {index + 1}
                    </span>
                    <span className={`h-2.5 w-2.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  </div>
                  <p className="mt-4 text-base font-black text-slate-950">{stage.name}</p>
                  <p className="mt-2 text-xs leading-5 text-slate-500">{stage.note}</p>
                </Link>
              )
            })}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-black text-slate-950">MVP構築チェック</h2>
          <div className="mt-4 space-y-3">
            <ReadinessRow label="必須タグ" current={computed.tagCount} total={requiredTags.length} href="/friends" />
            <ReadinessRow label="シナリオ" current={computed.scenarioCount} total={requiredScenarios.length} href="/scenarios" />
            <ReadinessRow label="自動返信" current={computed.keywordCount} total={requiredKeywords.length} href="/automations" />
            <ReadinessRow label="タグ付け自動化" current={computed.tagAutomationCount} total={requiredKeywords.length} href="/automations" />
            <ReadinessRow label="相談フォーム" current={computed.hasConsultForm ? 1 : 0} total={1} href="/form-submissions" />
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-950">次の実装アクション</h2>
            <p className="mt-1 text-sm text-slate-500">未構築の箇所を上から潰すと、本番投入に近づきます。</p>
          </div>
          <Link href="/automations" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50">
            自動化を確認
          </Link>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-sm font-black text-slate-900">1. Blueprint投入</p>
            <p className="mt-2 text-xs leading-5 text-slate-500">タグ、シナリオ、自動返信、自動化を投入して、構築率を90%以上へ。</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-sm font-black text-slate-900">2. リッチメニュー設定</p>
            <p className="mt-2 text-xs leading-5 text-slate-500">無料ガイド、AI診断、導入相談、講座、勉強会、質問の6枠を公開。</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-sm font-black text-slate-900">3. 実機テスト</p>
            <p className="mt-2 text-xs leading-5 text-slate-500">1から8の返信、タグ付与、シナリオ開始、フォーム送信をLINEで確認。</p>
          </div>
        </div>
      </section>
    </div>
  )
}
