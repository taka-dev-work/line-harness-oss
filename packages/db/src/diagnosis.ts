import { jstNow } from './utils.js';
import { addTagToFriend, createTag, getTags } from './tags.js';
import { getFriendByLineUserId } from './friends.js';

export interface DiagnosisOption {
  label: string;
  value: number;
  tags?: string[];
}

export interface DiagnosisQuestion {
  id: string;
  org_id: string | null;
  question_id: string;
  sort_order: number;
  text: string;
  maps_to_type: string;
  options: string;
  created_at: string;
  updated_at: string;
}

export interface DiagnosisConfig {
  id: string;
  org_id: string | null;
  type_key: string;
  label: string;
  description: string | null;
  tag_name: string;
  line_message: string;
  manga_lp_url: string;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface DiagnosisFormConfig {
  id: string;
  org_id: string | null;
  form_name: string;
  form_title: string;
  created_at: string;
  updated_at: string;
}

export interface DiagnosisResult {
  id: string;
  user_id: string | null;
  friend_id: string | null;
  line_user_id: string | null;
  org_id: string | null;
  diagnosis_type: string;
  result_key: string;
  result_label: string | null;
  score: string | null;
  answers: string;
  created_at: string;
}

export interface AiDiagnosisConfigInput {
  formName: string;
  formTitle: string;
  questions: Array<{
    text: string;
    maps_to_type: string;
    options: DiagnosisOption[];
  }>;
  configs: Array<{
    type_key: string;
    label: string;
    description: string;
    tag_name: string;
    line_message: string;
    manga_lp_url?: string;
    color?: string;
  }>;
}

export interface DiagnosisAnswerInput {
  questionId: string;
  selectedLabel?: string;
  selectedLabels?: string[];
}

export const DEFAULT_AI_DIAGNOSIS_CONFIG: AiDiagnosisConfigInput = {
  formName: 'AI活用目的診断',
  formTitle: 'AI活用目的・働き方診断',
  questions: [
    {
      text: 'Q1. 現在のAI活用レベルに近いものを選んでください。',
      maps_to_type: 'career_learning',
      options: [
        { label: 'まだほとんど使っていない', value: 1, tags: ['レベル_初心者', '温度_低'] },
        { label: 'ChatGPTなどを少し触ったことがある', value: 1, tags: ['レベル_初級', '温度_低'] },
        { label: '仕事で少し使っている', value: 1, tags: ['レベル_実務活用中', '温度_中'] },
        { label: '業務に本格的に取り入れたい', value: 1, tags: ['レベル_本格導入検討', '温度_高'] },
        { label: '社内・チームで導入したい', value: 1, tags: ['レベル_法人導入', '温度_高', '見込み_法人相談'] },
      ],
    },
    {
      text: 'Q2. 現在の働き方・立場に近いものを選んでください。',
      maps_to_type: 'time_efficiency',
      options: [
        { label: '会社員として仕事の効率を上げたい', value: 1, tags: ['ペルソナ_会社員', '目的_業務効率化'] },
        { label: '個人事業主・フリーランスとして仕事に活かしたい', value: 1, tags: ['ペルソナ_個人事業主', '目的_仕事活用'] },
        { label: '副業や発信にAIを活用したい', value: 1, tags: ['ペルソナ_副業発信', '目的_副業収益化'] },
        { label: '経営者・事業責任者として導入を考えている', value: 1, tags: ['ペルソナ_経営者', '目的_事業導入', '温度_高'] },
        { label: 'チーム・社内でAI活用を進めたい', value: 1, tags: ['ペルソナ_チーム導入', '目的_社内導入', '温度_高'] },
        { label: 'まだ明確ではないが、AI時代に備えたい', value: 1, tags: ['ペルソナ_AI学習層', '目的_キャリア形成'] },
      ],
    },
    {
      text: 'Q3. AIを活用して、一番実現したいことは何ですか？',
      maps_to_type: 'time_efficiency',
      options: [
        { label: '作業時間を減らして、余裕をつくりたい', value: 1, tags: ['本質目的_時間を増やしたい'] },
        { label: '仕事の質や成果を上げたい', value: 1, tags: ['本質目的_成果を上げたい'] },
        { label: '副業・発信・コンテンツ制作に活かしたい', value: 1, tags: ['本質目的_副業発信に活かしたい'] },
        { label: '事業やサービスの成長につなげたい', value: 1, tags: ['本質目的_事業成長'] },
        { label: '社内・チームの生産性を上げたい', value: 1, tags: ['本質目的_チーム生産性向上', '温度_高'] },
        { label: 'AI時代に置いていかれないように学びたい', value: 1, tags: ['本質目的_AI時代への備え'] },
        { label: '自分専用のAI活用フローを作りたい', value: 1, tags: ['本質目的_自分専用ワークフロー化'] },
      ],
    },
    {
      text: 'Q4. 今、一番AIで効率化・改善したい業務を選んでください。',
      maps_to_type: 'performance',
      options: [
        { label: 'メール・文章作成', value: 1, tags: ['課題_文章作成'] },
        { label: '要約・資料整理', value: 1, tags: ['課題_資料整理', '課題_要約'] },
        { label: 'リサーチ・情報収集', value: 1, tags: ['課題_リサーチ'] },
        { label: '資料作成・スライド作成', value: 1, tags: ['課題_資料作成'] },
        { label: 'SNS・コンテンツ制作', value: 1, tags: ['課題_SNS運用'] },
        { label: '会議・議事録整理', value: 1, tags: ['課題_議事録'] },
        { label: 'Gmail / Drive / Docs / Sheets などのGoogle業務', value: 1, tags: ['課題_GoogleWorkspace'] },
        { label: '業務自動化・AIエージェント', value: 1, tags: ['課題_業務自動化', '興味_AIエージェント', '温度_高'] },
        { label: 'まだ具体的には決まっていない', value: 1, tags: ['課題_未整理', 'AI診断_要フォロー'] },
      ],
    },
    {
      text: 'Q5. 次に希望するサポートに近いものを選んでください。',
      maps_to_type: 'career_learning',
      options: [
        { label: 'まずは無料ガイドで学びたい', value: 1, tags: ['希望_無料ガイド'] },
        { label: '事例やテンプレートを見たい', value: 1, tags: ['希望_事例テンプレート'] },
        { label: '勉強会で実践イメージをつかみたい', value: 1, tags: ['希望_勉強会'] },
        { label: 'AI講座で体系的に学びたい', value: 1, tags: ['希望_AI講座'] },
        { label: '自分の業務に合わせて個別に相談したい', value: 1, tags: ['希望_個別相談', '温度_高'] },
        { label: '法人・チーム導入について相談したい', value: 1, tags: ['希望_法人導入', '温度_高', '見込み_法人相談'] },
      ],
    },
  ],
  configs: [
    {
      type_key: 'time_efficiency',
      label: '時間創出・業務効率化型',
      description: '毎日の作業時間を減らし、集中すべき仕事に時間を戻すことがAI活用の主目的です。',
      tag_name: '診断_時間創出業務効率化型',
      line_message: '診断結果：\n{name}さんは「時間創出・業務効率化型」です。\n\n1. あなたの現在地\n日々の仕事の中に、メール返信、要約、議事録、資料構成など、AIに任せやすい作業がありそうです。\n\n2. AI活用の本質的な目的\n便利なツールを増やすことではなく、時間がかかる作業を減らして、本当に集中したい仕事に使える時間を増やすことです。\n\n3. まず取り組むべきこと\n毎日・毎週くり返している作業を3つ書き出し、AIに任せる部分と人が判断する部分を分けましょう。\n\n4. おすすめのAI活用メソッド\n・メール返信の下書き\n・要約と議事録整理\n・資料構成のたたき台作成\n・Google業務の整理\n\n5. おすすめツール\n・ChatGPT：文章作成・要約\n・Claude：資料整理・長文要約\n・Gemini：Google業務\n\n6. 次のアクション\nまずは「AI実務活用スタートガイド」を見て、自分の仕事のどこにAIを使えるか整理してみてください。',
      manga_lp_url: '/ai-crm/guide',
      color: '#38bdf8',
    },
    {
      type_key: 'performance',
      label: '仕事成果アップ型',
      description: '提案の質、資料のわかりやすさ、リサーチの深さをAIで高めるタイプです。',
      tag_name: '診断_仕事成果アップ型',
      line_message: '診断結果：\n{name}さんは「仕事成果アップ型」です。\n\n1. あなたの現在地\nAIを単なる時短ツールではなく、成果物の質を上げる相棒として使うと伸びやすい状態です。\n\n2. AI活用の本質的な目的\n提案の質、資料のわかりやすさ、リサーチの深さ、文章の伝わりやすさを高めることです。\n\n3. まず取り組むべきこと\nAIに丸投げするのではなく、壁打ち相手やたたき台作成パートナーとして使いましょう。\n\n4. おすすめのAI活用メソッド\n・リサーチの論点整理\n・資料構成の作成\n・文章のたたき台作成\n・読み手に合わせた改善\n\n5. おすすめツール\n・ChatGPT：アイデア出し・構成作成\n・Claude：長文整理・提案文作成\n\n6. 次のアクション\nまずはAI活用事例を確認し、より自分の業務に合わせたい場合は個別相談がおすすめです。',
      manga_lp_url: '/ai-crm/cases',
      color: '#60a5fa',
    },
    {
      type_key: 'creator',
      label: '副業・発信スタート型',
      description: 'AIでコンテンツ制作の負担を減らし、副業や発信の導線づくりに活かすタイプです。',
      tag_name: '診断_副業発信スタート型',
      line_message: '診断結果：\n{name}さんは「副業・発信スタート型」です。\n\n1. あなたの現在地\n自分の知識、経験、スキルを発信や副業につなげたい状態です。\n\n2. AI活用の本質的な目的\nコンテンツ制作の負担を減らしながら、発信テーマやサービス設計を整理することです。\n\n3. まず取り組むべきこと\n自分の経験や強みを整理し、SNS投稿やnote記事の型を作りましょう。\n\n4. おすすめのAI活用メソッド\n・発信テーマの整理\n・SNS投稿案の作成\n・note記事の構成\n・LINE登録や無料特典への導線設計\n\n5. おすすめツール\n・ChatGPT：投稿案・構成・文章作成\n・Claude：長文記事・note構成\n・Gemini：Googleドキュメント管理\n\n6. 次のアクション\nまずはChatGPT実務活用ガイドを確認し、実践しながら学びたい方は勉強会がおすすめです。',
      manga_lp_url: '/ai-crm/guide',
      color: '#f472b6',
    },
    {
      type_key: 'business_growth',
      label: '事業成長・サービス活用型',
      description: 'AIを集客、提案、顧客対応、業務改善に組み込み、事業成長につなげるタイプです。',
      tag_name: '診断_事業成長サービス活用型',
      line_message: '診断結果：\n{name}さんは「事業成長・サービス活用型」です。\n\n1. あなたの現在地\nAIを単発の作業効率化ではなく、事業全体の仕組みに組み込むと成果につながりやすい状態です。\n\n2. AI活用の本質的な目的\n集客、提案、顧客対応、商品設計、業務改善を通じて事業の成長につなげることです。\n\n3. まず取り組むべきこと\n集客、問い合わせ対応、提案資料、顧客管理、納品、継続フォローのどこにAIを使えるか整理しましょう。\n\n4. おすすめのAI活用メソッド\n・提案文の作成\n・顧客対応のテンプレート化\n・営業資料の構成\n・業務フローの自動化候補整理\n\n5. おすすめツール\n・ChatGPT：提案文・顧客対応\n・Claude：資料整理・提案書\n・Gemini：Google Workspace連携\n・AIエージェント：業務フロー自動化\n\n6. 次のアクション\n事業やサービスにAIを組み込みたい方は、導入相談で現在の業務フローを整理するのがおすすめです。',
      manga_lp_url: '/book/ai-consultation',
      color: '#22c55e',
    },
    {
      type_key: 'team_adoption',
      label: 'チーム導入・法人活用型',
      description: '個人の時短だけでなく、チーム全体の生産性、標準化、教育コスト削減を目指すタイプです。',
      tag_name: '診断_チーム導入法人活用型',
      line_message: '診断結果：\n{name}さんは「チーム導入・法人活用型」です。\n\n1. あなたの現在地\n個人利用ではなく、社内やチームでAI活用を進める入口にいます。\n\n2. AI活用の本質的な目的\nチーム全体の生産性向上、ナレッジ共有、業務標準化、教育コストの削減です。\n\n3. まず取り組むべきこと\nいきなりツールを導入するのではなく、どの業務にAIを使うか、どのルールで運用するかを整理しましょう。\n\n4. おすすめのAI活用メソッド\n・AI化したい業務の棚卸し\n・入力してよい情報とNG情報の整理\n・共通プロンプト作成\n・社内教育の設計\n\n5. おすすめツール\n・ChatGPT Team / Enterprise\n・Claude\n・Gemini for Google Workspace\n・社内AIエージェント\n\n6. 次のアクション\n法人・チームでAI活用を進めたい方は、まず導入相談で現状を整理するのがおすすめです。',
      manga_lp_url: '/book/ai-consultation',
      color: '#ef4444',
    },
    {
      type_key: 'career_learning',
      label: 'AI学習・キャリア形成型',
      description: 'AI時代に備え、基本的なAI活用を実務に結びつけながら体系的に学ぶタイプです。',
      tag_name: '診断_AI学習キャリア形成型',
      line_message: '診断結果：\n{name}さんは「AI学習・キャリア形成型」です。\n\n1. あなたの現在地\n今すぐ大きな自動化をするより、AIを仕事で使える基礎体力を作る段階です。\n\n2. AI活用の本質的な目的\nこれからの仕事やキャリアに備えて、AIを使いこなせる状態を作ることです。\n\n3. まず取り組むべきこと\nAI活用の全体像、ChatGPT / Claude / Geminiの違い、プロンプトの基本を順番に学びましょう。\n\n4. おすすめのAI活用メソッド\n・AI活用の全体像を知る\n・ツールの違いを知る\n・仕事別の活用パターンを学ぶ\n・自分の業務に落とし込む\n\n5. おすすめツール\n・ChatGPT：基本の文章作成\n・Claude：資料整理\n・Gemini：Google業務\n\n6. 次のアクション\n体系的に学びたい方は、まず勉強会で実践イメージをつかむのがおすすめです。',
      manga_lp_url: '/book/ai-workshop',
      color: '#f59e0b',
    },
    {
      type_key: 'workflow_builder',
      label: '自分専用AIワークフロー構築型',
      description: 'AIを単発利用で終わらせず、自分の仕事の流れに組み込むタイプです。',
      tag_name: '診断_自分専用AIワークフロー構築型',
      line_message: '診断結果：\n{name}さんは「自分専用AIワークフロー構築型」です。\n\n1. あなたの現在地\nAIを単発で便利に使う段階から、自分の仕事に組み込む段階へ進める状態です。\n\n2. AI活用の本質的な目的\n自分の仕事の流れにAIを組み込み、繰り返し使える仕組みにすることです。\n\n3. まず取り組むべきこと\nよくある業務を洗い出し、AIに任せる工程を決めて、プロンプトをテンプレート化しましょう。\n\n4. おすすめのAI活用メソッド\n・業務フローの分解\n・プロンプトのテンプレート化\n・Projects / GPTs / Gemsの活用\n・成果物の型づくり\n\n5. おすすめツール\n・ChatGPT Projects / GPTs\n・Claude Projects / Artifacts\n・Gemini Gems / Google Workspace\n\n6. 次のアクション\n自分の業務に合わせてAI活用フローを作りたい方は、個別相談で一度整理するのがおすすめです。',
      manga_lp_url: '/book/ai-consultation',
      color: '#a78bfa',
    },
  ],
};

export async function getDiagnosisFormConfig(db: D1Database): Promise<DiagnosisFormConfig | null> {
  return db
    .prepare('SELECT * FROM diagnosis_form_config ORDER BY created_at DESC LIMIT 1')
    .first<DiagnosisFormConfig>();
}

export async function getDiagnosisQuestions(db: D1Database): Promise<DiagnosisQuestion[]> {
  const result = await db
    .prepare('SELECT * FROM diagnosis_questions ORDER BY sort_order ASC')
    .all<DiagnosisQuestion>();
  return result.results;
}

export async function getDiagnosisConfigs(db: D1Database): Promise<DiagnosisConfig[]> {
  const result = await db
    .prepare('SELECT * FROM diagnosis_configs ORDER BY created_at ASC')
    .all<DiagnosisConfig>();
  return result.results;
}

export async function getDiagnosisSettings(db: D1Database): Promise<{
  form: DiagnosisFormConfig | null;
  questions: DiagnosisQuestion[];
  configs: DiagnosisConfig[];
}> {
  const [form, questions, configs] = await Promise.all([
    getDiagnosisFormConfig(db),
    getDiagnosisQuestions(db),
    getDiagnosisConfigs(db),
  ]);
  return { form, questions, configs };
}

function validateDiagnosisConfig(input: AiDiagnosisConfigInput): void {
  if (!input.formName || !input.formTitle) throw new Error('診断名とタイトルが必要です');
  if (!Array.isArray(input.questions) || input.questions.length < 1) throw new Error('質問が必要です');
  if (!Array.isArray(input.configs) || input.configs.length < 1) throw new Error('診断タイプが必要です');
  const typeKeys = new Set(input.configs.map((c) => c.type_key));
  for (const question of input.questions) {
    if (!typeKeys.has(question.maps_to_type)) {
      throw new Error(`質問の maps_to_type がタイプ定義に存在しません: ${question.maps_to_type}`);
    }
    if (!Array.isArray(question.options) || question.options.length < 2) {
      throw new Error('各質問には2つ以上の選択肢が必要です');
    }
  }
}

export async function applyAiDiagnosisConfig(
  db: D1Database,
  input: AiDiagnosisConfigInput,
): Promise<void> {
  validateDiagnosisConfig(input);
  const now = jstNow();
  const formId = crypto.randomUUID();

  const statements: D1PreparedStatement[] = [
    db.prepare('DELETE FROM diagnosis_form_config'),
    db.prepare('DELETE FROM diagnosis_questions'),
    db.prepare('DELETE FROM diagnosis_configs'),
    db.prepare(
      'INSERT INTO diagnosis_form_config (id, form_name, form_title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(formId, input.formName, input.formTitle, now, now),
  ];

  input.questions.forEach((question, index) => {
    statements.push(
      db.prepare(
        `INSERT INTO diagnosis_questions (
          id, question_id, sort_order, text, maps_to_type, options, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        `q${index + 1}`,
        index,
        question.text,
        question.maps_to_type,
        JSON.stringify(question.options),
        now,
        now,
      ),
    );
  });

  input.configs.forEach((config) => {
    statements.push(
      db.prepare(
        `INSERT INTO diagnosis_configs (
          id, type_key, label, description, tag_name, line_message,
          manga_lp_url, color, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        config.type_key,
        config.label,
        config.description,
        config.tag_name,
        config.line_message,
        config.manga_lp_url ?? '',
        config.color ?? '#6366f1',
        now,
        now,
      ),
    );
  });

  await db.batch(statements);
}

const RESULT_SCORE_BY_LABEL: Record<string, string> = {
  'まだほとんど使っていない': 'career_learning',
  'ChatGPTなどを少し触ったことがある': 'career_learning',
  '仕事で少し使っている': 'performance',
  '業務に本格的に取り入れたい': 'workflow_builder',
  '社内・チームで導入したい': 'team_adoption',
  '会社員として仕事の効率を上げたい': 'time_efficiency',
  '個人事業主・フリーランスとして仕事に活かしたい': 'business_growth',
  '副業や発信にAIを活用したい': 'creator',
  '経営者・事業責任者として導入を考えている': 'business_growth',
  'チーム・社内でAI活用を進めたい': 'team_adoption',
  'まだ明確ではないが、AI時代に備えたい': 'career_learning',
  '作業時間を減らして、余裕をつくりたい': 'time_efficiency',
  '仕事の質や成果を上げたい': 'performance',
  '副業・発信・コンテンツ制作に活かしたい': 'creator',
  '事業やサービスの成長につなげたい': 'business_growth',
  '社内・チームの生産性を上げたい': 'team_adoption',
  'AI時代に置いていかれないように学びたい': 'career_learning',
  '自分専用のAI活用フローを作りたい': 'workflow_builder',
  'メール・文章作成': 'time_efficiency',
  '要約・資料整理': 'time_efficiency',
  'リサーチ・情報収集': 'performance',
  '資料作成・スライド作成': 'performance',
  'SNS・コンテンツ制作': 'creator',
  '会議・議事録整理': 'time_efficiency',
  'Gmail / Drive / Docs / Sheets などのGoogle業務': 'time_efficiency',
  '業務自動化・AIエージェント': 'workflow_builder',
  'まだ具体的には決まっていない': 'career_learning',
  'まずは無料ガイドで学びたい': 'career_learning',
  '事例やテンプレートを見たい': 'performance',
  '勉強会で実践イメージをつかみたい': 'career_learning',
  'AI講座で体系的に学びたい': 'career_learning',
  '自分の業務に合わせて個別に相談したい': 'workflow_builder',
  '法人・チーム導入について相談したい': 'team_adoption',
};

function answerLabels(
  questions: DiagnosisQuestion[],
  answers: DiagnosisAnswerInput[],
): string[] {
  const answerMap = new Map(
    answers.map((a) => [a.questionId, a.selectedLabels ?? (a.selectedLabel ? [a.selectedLabel] : [])]),
  );
  return questions.flatMap((question) => (
    answerMap.get(question.id) ?? answerMap.get(question.question_id) ?? []
  ));
}

function hasAny(labels: string[], targets: string[]): boolean {
  return targets.some((target) => labels.includes(target));
}

function pickPriorityResult(labels: string[], configs: DiagnosisConfig[]): DiagnosisConfig {
  const priority: Array<{ typeKey: string; labels: string[] }> = [
    {
      typeKey: 'team_adoption',
      labels: [
        '社内・チームで導入したい',
        '経営者・事業責任者として導入を考えている',
        'チーム・社内でAI活用を進めたい',
        '社内・チームの生産性を上げたい',
        '法人・チーム導入について相談したい',
      ],
    },
    {
      typeKey: 'business_growth',
      labels: ['事業やサービスの成長につなげたい', '個人事業主・フリーランスとして仕事に活かしたい'],
    },
    {
      typeKey: 'creator',
      labels: ['副業・発信・コンテンツ制作に活かしたい', '副業や発信にAIを活用したい', 'SNS・コンテンツ制作'],
    },
    {
      typeKey: 'workflow_builder',
      labels: ['自分専用のAI活用フローを作りたい', '自分の業務に合わせて個別に相談したい', '業務自動化・AIエージェント'],
    },
    {
      typeKey: 'performance',
      labels: ['仕事の質や成果を上げたい', '資料作成・スライド作成', 'リサーチ・情報収集'],
    },
    {
      typeKey: 'time_efficiency',
      labels: ['作業時間を減らして、余裕をつくりたい', '会社員として仕事の効率を上げたい'],
    },
    {
      typeKey: 'career_learning',
      labels: ['AI時代に置いていかれないように学びたい', '勉強会で実践イメージをつかみたい', 'AI講座で体系的に学びたい'],
    },
  ];
  const matched = priority.find((rule) => hasAny(labels, rule.labels));
  return configs.find((config) => config.type_key === (matched?.typeKey ?? 'career_learning')) ?? configs[0];
}

function optionTagsByLabel(questions: DiagnosisQuestion[]): Map<string, string[]> {
  const tags = new Map<string, string[]>();
  for (const question of questions) {
    const options = JSON.parse(question.options || '[]') as DiagnosisOption[];
    for (const option of options) {
      if (option.tags?.length) tags.set(option.label, option.tags);
    }
  }
  return tags;
}

function diagnosisTags(result: DiagnosisConfig, labels: string[], questions: DiagnosisQuestion[]): string[] {
  const optionTags = optionTagsByLabel(questions);
  const tags = new Set<string>(['診断_完了', result.tag_name]);
  for (const label of labels) {
    for (const tag of optionTags.get(label) ?? []) tags.add(tag);
  }
  return [...tags];
}

export function scoreDiagnosis(
  questions: DiagnosisQuestion[],
  configs: DiagnosisConfig[],
  answers: DiagnosisAnswerInput[],
): { result: DiagnosisConfig; scores: Record<string, number> } {
  const scores: Record<string, number> = Object.fromEntries(configs.map((c) => [c.type_key, 0]));
  const labels = answerLabels(questions, answers);
  for (const label of labels) {
    const typeKey = RESULT_SCORE_BY_LABEL[label] ?? 'overview';
    scores[typeKey] = (scores[typeKey] ?? 0) + 1;
  }
  const result = pickPriorityResult(labels, configs);
  scores[result.type_key] = Math.max(scores[result.type_key] ?? 0, 1);

  return { result, scores };
}

export async function saveDiagnosisResult(
  db: D1Database,
  input: {
    lineUserId?: string | null;
    answers: DiagnosisAnswerInput[];
  },
): Promise<{ result: DiagnosisConfig; scores: Record<string, number>; friendName: string | null }> {
  const settings = await getDiagnosisSettings(db);
  if (settings.questions.length === 0 || settings.configs.length === 0) {
    await applyAiDiagnosisConfig(db, DEFAULT_AI_DIAGNOSIS_CONFIG);
    const refreshed = await getDiagnosisSettings(db);
    settings.questions = refreshed.questions;
    settings.configs = refreshed.configs;
  }

  const { result, scores } = scoreDiagnosis(settings.questions, settings.configs, input.answers);
  const friend = input.lineUserId ? await getFriendByLineUserId(db, input.lineUserId) : null;
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO diagnosis_results (
        id, user_id, friend_id, line_user_id, diagnosis_type, result_key,
        result_label, score, answers, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      friend?.user_id ?? null,
      friend?.id ?? null,
      input.lineUserId ?? null,
      result.type_key,
      result.type_key,
      result.label,
      JSON.stringify(scores),
      JSON.stringify(input.answers),
      now,
    )
    .run();

  if (friend) {
    const labels = answerLabels(settings.questions, input.answers);
    const tagNames = diagnosisTags(result, labels, settings.questions);
    const tags = await getTags(db);
    for (const tagName of tagNames) {
      let tag = tags.find((t) => t.name === tagName);
      if (!tag) tag = await createTag(db, { name: tagName, color: tagName === result.tag_name ? result.color : '#14b8a6' });
      await addTagToFriend(db, friend.id, tag.id);
    }
  }

  return { result, scores, friendName: friend?.display_name ?? null };
}
