'use client'

import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/layout/header'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

type AutoReply = {
  id: string
  keyword: string
  matchType: 'exact' | 'contains'
  responseType: string
  responseContent: string
  lineAccountId: string | null
  isActive: boolean
  createdAt: string
}

type GuideAsset = {
  id: string
  title: string
  filename: string
  url: string
  size: number
  createdAt: string
}

function getAppBaseUrl() {
  if (typeof window !== 'undefined') return window.location.origin
  return process.env.NEXT_PUBLIC_API_URL || 'https://YOUR_WORKER_DOMAIN'
}

function buildMenuItems(baseUrl: string) {
  return [
  {
    keyword: 'ガイド',
    label: '無料ガイド',
    description: 'AI活用ガイドやPDF一覧へ案内します。',
    defaultMessage: `AI活用ガイドはこちらです。\n${baseUrl}/ai-crm/guide`,
  },
  {
    keyword: 'AI診断',
    label: 'AI診断',
    description: '4問のAI活用診断へ案内します。',
    defaultMessage: `AI活用診断はこちらです。\n3つの質問に答えるだけで、あなたに合ったAI活用の始め方をご案内します。\n${baseUrl}/diagnosis/form`,
  },
  {
    keyword: '導入相談',
    label: '導入相談',
    description: '予約ページへ一本化して案内します。',
    defaultMessage: `導入相談はこちらです。\n現在の業務を整理し、AI活用・業務改善・導入方法を一緒に確認できます。\n${baseUrl}/book/ai-consultation?lineUserId={{line_user_id}}`,
  },
  {
    keyword: 'AI講座',
    label: 'AI講座',
    description: 'AI講座の予約ページへ案内します。',
    defaultMessage: `AI講座の予約はこちらです。\nChatGPT / Claude / Gemini を仕事で使える形に落とし込む講座です。\n${baseUrl}/book/ai-course?lineUserId={{line_user_id}}`,
  },
  {
    keyword: '勉強会',
    label: '勉強会',
    description: 'AI勉強会の予約ページへ案内します。',
    defaultMessage: `AI勉強会の予約はこちらです。\n実務で使えるAI活用を、初心者でも参加しやすい形で学べます。\n${baseUrl}/book/ai-workshop?lineUserId={{line_user_id}}`,
  },
  {
    keyword: '質問',
    label: '質問する',
    description: '自由質問や個別相談への導線です。',
    defaultMessage: `ご質問ありがとうございます。\n知りたい内容をそのままメッセージで送ってください。個別に整理したい場合は、こちらから相談予約もできます。\n${baseUrl}/book/ai-consultation?lineUserId={{line_user_id}}`,
  },
  ]
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export default function RichMenuResponsesPage() {
  const { selectedAccountId } = useAccount()
  const [appBaseUrl, setAppBaseUrl] = useState(process.env.NEXT_PUBLIC_API_URL || 'https://YOUR_WORKER_DOMAIN')
  const menuItems = useMemo(() => buildMenuItems(appBaseUrl), [appBaseUrl])
  const [autoReplies, setAutoReplies] = useState<AutoReply[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [guideAssets, setGuideAssets] = useState<GuideAsset[]>([])
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingKeyword, setSavingKeyword] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    setAppBaseUrl(getAppBaseUrl())
  }, [])

  const replyByKeyword = useMemo(() => {
    const map = new Map<string, AutoReply>()
    for (const item of autoReplies) {
      if (!map.has(item.keyword)) map.set(item.keyword, item)
    }
    return map
  }, [autoReplies])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [repliesRes, assetsRes] = await Promise.all([
        api.autoReplies.list({ accountId: selectedAccountId || undefined }),
        api.guideAssets.list(),
      ])
      if (repliesRes.success) {
        setAutoReplies(repliesRes.data)
        const nextDrafts: Record<string, string> = {}
        for (const item of menuItems) {
          const existing = repliesRes.data.find((reply) => reply.keyword === item.keyword)
          nextDrafts[item.keyword] = existing?.responseContent || item.defaultMessage
        }
        setDrafts(nextDrafts)
      }
      if (assetsRes.success) setGuideAssets(assetsRes.data)
    } catch {
      setError('設定の読み込みに失敗しました。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId, appBaseUrl])

  async function saveReply(keyword: string) {
    const content = drafts[keyword]?.trim()
    if (!content) {
      setError('返信メッセージを入力してください。')
      return
    }
    setSavingKeyword(keyword)
    setError('')
    setMessage('')
    try {
      const existing = replyByKeyword.get(keyword)
      if (existing) {
        await api.autoReplies.update(existing.id, {
          keyword,
          matchType: 'exact',
          responseType: 'text',
          responseContent: content,
          lineAccountId: selectedAccountId || null,
          isActive: true,
        })
      } else {
        await api.autoReplies.create({
          keyword,
          matchType: 'exact',
          responseType: 'text',
          responseContent: content,
          lineAccountId: selectedAccountId || null,
        })
      }
      setMessage(`${keyword} の返信を保存しました。`)
      await load()
    } catch {
      setError('返信メッセージの保存に失敗しました。')
    } finally {
      setSavingKeyword(null)
    }
  }

  async function uploadPdf() {
    if (!uploadFile) {
      setError('PDFファイルを選択してください。')
      return
    }
    if (uploadFile.type !== 'application/pdf') {
      setError('PDFのみアップロードできます。')
      return
    }
    setUploading(true)
    setError('')
    setMessage('')
    try {
      const data = await fileToDataUrl(uploadFile)
      await api.guideAssets.upload({
        title: uploadTitle || uploadFile.name.replace(/\.pdf$/i, ''),
        filename: uploadFile.name,
        mimeType: uploadFile.type,
        data,
      })
      setUploadTitle('')
      setUploadFile(null)
      setMessage('PDFをアップロードしました。')
      await load()
    } catch {
      setError('PDFアップロードに失敗しました。')
    } finally {
      setUploading(false)
    }
  }

  async function deletePdf(id: string) {
    if (!confirm('このPDFをガイドページから削除しますか？')) return
    await api.guideAssets.delete(id)
    await load()
  }

  return (
    <div className="space-y-6">
      <Header title="リッチメニュー応答" description="リッチメニューをタップした後に返す自動応答と、無料ガイドPDFを管理します" />

      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-700">{message}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-950">タップ後の自動応答</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">LINE側から送られるキーワードごとに返信文を編集します。</p>
          </div>
          <a className="text-sm font-bold text-emerald-700 hover:text-emerald-800" href={`${appBaseUrl}/ai-crm/guide`} target="_blank" rel="noreferrer">
            ガイドページを確認
          </a>
        </div>

        {loading ? (
          <div className="mt-5 rounded-lg bg-slate-50 p-4 text-sm text-slate-500">読み込み中...</div>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
            {menuItems.map((item) => (
              <div key={item.keyword} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-slate-950">{item.label}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{item.description}</p>
                  </div>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-600 ring-1 ring-slate-200">{item.keyword}</span>
                </div>
                <textarea
                  className="mt-3 h-36 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500"
                  value={drafts[item.keyword] || ''}
                  onChange={(event) => setDrafts((prev) => ({ ...prev, [item.keyword]: event.target.value }))}
                />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-xs text-slate-500">{replyByKeyword.get(item.keyword)?.isActive ? '有効' : '未作成または無効'}</p>
                  <button
                    type="button"
                    onClick={() => saveReply(item.keyword)}
                    disabled={savingKeyword === item.keyword}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {savingKeyword === item.keyword ? '保存中...' : '保存する'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-black text-slate-950">AI活用ガイドPDF</h2>
        <p className="mt-1 text-sm leading-6 text-slate-500">アップロードしたPDFは無料ガイドページに掲載されます。</p>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto]">
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="表示タイトル"
            value={uploadTitle}
            onChange={(event) => setUploadTitle(event.target.value)}
          />
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            type="file"
            accept="application/pdf"
            onChange={(event) => setUploadFile(event.target.files?.[0] || null)}
          />
          <button
            type="button"
            onClick={uploadPdf}
            disabled={uploading}
            className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {uploading ? 'アップロード中...' : 'PDFを掲載'}
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {guideAssets.length === 0 ? (
            <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">まだPDFは掲載されていません。</div>
          ) : (
            guideAssets.map((asset) => (
              <div key={asset.id} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-black text-slate-950">{asset.title}</p>
                  <p className="mt-1 text-xs text-slate-500">{asset.filename} / {Math.max(1, Math.round(asset.size / 1024))}KB</p>
                </div>
                <div className="flex gap-2">
                  <a className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50" href={asset.url} target="_blank" rel="noreferrer">開く</a>
                  <button className="rounded-lg border border-red-200 px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-50" onClick={() => deletePdf(asset.id)}>削除</button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
