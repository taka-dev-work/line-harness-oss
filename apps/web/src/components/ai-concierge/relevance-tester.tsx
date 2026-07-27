'use client'

import { useState } from 'react'

type Result = { relevant: boolean; score: number; reasonCodes: string[]; matchedTerms: string[] }

export function RelevanceTester({ onTest }: { onTest: (message: string) => Promise<Result> }) {
  const [message, setMessage] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')

  return (
    <section className="border-b border-gray-200 py-7">
      <h2 className="text-base font-bold text-gray-900">ローカル判定テスト</h2>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input
          className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-100"
          placeholder="顧客から届く質問を入力"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
        <button
          type="button"
          disabled={testing || !message.trim()}
          onClick={async () => {
            setTesting(true)
            setError('')
            try {
              setResult(await onTest(message))
            } catch (testError) {
              setError(testError instanceof Error ? testError.message : '判定に失敗しました')
            } finally {
              setTesting(false)
            }
          }}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          {testing ? '判定中...' : '判定する'}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {result && (
        <div className={`mt-4 rounded-md border px-4 py-3 text-sm ${result.relevant ? 'border-green-200 bg-green-50 text-green-800' : 'border-gray-200 bg-gray-50 text-gray-700'}`}>
          <div className="flex flex-wrap items-center gap-3">
            <strong>{result.relevant ? 'relevant' : 'off_topic'}</strong>
            <span>スコア {result.score}</span>
          </div>
          <p className="mt-2 text-xs">理由: {result.reasonCodes.join(', ') || '-'}</p>
          <p className="mt-1 text-xs">一致語: {result.matchedTerms.join(', ') || '-'}</p>
        </div>
      )}
    </section>
  )
}
