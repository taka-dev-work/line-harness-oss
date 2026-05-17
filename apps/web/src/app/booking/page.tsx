'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Header from '@/components/layout/header'
import { fetchApi } from '@/lib/api'

type BookingService = {
  id: string
  name: string
  slug: string
  description: string | null
  approvalRequired: boolean
  formFields: BookingFormField[]
  googleCalendarId: string | null
  enableGoogleMeet: boolean
}

type BookingFormField = {
  key: string
  label: string
  type: 'text' | 'email' | 'phone' | 'select'
  required?: boolean
  options?: string[]
}

type BookingSlot = {
  id: string
  serviceId: string
  startsAt: string
  endsAt: string
  capacity: number
  bookedCount: number
  isCancelled: boolean
}

type Booking = {
  id: string
  serviceName: string | null
  slotStartsAt: string | null
  lineUserId: string
  status: string
  approvalStatus: string | null
  customerInfo: Record<string, unknown>
  createdAt: string
}

type BookingServicePreset = {
  key: string
  label: string
  name: string
  slug: string
  description: string
  approvalRequired: boolean
}

const workerBase = process.env.NEXT_PUBLIC_API_URL ?? ''
const dayOptions = [
  { value: 0, label: '日' },
  { value: 1, label: '月' },
  { value: 2, label: '火' },
  { value: 3, label: '水' },
  { value: 4, label: '木' },
  { value: 5, label: '金' },
  { value: 6, label: '土' },
]

const servicePresets: BookingServicePreset[] = [
  {
    key: 'consultation',
    label: 'AI個別相談',
    name: 'AI個別相談',
    slug: 'ai-consultation',
    description: 'AI活用・業務改善・AIエージェント導入について相談できます。',
    approvalRequired: false,
  },
  {
    key: 'course',
    label: 'AI講座',
    name: 'AI講座',
    slug: 'ai-course',
    description: 'ChatGPT / Claude / Gemini の実務活用を、自分の仕事に落とし込むための講座予約です。',
    approvalRequired: false,
  },
  {
    key: 'workshop',
    label: 'AI勉強会',
    name: 'AI勉強会',
    slug: 'ai-workshop',
    description: '実務で使えるAI活用をテーマに、初心者でも参加しやすい勉強会の予約です。',
    approvalRequired: false,
  },
] 

const bookingFormFieldsBySlug: Record<string, BookingFormField[]> = {
  'ai-consultation': [
    { key: 'name', label: 'お名前', type: 'text', required: true },
    { key: 'company', label: '会社名・屋号', type: 'text', required: false },
    { key: 'topic', label: '相談したい内容', type: 'text', required: true },
  ],
  'ai-course': [
    { key: 'name', label: 'お名前', type: 'text', required: true },
    { key: 'email', label: 'メールアドレス', type: 'email', required: false },
    { key: 'company', label: '会社名・屋号', type: 'text', required: false },
    { key: 'experience', label: '現在のAI活用レベル', type: 'text', required: false },
    { key: 'topic', label: '講座で学びたいこと', type: 'text', required: true },
  ],
  'ai-workshop': [
    { key: 'name', label: 'お名前', type: 'text', required: true },
    { key: 'email', label: 'メールアドレス', type: 'email', required: false },
    { key: 'company', label: '会社名・屋号', type: 'text', required: false },
    { key: 'interest', label: '興味のあるテーマ', type: 'text', required: true },
    { key: 'experience', label: '現在のAI活用レベル', type: 'text', required: false },
  ],
}

const bookingMessagesBySlug: Record<string, { confirmed: string; booked: string; cancelled: string }> = {
  'ai-consultation': {
    confirmed: '{name}さん、ご予約が確定しました。日時: {datetime}',
    booked: '{name}さん、ご予約を受け付けました。確認後にご連絡します。',
    cancelled: '{name}さん、ご予約をキャンセルしました。',
  },
  'ai-course': {
    confirmed: '{name}さん、AI講座のご予約が確定しました。日時: {datetime}',
    booked: '{name}さん、AI講座のご予約を受け付けました。確認後にご連絡します。',
    cancelled: '{name}さん、AI講座のご予約をキャンセルしました。',
  },
  'ai-workshop': {
    confirmed: '{name}さん、AI勉強会のご予約が確定しました。日時: {datetime}',
    booked: '{name}さん、AI勉強会のご予約を受け付けました。確認後にご連絡します。',
    cancelled: '{name}さん、AI勉強会のご予約をキャンセルしました。',
  },
}

function defaultFieldsForSlug(slug: string) {
  return (bookingFormFieldsBySlug[slug] ?? bookingFormFieldsBySlug['ai-consultation']).map((field) => ({
    ...field,
    options: field.options ? [...field.options] : undefined,
  }))
}

function parseOptionText(value: string) {
  return value
    .split('\n')
    .map((option) => option.trim())
}

function dateInput(offsetDays = 0) {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  return date.toISOString().slice(0, 10)
}

function datetimeLocalToJst(value: string) {
  return `${value}:00+09:00`
}

function fmt(value?: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function BookingPage() {
  const [services, setServices] = useState<BookingService[]>([])
  const [slots, setSlots] = useState<BookingSlot[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [selectedServiceId, setSelectedServiceId] = useState('')
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [savingFields, setSavingFields] = useState(false)
  const [savingService, setSavingService] = useState(false)
  const [fieldDrafts, setFieldDrafts] = useState<BookingFormField[]>(bookingFormFieldsBySlug['ai-consultation'])
  const [serviceForm, setServiceForm] = useState({
    ...servicePresets[0],
    googleCalendarId: '',
    enableGoogleMeet: true,
  })
  const [slotForm, setSlotForm] = useState({
    startsAt: '',
    endsAt: '',
    capacity: 1,
  })
  const [bulkForm, setBulkForm] = useState({
    dateFrom: dateInput(1),
    dateTo: dateInput(30),
    startTime: '10:00',
    endTime: '11:00',
    intervalMinutes: 30,
    capacity: 1,
    daysOfWeek: [1, 2, 3, 4, 5],
  })

  const selectedService = useMemo(
    () => services.find((service) => service.id === selectedServiceId) ?? services[0],
    [services, selectedServiceId],
  )

  useEffect(() => {
    if (!selectedService) return
    const fields = selectedService.formFields?.length
      ? selectedService.formFields
      : bookingFormFieldsBySlug[selectedService.slug] ?? bookingFormFieldsBySlug['ai-consultation']
    setFieldDrafts(fields)
    setServiceForm({
      key: selectedService.slug,
      label: selectedService.name,
      name: selectedService.name,
      slug: selectedService.slug,
      description: selectedService.description ?? '',
      approvalRequired: selectedService.approvalRequired,
      googleCalendarId: selectedService.googleCalendarId ?? '',
      enableGoogleMeet: selectedService.enableGoogleMeet,
    })
  }, [selectedService])

  const loadAll = useCallback(async (serviceIdOverride?: string) => {
    setLoading(true)
    try {
      const serviceRes = await fetchApi<{ success: boolean; data: BookingService[] }>('/api/booking/services')
      const loadedServices = serviceRes.success ? serviceRes.data : []
      setServices(loadedServices)
      const serviceId = serviceIdOverride || selectedServiceId || loadedServices[0]?.id || ''
      if (serviceId) {
        setSelectedServiceId(serviceId)
        const [slotRes, bookingRes] = await Promise.all([
          fetchApi<{ success: boolean; data: BookingSlot[] }>(`/api/booking/slots?serviceId=${serviceId}`),
          fetchApi<{ success: boolean; data: Booking[] }>(`/api/booking/bookings?serviceId=${serviceId}`),
        ])
        if (slotRes.success) setSlots(slotRes.data)
        if (bookingRes.success) setBookings(bookingRes.data)
      } else {
        setSlots([])
        setBookings([])
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [selectedServiceId])

  useEffect(() => { loadAll() }, [loadAll])

  async function createService() {
    setMessage('')
    const formFields = bookingFormFieldsBySlug[serviceForm.slug] ?? bookingFormFieldsBySlug['ai-consultation']
    const messages = bookingMessagesBySlug[serviceForm.slug] ?? bookingMessagesBySlug['ai-consultation']
    const res = await fetchApi<{ success: boolean; data?: BookingService; error?: string }>('/api/booking/services', {
      method: 'POST',
      body: JSON.stringify({
        ...serviceForm,
        type: 'calendar',
        formFields,
        remindHours: [24],
        googleCalendarId: serviceForm.googleCalendarId || null,
        enableGoogleMeet: serviceForm.enableGoogleMeet,
        messageOnConfirmed: messages.confirmed,
        messageOnBooked: messages.booked,
        messageOnCancelled: messages.cancelled,
      }),
    })
    if (!res.success) throw new Error(res.error || '作成に失敗しました')
    setSelectedServiceId(res.data?.id ?? '')
    setMessage('予約サービスを作成しました')
    await loadAll(res.data?.id)
  }

  function updateField(index: number, patch: Partial<BookingFormField>) {
    setFieldDrafts((fields) => fields.map((field, i) => (i === index ? { ...field, ...patch } : field)))
  }

  function addField() {
    setFieldDrafts((fields) => [
      ...fields,
      {
        key: `field_${fields.length + 1}`,
        label: '新しい項目',
        type: 'text',
        required: false,
      },
    ])
  }

  function removeField(index: number) {
    setFieldDrafts((fields) => fields.filter((_, i) => i !== index))
  }

  function normalizeFields(fields: BookingFormField[]) {
    return fields
      .map((field, index) => ({
        key: (field.key || `field_${index + 1}`)
          .trim()
          .replace(/[^a-zA-Z0-9_]/g, '_'),
        label: (field.label || '項目').trim(),
        type: field.type || 'text',
        required: Boolean(field.required),
        options: field.type === 'select' ? (field.options ?? []).map((value) => value.trim()).filter(Boolean) : undefined,
      }))
      .filter((field) => field.key && field.label)
  }

  async function saveFormFields() {
    if (!selectedService) return
    setSavingFields(true)
    setMessage('')
    try {
      const formFields = normalizeFields(fieldDrafts)
      const res = await fetchApi<{ success: boolean; data?: BookingService; error?: string }>(`/api/booking/services/${selectedService.id}`, {
        method: 'PUT',
        body: JSON.stringify({ formFields }),
      })
      if (!res.success) throw new Error(res.error || '入力フォームの保存に失敗しました')
      setFieldDrafts(res.data?.formFields ?? formFields)
      setMessage(`${selectedService.name} の入力フォームを保存しました`)
      await loadAll(selectedService.id)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '入力フォームの保存に失敗しました')
    } finally {
      setSavingFields(false)
    }
  }

  async function saveSelectedServiceSettings() {
    if (!selectedService) return
    setSavingService(true)
    setMessage('')
    try {
      const res = await fetchApi<{ success: boolean; data?: BookingService; error?: string }>(`/api/booking/services/${selectedService.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          googleCalendarId: serviceForm.googleCalendarId || null,
          enableGoogleMeet: serviceForm.enableGoogleMeet,
        }),
      })
      if (!res.success) throw new Error(res.error || 'Googleカレンダー設定の保存に失敗しました')
      setMessage(`${selectedService.name} のGoogleカレンダー設定を保存しました`)
      await loadAll(selectedService.id)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Googleカレンダー設定の保存に失敗しました')
    } finally {
      setSavingService(false)
    }
  }

  async function createSlot() {
    if (!selectedService || !slotForm.startsAt || !slotForm.endsAt) return
    setMessage('')
    const res = await fetchApi<{ success: boolean; error?: string }>('/api/booking/slots', {
      method: 'POST',
      body: JSON.stringify({
        serviceId: selectedService.id,
        startsAt: datetimeLocalToJst(slotForm.startsAt),
        endsAt: datetimeLocalToJst(slotForm.endsAt),
        capacity: Number(slotForm.capacity),
      }),
    })
    if (!res.success) throw new Error(res.error || '予約枠の作成に失敗しました')
    setMessage('予約枠を作成しました')
    await loadAll(selectedService.id)
  }

  async function generateSlots() {
    setMessage('')
    if (!selectedService) {
      setMessage('先に予約サービスを作成または選択してください')
      return
    }
    if (bulkForm.daysOfWeek.length === 0) {
      setMessage('予約を解放する曜日を1つ以上選択してください')
      return
    }
    if (!bulkForm.dateFrom || !bulkForm.dateTo || !bulkForm.startTime || !bulkForm.endTime) {
      setMessage('期間と時間帯を入力してください')
      return
    }
    try {
      const res = await fetchApi<{ success: boolean; data?: BookingSlot[]; error?: string }>('/api/booking/slots/generate', {
        method: 'POST',
        body: JSON.stringify({
          serviceId: selectedService.id,
          dateFrom: bulkForm.dateFrom,
          dateTo: bulkForm.dateTo,
          startTime: bulkForm.startTime,
          endTime: bulkForm.endTime,
          intervalMinutes: Number(bulkForm.intervalMinutes),
          capacity: Number(bulkForm.capacity),
          daysOfWeek: bulkForm.daysOfWeek,
        }),
      })
      if (!res.success) throw new Error(res.error || '予約枠の一括生成に失敗しました')
      setMessage(`${res.data?.length ?? 0}件の予約枠を作成しました`)
      await loadAll(selectedService.id)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '予約枠の一括生成に失敗しました')
    }
  }

  function setDayPreset(daysOfWeek: number[]) {
    setBulkForm({ ...bulkForm, daysOfWeek })
  }

  function toggleDay(day: number) {
    const exists = bulkForm.daysOfWeek.includes(day)
    setBulkForm({
      ...bulkForm,
      daysOfWeek: exists
        ? bulkForm.daysOfWeek.filter((value) => value !== day)
        : [...bulkForm.daysOfWeek, day].sort((a, b) => a - b),
    })
  }

  function applyServicePreset(preset: BookingServicePreset) {
    setServiceForm((current) => ({ ...current, ...preset }))
    const existingService = services.find((service) => service.slug === preset.slug)
    if (existingService) {
      setServiceForm({
        ...preset,
        googleCalendarId: existingService.googleCalendarId ?? '',
        enableGoogleMeet: existingService.enableGoogleMeet,
      })
      setSelectedServiceId(existingService.id)
      setFieldDrafts(existingService.formFields?.length ? existingService.formFields : defaultFieldsForSlug(existingService.slug))
      void loadAll(existingService.id)
      setMessage(`${preset.label} を選択しました。入力フォーム編集も ${preset.label} に切り替えました`)
      return
    }
    setFieldDrafts(defaultFieldsForSlug(preset.slug))
    setMessage(`${preset.label} の作成内容を入力欄にセットしました。まだ未作成のため、サービス作成後に保存できます`)
  }

  const publicUrl = selectedService ? `${workerBase}/book/${selectedService.slug}` : ''

  return (
    <div>
      <Header title="予約管理" description="相談予約の公開URL、予約枠、申込状況を管理します" />

      {message && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{message}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <section className="bg-white border border-gray-200 rounded-lg p-5">
          <h2 className="text-base font-bold text-gray-900 mb-4">予約サービス</h2>
          <div className="space-y-3">
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3">
              <p className="text-xs font-bold text-emerald-800">すぐ作れるプリセット</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {servicePresets.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => applyServicePreset(preset)}
                    className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs leading-5 text-emerald-700">AI講座も個別相談と同じ予約ルールで管理できます。</p>
            </div>
            <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={serviceForm.name} onChange={(e) => setServiceForm({ ...serviceForm, name: e.target.value })} placeholder="サービス名" />
            <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={serviceForm.slug} onChange={(e) => setServiceForm({ ...serviceForm, slug: e.target.value })} placeholder="URL slug" />
            <textarea className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" rows={4} value={serviceForm.description} onChange={(e) => setServiceForm({ ...serviceForm, description: e.target.value })} />
            <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={serviceForm.googleCalendarId} onChange={(e) => setServiceForm({ ...serviceForm, googleCalendarId: e.target.value })} placeholder="Google Calendar ID（未入力なら共通設定を使用）" />
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={serviceForm.approvalRequired} onChange={(e) => setServiceForm({ ...serviceForm, approvalRequired: e.target.checked })} />
              管理者承認を必要にする
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={serviceForm.enableGoogleMeet} onChange={(e) => setServiceForm({ ...serviceForm, enableGoogleMeet: e.target.checked })} />
              予約確定時にGoogle Meetを自動発行する
            </label>
            <button onClick={createService} className="w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700">サービス作成</button>
            {selectedService && (
              <button
                type="button"
                onClick={saveSelectedServiceSettings}
                disabled={savingService}
                className="w-full rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-60"
              >
                {savingService ? '保存中...' : '選択中サービスのGoogle設定を保存'}
              </button>
            )}
          </div>

          <div className="mt-6">
            <label className="text-xs font-semibold text-gray-500">選択中のサービス</label>
            <select className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={selectedService?.id ?? ''} onChange={(e) => setSelectedServiceId(e.target.value)}>
              {services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
            </select>
          </div>

          {publicUrl && (
            <div className="mt-4 rounded-lg bg-gray-50 p-3">
              <p className="text-xs font-semibold text-gray-500">公開予約URL</p>
              <a className="mt-1 block break-all text-sm text-green-700 underline" href={publicUrl} target="_blank">{publicUrl}</a>
            </div>
          )}
        </section>

        <section className="bg-white border border-gray-200 rounded-lg p-5 xl:col-span-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-base font-bold text-gray-900">入力フォーム編集</h2>
              <p className="mt-1 text-sm text-gray-500">
                選択中のサービスごとに、ユーザーが予約時に入力する項目を変更できます。
              </p>
            </div>
            {selectedService && (
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">{selectedService.name}</span>
            )}
          </div>

          <div className="mt-4 space-y-3">
            {fieldDrafts.map((field, index) => (
              <div key={`${field.key}-${index}`} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="grid gap-3 lg:grid-cols-12">
                  <label className="text-xs font-bold text-gray-600 lg:col-span-3">
                    管理キー
                    <input
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      value={field.key}
                      onChange={(e) => updateField(index, { key: e.target.value })}
                      placeholder="例: name"
                    />
                  </label>
                  <label className="text-xs font-bold text-gray-600 lg:col-span-4">
                    表示名
                    <input
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      value={field.label}
                      onChange={(e) => updateField(index, { label: e.target.value })}
                      placeholder="例: お名前"
                    />
                  </label>
                  <label className="text-xs font-bold text-gray-600 lg:col-span-3">
                    入力タイプ
                    <select
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      value={field.type}
                      onChange={(e) => updateField(index, { type: e.target.value as BookingFormField['type'] })}
                    >
                      <option value="text">テキスト</option>
                      <option value="email">メール</option>
                      <option value="phone">電話番号</option>
                      <option value="select">選択式</option>
                    </select>
                  </label>
                  <div className="flex items-end gap-3 lg:col-span-2">
                    <label className="mb-2 flex items-center gap-2 text-sm font-bold text-gray-700">
                      <input
                        type="checkbox"
                        checked={Boolean(field.required)}
                        onChange={(e) => updateField(index, { required: e.target.checked })}
                      />
                      必須
                    </label>
                    <button
                      type="button"
                      onClick={() => removeField(index)}
                      className="mb-1 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50"
                    >
                      削除
                    </button>
                  </div>
                </div>
                {field.type === 'select' && (
                  <label className="mt-3 block text-xs font-bold text-gray-600">
                    選択肢
                    <textarea
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      rows={4}
                      value={(field.options ?? []).join('\n')}
                      onChange={(e) => updateField(index, { options: parseOptionText(e.target.value) })}
                      placeholder={'例:\n初心者\n少し使っている\n本格導入したい'}
                    />
                    <span className="mt-1 block text-[11px] font-medium text-gray-500">1行につき1つの選択肢を入力してください。</span>
                  </label>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={addField} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-800 hover:bg-gray-50">
              項目を追加
            </button>
            <button
              type="button"
              onClick={saveFormFields}
              disabled={!selectedService || savingFields}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:bg-gray-300"
            >
              {savingFields ? '保存中...' : 'この入力フォームを保存'}
            </button>
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-lg p-5 xl:col-span-2">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-base font-bold text-gray-900">予約枠</h2>
              <p className="mt-1 text-sm text-gray-500">曜日と時間帯を選んで、予約できる枠をまとめて解放します。</p>
            </div>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">Google Calendar連携準備中</span>
          </div>

          <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="grid gap-3 lg:grid-cols-2">
              <label className="text-sm font-medium text-gray-700">開始日<input type="date" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={bulkForm.dateFrom} onChange={(e) => setBulkForm({ ...bulkForm, dateFrom: e.target.value })} /></label>
              <label className="text-sm font-medium text-gray-700">終了日<input type="date" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={bulkForm.dateTo} onChange={(e) => setBulkForm({ ...bulkForm, dateTo: e.target.value })} /></label>
              <label className="text-sm font-medium text-gray-700">開始時間<input type="time" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={bulkForm.startTime} onChange={(e) => setBulkForm({ ...bulkForm, startTime: e.target.value })} /></label>
              <label className="text-sm font-medium text-gray-700">終了時間<input type="time" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={bulkForm.endTime} onChange={(e) => setBulkForm({ ...bulkForm, endTime: e.target.value })} /></label>
              <label className="text-sm font-medium text-gray-700">枠の長さ
                <select className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={bulkForm.intervalMinutes} onChange={(e) => setBulkForm({ ...bulkForm, intervalMinutes: Number(e.target.value) })}>
                  <option value={15}>15分</option>
                  <option value={30}>30分</option>
                  <option value={45}>45分</option>
                  <option value={60}>60分</option>
                  <option value={90}>90分</option>
                  <option value={120}>120分</option>
                </select>
              </label>
              <label className="text-sm font-medium text-gray-700">定員<input type="number" min={1} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={bulkForm.capacity} onChange={(e) => setBulkForm({ ...bulkForm, capacity: Number(e.target.value) })} /></label>
            </div>

            <div className="mt-4">
              <p className="text-sm font-medium text-gray-700">曜日</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => setDayPreset([1, 2, 3, 4, 5])} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-100">平日</button>
                <button type="button" onClick={() => setDayPreset([0, 6])} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-100">土日</button>
                <button type="button" onClick={() => setDayPreset([0, 1, 2, 3, 4, 5, 6])} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-100">毎日</button>
              </div>
              <div className="mt-3 grid grid-cols-7 gap-2">
                {dayOptions.map((day) => {
                  const active = bulkForm.daysOfWeek.includes(day.value)
                  return (
                    <button
                      key={day.value}
                      type="button"
                      onClick={() => toggleDay(day.value)}
                      className={`h-10 rounded-lg border text-sm font-bold transition-colors ${active ? 'border-green-600 bg-green-600 text-white' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-100'}`}
                    >
                      {day.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <button onClick={generateSlots} className="mt-4 w-full rounded-lg bg-green-600 px-4 py-3 text-sm font-bold text-white hover:bg-green-700">選択した条件で予約枠を一括生成</button>
          </div>

          <div className="mt-6 border-t border-gray-100 pt-5">
            <h3 className="text-sm font-bold text-gray-900 mb-3">1枠だけ追加</h3>
          <div className="grid gap-3">
            <label className="text-sm font-medium text-gray-700">開始<input type="datetime-local" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={slotForm.startsAt} onChange={(e) => setSlotForm({ ...slotForm, startsAt: e.target.value })} /></label>
            <label className="text-sm font-medium text-gray-700">終了<input type="datetime-local" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={slotForm.endsAt} onChange={(e) => setSlotForm({ ...slotForm, endsAt: e.target.value })} /></label>
            <label className="text-sm font-medium text-gray-700">定員<input type="number" min={1} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={slotForm.capacity} onChange={(e) => setSlotForm({ ...slotForm, capacity: Number(e.target.value) })} /></label>
            <button onClick={createSlot} disabled={!selectedService} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-bold text-white disabled:bg-gray-300">予約枠を追加</button>
          </div>
          </div>

          <div className="mt-5 space-y-2">
            {loading ? <p className="text-sm text-gray-400">読み込み中...</p> : slots.length === 0 ? <p className="text-sm text-gray-400">予約枠がありません</p> : (
              <>
                <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-sm">
                  <span className="font-bold text-emerald-900">表示中の予約枠</span>
                  <span className="font-black text-emerald-700">{slots.length}件</span>
                </div>
                {slots.slice(0, 12).map((slot) => (
                  <div key={slot.id} className="rounded-lg border border-gray-200 px-3 py-2">
                    <p className="text-sm font-semibold text-gray-900">{fmt(slot.startsAt)} - {fmt(slot.endsAt)}</p>
                    <p className="text-xs text-gray-500">予約 {slot.bookedCount} / {slot.capacity}</p>
                  </div>
                ))}
                {slots.length > 12 && <p className="text-xs text-gray-500">ほか {slots.length - 12}件の予約枠があります。</p>}
              </>
            )}
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-lg p-5">
          <h2 className="text-base font-bold text-gray-900 mb-4">予約申込</h2>
          <div className="space-y-3">
            {bookings.length === 0 ? <p className="text-sm text-gray-400">申込はまだありません</p> : bookings.slice(0, 10).map((booking) => (
              <div key={booking.id} className="rounded-lg border border-gray-200 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-gray-900">{String(booking.customerInfo.name || '名前未入力')}</p>
                  <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600">{booking.status}</span>
                </div>
                <p className="mt-1 text-xs text-gray-500">{fmt(booking.slotStartsAt)} / {booking.lineUserId}</p>
                <p className="mt-2 text-sm text-gray-700">{String(booking.customerInfo.topic || '')}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
