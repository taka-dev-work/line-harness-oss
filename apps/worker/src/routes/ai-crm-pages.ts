import { Hono } from 'hono';
import { getFormById, getForms } from '@line-crm/db';
import type { Env } from '../index.js';

const aiCrmPages = new Hono<Env>();
const GUIDE_ASSETS_ACCOUNT_ID = 'global';
const GUIDE_ASSETS_KEY = 'ai_crm_guide_assets';
const FILE_BUCKET = 'line-harness-images';

type GuideAsset = {
  id: string;
  title: string;
  filename: string;
  url: string;
  key: string;
  mimeType: string;
  size: number;
  createdAt: string;
};

const staticGuidePdfs = [
  {
    id: 'static-guide-ai',
    title: 'AI実務活用スタートガイド',
    filename: 'ai-practical-start-guide.pdf',
    key: 'guide-pdfs/ai-practical-start-guide.pdf',
    size: 17740763,
  },
  {
    id: 'static-guide-chatgpt',
    title: 'ChatGPT実務活用スタートガイド',
    filename: 'chatgpt-practical-start-guide.pdf',
    key: 'guide-pdfs/chatgpt-practical-start-guide.pdf',
    size: 14343340,
  },
  {
    id: 'static-guide-claude',
    title: 'Claude実務活用スタートガイド',
    filename: 'claude-practical-start-guide.pdf',
    key: 'guide-pdfs/claude-practical-start-guide.pdf',
    size: 15420353,
  },
  {
    id: 'static-guide-gemini',
    title: 'Gemini実務活用スタートガイド',
    filename: 'gemini-practical-start-guide.pdf',
    key: 'guide-pdfs/gemini-practical-start-guide.pdf',
    size: 14453262,
  },
];

const pages: Record<string, { title: string; lead: string; items: string[]; cta: string; ctaPath: string }> = {
  guide: {
    title: 'AI活用ガイド',
    lead: 'AIを仕事で使える形にするための無料ガイド一覧です。',
    items: ['ChatGPT実務活用スタートガイド', 'AI業務分解チェックリスト', 'AIエージェント導入前チェックリスト', '30日AI活用ロードマップ'],
    cta: '相談フォームへ進む',
    ctaPath: '/ai-crm/consult',
  },
  'work-breakdown': {
    title: 'AI業務分解チェックリスト',
    lead: 'AI化しやすい業務、人が担当すべき業務、自動化候補を整理するためのチェックリストです。',
    items: ['毎日くり返す作業を洗い出す', '文章作成・要約・調査・分類の作業を見つける', '相談前に業務の流れを整理する'],
    cta: '相談フォームへ進む',
    ctaPath: '/ai-crm/consult',
  },
  prompts: {
    title: 'プロンプトテンプレート',
    lead: 'メール、資料、SNS、議事録、リサーチで使えるAI活用テンプレートです。',
    items: ['メール返信の下書き', 'SNS投稿の構成作成', '議事録の要約とタスク整理', '提案資料の構成作成'],
    cta: '相談フォームへ進む',
    ctaPath: '/ai-crm/consult',
  },
  agent: {
    title: 'AIエージェント導入前チェックリスト',
    lead: 'AIエージェント導入前に、任せる業務・必要データ・運用体制を整理します。',
    items: ['任せたい業務を決める', '必要なデータやツールを確認する', '導入しやすい業務から始める'],
    cta: '導入相談へ進む',
    ctaPath: '/ai-crm/consult',
  },
  automation: {
    title: '自動化できる業務例',
    lead: 'AIエージェント化しやすい業務の例をまとめています。',
    items: ['問い合わせ対応', 'リサーチ', '営業リスト作成', '提案資料作成', '議事録整理', '社内ナレッジ検索'],
    cta: '導入相談へ進む',
    ctaPath: '/ai-crm/consult',
  },
  cases: {
    title: '導入事例',
    lead: 'AI活用・業務改善・AIエージェント導入の事例を掲載していきます。',
    items: ['業務改善 Before / After', 'EC x AI活用', '営業自動化', '資料作成・リサーチ効率化'],
    cta: '相談フォームへ進む',
    ctaPath: '/ai-crm/consult',
  },
  workshop: {
    title: '勉強会・ワークショップ',
    lead: '実務で使えるAI活用をテーマに、初心者でも参加しやすい勉強会を案内します。',
    items: ['ChatGPT / Claude / Gemini活用', 'AIエージェント実演', '業務別AIワークフロー作成'],
    cta: 'AI勉強会を予約する',
    ctaPath: '/book/ai-workshop',
  },
  bootcamp: {
    title: 'AI講座 / BOOTCAMP',
    lead: 'AIを触って終わりにせず、自分の仕事で使えるワークフローに落とし込む講座です。',
    items: ['AI基礎と業務整理', 'プロンプトとテンプレート作成', '業務別AI活用', '自分専用AIワークフロー化'],
    cta: 'AI講座を予約する',
    ctaPath: '/book/ai-course',
  },
  pricing: {
    title: '料金・サービス一覧',
    lead: '相談内容に応じて、講座・研修・顧問・導入支援をご案内します。',
    items: ['AIブートキャンプ', '個別AI講座', '法人向けAI研修', 'AIエージェント導入支援', 'AI顧問'],
    cta: 'まず相談する',
    ctaPath: '/ai-crm/consult',
  },
  booking: {
    title: '個別相談',
    lead: '現在の業務を整理し、AI活用・業務改善・導入相談の進め方を一緒に決めます。',
    items: ['30分無料相談', 'AI活用診断', 'AIエージェント導入相談', '法人研修相談'],
    cta: '相談フォームへ進む',
    ctaPath: '/ai-crm/consult',
  },
  consult: {
    title: 'AI相談ヒアリングフォーム',
    lead: '相談前に、現在の状況と実現したいことを簡単に教えてください。',
    items: ['お名前', '個人 / 法人', '相談内容', '現在の課題', '希望する相談方法'],
    cta: 'フォームを開く',
    ctaPath: '/ai-crm/form?name=AI相談ヒアリングフォーム',
  },
};

async function getGuideAssets(db: D1Database): Promise<GuideAsset[]> {
  const row = await db.prepare(
    'SELECT value FROM account_settings WHERE line_account_id = ? AND key = ?',
  ).bind(GUIDE_ASSETS_ACCOUNT_ID, GUIDE_ASSETS_KEY).first<{ value: string }>();
  if (!row?.value) return [];
  try {
    return JSON.parse(row.value) as GuideAsset[];
  } catch {
    return [];
  }
}

async function saveGuideAssets(db: D1Database, assets: GuideAsset[]): Promise<void> {
  const id = crypto.randomUUID();
  const now = new Date(Date.now() + 9 * 60 * 60_000).toISOString().replace('Z', '+09:00');
  await db.prepare(
    `INSERT INTO account_settings (id, line_account_id, key, value, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (line_account_id, key) DO UPDATE SET value = ?, updated_at = ?`,
  ).bind(
    id,
    GUIDE_ASSETS_ACCOUNT_ID,
    GUIDE_ASSETS_KEY,
    JSON.stringify(assets),
    now,
    now,
    JSON.stringify(assets),
    now,
  ).run();
}

function storageUrl(supabaseUrl: string, key: string): string {
  return `${supabaseUrl}/storage/v1/object/${FILE_BUCKET}/${key}`;
}

function publicFileUrl(supabaseUrl: string, key: string): string {
  return `${supabaseUrl}/storage/v1/object/public/${FILE_BUCKET}/${key}`;
}

function renderPage(origin: string, slug: string, guideAssets: GuideAsset[] = []): string {
  const page = pages[slug] ?? pages.guide;
  const ctaUrl = new URL(page.ctaPath, origin).toString();
  const items = page.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const staticAssets: GuideAsset[] = slug === 'guide'
    ? staticGuidePdfs.map((asset) => ({
        ...asset,
        url: new URL(`/${asset.key}`, origin).toString(),
        mimeType: 'application/pdf',
        createdAt: '',
      }))
    : [];
  const allGuideAssets = [
    ...staticAssets,
    ...guideAssets.filter((asset) => !staticAssets.some((staticAsset) => staticAsset.filename === asset.filename)),
  ];
  const guidePdfSection = slug === 'guide' && allGuideAssets.length > 0
    ? `<section class="pdfs"><h2>掲載PDF</h2>${allGuideAssets.map((asset) => `
        <article class="pdf">
          <div>
            <strong>${escapeHtml(asset.title || asset.filename)}</strong>
            <span>${Math.max(1, Math.round(asset.size / 1024))}KB</span>
          </div>
          <a href="${asset.url}" target="_blank" rel="noopener">PDFをダウンロード</a>
        </article>
      `).join('')}</section>`
    : '';

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(page.title)}</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #f8fafc; background: #07152f; }
    main { max-width: 760px; margin: 0 auto; padding: 48px 20px; }
    h1 { font-size: 32px; line-height: 1.35; margin: 0 0 16px; }
    h2 { font-size: 20px; margin: 32px 0 14px; }
    p { color: #cbd5e1; line-height: 1.8; font-size: 16px; }
    ul { background: rgba(15, 23, 42, 0.72); border: 1px solid rgba(148, 163, 184, 0.28); border-radius: 12px; padding: 20px 20px 20px 40px; line-height: 1.9; }
    a { display: inline-flex; margin-top: 20px; padding: 14px 18px; border-radius: 10px; color: #07152f; background: #93c5fd; font-weight: 700; text-decoration: none; }
    .pdfs { margin-top: 28px; }
    .pdf { display: flex; align-items: center; justify-content: space-between; gap: 16px; background: rgba(15, 23, 42, 0.72); border: 1px solid rgba(148, 163, 184, 0.28); border-radius: 12px; padding: 16px; margin-top: 10px; }
    .pdf strong, .pdf span { display: block; }
    .pdf span { margin-top: 4px; color: #94a3b8; font-size: 13px; }
    .pdf a { margin: 0; white-space: nowrap; }
    @media (max-width: 560px) { main { padding: 32px 16px; } h1 { font-size: 26px; } .pdf { align-items: stretch; flex-direction: column; } .pdf a { justify-content: center; } }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(page.title)}</h1>
    <p>${escapeHtml(page.lead)}</p>
    <ul>${items}</ul>
    ${guidePdfSection}
    <a href="${ctaUrl}">${escapeHtml(page.cta)}</a>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

type FormField = {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
};

function renderFormPage(origin: string, form: { id: string; name: string; description: string | null; fields: string | null }): string {
  const fields = JSON.parse(form.fields || '[]') as FormField[];
  const controls = fields.map((field) => {
    const required = field.required ? ' required' : '';
    const label = escapeHtml(field.label);
    const name = escapeHtml(field.name);
    if (field.type === 'textarea') {
      return `<label>${label}<textarea name="${name}" rows="5"${required}></textarea></label>`;
    }
    if (field.type === 'select') {
      const options = (field.options ?? []).map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('');
      return `<label>${label}<select name="${name}"${required}><option value="">選択してください</option>${options}</select></label>`;
    }
    return `<label>${label}<input name="${name}" type="text"${required}></label>`;
  }).join('');
  const submitUrl = new URL(`/api/forms/${form.id}/submit`, origin).toString();

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(form.name)}</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #f8fafc; background: #07152f; }
    main { max-width: 720px; margin: 0 auto; padding: 40px 20px; }
    h1 { font-size: 30px; line-height: 1.35; margin: 0 0 12px; }
    p { color: #cbd5e1; line-height: 1.8; }
    form { display: grid; gap: 18px; margin-top: 24px; }
    label { display: grid; gap: 8px; color: #e2e8f0; font-weight: 700; }
    input, select, textarea { width: 100%; border: 1px solid rgba(148, 163, 184, 0.45); border-radius: 10px; padding: 13px 14px; color: #0f172a; font: inherit; background: #fff; }
    button { justify-self: start; border: 0; border-radius: 10px; padding: 14px 18px; color: #07152f; background: #93c5fd; font-weight: 800; font: inherit; cursor: pointer; }
    .status { min-height: 24px; color: #bfdbfe; font-weight: 700; }
    .success-popup { position: fixed; left: 0; right: 0; bottom: 0; width: 100%; box-sizing: border-box; padding: 18px 20px calc(18px + env(safe-area-inset-bottom)); background: #dcfce7; color: #14532d; border-top: 1px solid rgba(22, 101, 52, 0.22); box-shadow: 0 -16px 40px rgba(0, 0, 0, 0.28); transform: translateY(110%); opacity: 0; transition: transform 180ms ease, opacity 180ms ease; z-index: 50; }
    .success-popup.show { transform: translateY(0); opacity: 1; }
    .success-popup strong { display: block; font-size: 18px; line-height: 1.4; margin-bottom: 4px; }
    .success-popup span { display: block; font-size: 14px; line-height: 1.6; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(form.name)}</h1>
    <p>${escapeHtml(form.description || '相談内容を入力してください。')}</p>
    <form id="crm-form">
      ${controls}
      <button type="submit">送信する</button>
      <div class="status" id="status"></div>
    </form>
  </main>
  <div class="success-popup" id="success-popup" role="status" aria-live="polite">
    <strong>送信完了しました</strong>
    <span>内容を確認して、LINEでご案内します。</span>
  </div>
  <script>
    const form = document.getElementById('crm-form');
    const status = document.getElementById('status');
    const successPopup = document.getElementById('success-popup');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      status.textContent = '送信中です...';
      successPopup.classList.remove('show');
      const data = Object.fromEntries(new FormData(form).entries());
      const response = await fetch(${JSON.stringify(submitUrl)}, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success === false) {
        status.textContent = result.error || '送信に失敗しました。時間をおいて再度お試しください。';
        return;
      }
      form.reset();
      status.textContent = '';
      successPopup.classList.add('show');
    });
  </script>
</body>
</html>`;
}

aiCrmPages.get('/ai-crm/form', async (c) => {
  const formId = c.req.query('id');
  const formName = c.req.query('name');
  if (!formId && !formName) return c.text('Missing form id or name', 400);
  const form = formId
    ? await getFormById(c.env.DB, formId)
    : (await getForms(c.env.DB)).find((item) => item.name === formName) ?? null;
  if (!form) return c.text('Form not found', 404);
  const url = new URL(c.req.url);
  const forwardedProto = c.req.header('x-forwarded-proto');
  const origin = `${forwardedProto || url.protocol.replace(':', '')}://${url.host}`;
  return c.html(renderFormPage(origin, form));
});

aiCrmPages.get('/api/ai-crm/guide-assets', async (c) => {
  const assets = await getGuideAssets(c.env.DB);
  return c.json({ success: true, data: assets });
});

aiCrmPages.post('/api/ai-crm/guide-assets', async (c) => {
  try {
    const body = await c.req.json<{ title?: string; filename?: string; mimeType?: string; data?: string }>();
    if (!body.data) return c.json({ success: false, error: 'PDF data is required' }, 400);
    const mimeType = body.mimeType || 'application/pdf';
    if (mimeType !== 'application/pdf') return c.json({ success: false, error: 'PDFのみアップロードできます' }, 400);

    let base64 = body.data;
    if (base64.startsWith('data:')) {
      const match = base64.match(/^data:application\/pdf;base64,(.+)$/);
      if (!match) return c.json({ success: false, error: 'PDFの形式が正しくありません' }, 400);
      base64 = match[1];
    }
    const binary = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
    if (binary.byteLength > 30 * 1024 * 1024) {
      return c.json({ success: false, error: 'PDFは30MB以下にしてください' }, 400);
    }

    const id = crypto.randomUUID();
    const safeFilename = (body.filename || 'guide.pdf').replace(/[^\w.\-一-龠ぁ-んァ-ヶー]/g, '_');
    const key = `${id}-${safeFilename.endsWith('.pdf') ? safeFilename : `${safeFilename}.pdf`}`;
    const res = await fetch(storageUrl(c.env.SUPABASE_URL, key), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/pdf',
        'x-upsert': 'false',
      },
      body: binary.buffer,
    });
    if (!res.ok) {
      console.error('Guide PDF upload error:', await res.text());
      return c.json({ success: false, error: 'PDFアップロードに失敗しました' }, 500);
    }

    const assets = await getGuideAssets(c.env.DB);
    const asset: GuideAsset = {
      id,
      title: body.title?.trim() || safeFilename.replace(/\.pdf$/i, ''),
      filename: safeFilename,
      url: publicFileUrl(c.env.SUPABASE_URL, key),
      key,
      mimeType: 'application/pdf',
      size: binary.byteLength,
      createdAt: new Date(Date.now() + 9 * 60 * 60_000).toISOString().replace('Z', '+09:00'),
    };
    await saveGuideAssets(c.env.DB, [asset, ...assets]);
    return c.json({ success: true, data: asset }, 201);
  } catch (err) {
    console.error('POST /api/ai-crm/guide-assets error:', err);
    return c.json({ success: false, error: 'PDFアップロードに失敗しました' }, 500);
  }
});

aiCrmPages.delete('/api/ai-crm/guide-assets/:id', async (c) => {
  const id = c.req.param('id');
  const assets = await getGuideAssets(c.env.DB);
  const next = assets.filter((asset) => asset.id !== id);
  await saveGuideAssets(c.env.DB, next);
  return c.json({ success: true, data: null });
});

aiCrmPages.get('/ai-crm/:slug', async (c) => {
  const url = new URL(c.req.url);
  const forwardedProto = c.req.header('x-forwarded-proto');
  const origin = `${forwardedProto || url.protocol.replace(':', '')}://${url.host}`;
  const slug = c.req.param('slug');
  const guideAssets = slug === 'guide' ? await getGuideAssets(c.env.DB) : [];
  return c.html(renderPage(origin, slug, guideAssets));
});

export { aiCrmPages };
