'use client'

import { useState, useEffect, useCallback } from 'react'
import { api, fetchApi, type FormField, type ManagedForm } from '@/lib/api'
import Header from '@/components/layout/header'

interface Submission {
  id: string
  formId: string
  friendId: string
  friendName?: string
  data: Record<string, unknown>
  createdAt: string
}

const PAGE_SIZE = 20
const defaultConsultFields: FormField[] = [
  { name: 'name', label: 'お名前', type: 'text', required: true },
  { name: 'type', label: '区分', type: 'select', required: true, options: ['個人', '法人'] },
  { name: 'topic', label: '相談内容', type: 'select', required: true, options: ['AI活用', '業務自動化', 'AIエージェント導入', '研修・講座', 'その他'] },
  { name: 'challenge', label: '現在の課題', type: 'textarea', required: true },
  { name: 'contact', label: '希望する相談方法', type: 'select', required: false, options: ['LINE', 'オンライン面談', 'メール'] },
]

type FormDraft = {
  name: string
  description: string
  fieldsJson: string
  isActive: boolean
  saveToMetadata: boolean
}

function toDraft(form?: ManagedForm): FormDraft {
  return {
    name: form?.name ?? 'AI相談ヒアリングフォーム',
    description: form?.description ?? '相談前に、現在の状況と実現したいことを簡単に教えてください。',
    fieldsJson: JSON.stringify(form?.fields ?? defaultConsultFields, null, 2),
    isActive: form?.isActive ?? true,
    saveToMetadata: form?.saveToMetadata ?? true,
  }
}

export default function FormSubmissionsPage() {
  const [forms, setForms] = useState<ManagedForm[]>([])
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null)
  const selectedForm = forms.find((form) => form.id === selectedFormId) ?? null
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [subLoading, setSubLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [fieldLabels, setFieldLabels] = useState<Record<string, string>>({})
  const [showEditor, setShowEditor] = useState(false)
  const [draft, setDraft] = useState<FormDraft>(() => toDraft())
  const [formSaving, setFormSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const loadForms = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.forms.list()
      if (res.success) setForms(res.data)
    } catch { /* silent */ }
    setLoading(false)
  }, [])

  useEffect(() => { loadForms() }, [loadForms])

  const loadSubmissions = useCallback(async (formId: string) => {
    setSubLoading(true)
    setPage(1)
    try {
      // Load form definition for field labels
      const formRes = await fetchApi<{ success: boolean; data: { fields: Array<{ name: string; label: string }> } }>(`/api/forms/${formId}`)

      const res = await fetchApi<{ success: boolean; data: (Submission & { friendName?: string })[] }>(`/api/forms/${formId}/submissions`)

      // Guard against race condition: only update if this form is still selected
      setSelectedFormId((current) => {
        if (current !== formId) return current
        if (formRes.success && formRes.data.fields) {
          const labels: Record<string, string> = {}
          const fields = typeof formRes.data.fields === 'string' ? JSON.parse(formRes.data.fields) : formRes.data.fields
          for (const f of fields) labels[f.name] = f.label
          setFieldLabels(labels)
        }
        if (res.success) {
          setSubmissions(res.data.map((s) => ({
            ...s,
            data: typeof s.data === 'string' ? JSON.parse(s.data) : s.data,
            friendName: s.friendName || '不明',
          })))
        }
        return current
      })
    } catch { /* silent */ }
    // Only clear loading if this form is still selected
    setSelectedFormId((current) => {
      if (current === formId) setSubLoading(false)
      return current
    })
  }, [])

  const handleSelectForm = (formId: string) => {
    setSelectedFormId(formId)
    const form = forms.find((item) => item.id === formId)
    if (form) setDraft(toDraft(form))
    loadSubmissions(formId)
  }

  const startCreate = () => {
    setSelectedFormId(null)
    setSubmissions([])
    setFieldLabels({})
    setDraft(toDraft())
    setFormError('')
    setShowEditor(true)
  }

  const startEdit = () => {
    setDraft(toDraft(selectedForm ?? undefined))
    setFormError('')
    setShowEditor(true)
  }

  const saveForm = async () => {
    if (!draft.name.trim()) {
      setFormError('フォーム名を入力してください')
      return
    }
    let fields: FormField[]
    try {
      fields = JSON.parse(draft.fieldsJson)
      if (!Array.isArray(fields)) throw new Error('fields must be an array')
    } catch {
      setFormError('項目JSONの形式が正しくありません')
      return
    }
    setFormSaving(true)
    setFormError('')
    try {
      const payload = {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        fields,
        isActive: draft.isActive,
        saveToMetadata: draft.saveToMetadata,
      }
      const res = selectedFormId
        ? await api.forms.update(selectedFormId, payload)
        : await api.forms.create(payload)
      if (!res.success) {
        setFormError(res.error)
        return
      }
      await loadForms()
      setSelectedFormId(res.data.id)
      setDraft(toDraft(res.data))
      setShowEditor(false)
      loadSubmissions(res.data.id)
    } catch {
      setFormError('フォーム設定の保存に失敗しました')
    } finally {
      setFormSaving(false)
    }
  }

  // Pagination
  const totalPages = Math.ceil(submissions.length / PAGE_SIZE)
  const paged = submissions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Get all unique field keys
  const fieldKeys = submissions.length > 0
    ? [...new Set(submissions.flatMap(s => Object.keys(s.data)))]
    : []

  return (
    <div>
      <Header
        title="フォーム回答"
        description="相談フォームを編集し、公開フォームに反映します。"
        action={
          <button
            type="button"
            onClick={startCreate}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            + 新規フォーム
          </button>
        }
      />

      {/* Form selector */}
      <div className="mb-6">
        <div className="flex flex-wrap gap-2">
          {loading ? (
            <div className="text-sm text-gray-400">読み込み中...</div>
          ) : (
            forms.map((form) => (
              <button
                key={form.id}
                onClick={() => handleSelectForm(form.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  selectedFormId === form.id
                    ? 'text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                style={selectedFormId === form.id ? { backgroundColor: '#06C755' } : {}}
              >
                {form.name}
              </button>
            ))
          )}
        </div>
      </div>

      {selectedForm && (
        <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">{selectedForm.name}</h2>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${selectedForm.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {selectedForm.isActive ? '公開中' : '停止中'}
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-500">{selectedForm.description || '説明は未設定です。'}</p>
              <p className="mt-2 text-xs text-slate-400">
                公開URL: /ai-crm/form?id={selectedForm.id}
              </p>
            </div>
            <button
              type="button"
              onClick={startEdit}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50"
            >
              フォーム設定を編集
            </button>
          </div>
        </section>
      )}

      {showEditor && (
        <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">{selectedFormId ? 'フォーム設定を編集' : '新規フォームを作成'}</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[420px_1fr]">
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">フォーム名</label>
                <input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">説明文</label>
                <textarea
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  rows={3}
                  className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-green-600 focus:ring-green-500"
                />
                公開して回答を受け付ける
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={draft.saveToMetadata}
                  onChange={(event) => setDraft({ ...draft, saveToMetadata: event.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-green-600 focus:ring-green-500"
                />
                回答を友だちメタデータにも保存
              </label>
            </div>
            <div>
              <div className="flex items-center justify-between gap-2">
                <label className="block text-xs font-medium text-slate-600">項目JSON</label>
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, fieldsJson: JSON.stringify(defaultConsultFields, null, 2) })}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  相談フォーム初期値
                </button>
              </div>
              <textarea
                value={draft.fieldsJson}
                onChange={(event) => setDraft({ ...draft, fieldsJson: event.target.value })}
                rows={14}
                className="mt-1 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>
          {formError && <p className="mt-3 text-xs font-medium text-red-600">{formError}</p>}
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={saveForm}
              disabled={formSaving}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: '#06C755' }}
            >
              {formSaving ? '保存中...' : '保存して反映'}
            </button>
            <button
              type="button"
              onClick={() => { setShowEditor(false); setFormError('') }}
              className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
            >
              キャンセル
            </button>
          </div>
        </section>
      )}

      {/* Stats */}
      {selectedFormId && !subLoading && submissions.length > 0 && (
        <div className="mb-4 text-sm text-gray-500">
          全 <span className="font-bold text-gray-900">{submissions.length}</span> 件の回答
        </div>
      )}

      {/* Table */}
      {selectedFormId && (
        subLoading ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">読み込み中...</div>
        ) : submissions.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">回答がありません</div>
        ) : (
          <>
            <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
              <table className="w-full min-w-[800px]">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">名前</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">日時</th>
                    {fieldKeys.map((key) => (
                      <th key={key} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">
                        {fieldLabels[key] || key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {paged.map((sub) => (
                    <tr key={sub.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">{sub.friendName}</td>
                      <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                        {new Date(sub.createdAt).toLocaleString('ja-JP', {
                          month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                      {fieldKeys.map((key) => (
                        <td key={key} className="px-4 py-3 text-sm text-gray-700 max-w-[200px] truncate">
                          {Array.isArray(sub.data[key])
                            ? (sub.data[key] as string[]).join(', ')
                            : (sub.data[key] !== null && sub.data[key] !== undefined && sub.data[key] !== '') ? String(sub.data[key]) : '-'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <p className="text-xs text-gray-400">
                  {(page - 1) * PAGE_SIZE + 1}〜{Math.min(page * PAGE_SIZE, submissions.length)} 件 / 全{submissions.length}件
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-30 hover:bg-gray-50"
                  >
                    前へ
                  </button>
                  <span className="px-3 py-1.5 text-sm text-gray-500">{page} / {totalPages}</span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-30 hover:bg-gray-50"
                  >
                    次へ
                  </button>
                </div>
              </div>
            )}
          </>
        )
      )}
    </div>
  )
}
