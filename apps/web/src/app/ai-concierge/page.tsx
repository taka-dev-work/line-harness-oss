'use client'

import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import {
  api,
  type AiConciergeFaq,
  type AiConciergeLog,
  type AiConciergeSettings,
  type AiProviderName,
} from '@/lib/api'
import { ConciergeSettings } from '@/components/ai-concierge/concierge-settings'
import { FaqEditor } from '@/components/ai-concierge/faq-editor'
import { RelevanceTester } from '@/components/ai-concierge/relevance-tester'
import { UsageLog } from '@/components/ai-concierge/usage-log'

const emptySettings: AiConciergeSettings = {
  enabled: false,
  serviceName: '',
  serviceDescription: '',
  pricing: '',
  targetAudience: '',
  relatedUrls: [],
  relatedKeywords: [],
  providerOrder: ['openai', 'anthropic', 'gemini'],
  offTopicMessage: 'このサービスに関するご質問のみお答えできます。',
  providerErrorMessage: 'ただいま回答を生成できません。時間をおいて再度お試しください。',
  contextTtlMinutes: 30,
  maxHistoryMessages: 6,
}

const emptyCapabilities: Record<AiProviderName, boolean> = {
  openai: false,
  anthropic: false,
  gemini: false,
}

export default function AiConciergePage() {
  const { selectedAccountId, selectedAccount, loading: accountLoading } = useAccount()
  const [settings, setSettings] = useState<AiConciergeSettings>(emptySettings)
  const [faqs, setFaqs] = useState<AiConciergeFaq[]>([])
  const [logs, setLogs] = useState<AiConciergeLog[]>([])
  const [capabilities, setCapabilities] = useState(emptyCapabilities)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [faqBusy, setFaqBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!selectedAccountId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const [settingsRes, faqRes, logRes, capabilityRes] = await Promise.all([
        api.aiConcierge.settings(selectedAccountId),
        api.aiConcierge.faqs(selectedAccountId),
        api.aiConcierge.logs(selectedAccountId),
        api.aiConcierge.capabilities(selectedAccountId),
      ])
      if (settingsRes.success) setSettings(settingsRes.data)
      if (faqRes.success) setFaqs(faqRes.data)
      if (logRes.success) setLogs(logRes.data.items)
      if (capabilityRes.success) setCapabilities(capabilityRes.data)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => { load() }, [load])

  const run = async (task: () => Promise<void>, success: string) => {
    setError('')
    setNotice('')
    try {
      await task()
      setNotice(success)
    } catch (taskError) {
      setError(taskError instanceof Error ? taskError.message : '処理に失敗しました')
      throw taskError
    }
  }

  async function saveSettings() {
    if (!selectedAccountId) return
    setSaving(true)
    try {
      await run(async () => {
        const response = await api.aiConcierge.saveSettings(selectedAccountId, settings)
        if (response.success) setSettings(response.data)
      }, '設定を保存しました')
    } finally {
      setSaving(false)
    }
  }

  async function createFaq(question: string, answer: string) {
    if (!selectedAccountId) return
    setFaqBusy(true)
    try {
      await run(async () => {
        const response = await api.aiConcierge.createFaq(selectedAccountId, {
          question,
          answer,
          sortOrder: faqs.length,
          active: true,
        })
        if (response.success) setFaqs((current) => [...current, response.data])
      }, 'FAQを追加しました')
    } finally {
      setFaqBusy(false)
    }
  }

  async function updateFaq(faq: AiConciergeFaq) {
    if (!selectedAccountId) return
    setFaqBusy(true)
    try {
      await run(async () => {
        const response = await api.aiConcierge.updateFaq(selectedAccountId, faq.id, {
          question: faq.question,
          answer: faq.answer,
          sortOrder: faq.sortOrder,
          active: faq.active,
        })
        if (response.success) {
          setFaqs((current) => current.map((item) => item.id === faq.id ? response.data : item))
        }
      }, 'FAQを更新しました')
    } finally {
      setFaqBusy(false)
    }
  }

  async function deleteFaq(id: string) {
    if (!selectedAccountId) return
    setFaqBusy(true)
    try {
      await run(async () => {
        await api.aiConcierge.deleteFaq(selectedAccountId, id)
        setFaqs((current) => current.filter((faq) => faq.id !== id))
      }, 'FAQを削除しました')
    } finally {
      setFaqBusy(false)
    }
  }

  return (
    <div>
      <Header
        title="AIコンシェルジュ"
        description={selectedAccount ? `${selectedAccount.displayName || selectedAccount.name} の顧客対応設定` : 'LINEアカウントを選択してください'}
      />

      {notice && <div className="mb-4 border-l-4 border-green-500 bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</div>}
      {error && <div className="mb-4 border-l-4 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {accountLoading || loading ? (
        <div className="border-t border-gray-200 py-16 text-center text-sm text-gray-500">読み込み中...</div>
      ) : !selectedAccountId ? (
        <div className="border-t border-gray-200 py-16 text-center text-sm text-gray-500">LINEアカウントを選択してください</div>
      ) : (
        <div className="border-t border-gray-200 bg-white px-4 py-7 sm:px-6">
          <ConciergeSettings
            value={settings}
            capabilities={capabilities}
            saving={saving}
            onChange={setSettings}
            onSave={saveSettings}
          />
          <FaqEditor
            faqs={faqs}
            busy={faqBusy}
            onCreate={createFaq}
            onUpdate={updateFaq}
            onDelete={deleteFaq}
          />
          <RelevanceTester
            onTest={async (message) => {
              if (!selectedAccountId) throw new Error('LINEアカウントを選択してください')
              const response = await api.aiConcierge.relevanceTest(selectedAccountId, message)
              if (!response.success) throw new Error(response.error)
              return response.data
            }}
          />
          <UsageLog logs={logs} />
        </div>
      )}
    </div>
  )
}
