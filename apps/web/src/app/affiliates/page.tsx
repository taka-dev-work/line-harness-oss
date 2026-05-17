'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'

import { fetchApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

function getWorkerBase() {
  if (typeof window !== 'undefined') return window.location.origin
  return process.env.NEXT_PUBLIC_API_URL || ''
}

interface RefRoute {
  refCode: string
  name: string
  friendCount: number
  clickCount: number
  latestAt: string | null
}

interface RefSummaryData {
  routes: RefRoute[]
  totalFriends: number
  friendsWithRef: number
  friendsWithoutRef: number
}

interface RefFriend {
  id: string
  displayName: string
  trackedAt: string | null
}

interface RefDetailData {
  refCode: string
  name: string
  friends: RefFriend[]
}

export default function AttributionPage() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const [workerBase, setWorkerBase] = useState(process.env.NEXT_PUBLIC_API_URL || '')
  const [summary, setSummary] = useState<RefSummaryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedRef, setSelectedRef] = useState<string | null>(null)
  const [detail, setDetail] = useState<RefDetailData | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [routeForm, setRouteForm] = useState({ name: '', refCode: '' })
  const [savingRoute, setSavingRoute] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    setWorkerBase(getWorkerBase())
  }, [])

  const loadSummary = useCallback(async () => {
    setLoading(true)
    try {
      const query = selectedAccountId ? `?lineAccountId=${selectedAccountId}` : ''
      const res = await fetchApi<{ success: boolean; data: RefSummaryData }>(`/api/analytics/ref-summary${query}`)
      setSummary(res.data)
    } catch {
      // silent
    }
    setLoading(false)
  }, [selectedAccountId])

  useEffect(() => {
    loadSummary()
    // Refresh when tab becomes visible
    const handleVisibility = () => { if (document.visibilityState === 'visible') loadSummary() }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [loadSummary])

  const handleRowClick = async (refCode: string) => {
    if (selectedRef === refCode) {
      setSelectedRef(null)
      setDetail(null)
      return
    }
    setSelectedRef(refCode)
    setDetailLoading(true)
    try {
      const query = selectedAccountId ? `?lineAccountId=${selectedAccountId}` : ''
      const res = await fetchApi<{ success: boolean; data: RefDetailData }>(`/api/analytics/ref/${encodeURIComponent(refCode)}${query}`)
      setDetail(res.data)
    } catch {
      setDetail(null)
    }
    setDetailLoading(false)
  }

  const handleCopy = async (refCode: string) => {
    const url = buildEntryUrl(refCode)
    await navigator.clipboard.writeText(url)
    setCopiedCode(refCode)
    setTimeout(() => setCopiedCode(null), 2000)
  }

  const copyText = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value)
    setNotice(`${label}をコピーしました。`)
  }

  const buildEntryUrl = (refCode: string) => {
    const params = new URLSearchParams()
    params.set('ref', refCode)
    if (selectedAccount?.channelId) params.set('account', selectedAccount.channelId)
    return `${workerBase}/auth/line?${params.toString()}`
  }

  const officialLineUrl = selectedAccount?.basicId
    ? `https://line.me/R/ti/p/${selectedAccount.basicId}`
    : ''

  const suggestRefCode = (name: string) => {
    const base = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    return base || `route-${Date.now().toString(36)}`
  }

  const createRoute = async () => {
    const name = routeForm.name.trim()
    const refCode = (routeForm.refCode.trim() || suggestRefCode(name)).replace(/[^a-zA-Z0-9_-]/g, '-')
    if (!name || !refCode) {
      setNotice('経路名とrefコードを入力してください。')
      return
    }
    setSavingRoute(true)
    setNotice('')
    try {
      const res = await fetchApi<{ success: boolean; error?: string }>('/api/entry-routes', {
        method: 'POST',
        body: JSON.stringify({ name, refCode, isActive: true }),
      })
      if (!res.success) throw new Error(res.error || '流入経路の作成に失敗しました')
      setRouteForm({ name: '', refCode: '' })
      setNotice('流入経路を作成しました。URLをコピーしてSNS、note、LPなどに設置できます。')
      await loadSummary()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '流入経路の作成に失敗しました')
    } finally {
      setSavingRoute(false)
    }
  }

  const formatDate = (iso: string | null) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
  }

  return (
    <div>
      <Header
        title="流入経路分析"
        description="SNS、note、LP、セミナーなどの入口別に友だち追加を計測します"
      />

      {notice && <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">{notice}</div>}

      <section className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-bold text-emerald-950">連携中の公式アカウント</h2>
            <p className="mt-1 text-sm text-emerald-800">
              {selectedAccount ? `${selectedAccount.displayName || selectedAccount.name} に紐づく流入URLを作成します。` : '公式アカウントを選択してください。'}
            </p>
            {selectedAccount?.basicId && <p className="mt-1 font-mono text-xs text-emerald-700">{selectedAccount.basicId}</p>}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {officialLineUrl ? (
              <button
                type="button"
                onClick={() => copyText(officialLineUrl, '公式LINE URL')}
                className="rounded-lg bg-white px-3 py-2 text-sm font-bold text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100"
              >
                公式LINE URLをコピー
              </button>
            ) : (
              <span className="rounded-lg bg-white px-3 py-2 text-sm font-bold text-amber-700 ring-1 ring-amber-200">
                Basic ID取得中
              </span>
            )}
          </div>
        </div>
      </section>

      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">流入経路を作成</h2>
            <p className="mt-1 text-sm text-gray-500">
              入口ごとに専用URLを作ります。例: Xプロフィール、note記事、セミナー、LP。
            </p>
          </div>
          <button
            type="button"
            onClick={() => setRouteForm({ ...routeForm, refCode: suggestRefCode(routeForm.name) })}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
          >
            ref自動作成
          </button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_220px_auto]">
          <label className="text-sm font-medium text-gray-700">
            経路名
            <input
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={routeForm.name}
              onChange={(e) => setRouteForm({ ...routeForm, name: e.target.value })}
              placeholder="例: Xプロフィール"
            />
          </label>
          <label className="text-sm font-medium text-gray-700">
            refコード
            <input
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm"
              value={routeForm.refCode}
              onChange={(e) => setRouteForm({ ...routeForm, refCode: e.target.value })}
              placeholder="例: x-profile"
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={createRoute}
              disabled={savingRoute}
              className="w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:bg-gray-300"
            >
              {savingRoute ? '作成中...' : '作成'}
            </button>
          </div>
        </div>
        <p className="mt-3 break-all rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
          作成されるURL: {buildEntryUrl(routeForm.refCode || suggestRefCode(routeForm.name))}
        </p>
      </section>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-xl p-5 border border-gray-100">
            <p className="text-sm text-gray-500">総友だち数</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{summary.totalFriends}</p>
          </div>
          <div className="bg-white rounded-xl p-5 border border-gray-100">
            <p className="text-sm text-gray-500">ref 経由</p>
            <p className="text-3xl font-bold text-green-600 mt-1">{summary.friendsWithRef}</p>
          </div>
          <div className="bg-white rounded-xl p-5 border border-gray-100">
            <p className="text-sm text-gray-500">ref 不明</p>
            <p className="text-3xl font-bold text-gray-400 mt-1">{summary.friendsWithoutRef}</p>
          </div>
          <div className="bg-white rounded-xl p-5 border border-gray-100">
            <p className="text-sm text-gray-500">経路数</p>
            <p className="text-3xl font-bold text-blue-600 mt-1">{summary.routes.length}</p>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
          読み込み中...
        </div>
      ) : !summary || summary.routes.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
          流入経路がまだ登録されていません
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ref コード</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">経路名</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">友だち数</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">クリック数</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">最新追加日</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">URL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {summary.routes.map((route) => {
                const authUrl = buildEntryUrl(route.refCode)
                const isExpanded = selectedRef === route.refCode
                return (
                  <>
                    <tr
                      key={route.refCode}
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => handleRowClick(route.refCode)}
                    >
                      <td className="px-4 py-3 text-sm font-mono text-blue-600">{route.refCode}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{route.name}</td>
                      <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900">{route.friendCount}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600">{route.clickCount}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{formatDate(route.latestAt)}</td>
                      <td className="px-4 py-3 text-sm" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400 truncate max-w-[180px]">{authUrl}</span>
                          <button
                            onClick={() => handleCopy(route.refCode)}
                            className="text-xs text-blue-500 hover:text-blue-700 shrink-0"
                          >
                            {copiedCode === route.refCode ? 'コピー済' : 'コピー'}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${route.refCode}-detail`}>
                        <td colSpan={6} className="px-6 py-4 bg-gray-50">
                          {detailLoading ? (
                            <p className="text-sm text-gray-400">読み込み中...</p>
                          ) : detail && detail.friends.length > 0 ? (
                            <div>
                              <p className="text-xs font-semibold text-gray-500 uppercase mb-3">
                                このルートから追加した友だち ({detail.friends.length}人)
                              </p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                {detail.friends.map((f) => (
                                  <div key={f.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-gray-100">
                                    <span className="text-sm text-gray-800 font-medium truncate">{f.displayName}</span>
                                    <span className="text-xs text-gray-400 ml-2 shrink-0">{formatDate(f.trackedAt)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <p className="text-sm text-gray-400">このルートから追加した友だちはまだいません</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
