import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outDir = "generated/google-io-ec-slides";
const pngSourceDir = join(outDir, "png-source");
mkdirSync(outDir, { recursive: true });
mkdirSync(pngSourceDir, { recursive: true });

const W = 1920;
const H = 1080;
const colors = {
  blue: "#1a73e8",
  red: "#ea4335",
  yellow: "#fbbc04",
  green: "#34a853",
  ink: "#202124",
  muted: "#5f6368",
  bg: "#f8fbff",
  card: "#ffffff",
  line: "#dadce0",
  softBlue: "#e8f0fe",
  softRed: "#fce8e6",
  softYellow: "#fef7e0",
  softGreen: "#e6f4ea",
};

const slides = [
  {
    title: "AI時代のECは、入口が変わる",
    kicker: "Google I/O 2026を前提にしたEC戦略",
    type: "hero",
    main: "人がサイトを探す時代から、AIが商品を選ぶ時代へ",
    sub: "EC事業者は「見た目のサイト」だけでなく、「AIが読める商品データ」を整える必要がある。",
  },
  {
    title: "これまでのEC導線",
    kicker: "Before",
    type: "flow",
    items: ["検索する", "サイトへ行く", "比較する", "カートに入れる", "購入する"],
    note: "人間が毎回、探して、迷って、操作していた。",
  },
  {
    title: "これからのEC導線",
    kicker: "After",
    type: "split",
    leftTitle: "人間",
    left: ["希望をAIに伝える", "候補を確認する", "最後に納得して買う"],
    rightTitle: "AI",
    right: ["商品データを読む", "在庫・価格を比べる", "購入手続きまで進める"],
    note: "買い物の面倒な部分を、AIが代わりに処理する。",
  },
  {
    title: "GoogleがECに踏み込む理由",
    kicker: "Google視点",
    type: "three",
    cards: [
      ["検索の入口を守る", "AmazonやSNS、他のAIに買い物の起点を奪われたくない。", colors.blue],
      ["比較をAI化する", "検索結果を並べるだけでなく、答えと候補を直接出す。", colors.green],
      ["購入まで閉じる", "検索、動画、メール、AIの中で買える体験を作る。", colors.yellow],
    ],
  },
  {
    title: "EC事業者への3大インパクト",
    kicker: "全体像",
    type: "three",
    cards: [
      ["検索が購買エージェントへ", "サイト訪問より、AI画面内で選ばれることが重要になる。", colors.blue],
      ["AIが買い物を代理する", "価格、在庫、レビューをAIが見て候補を選ぶ。", colors.red],
      ["動画制作が高速化する", "商品動画や短尺動画の競争が一気に増える。", colors.green],
    ],
  },
  {
    title: "インパクト1：サイトに来ない購入が増える",
    kicker: "Universal Cart的な世界",
    type: "diagram",
    center: "Google / Gemini / YouTube",
    around: ["商品発見", "比較", "カート", "決済"],
    note: "ECサイトは「店舗」だけでなく、商品データの供給元になる。",
  },
  {
    title: "インパクト2：AIに伝わる商品だけが残る",
    kicker: "AIエージェント最適化",
    type: "compare",
    leftTitle: "弱い商品データ",
    left: ["色名があいまい", "在庫更新が遅い", "レビューが読みにくい"],
    rightTitle: "強い商品データ",
    right: ["属性が標準化", "価格・在庫が同期", "レビューも構造化"],
  },
  {
    title: "インパクト3：動画は少数精鋭から大量運用へ",
    kicker: "クリエイティブ",
    type: "pipeline",
    items: ["商品画像", "説明文", "AI生成", "Shorts動画", "検証と改善"],
    note: "人が全部作るのではなく、AIで作って、成果を見て磨く。",
  },
  {
    title: "これからのWebは二重構造になる",
    kicker: "重要な考え方",
    type: "splitBig",
    leftTitle: "人間が見るWebページ",
    left: ["世界観", "ストーリー", "安心感", "買いたい気持ち"],
    rightTitle: "AIが読むデータシート",
    right: ["JSON-LD", "商品フィード", "API", "価格・在庫・属性"],
    note: "どちらか一方ではなく、役割を分けて両方を強くする。",
  },
  {
    title: "Webページの価値は消えるのか？",
    kicker: "結論",
    type: "answer",
    main: "消えるのではなく、役割が変わる",
    points: [
      "スペックだけのページは価値が下がる。",
      "ブランドの信頼や熱量を伝えるページは価値が上がる。",
      "AIに運んでもらい、最後は人に選ばれる状態を作る。",
    ],
  },
  {
    title: "短期：1〜6ヶ月でやること",
    kicker: "まず土台を整える",
    type: "checklist",
    color: colors.blue,
    items: [
      "Google Merchant Centerの商品データを整える",
      "価格・在庫・配送情報を正確に同期する",
      "商品ページにJSON-LDを入れる",
      "会話型検索に答えるFAQを作る",
      "短尺の商品動画を作り始める",
    ],
  },
  {
    title: "中期：6ヶ月〜2年でやること",
    kicker: "AIに選ばれる運用へ",
    type: "checklist",
    color: colors.green,
    items: [
      "外部カートや決済連携に対応できる状態にする",
      "レビュー、比較記事、SNSの評判を増やす",
      "AIが読みやすいレビュー形式にする",
      "自社LINE、アプリ、メールで直接つながる",
      "社内AIで商品登録や広告文作成を自動化する",
    ],
  },
  {
    title: "長期：2年以降で勝つ方法",
    kicker: "AIに比較されても負けない",
    type: "checklist",
    color: colors.red,
    items: [
      "指名買いされるブランドを作る",
      "ファンコミュニティを育てる",
      "購入後の体験を動画やCRMで深める",
      "顧客データを自社で蓄積する",
      "価格以外で選ばれる理由を作る",
    ],
  },
  {
    title: "EC支援事業者には大きなチャンス",
    kicker: "新しい役割",
    type: "layers",
    layers: [
      ["AI向けインフラ", "商品データ、JSON-LD、API、在庫同期を整える"],
      ["AI向け評価づくり", "FAQ、比較記事、レビュー、SNS上の信頼を作る"],
      ["人間向けブランド体験", "動画、ストーリー、コミュニティ、CRMを育てる"],
    ],
    note: "つまり、商品とブランドを「AIにも人にも伝わる形」に翻訳する仕事。",
  },
  {
    title: "新しい売上方程式",
    kicker: "これからのKPI",
    type: "formula",
    old: "売上 = アクセス数 × 転換率 × 客単価",
    now: "売上 = AI経由の自動購入 + ファンの指名買い",
    points: [
      "AI経由：商品データの正確さ、在庫同期、決済のしやすさ",
      "指名買い：ブランドの熱量、レビュー、直接つながる顧客",
    ],
  },
  {
    title: "明日からの優先順位",
    kicker: "実務チェック",
    type: "priority",
    items: [
      ["1", "商品データを棚卸し", "色、サイズ、素材、在庫、配送を正確にする"],
      ["2", "AIが読む情報を整備", "JSON-LD、FAQ、レビュー形式を見直す"],
      ["3", "動画運用を始める", "商品説明と利用シーンを短尺で出す"],
      ["4", "直接つながる顧客を増やす", "LINE、アプリ、メール、会員導線を強化する"],
    ],
  },
];

const esc = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function wrapText(text, maxChars = 20) {
  const out = [];
  let line = "";
  for (const char of text) {
    const next = line + char;
    if (next.length > maxChars && line.length > 0) {
      out.push(line);
      line = char;
    } else {
      line = next;
    }
  }
  if (line) out.push(line);
  return out;
}

function textBlock(text, x, y, opts = {}) {
  const {
    size = 46,
    weight = 600,
    fill = colors.ink,
    max = 22,
    line = Math.round(size * 1.4),
    anchor = "start",
  } = opts;
  const lines = Array.isArray(text) ? text : wrapText(text, max);
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${lines
    .map((l, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : line}">${esc(l)}</tspan>`)
    .join("")}</text>`;
}

function pill(text, x, y, fill = colors.softBlue, stroke = colors.blue) {
  return `<g><rect x="${x}" y="${y}" width="${Math.max(240, text.length * 23)}" height="54" rx="27" fill="${fill}" stroke="${stroke}" stroke-width="2"/><text x="${
    x + 28
  }" y="${y + 36}" font-size="24" font-weight="700" fill="${stroke}">${esc(text)}</text></g>`;
}

function header(s, n) {
  return `
    <rect width="${W}" height="${H}" fill="${colors.bg}"/>
    <circle cx="1730" cy="96" r="18" fill="${colors.blue}"/>
    <circle cx="1780" cy="96" r="18" fill="${colors.red}"/>
    <circle cx="1830" cy="96" r="18" fill="${colors.yellow}"/>
    <circle cx="1880" cy="96" r="18" fill="${colors.green}"/>
    ${pill(s.kicker, 104, 78)}
    ${textBlock(s.title, 104, 225, { size: 62, weight: 800, max: 24, line: 78 })}
    <text x="104" y="1010" font-size="24" fill="${colors.muted}">${String(n + 1).padStart(2, "0")} / ${slides.length}  |  AI x EC Strategy</text>
  `;
}

function card(x, y, w, h, fill = colors.card, stroke = colors.line) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="28" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
}

function arrow(x1, y1, x2, y2, color = colors.blue) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="8" stroke-linecap="round"/><path d="M ${x2} ${y2} l -24 -16 l 0 32 z" fill="${color}"/>`;
}

function renderBody(s) {
  if (s.type === "hero") {
    return `
      <rect x="104" y="315" width="1712" height="520" rx="42" fill="${colors.card}" stroke="${colors.line}" stroke-width="2"/>
      <circle cx="1460" cy="570" r="190" fill="${colors.softBlue}"/>
      <circle cx="1565" cy="512" r="72" fill="${colors.softYellow}"/>
      <circle cx="1370" cy="440" r="48" fill="${colors.softGreen}"/>
      ${textBlock(s.main, 170, 455, { size: 66, weight: 800, max: 18, line: 86 })}
      ${textBlock(s.sub, 174, 690, { size: 35, weight: 500, fill: colors.muted, max: 32, line: 52 })}
    `;
  }
  if (s.type === "flow" || s.type === "pipeline") {
    const startX = 130;
    const y = 500;
    const stepW = 280;
    const gap = 90;
    return `
      ${s.items
        .map((it, i) => {
          const x = startX + i * (stepW + gap);
          const c = [colors.blue, colors.red, colors.yellow, colors.green, colors.blue][i];
          return `
            ${card(x, y, stepW, 190, colors.card, c)}
            <circle cx="${x + 50}" cy="${y + 58}" r="24" fill="${c}"/>
            <text x="${x + 50}" y="${y + 67}" font-size="28" font-weight="800" fill="#fff" text-anchor="middle">${i + 1}</text>
            ${textBlock(it, x + 34, y + 125, { size: 34, weight: 800, max: 8, line: 45 })}
            ${i < s.items.length - 1 ? arrow(x + stepW + 20, y + 95, x + stepW + 70, y + 95, colors.line) : ""}
          `;
        })
        .join("")}
      ${textBlock(s.note, 340, 820, { size: 40, weight: 700, fill: colors.muted, max: 34, anchor: "start" })}
    `;
  }
  if (s.type === "split" || s.type === "splitBig") {
    return `
      ${card(130, 345, 770, 470, colors.card, colors.blue)}
      ${card(1020, 345, 770, 470, colors.card, colors.green)}
      <text x="185" y="430" font-size="46" font-weight="800" fill="${colors.blue}">${esc(s.leftTitle)}</text>
      <text x="1075" y="430" font-size="46" font-weight="800" fill="${colors.green}">${esc(s.rightTitle)}</text>
      ${s.left.map((t, i) => `${textBlock("・" + t, 188, 515 + i * 75, { size: 38, weight: 650, max: 18, line: 50 })}`).join("")}
      ${s.right.map((t, i) => `${textBlock("・" + t, 1078, 515 + i * 75, { size: 38, weight: 650, max: 18, line: 50 })}`).join("")}
      ${s.note ? textBlock(s.note, 235, 895, { size: 36, weight: 700, fill: colors.muted, max: 42 }) : ""}
    `;
  }
  if (s.type === "three") {
    return `
      ${s.cards
        .map(([t, d, c], i) => {
          const x = 130 + i * 590;
          return `
            ${card(x, 380, 500, 390, colors.card, c)}
            <rect x="${x + 34}" y="420" width="84" height="12" rx="6" fill="${c}"/>
            ${textBlock(t, x + 34, 500, { size: 42, weight: 800, max: 11, line: 56 })}
            ${textBlock(d, x + 34, 630, { size: 31, weight: 500, fill: colors.muted, max: 18, line: 46 })}
          `;
        })
        .join("")}
    `;
  }
  if (s.type === "diagram") {
    return `
      <circle cx="960" cy="585" r="180" fill="${colors.softBlue}" stroke="${colors.blue}" stroke-width="4"/>
      ${textBlock(s.center, 960, 555, { size: 40, weight: 800, max: 12, line: 52, anchor: "middle" })}
      ${s.around
        .map((t, i) => {
          const pos = [
            [360, 500, colors.blue],
            [730, 790, colors.red],
            [1135, 790, colors.yellow],
            [1420, 500, colors.green],
          ][i];
          return `
            ${card(pos[0], pos[1], 230, 110, colors.card, pos[2])}
            <text x="${pos[0] + 115}" y="${pos[1] + 68}" font-size="32" font-weight="800" fill="${colors.ink}" text-anchor="middle">${esc(t)}</text>
            ${arrow(pos[0] + (pos[0] < 960 ? 230 : 0), pos[1] + 55, 960 + (pos[0] < 960 ? -170 : 170), 585, pos[2])}
          `;
        })
        .join("")}
      ${textBlock(s.note, 250, 920, { size: 36, weight: 700, fill: colors.muted, max: 42 })}
    `;
  }
  if (s.type === "compare") {
    return `
      ${card(135, 355, 755, 500, colors.softRed, colors.red)}
      ${card(1030, 355, 755, 500, colors.softGreen, colors.green)}
      <text x="195" y="450" font-size="46" font-weight="800" fill="${colors.red}">${esc(s.leftTitle)}</text>
      <text x="1090" y="450" font-size="46" font-weight="800" fill="${colors.green}">${esc(s.rightTitle)}</text>
      ${s.left.map((t, i) => `${textBlock("× " + t, 200, 545 + i * 88, { size: 40, weight: 700, max: 18 })}`).join("")}
      ${s.right.map((t, i) => `${textBlock("○ " + t, 1095, 545 + i * 88, { size: 40, weight: 700, max: 18 })}`).join("")}
    `;
  }
  if (s.type === "answer") {
    return `
      ${card(170, 340, 1580, 180, colors.softBlue, colors.blue)}
      <text x="960" y="455" font-size="64" font-weight="900" fill="${colors.blue}" text-anchor="middle">${esc(s.main)}</text>
      ${s.points
        .map((p, i) => {
          const c = [colors.red, colors.yellow, colors.green][i];
          return `${card(250, 605 + i * 105, 1420, 76, colors.card, c)}<circle cx="300" cy="${643 + i * 105}" r="14" fill="${c}"/>${textBlock(p, 335, 655 + i * 105, { size: 34, weight: 700, max: 42 })}`;
        })
        .join("")}
    `;
  }
  if (s.type === "checklist") {
    return `
      ${card(170, 330, 1580, 560, colors.card, s.color)}
      ${s.items
        .map((it, i) => {
          const y = 420 + i * 86;
          return `<circle cx="245" cy="${y - 12}" r="23" fill="${s.color}"/><path d="M234 ${y - 13} l9 11 l20 -26" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>${textBlock(it, 295, y, { size: 36, weight: 700, max: 38 })}`;
        })
        .join("")}
    `;
  }
  if (s.type === "layers") {
    return `
      ${s.layers
        .map(([t, d], i) => {
          const c = [colors.blue, colors.green, colors.red][i];
          const y = 350 + i * 170;
          return `${card(210, y, 1500, 125, colors.card, c)}<text x="280" y="${y + 54}" font-size="39" font-weight="900" fill="${c}">${esc(t)}</text>${textBlock(d, 280, y + 98, { size: 30, weight: 600, fill: colors.muted, max: 44 })}`;
        })
        .join("")}
      ${textBlock(s.note, 250, 910, { size: 35, weight: 800, fill: colors.ink, max: 40 })}
    `;
  }
  if (s.type === "formula") {
    return `
      ${card(160, 340, 1600, 170, colors.softRed, colors.red)}
      <text x="960" y="445" font-size="48" font-weight="800" fill="${colors.red}" text-anchor="middle">${esc(s.old)}</text>
      <text x="960" y="570" font-size="58" font-weight="900" fill="${colors.ink}" text-anchor="middle">↓</text>
      ${card(160, 620, 1600, 170, colors.softGreen, colors.green)}
      <text x="960" y="725" font-size="48" font-weight="900" fill="${colors.green}" text-anchor="middle">${esc(s.now)}</text>
      ${s.points.map((p, i) => textBlock(p, 245, 870 + i * 52, { size: 30, weight: 700, fill: colors.muted, max: 48 })).join("")}
    `;
  }
  if (s.type === "priority") {
    return `
      ${s.items
        .map(([num, t, d], i) => {
          const x = i % 2 === 0 ? 160 : 985;
          const y = i < 2 ? 350 : 630;
          const c = [colors.blue, colors.red, colors.yellow, colors.green][i];
          return `${card(x, y, 760, 215, colors.card, c)}<circle cx="${x + 70}" cy="${y + 70}" r="38" fill="${c}"/><text x="${x + 70}" y="${y + 83}" font-size="40" font-weight="900" fill="#fff" text-anchor="middle">${num}</text>${textBlock(t, x + 130, y + 66, { size: 38, weight: 900, max: 15 })}${textBlock(d, x + 130, y + 130, { size: 30, weight: 600, fill: colors.muted, max: 24, line: 42 })}`;
        })
        .join("")}
    `;
  }
  return "";
}

function renderSlide(slide, index) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <style>
    text { font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans CJK JP", "Yu Gothic", sans-serif; letter-spacing: 0; }
  </style>
  ${header(slide, index)}
  ${renderBody(slide)}
</svg>`;
}

function renderCenteredSquareSlide(slide, index) {
  const yOffset = 420;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">
  <style>
    text { font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans CJK JP", "Yu Gothic", sans-serif; letter-spacing: 0; }
  </style>
  <rect width="${W}" height="${W}" fill="${colors.bg}"/>
  <g transform="translate(0 ${yOffset})">
    ${header(slide, index)}
    ${renderBody(slide)}
  </g>
</svg>`;
}

slides.forEach((slide, i) => {
  writeFileSync(join(outDir, `slide-${String(i + 1).padStart(2, "0")}.svg`), renderSlide(slide, i));
  writeFileSync(join(pngSourceDir, `slide-${String(i + 1).padStart(2, "0")}.svg`), renderCenteredSquareSlide(slide, i));
});

const indexHtml = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AI x EC Slides</title>
  <style>
    body { margin: 0; background: #eef3fb; font-family: sans-serif; padding: 32px; }
    .grid { display: grid; gap: 24px; max-width: 1200px; margin: auto; }
    img { width: 100%; border-radius: 14px; box-shadow: 0 12px 40px rgba(60,64,67,.18); background: white; }
  </style>
</head>
<body>
  <main class="grid">
    ${slides.map((_, i) => `<img src="./slide-${String(i + 1).padStart(2, "0")}.png" alt="slide ${i + 1}" />`).join("\n    ")}
  </main>
</body>
</html>`;

writeFileSync(join(outDir, "index.html"), indexHtml);
console.log(`Generated ${slides.length} SVG slides in ${outDir}`);
