'use client'

import { useState } from 'react'
import type { AiConciergeFaq } from '@/lib/api'

type Props = {
  faqs: AiConciergeFaq[]
  busy: boolean
  onCreate: (question: string, answer: string) => Promise<void>
  onUpdate: (faq: AiConciergeFaq) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

const fieldClass = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-100'

export function FaqEditor({ faqs, busy, onCreate, onUpdate, onDelete }: Props) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')

  return (
    <section className="border-b border-gray-200 py-7">
      <div>
        <h2 className="text-base font-bold text-gray-900">FAQ</h2>
        <p className="mt-1 text-sm text-gray-500">回答の根拠として使う質問と回答を登録します。</p>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
        <input aria-label="新しいFAQの質問" className={fieldClass} placeholder="質問" value={question} onChange={(event) => setQuestion(event.target.value)} />
        <input aria-label="新しいFAQの回答" className={fieldClass} placeholder="回答" value={answer} onChange={(event) => setAnswer(event.target.value)} />
        <button
          type="button"
          disabled={busy || !question.trim() || !answer.trim()}
          onClick={async () => {
            try {
              await onCreate(question, answer)
              setQuestion('')
              setAnswer('')
            } catch {
              // Parent keeps the reader-facing error state.
            }
          }}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-bold text-white hover:bg-black disabled:opacity-40"
        >
          追加
        </button>
      </div>

      <div className="mt-5 space-y-3">
        {faqs.length === 0 && <p className="py-6 text-center text-sm text-gray-400">FAQはまだありません</p>}
        {faqs.map((faq) => (
          <div key={faq.id} className="rounded-md border border-gray-200 p-4">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
              <input className={fieldClass} defaultValue={faq.question} onBlur={(event) => onUpdate({ ...faq, question: event.target.value })} />
              <textarea className={fieldClass} rows={2} defaultValue={faq.answer} onBlur={(event) => onUpdate({ ...faq, answer: event.target.value })} />
              <div className="flex items-start gap-2">
                <label className="flex h-10 items-center gap-2 text-xs font-semibold text-gray-600">
                  <input type="checkbox" checked={faq.active} onChange={(event) => onUpdate({ ...faq, active: event.target.checked })} className="accent-green-600" />
                  有効
                </label>
                <button type="button" disabled={busy} onClick={() => onDelete(faq.id)} className="h-10 rounded-md border border-red-200 px-3 text-sm font-semibold text-red-600 hover:bg-red-50">
                  削除
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
