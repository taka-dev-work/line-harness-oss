'use client'

import type { AiConciergeSettings, AiProviderName } from '@/lib/api'

const providers: Array<{ id: AiProviderName; label: string }> = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Claude' },
  { id: 'gemini', label: 'Gemini' },
]

type Props = {
  value: AiConciergeSettings
  capabilities: Record<AiProviderName, boolean>
  saving: boolean
  onChange: (value: AiConciergeSettings) => void
  onSave: () => void
}

const inputClass = 'mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-100'

export function ConciergeSettings({ value, capabilities, saving, onChange, onSave }: Props) {
  const patch = (next: Partial<AiConciergeSettings>) => onChange({ ...value, ...next })

  return (
    <section className="border-b border-gray-200 pb-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-gray-900">応答設定</h2>
          <p className="mt-1 text-sm text-gray-500">登録情報に関係する質問だけAIへ送信します。</p>
        </div>
        <label className="flex items-center gap-3 text-sm font-semibold text-gray-700">
          <span>{value.enabled ? '有効' : '無効'}</span>
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(event) => patch({ enabled: event.target.checked })}
            className="h-5 w-5 accent-green-600"
          />
        </label>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <label className="text-sm font-semibold text-gray-700">
          サービス名
          <input className={inputClass} maxLength={200} value={value.serviceName} onChange={(event) => patch({ serviceName: event.target.value })} />
        </label>
        <label className="text-sm font-semibold text-gray-700">
          対象者
          <input className={inputClass} maxLength={2000} value={value.targetAudience} onChange={(event) => patch({ targetAudience: event.target.value })} />
        </label>
        <label className="text-sm font-semibold text-gray-700 lg:col-span-2">
          サービス説明
          <textarea className={inputClass} rows={4} maxLength={5000} value={value.serviceDescription} onChange={(event) => patch({ serviceDescription: event.target.value })} />
        </label>
        <label className="text-sm font-semibold text-gray-700 lg:col-span-2">
          料金・契約情報
          <textarea className={inputClass} rows={3} maxLength={3000} value={value.pricing} onChange={(event) => patch({ pricing: event.target.value })} />
        </label>
        <label className="text-sm font-semibold text-gray-700">
          関連キーワード（1行1件）
          <textarea
            className={inputClass}
            rows={5}
            value={value.relatedKeywords.join('\n')}
            onChange={(event) => patch({ relatedKeywords: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })}
          />
        </label>
        <label className="text-sm font-semibold text-gray-700">
          関連URL（1行1件）
          <textarea
            className={inputClass}
            rows={5}
            value={value.relatedUrls.join('\n')}
            onChange={(event) => patch({ relatedUrls: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })}
          />
        </label>
      </div>

      <div className="mt-5">
        <h3 className="text-sm font-bold text-gray-900">AI優先順</h3>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {value.providerOrder.map((selected, index) => (
            <label key={index} className="text-xs font-semibold text-gray-500">
              {index + 1}番目
              <select
                aria-label={`${index + 1}番目のAI`}
                className={inputClass}
                value={selected}
                onChange={(event) => {
                  const next = [...value.providerOrder]
                  const newProvider = event.target.value as AiProviderName
                  const otherIndex = next.indexOf(newProvider)
                  if (otherIndex >= 0) next[otherIndex] = selected
                  next[index] = newProvider
                  patch({ providerOrder: next })
                }}
              >
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}{capabilities[provider.id] ? '' : '（未設定）'}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <label className="text-sm font-semibold text-gray-700">
          対象外の固定返信
          <textarea className={inputClass} rows={3} maxLength={500} value={value.offTopicMessage} onChange={(event) => patch({ offTopicMessage: event.target.value })} />
        </label>
        <label className="text-sm font-semibold text-gray-700">
          AI障害時の固定返信
          <textarea className={inputClass} rows={3} maxLength={500} value={value.providerErrorMessage} onChange={(event) => patch({ providerErrorMessage: event.target.value })} />
        </label>
        <label className="text-sm font-semibold text-gray-700">
          会話継続時間（分）
          <input className={inputClass} type="number" min={1} max={1440} value={value.contextTtlMinutes} onChange={(event) => patch({ contextTtlMinutes: Number(event.target.value) })} />
        </label>
        <label className="text-sm font-semibold text-gray-700">
          履歴件数
          <input className={inputClass} type="number" min={0} max={20} value={value.maxHistoryMessages} onChange={(event) => patch({ maxHistoryMessages: Number(event.target.value) })} />
        </label>
      </div>

      <div className="mt-5 flex justify-end">
        <button type="button" onClick={onSave} disabled={saving} className="rounded-md bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-50">
          {saving ? '保存中...' : '設定を保存'}
        </button>
      </div>
    </section>
  )
}
