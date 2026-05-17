'use client'

import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/layout/header'
import { fetchApi } from '@/lib/api'

function getWorkerUrl() {
  if (typeof window !== 'undefined') return window.location.origin
  return process.env.NEXT_PUBLIC_API_URL || 'https://YOUR_WORKER_DOMAIN'
}

const mcpTools = [
  {
    name: 'manage_bookings',
    label: '予約管理',
    description: '予約サービス確認、予約枠生成、予約一覧確認、Google Calendar設定更新を自然言語から実行します。',
    examples: [
      'AI勉強会の予約サービスを確認して',
      '来週平日10:00〜17:00で30分枠を作って',
      'AI講座のGoogle Meet自動発行をONにして',
    ],
  },
  {
    name: 'analyze_customers',
    label: '顧客分析',
    description: 'LINE顧客、タグ、予約、温度感、高温度リードをまとめて分析します。',
    examples: [
      'LINE顧客を分析して',
      '高温度リードを一覧にして',
      '予約済みユーザーと未予約の商談候補を分けて',
    ],
  },
  {
    name: 'send_message / broadcast',
    label: '配信・個別送信',
    description: '友だちへの個別メッセージや一斉配信をMCPから作成できます。送信前確認を推奨します。',
    examples: [
      '個別相談予約者にリマインド文を作って',
      '勉強会参加者向けの配信案を作って',
    ],
  },
]

const operationRules = [
  '予約確定、Google Calendar登録、LINE通知など顧客向けの本番処理はWorker直連携で動かします。',
  'MCPは管理者が自然言語で操作するための補助レイヤーとして使います。',
  '配信や削除などの書き込み操作は、送信前に人間が内容を確認します。',
  '.mcp.json はローカルAIクライアント用の秘密設定なので、Gitには入れません。',
]

const testPrompt = 'manage_bookingsで予約サービス一覧を取得して\nanalyze_customersでLINE顧客を分析して'

function configJson(apiKey: string, workerUrl: string) {
  return JSON.stringify({
    mcpServers: {
      'ai-line-crm': {
        command: 'node',
        args: ['packages/mcp-server/dist/index.js'],
        env: {
          LINE_HARNESS_API_URL: workerUrl,
          LINE_HARNESS_API_KEY: apiKey || 'YOUR_PRODUCTION_API_KEY',
        },
      },
    },
  }, null, 2)
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return true
  }
  return false
}

export default function McpPage() {
  const [workerUrl, setWorkerUrl] = useState(process.env.NEXT_PUBLIC_API_URL || 'https://YOUR_WORKER_DOMAIN')
  const [apiKey, setApiKey] = useState('')
  const [message, setMessage] = useState('')
  const [fallbackCopyText, setFallbackCopyText] = useState('')
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<{ booking: boolean; friends: boolean } | null>(null)
  const config = useMemo(() => configJson(apiKey, workerUrl), [apiKey, workerUrl])

  useEffect(() => {
    setWorkerUrl(getWorkerUrl())
  }, [])

  async function runConnectionCheck() {
    setChecking(true)
    setMessage('')
    try {
      const [booking, friends] = await Promise.allSettled([
        fetchApi<{ success: boolean }>('/api/booking/services'),
        fetchApi<{ success: boolean }>('/api/friends/count'),
      ])
      const result = {
        booking: booking.status === 'fulfilled' && Boolean(booking.value.success),
        friends: friends.status === 'fulfilled' && Boolean(friends.value.success),
      }
      setCheckResult(result)
      setMessage(result.booking && result.friends ? '本番APIへの接続確認に成功しました' : '一部APIの確認に失敗しました')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '接続確認に失敗しました')
      setCheckResult({ booking: false, friends: false })
    } finally {
      setChecking(false)
    }
  }

  async function handleCopy(value: string, label: string) {
    try {
      const copied = await copyText(value)
      if (!copied) throw new Error('Clipboard API is not available')
      setFallbackCopyText('')
      setMessage(`${label}をコピーしました`)
    } catch {
      setFallbackCopyText(value)
      setMessage(`${label}を下の欄に表示しました。選択してコピーしてください`)
    }
  }

  return (
    <div>
      <Header title="MCP連携" description="AIクライアントからCRM、予約、顧客分析を自然言語で操作するための接続設定です" />

      {message && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700">
          {message}
        </div>
      )}

      {fallbackCopyText && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-bold text-amber-900">自動コピーできなかったため、下のテキストを手動でコピーしてください。</p>
            <button
              type="button"
              onClick={() => setFallbackCopyText('')}
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-100"
            >
              閉じる
            </button>
          </div>
          <textarea
            readOnly
            value={fallbackCopyText}
            onFocus={(e) => e.currentTarget.select()}
            className="mt-3 h-28 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 font-mono text-sm text-gray-900"
          />
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <section className="xl:col-span-2 rounded-lg border border-gray-200 bg-white p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-gray-400">Connection</p>
              <h2 className="mt-1 text-lg font-black text-gray-950">MCP接続設定</h2>
              <p className="mt-2 text-sm leading-6 text-gray-500">
                Claude CodeやCursorなどのMCPクライアントに、この設定を入れるとCRM操作ツールが使えます。
              </p>
            </div>
            <button
              type="button"
              onClick={runConnectionCheck}
              disabled={checking}
              className="rounded-lg bg-gray-950 px-4 py-2 text-sm font-bold text-white hover:bg-gray-800 disabled:bg-gray-300"
            >
              {checking ? '確認中...' : '本番APIを確認'}
            </button>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs font-bold text-gray-500">Worker URL</p>
              <p className="mt-2 break-all text-sm font-semibold text-gray-900">{workerUrl}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs font-bold text-gray-500">接続状態</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${checkResult?.booking ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  予約API {checkResult?.booking ? 'OK' : '未確認'}
                </span>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${checkResult?.friends ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  顧客API {checkResult?.friends ? 'OK' : '未確認'}
                </span>
              </div>
            </div>
          </div>

          <label className="mt-5 block text-sm font-bold text-gray-700">
            API Key
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="YOUR_PRODUCTION_API_KEY"
              className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <div className="mt-4 overflow-hidden rounded-lg border border-gray-200">
            <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-sm font-black text-gray-900">.mcp.json</p>
              <button
                type="button"
                onClick={() => handleCopy(config, 'MCP設定')}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-100"
              >
                コピー
              </button>
            </div>
            <pre className="max-h-[360px] overflow-auto bg-gray-950 p-4 text-xs leading-5 text-gray-100">{config}</pre>
          </div>
        </section>

        <aside className="rounded-lg border border-gray-200 bg-white p-5">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-gray-400">Rules</p>
          <h2 className="mt-1 text-lg font-black text-gray-950">運用ルール</h2>
          <div className="mt-4 space-y-3">
            {operationRules.map((rule, index) => (
              <div key={rule} className="flex gap-3 rounded-lg bg-gray-50 p-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-950 text-xs font-black text-white">{index + 1}</span>
                <p className="text-sm leading-6 text-gray-600">{rule}</p>
              </div>
            ))}
          </div>
        </aside>

        <section className="xl:col-span-3 rounded-lg border border-gray-200 bg-white p-5">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-gray-400">Tools</p>
              <h2 className="mt-1 text-lg font-black text-gray-950">利用できるMCPツール</h2>
            </div>
            <button
              type="button"
              onClick={() => handleCopy(testPrompt, '動作確認プロンプト')}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
            >
              動作確認プロンプトをコピー
            </button>
          </div>

          <div className="mt-4 rounded-lg border border-green-100 bg-green-50 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-black text-green-900">動作確認プロンプト</p>
              <button
                type="button"
                onClick={() => handleCopy(testPrompt, '動作確認プロンプト')}
                className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-700"
              >
                この文をコピー
              </button>
            </div>
            <textarea
              readOnly
              value={testPrompt}
              onFocus={(e) => e.currentTarget.select()}
              className="mt-3 h-20 w-full rounded-lg border border-green-200 bg-white px-3 py-2 font-mono text-sm text-gray-900"
            />
            <p className="mt-2 text-xs leading-5 text-green-800">
              ボタンでコピーできない場合は、この欄をタップして全選択し、手動でコピーしてください。
            </p>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {mcpTools.map((tool) => (
              <article key={tool.name} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-black text-gray-950">{tool.label}</h3>
                    <p className="mt-1 font-mono text-xs text-green-700">{tool.name}</p>
                  </div>
                  <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-gray-500">MCP</span>
                </div>
                <p className="mt-3 text-sm leading-6 text-gray-600">{tool.description}</p>
                <div className="mt-4 space-y-2">
                  {tool.examples.map((example) => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => handleCopy(example, 'プロンプト')}
                      className="block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-xs font-semibold leading-5 text-gray-700 hover:border-green-300 hover:bg-green-50"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
