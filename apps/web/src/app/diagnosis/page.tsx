'use client'

import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import { fetchApi } from '@/lib/api'

type DiagnosisSettings = {
  form: { formName: string; formTitle: string } | null
  questions: Array<{
    id: string
    text: string
    mapsToType: string
    options: Array<{ label: string; value: number }>
  }>
  configs: Array<{
    id: string
    typeKey: string
    label: string
    description: string | null
    tagName: string
    lineMessage: string
    mangaLpUrl?: string | null
    color: string
  }>
}

const workerBase = process.env.NEXT_PUBLIC_API_URL ?? ''

const initialDescription = `AI活用目的診断。ユーザーのAI活用レベル、働き方、実現したい未来、効率化したい業務、希望サポートを聞き、時間創出・仕事成果アップ・副業発信・事業成長・チーム導入・AI学習・自分専用ワークフローの7タイプに分類したい。`

export default function DiagnosisPage() {
  const [settings, setSettings] = useState<DiagnosisSettings | null>(null)
  const [description, setDescription] = useState(initialDescription)
  const [jsonText, setJsonText] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingMessages, setSavingMessages] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; data: DiagnosisSettings }>('/api/diagnosis/config')
      if (res.success) {
        setSettings(res.data)
        setJsonText(JSON.stringify({
          formName: res.data.form?.formName ?? '診断',
          formTitle: res.data.form?.formTitle ?? '診断',
          questions: res.data.questions.map((q) => ({
            text: q.text,
            maps_to_type: q.mapsToType,
            options: q.options,
          })),
          configs: res.data.configs.map((c) => ({
            type_key: c.typeKey,
            label: c.label,
            description: c.description ?? '',
            tag_name: c.tagName,
            line_message: c.lineMessage,
            manga_lp_url: c.mangaLpUrl ?? '',
            color: c.color,
          })),
        }, null, 2))
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function generate() {
    setMessage('AI診断設定を生成中です...')
    const res = await fetchApi<{ success: boolean; data?: unknown; warning?: string; error?: string }>('/api/ai/diagnosis-setup', {
      method: 'POST',
      body: JSON.stringify({ description }),
    })
    if (!res.success) throw new Error(res.error || '生成に失敗しました')
    setJsonText(JSON.stringify(res.data, null, 2))
    setMessage(res.warning || '生成しました。内容を確認して「設定を適用」してください。')
  }

  async function applyJson() {
    setMessage('')
    const parsed = JSON.parse(jsonText) as Record<string, unknown>
    const res = await fetchApi<{ success: boolean; data?: DiagnosisSettings; error?: string }>('/api/diagnosis/config', {
      method: 'POST',
      body: JSON.stringify(parsed),
    })
    if (!res.success) throw new Error(res.error || '保存に失敗しました')
    setMessage('診断設定を適用しました')
    await load()
  }

  async function applyDefault() {
    const res = await fetchApi<{ success: boolean; data?: DiagnosisSettings; error?: string }>('/api/diagnosis/config/default', { method: 'POST' })
    if (!res.success) throw new Error(res.error || '初期テンプレートの適用に失敗しました')
    setMessage('AI活用診断テンプレートを適用しました')
    await load()
  }

  function buildConfigPayload(current: DiagnosisSettings): Record<string, unknown> {
    return {
      formName: current.form?.formName ?? 'AI活用診断',
      formTitle: current.form?.formTitle ?? 'AI活用診断',
      questions: current.questions.map((q) => ({
        text: q.text,
        maps_to_type: q.mapsToType,
        options: q.options,
      })),
      configs: current.configs.map((c) => ({
        type_key: c.typeKey,
        label: c.label,
        description: c.description ?? '',
        tag_name: c.tagName,
        line_message: c.lineMessage,
        manga_lp_url: c.mangaLpUrl ?? '',
        color: c.color,
      })),
    }
  }

  function updateConfigMessage(id: string, lineMessage: string) {
    setSettings((current) => current ? {
      ...current,
      configs: current.configs.map((config) => config.id === id ? { ...config, lineMessage } : config),
    } : current)
  }

  async function saveResultMessages() {
    if (!settings) return
    setSavingMessages(true)
    setMessage('')
    try {
      const payload = buildConfigPayload(settings)
      const res = await fetchApi<{ success: boolean; data?: DiagnosisSettings; error?: string }>('/api/diagnosis/config', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      if (!res.success) throw new Error(res.error || '診断結果メッセージの保存に失敗しました')
      setMessage('診断結果メッセージを保存しました')
      await load()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '診断結果メッセージの保存に失敗しました')
    } finally {
      setSavingMessages(false)
    }
  }

  const publicUrl = `${workerBase}/diagnosis/form`

  return (
    <div>
      <Header title="AI診断" description="質問、診断タイプ、タグ付与、LINE結果メッセージを管理します" />

      {message && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{message}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-6">
        <section className="bg-white border border-gray-200 rounded-lg p-5">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h2 className="text-base font-bold text-gray-900">AIで診断設定を作る</h2>
              <p className="mt-1 text-sm text-gray-500">説明文から、質問・選択肢・診断タイプ・LINE文面をJSONで生成します。</p>
            </div>
            <a className="shrink-0 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" href={publicUrl} target="_blank">公開ページ</a>
          </div>

          <textarea
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={generate} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700">AI生成</button>
            <button onClick={applyDefault} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50">初期テンプレートを適用</button>
            <button onClick={applyJson} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-bold text-white hover:bg-black">設定を適用</button>
          </div>

          <div className="mt-5">
            <label className="text-xs font-semibold text-gray-500">設定JSON</label>
            <textarea
              className="mt-2 h-[520px] w-full rounded-lg border border-gray-300 bg-gray-950 px-3 py-3 font-mono text-xs text-gray-100"
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              spellCheck={false}
            />
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-lg p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-base font-bold text-gray-900">診断結果メッセージ編集</h2>
              <p className="mt-1 text-sm text-gray-500">
                診断後にLINEへ送る文章をタイプ別に変更できます。{'{name}'} を入れると友だち名に置き換わります。
              </p>
            </div>
            <button
              onClick={saveResultMessages}
              disabled={!settings || savingMessages}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:bg-gray-300"
            >
              {savingMessages ? '保存中...' : 'メッセージを保存'}
            </button>
          </div>

          <div className="mt-4 grid gap-4">
            {settings?.configs.map((config) => (
              <div key={config.id} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: config.color }} />
                  <p className="text-sm font-bold text-gray-900">{config.label}</p>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-500">{config.typeKey}</span>
                </div>
                <textarea
                  className="h-56 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm leading-6"
                  value={config.lineMessage}
                  onChange={(e) => updateConfigMessage(config.id, e.target.value)}
                />
              </div>
            ))}
          </div>
        </section>

        <aside className="space-y-6">
          <section className="bg-white border border-gray-200 rounded-lg p-5">
            <h2 className="text-base font-bold text-gray-900">現在の診断</h2>
            {loading ? (
              <p className="mt-3 text-sm text-gray-400">読み込み中...</p>
            ) : (
              <>
                <p className="mt-3 text-sm font-semibold text-gray-900">{settings?.form?.formTitle ?? '未設定'}</p>
                <p className="mt-1 break-all text-sm text-green-700 underline">{publicUrl}</p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-gray-50 p-3">
                    <p className="text-xs text-gray-500">質問数</p>
                    <p className="text-2xl font-bold text-gray-900">{settings?.questions.length ?? 0}</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-3">
                    <p className="text-xs text-gray-500">タイプ数</p>
                    <p className="text-2xl font-bold text-gray-900">{settings?.configs.length ?? 0}</p>
                  </div>
                </div>
              </>
            )}
          </section>

          <section className="bg-white border border-gray-200 rounded-lg p-5">
            <h2 className="text-base font-bold text-gray-900">診断タイプ</h2>
            <div className="mt-4 space-y-3">
              {settings?.configs.map((config) => (
                <div key={config.id} className="rounded-lg border border-gray-200 p-3">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: config.color }} />
                    <p className="text-sm font-bold text-gray-900">{config.label}</p>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">{config.tagName}</p>
                  <p className="mt-2 text-sm text-gray-700">{config.description}</p>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
