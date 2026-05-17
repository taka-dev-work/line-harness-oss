import { Hono } from 'hono';
import { LineClient } from '@line-crm/line-sdk';
import {
  applyAiDiagnosisConfig,
  DEFAULT_AI_DIAGNOSIS_CONFIG,
  getDiagnosisSettings,
  saveDiagnosisResult,
} from '@line-crm/db';
import type { AiDiagnosisConfigInput, DiagnosisConfig, DiagnosisQuestion } from '@line-crm/db';
import type { Env } from '../index.js';

export const diagnosis = new Hono<Env>();

function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function workerBase(c: { env: Env['Bindings']; req: { url: string } }): string {
  return (c.env.WORKER_URL || new URL(c.req.url).origin).replace(/\/$/, '');
}

function getLiffId(liffUrl?: string): string {
  return liffUrl?.match(/liff\.line\.me\/([^/?#]+)/)?.[1] ?? '';
}

function serializeQuestion(row: DiagnosisQuestion) {
  return {
    id: row.id,
    questionId: row.question_id,
    sortOrder: row.sort_order,
    text: row.text,
    mapsToType: row.maps_to_type,
    options: safeJson(row.options, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeConfig(row: DiagnosisConfig) {
  return {
    id: row.id,
    typeKey: row.type_key,
    label: row.label,
    description: row.description,
    tagName: row.tag_name,
    lineMessage: row.line_message,
    mangaLpUrl: row.manga_lp_url,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function resultCtaLabel(typeKey: string): string {
  const labels: Record<string, string> = {
    time_efficiency: 'AI実務活用ガイドを見る',
    performance: 'AI活用事例を見る',
    creator: 'ChatGPTガイドを見る',
    business_growth: '導入相談を予約する',
    team_adoption: '法人導入相談を予約する',
    career_learning: 'AI勉強会を予約する',
    workflow_builder: '個別相談を予約する',
  };
  return labels[typeKey] ?? 'おすすめコンテンツを見る';
}

function resultUrl(base: string, result: DiagnosisConfig, lineUserId?: string): string {
  const raw = result.manga_lp_url || '/ai-crm/guide';
  const url = raw.startsWith('http') ? new URL(raw) : new URL(raw, base);
  if (lineUserId && url.pathname.startsWith('/book/')) url.searchParams.set('lineUserId', lineUserId);
  return url.toString();
}

function diagnosisLineMessage(
  result: DiagnosisConfig,
  displayName: string,
  labels: string[],
  ctaLabel: string,
  ctaUrl: string,
): string {
  return [
    result.line_message.replaceAll('\\n', '\n').replaceAll('{name}', displayName),
    followupMessage(labels),
    `次におすすめ:\n${ctaLabel}\n${ctaUrl}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function selectedLabels(answers: Array<{ selectedLabel?: string; selectedLabels?: string[] }>): string[] {
  return answers.flatMap((answer) => answer.selectedLabels ?? (answer.selectedLabel ? [answer.selectedLabel] : []));
}

function followupMessage(labels: string[]): string {
  const highIntent = [
    '自分の業務に合わせて個別に相談したい',
    '業務に本格的に取り入れたい',
    '社内・チームで導入したい',
    '経営者・事業責任者として導入を考えている',
    'チーム・社内でAI活用を進めたい',
    '社内・チームの生産性を上げたい',
    '業務自動化・AIエージェント',
    '法人・チーム導入について相談したい',
  ];
  const lowIntent = [
    'まだほとんど使っていない',
    'ChatGPTなどを少し触ったことがある',
    'まだ明確ではないが、AI時代に備えたい',
    'まずは無料ガイドで学びたい',
  ];
  if (highIntent.some((label) => labels.includes(label))) {
    return '\n\n現在、具体的にAI活用や導入を検討されている場合は、個別相談で一度整理するのがおすすめです。\n\n相談では、売り込みではなく、まず「どの業務にAIを使えるか」を一緒に整理します。';
  }
  if (lowIntent.some((label) => labels.includes(label))) {
    return '\n\nAIを仕事で使い始めるなら、まずは小さな作業から試すのがおすすめです。\n\nたとえば、メール返信・文章の下書き・要約・資料構成・アイデア出しから始めると取り入れやすいです。';
  }
  return '';
}

async function ensureDiagnosisConfigured(db: D1Database) {
  let settings = await getDiagnosisSettings(db);
  if (!settings.form || settings.questions.length === 0 || settings.configs.length === 0) {
    await applyAiDiagnosisConfig(db, DEFAULT_AI_DIAGNOSIS_CONFIG);
    settings = await getDiagnosisSettings(db);
  }
  return settings;
}

function serializeSettings(settings: Awaited<ReturnType<typeof getDiagnosisSettings>>) {
  return {
    form: settings.form
      ? {
          id: settings.form.id,
          formName: settings.form.form_name,
          formTitle: settings.form.form_title,
          createdAt: settings.form.created_at,
          updatedAt: settings.form.updated_at,
        }
      : null,
    questions: settings.questions.map(serializeQuestion),
    configs: settings.configs.map(serializeConfig),
  };
}

function buildGeminiPrompt(description: string): string {
  return `あなたはマーケティングオートメーションの専門家です。
以下の診断の説明に基づいて、LINEインタラクティブ診断の完全なJSON設定を生成してください。

診断の説明:
"${description}"

以下のJSON形式のみで出力してください。説明やコードフェンスは不要です。
{
  "formName": "診断名",
  "formTitle": "ページ表示タイトル",
  "questions": [
    {
      "text": "質問文",
      "maps_to_type": "type_key",
      "options": [
        { "label": "よくある", "value": 3 },
        { "label": "たまにある", "value": 1 },
        { "label": "ない", "value": 0 }
      ]
    }
  ],
  "configs": [
    {
      "type_key": "snake_case_key",
      "label": "表示名",
      "description": "タイプの特徴説明",
      "tag_name": "診断_タグ名",
      "line_message": "{name}さんへの診断結果メッセージ。500文字以内。",
      "manga_lp_url": "",
      "color": "#06C755"
    }
  ]
}

ルール:
- questions は4〜8問
- 各questionのoptionsは3〜4つ、valueは0〜3の整数
- configs は3〜5タイプ
- type_key は configs 内でユニークな snake_case
- maps_to_type は configs のいずれかの type_key と一致
- JSON形式のみ。コードフェンスは絶対に含めないこと`;
}

async function generateWithGemini(apiKey: string, description: string): Promise<AiDiagnosisConfigInput> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildGeminiPrompt(description) }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
  const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error('Geminiから設定JSONを取得できませんでした');
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  return JSON.parse(cleaned) as AiDiagnosisConfigInput;
}

diagnosis.get('/api/diagnosis/config', async (c) => {
  const settings = await ensureDiagnosisConfigured(c.env.DB);
  return c.json({ success: true, data: serializeSettings(settings) });
});

diagnosis.post('/api/diagnosis/config', async (c) => {
  try {
    const body = await c.req.json<AiDiagnosisConfigInput>();
    await applyAiDiagnosisConfig(c.env.DB, body);
    const settings = await getDiagnosisSettings(c.env.DB);
    return c.json({ success: true, data: serializeSettings(settings) });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : '診断設定の保存に失敗しました' }, 400);
  }
});

diagnosis.post('/api/diagnosis/config/default', async (c) => {
  await applyAiDiagnosisConfig(c.env.DB, DEFAULT_AI_DIAGNOSIS_CONFIG);
  const settings = await getDiagnosisSettings(c.env.DB);
  return c.json({ success: true, data: serializeSettings(settings) });
});

diagnosis.post('/api/ai/diagnosis-setup', async (c) => {
  try {
    const body = await c.req.json<{ description?: string }>();
    if (!body.description) return c.json({ success: false, error: '診断の説明文が必要です' }, 400);
    if (!c.env.GEMINI_API_KEY) {
      return c.json({
        success: true,
        data: DEFAULT_AI_DIAGNOSIS_CONFIG,
        warning: 'GEMINI_API_KEY が未設定のため、AI活用診断の初期テンプレートを返しました。',
      });
    }
    const config = await generateWithGemini(c.env.GEMINI_API_KEY, body.description);
    return c.json({ success: true, data: config });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'AI診断設定の生成に失敗しました' }, 400);
  }
});

diagnosis.post('/api/diagnosis/submit', async (c) => {
  try {
    const body = await c.req.json<{ lineUserId?: string; answers: Array<{ questionId: string; selectedLabel?: string; selectedLabels?: string[] }> }>();
    const saved = await saveDiagnosisResult(c.env.DB, {
      lineUserId: body.lineUserId || null,
      answers: body.answers ?? [],
    });
    const displayName = saved.friendName || 'あなた';
    const labels = selectedLabels(body.answers ?? []);
    const ctaUrl = resultUrl(workerBase(c), saved.result, body.lineUserId || undefined);
    const ctaLabel = resultCtaLabel(saved.result.type_key);
    const message = diagnosisLineMessage(saved.result, displayName, labels, ctaLabel, ctaUrl);
    if (body.lineUserId && c.env.LINE_CHANNEL_ACCESS_TOKEN) {
      const client = new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
      await client.pushMessage(body.lineUserId, [{ type: 'text', text: message }]);
    }
    return c.json({
      success: true,
      data: {
        result: serializeConfig(saved.result),
        scores: saved.scores,
        lineMessage: message,
        ctaLabel,
        ctaUrl,
      },
    });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : '診断の送信に失敗しました' }, 400);
  }
});

diagnosis.get('/diagnosis/form', async (c) => {
  const settings = await ensureDiagnosisConfigured(c.env.DB);
  const form = settings.form!;
  const questions = settings.questions.map(serializeQuestion);
  const configs = settings.configs.map(serializeConfig);
  const apiUrl = `${workerBase(c)}/api/diagnosis/submit`;
  const bookingUrl = `${workerBase(c)}/book/ai-consultation`;
  const liffId = getLiffId(c.env.LIFF_URL);
  return c.html(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${form.form_title}</title>
<style>
:root{--navy:#020b22;--navy2:#071a3d;--panel:#092452;--line:#4f76b8;--line2:#7cc7ff;--white:#f8fbff;--muted:#b8c9ee;--accent:#78c7ff;--glow:rgba(93,173,255,.38)}
*{box-sizing:border-box}html{min-height:100%;background:#020817}body{margin:0;min-height:100%;background:radial-gradient(circle at 50% -12%,#12346b 0,#071a3d 34%,#020817 78%);color:var(--white);font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Yu Gothic',system-ui,sans-serif;letter-spacing:.02em}.shell{position:relative;width:100%;max-width:560px;margin:0 auto;min-height:100vh;background:linear-gradient(180deg,rgba(5,18,45,.96),rgba(1,7,22,.98));overflow:hidden}.shell:before{content:"";position:absolute;inset:6px;border:1px solid rgba(129,177,255,.48);border-radius:18px;pointer-events:none;box-shadow:inset 0 0 24px rgba(84,140,222,.18)}.shell:after{content:"";position:absolute;inset:0;background:radial-gradient(circle at 50% 18%,rgba(69,141,255,.18),transparent 34%),linear-gradient(120deg,transparent 0 48%,rgba(255,255,255,.035) 50%,transparent 52%);pointer-events:none}.top,.panel,.report,.nav{position:relative;z-index:1}.top{padding:24px 20px 18px;border-bottom:1px solid rgba(125,174,255,.28);background:linear-gradient(180deg,rgba(7,25,61,.96),rgba(4,16,42,.78));box-shadow:0 14px 40px rgba(0,0,0,.22)}.step{letter-spacing:.18em;color:#cfe2ff;font-size:11px;font-weight:900;text-transform:uppercase;text-shadow:0 0 12px rgba(255,255,255,.3)}.progress-row{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin-top:10px}.count{font-size:18px;font-weight:950;letter-spacing:.08em;color:#fff;text-shadow:0 2px 0 rgba(0,0,0,.28)}.percent{font-size:31px;font-weight:950;color:#fff;text-shadow:0 0 18px rgba(112,194,255,.45)}.bar{height:7px;background:rgba(255,255,255,.12);border:1px solid rgba(123,179,255,.18);border-radius:999px;overflow:hidden;margin-top:15px}.bar span{display:block;height:100%;width:0;background:linear-gradient(90deg,#69b7ff,#e8f6ff);border-radius:999px;box-shadow:0 0 18px rgba(105,183,255,.8);transition:width .25s ease}.panel{padding:26px 20px 108px}.pill{display:inline-flex;align-items:center;border:1px solid rgba(137,199,255,.42);background:rgba(11,43,91,.72);color:#e8f6ff;border-radius:999px;padding:7px 13px;font-weight:900;font-size:11px;box-shadow:inset 0 0 12px rgba(124,199,255,.08)}.title{margin:17px 0 10px;font-size:24px;line-height:1.38;font-weight:950;color:#fff;text-shadow:0 2px 0 rgba(0,0,0,.35),0 0 20px rgba(124,199,255,.22)}.hint{font-size:13px;line-height:1.65;color:var(--muted);margin:0 0 18px}.hint strong{color:#fff}.options{display:grid;gap:12px}.option{position:relative;width:100%;min-height:62px;margin:0;border:1px solid rgba(126,174,255,.42);border-radius:14px;background:linear-gradient(180deg,rgba(12,37,83,.78),rgba(5,20,52,.92));color:#fff;text-align:left;padding:15px 16px 15px 48px;font-size:14px;line-height:1.45;font-weight:850;box-shadow:inset 0 0 0 1px rgba(255,255,255,.035),0 12px 30px rgba(0,0,0,.18);transition:transform .14s ease,border-color .14s ease,background .14s ease,box-shadow .14s ease}.option:before{content:"";position:absolute;left:17px;top:50%;width:16px;height:16px;border:2px solid rgba(255,255,255,.82);border-radius:50%;transform:translateY(-50%);box-shadow:0 0 10px rgba(124,199,255,.18)}.option.active{border-color:#8fd4ff;background:linear-gradient(180deg,rgba(20,71,142,.94),rgba(8,35,86,.96));box-shadow:0 0 0 1px rgba(143,212,255,.45),0 0 28px rgba(68,153,255,.28),inset 0 0 22px rgba(126,199,255,.08)}.option.active:before{background:#fff;border-color:#fff;box-shadow:0 0 18px rgba(143,212,255,.95)}.option:active{transform:scale(.99)}.line{display:none;margin:0 0 16px;color:#cfe2ff;font-weight:900;font-size:12px}.line input{width:100%;margin-top:7px;border:1px solid rgba(126,174,255,.42);border-radius:12px;padding:11px 12px;font-size:14px;background:rgba(255,255,255,.08);color:#fff}.line input::placeholder{color:#93a9d0}.nav{position:fixed;left:50%;bottom:0;transform:translateX(-50%);width:100%;max-width:560px;background:rgba(2,10,29,.88);border-top:1px solid rgba(126,174,255,.32);padding:12px 14px calc(12px + env(safe-area-inset-bottom));display:flex;gap:10px;backdrop-filter:blur(12px)}.back{width:58px;border:1px solid rgba(126,174,255,.42);border-radius:14px;background:rgba(10,31,70,.92);color:#fff;font-size:28px;font-weight:900}.next{flex:1;border:1px solid rgba(154,218,255,.78);border-radius:14px;background:linear-gradient(180deg,#2c84ff,#0e4ca6);color:#fff;font-size:16px;font-weight:950;box-shadow:0 0 22px rgba(74,158,255,.28),inset 0 1px 0 rgba(255,255,255,.22)}.back,.next{height:54px;cursor:pointer}.next:disabled{opacity:.55;cursor:not-allowed}.error{display:none;position:relative;z-index:2;margin:12px 18px 0;border:1px solid rgba(255,135,155,.45);border-radius:12px;padding:11px 12px;background:rgba(92,16,38,.88);color:#fff;font-weight:850;font-size:13px}.report{display:none;padding:14px 16px 40px}.hero{border:1px solid rgba(126,174,255,.45);border-radius:22px;padding:30px 18px 26px;text-align:center;background:linear-gradient(180deg,rgba(13,42,91,.92),rgba(5,19,51,.94));box-shadow:0 0 36px rgba(68,153,255,.14),inset 0 0 24px rgba(255,255,255,.035)}.eyebrow{display:inline-flex;border:1px solid rgba(153,215,255,.7);background:rgba(8,38,86,.82);color:#eaf6ff;border-radius:999px;padding:7px 16px;font-size:10px;font-weight:950;letter-spacing:.16em}.hero h1{font-size:24px;color:#fff;margin:15px 0 6px;text-shadow:0 0 20px rgba(124,199,255,.26)}.sub{color:var(--muted);font-weight:850;font-size:12px}.card{border:1px solid rgba(126,174,255,.42);border-radius:18px;padding:18px;margin:16px auto 0;background:linear-gradient(180deg,rgba(12,37,83,.72),rgba(4,16,42,.86));box-shadow:0 14px 34px rgba(0,0,0,.22),inset 0 0 0 1px rgba(255,255,255,.03);max-width:520px}.score-row{margin:12px 0}.score-top{display:flex;justify-content:space-between;gap:12px;color:#eaf6ff;font-weight:900;font-size:12px}.scorebar{height:8px;border-radius:999px;background:rgba(255,255,255,.12);overflow:hidden;margin-top:7px}.scorebar span{display:block;height:100%;width:0;background:linear-gradient(90deg,#6bbcff,#fff);border-radius:999px;box-shadow:0 0 16px rgba(107,188,255,.65)}.main-type{display:flex;gap:12px;align-items:center;border-top:1px solid rgba(126,174,255,.28);margin-top:18px;padding-top:18px}.trophy{width:46px;height:46px;border-radius:15px;border:1px solid rgba(153,215,255,.56);background:rgba(12,45,98,.86);display:grid;place-items:center;font-size:21px;color:#fff;box-shadow:0 0 18px rgba(124,199,255,.2)}.type-label{font-size:19px;color:#fff;font-weight:950;line-height:1.35;text-shadow:0 0 18px rgba(124,199,255,.22)}.radar{display:grid;place-items:center;padding:10px 0}.radar svg{width:230px;max-width:100%;height:auto}.advice{border:1px solid rgba(126,214,255,.46);background:rgba(2,16,42,.66);border-radius:14px;padding:13px;text-align:left;color:#e7f2ff;font-weight:750;font-size:13px;line-height:1.75}.advice strong{display:block;color:#fff;font-size:14px;margin-bottom:6px}.cta{display:block;text-align:center;text-decoration:none;border:1px solid rgba(154,218,255,.78);background:linear-gradient(180deg,#2c84ff,#0e4ca6);color:#fff;border-radius:14px;margin-top:16px;padding:15px;font-size:15px;font-weight:950;box-shadow:0 0 22px rgba(74,158,255,.28),inset 0 1px 0 rgba(255,255,255,.2)}@media(min-width:760px){.shell{max-width:640px}.top{padding:28px 30px 20px}.panel{padding:34px 30px 112px}.title{font-size:29px}.hint{font-size:15px}.option{font-size:16px;min-height:70px;padding:18px 20px 18px 54px}.nav{max-width:640px;padding:16px 22px}.back,.next{height:60px}.back{width:74px}.next{font-size:19px}.percent{font-size:38px}}
</style>
</head>
<body>
<main class="shell">
  <section id="quiz">
    <div class="top">
      <div id="step-label" class="step"></div>
      <div class="progress-row"><div id="count" class="count"></div><div id="percent" class="percent"></div></div>
      <div class="bar"><span id="bar"></span></div>
    </div>
    <div id="error" class="error"></div>
    <div class="panel">
      <label class="line" hidden>LINEユーザーID<input type="text" name="lineUserId" placeholder="LINE内で開くと自動入力されます"></label>
      <div class="pill">1つ選択</div>
      <h1 id="question-title" class="title"></h1>
      <p class="hint"><strong>今いちばん近いもの</strong>を選んでください</p>
      <div id="options" class="options"></div>
    </div>
    <div class="nav">
      <button id="back" class="back" type="button">‹</button>
      <button id="next" class="next" type="button">次へ進む</button>
    </div>
  </section>
  <section id="report" class="report"></section>
</main>
<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
<script>
const questions=${JSON.stringify(questions)};
const configs=${JSON.stringify(configs)};
const apiUrl='${apiUrl}';
const bookingBase='${bookingUrl}';
const quiz=document.getElementById('quiz');const report=document.getElementById('report');const error=document.getElementById('error');
const lineInput=document.querySelector('input[name="lineUserId"]');
const stepLabel=document.getElementById('step-label');const count=document.getElementById('count');const percent=document.getElementById('percent');const bar=document.getElementById('bar');
const title=document.getElementById('question-title');const optionsEl=document.getElementById('options');const back=document.getElementById('back');const next=document.getElementById('next');
let current=0;const answers={};
async function hydrateLineUserId(){
 const params=new URLSearchParams(location.search);
 const fromUrl=params.get('lineUserId')||params.get('uid')||params.get('line_user_id');
 const fromStore=localStorage.getItem('line_user_id')||'';
 if(fromUrl||fromStore){lineInput.value=fromUrl||fromStore;lineInput.closest('label').style.display='none';return;}
 const liffId=params.get('liffId')||'${liffId}';
 if(liffId&&window.liff){try{await liff.init({liffId});if(liff.isLoggedIn()){const p=await liff.getProfile();if(p.userId){lineInput.value=p.userId;localStorage.setItem('line_user_id',p.userId);lineInput.closest('label').style.display='none';}}}catch(_){}}
}
hydrateLineUserId();
function render(){const q=questions[current];const p=Math.round(((current+1)/questions.length)*100);stepLabel.textContent='STEP '+(current+1)+': AI活用診断';count.textContent='項目 '+(current+1)+' / '+questions.length;percent.textContent=p+'%';bar.style.width=p+'%';title.textContent=q.text;back.style.visibility=current===0?'hidden':'visible';next.textContent=current===questions.length-1?'結果を見る':'次へ進む';const selected=answers[q.id]||[];optionsEl.innerHTML='';q.options.forEach(opt=>{const btn=document.createElement('button');btn.type='button';btn.className='option'+(selected.includes(opt.label)?' active':'');btn.textContent=opt.label;btn.addEventListener('click',()=>{answers[q.id]=[opt.label];render();});optionsEl.appendChild(btn);});}
back.addEventListener('click',()=>{if(current>0){current--;error.style.display='none';render();}});
next.addEventListener('click',async()=>{const q=questions[current];if(!(answers[q.id]||[]).length){error.textContent='選択肢を1つ選んでください';error.style.display='block';return;}error.style.display='none';if(current<questions.length-1){current++;render();return;}await submit();});
function maxScores(){const max={};configs.forEach(c=>{max[c.typeKey]=questions.length;});return max;}
function radarSvg(scores){const axes=configs.map(c=>c.typeKey);const labels=configs.map(c=>c.label.replace('型','').replace('AI活用','活用').slice(0,6));const max=maxScores();const cx=140,cy=140,r=96;const pts=axes.map((key,i)=>{const a=(-90+i*360/axes.length)*Math.PI/180;const rate=Math.min(1,(scores[key]||0)/(max[key]||1));return [cx+Math.cos(a)*r*rate,cy+Math.sin(a)*r*rate];}).map(p=>p.join(',')).join(' ');const grid=[.33,.66,1].map(rate=>'<polygon points="'+axes.map((_,i)=>{const a=(-90+i*360/axes.length)*Math.PI/180;return (cx+Math.cos(a)*r*rate)+','+(cy+Math.sin(a)*r*rate)}).join(' ')+'" fill="none" stroke="rgba(142,198,255,.36)" stroke-width=".55"/>').join('');const labelEls=axes.map((_,i)=>{const a=(-90+i*360/axes.length)*Math.PI/180;return '<text x="'+(cx+Math.cos(a)*(r+34))+'" y="'+(cy+Math.sin(a)*(r+34))+'" text-anchor="middle" dominant-baseline="middle" fill="#dcecff" font-size="10" font-weight="800">'+labels[i]+'</text>';}).join('');return '<svg viewBox="0 0 280 280">'+grid+labelEls+'<polygon points="'+pts+'" fill="rgba(124,199,255,.18)" stroke="#8fd4ff" stroke-width="2"/></svg>';}
function advisorAdvice(typeKey){const messages={time_efficiency:'毎日の仕事で時間がかかる作業を、AIに任せる部分と人が判断する部分に分けましょう。最初はメール返信、要約、議事録、資料構成など小さな作業から始めると効果が見えやすいです。',performance:'AIを作業の丸投げ先にするより、壁打ち相手やたたき台作成パートナーとして使うと成果につながります。リサーチ、資料構成、文章改善の順に使うと、提案や資料の質を上げやすいです。',creator:'発信や副業にAIを使うなら、まず自分の経験や強みを整理し、投稿や記事の型を作るのが近道です。AIで制作負担を減らしながら、LINE登録や勉強会への導線も一緒に設計しましょう。',business_growth:'事業でAIを使うなら、単発の時短ではなく、集客、問い合わせ対応、提案、顧客管理、継続フォローの流れに組み込む視点が重要です。まずは業務フローを一枚に整理しましょう。',team_adoption:'チーム導入では、ツール選定より先に運用ルールが大切です。AI化したい業務、入力してよい情報、共通プロンプト、社内教育の進め方を整理してから導入すると失敗しにくくなります。',career_learning:'AI時代に備える段階では、難しい自動化よりも基本の型を身につけるのが先です。ChatGPT、Claude、Geminiの違いを知り、仕事別の使い方を勉強会で試すと実務に落とし込みやすくなります。',workflow_builder:'単発利用から一歩進んで、自分の仕事の流れにAIを組み込みましょう。よくある業務を洗い出し、プロンプトをテンプレート化し、必要に応じてProjects、GPTs、Gemsを使うと再現性が上がります。'};return '<strong>実務アドバイス</strong>'+(messages[typeKey]||messages.career_learning)+'<br><br><strong>おすすめの進め方</strong>まずは診断結果に合うガイドで基本の型を確認し、勉強会で実例を見て、自分の業務に落とし込む段階で個別相談を使う流れがスムーズです。';}
function renderReport(data){const scores=data.scores||{};const max=maxScores();const sorted=[...configs].sort((a,b)=>(scores[b.typeKey]||0)-(scores[a.typeKey]||0));const rows=sorted.map(c=>{const v=scores[c.typeKey]||0;const m=max[c.typeKey]||1;return '<div class="score-row"><div class="score-top"><span>'+c.label+'</span><span>'+v+' / '+m+'</span></div><div class="scorebar"><span style="width:'+Math.round(v/m*100)+'%"></span></div></div>';}).join('');const lineUserId=lineInput.value||'';const ctaUrl=data.ctaUrl||bookingBase+(lineUserId?'?lineUserId='+encodeURIComponent(lineUserId):'');const ctaLabel=data.ctaLabel||'無料で相談予約する';quiz.style.display='none';report.style.display='block';report.innerHTML='<div class="hero"><div class="eyebrow">PERSONAL REPORT</div><h1>分析結果レポート</h1><div class="sub">診断完了</div></div><div class="card">'+rows+'<div class="main-type"><div class="trophy">AI</div><div><div class="sub">あなたのメインタイプ</div><div class="type-label">'+data.result.label+'</div></div></div></div><div class="card"><div class="sub" style="text-align:center">現在のAI活用バランス</div><div class="radar">'+radarSvg(scores)+'</div><div class="advice">'+advisorAdvice(data.result.typeKey)+'</div></div><div class="card"><div class="sub" style="text-align:center">診断結果に合わせた次のステップです</div><a class="cta" href="'+ctaUrl+'">'+ctaLabel+'</a></div>';}
async function submit(){next.disabled=true;next.textContent='診断中...';try{const payload=Object.entries(answers).map(([questionId,selectedLabels])=>({questionId,selectedLabels}));const res=await fetch(apiUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lineUserId:lineInput.value||'',answers:payload})});const data=await res.json();if(!data.success)throw new Error(data.error||'診断に失敗しました');renderReport(data.data);}catch(err){next.disabled=false;next.textContent='結果を見る';error.textContent=err.message||'診断に失敗しました';error.style.display='block';}}
render();
</script>
</body>
</html>`);
});
