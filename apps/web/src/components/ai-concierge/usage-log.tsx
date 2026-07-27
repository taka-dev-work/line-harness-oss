import type { AiConciergeLog } from '@/lib/api'

export function UsageLog({ logs }: { logs: AiConciergeLog[] }) {
  return (
    <section className="pt-7">
      <h2 className="text-base font-bold text-gray-900">利用ログ</h2>
      {logs.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">利用ログはまだありません</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[720px] w-full text-left text-sm">
            <thead className="border-b border-gray-200 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 font-semibold">日時</th>
                <th className="px-3 py-2 font-semibold">判定</th>
                <th className="px-3 py-2 font-semibold">AI</th>
                <th className="px-3 py-2 font-semibold">トークン</th>
                <th className="px-3 py-2 font-semibold">応答</th>
                <th className="px-3 py-2 font-semibold">状態</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {logs.map((log) => (
                <tr key={log.id}>
                  <td className="whitespace-nowrap px-3 py-3 text-gray-500">{new Date(log.created_at).toLocaleString('ja-JP')}</td>
                  <td className="px-3 py-3 font-medium text-gray-800">{log.decision}</td>
                  <td className="px-3 py-3 text-gray-600">{log.provider ?? '-'}</td>
                  <td className="px-3 py-3 text-gray-600">{(log.input_tokens ?? 0) + (log.output_tokens ?? 0)}</td>
                  <td className="px-3 py-3 text-gray-600">{log.latency_ms == null ? '-' : `${log.latency_ms}ms`}</td>
                  <td className="px-3 py-3 text-gray-600">{log.error_code ?? log.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
