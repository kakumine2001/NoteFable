import { fitMarkdownBlocksToNote } from "@/lib/answer-export";
import { isLocale, type Locale } from "@/lib/i18n/locale";
import { MAX_NOTE_TITLE } from "@/lib/note-document";
import { MENTION_PAGE_ID, pageMention } from "@/lib/note-mention";

// 復習・クイズモード（#154 PR 13）の型・検証・採点・復習ノート生成。
// データベースの表を増やさず、出題結果はクライアントのセッション内だけで保持し、「保存」時だけ通常のノート（aiUpdatedAt 付き）を作る。

export const QUIZ_TYPES = ["mcq", "true_false", "fill_blank", "flashcard"] as const;
export type QuizQuestionType = (typeof QUIZ_TYPES)[number];

export const MIN_QUIZ_COUNT = 3;
export const MAX_QUIZ_COUNT = 20;
export const DEFAULT_QUIZ_COUNT = 8;
export const QUIZ_COUNT_PRESETS = [5, 8, 12, 15] as const;

export type QuizLanguage = "auto" | Locale;

export type QuizOptions = {
  count: number;
  types: QuizQuestionType[];
  language: QuizLanguage;
};

export type McqQuestion = {
  id: string;
  type: "mcq";
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
};

export type TrueFalseQuestion = {
  id: string;
  type: "true_false";
  prompt: string;
  correct: boolean;
  explanation: string;
};

export type FillBlankQuestion = {
  id: string;
  type: "fill_blank";
  prompt: string;
  acceptedAnswers: string[];
  explanation: string;
};

export type FlashcardQuestion = {
  id: string;
  type: "flashcard";
  front: string;
  back: string;
  explanation?: string;
};

export type QuizQuestion = McqQuestion | TrueFalseQuestion | FillBlankQuestion | FlashcardQuestion;

export type ReviewQuiz = {
  title: string;
  questions: QuizQuestion[];
};

export type ReviewNoteLabels = {
  noteTitle?: string;
  sourceLabel?: string;
  answerLabel?: string;
  explanationLabel?: string;
  trueLabel?: string;
  falseLabel?: string;
  typeLabels?: Partial<Record<QuizQuestionType, string>>;
};

export const MAX_QUIZ_TITLE_CHARS = 120;
const MAX_PROMPT_CHARS = 1_500;
const MAX_OPTION_CHARS = 400;
const MAX_ANSWER_CHARS = 300;
const MAX_EXPLANATION_CHARS = 2_000;
const MAX_MCQ_OPTIONS = 6;
const MIN_MCQ_OPTIONS = 2;
const MAX_ACCEPTED_ANSWERS = 10;
const MAX_LABEL_CHARS = 120;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const cleanText = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  const clipped = normalized.slice(0, max).trim();
  return clipped || null;
};

const cleanOptionalText = (value: unknown, max: number): string | null => {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  return value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max).trim();
};

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

export function isQuizQuestionType(value: unknown): value is QuizQuestionType {
  return typeof value === "string" && (QUIZ_TYPES as readonly string[]).includes(value);
}

export function defaultQuizOptions(): QuizOptions {
  return { count: DEFAULT_QUIZ_COUNT, types: [...QUIZ_TYPES], language: "auto" };
}

export function parseQuizOptions(raw: unknown): QuizOptions | null {
  if (!isObject(raw)) return null;
  const count = raw.count;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < MIN_QUIZ_COUNT || count > MAX_QUIZ_COUNT) return null;
  if (!Array.isArray(raw.types) || !raw.types.length || raw.types.length > QUIZ_TYPES.length) return null;
  const seen = new Set<QuizQuestionType>();
  for (const item of raw.types) {
    if (!isQuizQuestionType(item)) return null;
    seen.add(item);
  }
  if (!seen.size) return null;
  const types = QUIZ_TYPES.filter((type) => seen.has(type));
  const languageRaw = raw.language === undefined ? "auto" : raw.language;
  if (languageRaw !== "auto" && !isLocale(languageRaw)) return null;
  return { count, types, language: languageRaw };
}

// 1 問分の構造を厳格に検証する。allowedTypes が指定されたときは、要求外の題型を弾く。
function parseQuestion(raw: unknown, index: number, allowedTypes?: ReadonlySet<QuizQuestionType>): QuizQuestion | null {
  if (!isObject(raw) || !isQuizQuestionType(raw.type)) return null;
  if (allowedTypes && !allowedTypes.has(raw.type)) return null;
  const id = `q${index + 1}`;
  switch (raw.type) {
    case "mcq": {
      const prompt = cleanText(raw.prompt, MAX_PROMPT_CHARS);
      const explanation = cleanOptionalText(raw.explanation, MAX_EXPLANATION_CHARS);
      if (!prompt || explanation === null || !Array.isArray(raw.options)) return null;
      if (raw.options.length < MIN_MCQ_OPTIONS || raw.options.length > MAX_MCQ_OPTIONS) return null;
      const options: string[] = [];
      const uniqueNormalized = new Set<string>();
      for (const item of raw.options) {
        const option = cleanText(item, MAX_OPTION_CHARS);
        if (!option) return null;
        options.push(option);
        uniqueNormalized.add(normalizeAnswerText(option) || option.toLowerCase());
      }
      if (uniqueNormalized.size !== options.length) return null;
      const correctIndex = raw.correctIndex;
      if (typeof correctIndex !== "number" || !Number.isSafeInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) return null;
      return { id, type: "mcq", prompt, options, correctIndex, explanation };
    }
    case "true_false": {
      const prompt = cleanText(raw.prompt, MAX_PROMPT_CHARS);
      const explanation = cleanOptionalText(raw.explanation, MAX_EXPLANATION_CHARS);
      if (!prompt || explanation === null || typeof raw.correct !== "boolean") return null;
      return { id, type: "true_false", prompt, correct: raw.correct, explanation };
    }
    case "fill_blank": {
      const prompt = cleanText(raw.prompt, MAX_PROMPT_CHARS);
      const explanation = cleanOptionalText(raw.explanation, MAX_EXPLANATION_CHARS);
      if (!prompt || explanation === null || !Array.isArray(raw.acceptedAnswers)) return null;
      if (!raw.acceptedAnswers.length || raw.acceptedAnswers.length > MAX_ACCEPTED_ANSWERS) return null;
      const acceptedAnswers: string[] = [];
      const seen = new Set<string>();
      for (const item of raw.acceptedAnswers) {
        const answer = cleanText(item, MAX_ANSWER_CHARS);
        if (!answer) return null;
        const key = normalizeAnswerText(answer);
        if (!seen.has(key)) {
          seen.add(key);
          acceptedAnswers.push(answer);
        }
      }
      if (!acceptedAnswers.length) return null;
      return { id, type: "fill_blank", prompt, acceptedAnswers, explanation };
    }
    case "flashcard": {
      const front = cleanText(raw.front, MAX_PROMPT_CHARS);
      const back = cleanText(raw.back, MAX_EXPLANATION_CHARS);
      const explanation = cleanOptionalText(raw.explanation, MAX_EXPLANATION_CHARS);
      if (!front || !back || explanation === null) return null;
      return explanation ? { id, type: "flashcard", front, back, explanation } : { id, type: "flashcard", front, back };
    }
  }
}

function stripOuterJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

// 「以上都是 / All of the above」のような位置に依存する選択肢。シャッフル時も末尾に留める。
const POSITION_DEPENDENT_OPTION_PATTERNS: readonly RegExp[] = [
  /^(?:all|none)\s+of\s+the\s+(?:above|preceding|following)(?:\s+(?:options?|choices?|answers?|statements?))?$/,
  /^(?:all|none)\s+of\s+these(?:\s+(?:options?|choices?|answers?))?$/,
  /^(?:以上|上述)(?:全|全都|都|皆|均)?(?:是|对|對|正确|正確|符合|成立|不是|不对|不對|非|错|錯|都不对|都不對|都不是|皆是|皆非|皆不是|皆正确|皆正確|均是|均不是|均不对|均不對|正确选项|正確選項)$/,
  /^(?:(?:上記|以上)の(?:すべて|全て|どれも|いずれ)(?:が正しい|が当てはまる|に当てはまる|でもない|も当てはまらない|も正しくない)?|すべて(?:正しい|当てはまる)|全て(?:正しい|当てはまる)|どれも(?:当てはまらない|正しくない)|該当(?:なし|しない))$/,
  /^(?:(?:위의\s*)?(?:모두(?:\s*(?:해당|맞다|옳다|정답|아니다))?|해당\s*없음|어느\s*것도\s*(?:아니다|해당하지\s*않는다)))$/,
  /^(?:todas?|ningun[ao]?)\s+(?:de\s+)?las\s+(?:anteriores|opciones\s+anteriores|respuestas\s+anteriores)$/,
  /^(?:toutes?|aucune?)\s+(?:(?:les|des)\s+(?:reponses?|options?|choix)\s+)?(?:ci-dessus|precedentes?)$/,
  /^(?:toutes?|aucune?)\s+(?:de\s+)?ces\s+(?:reponses?|options?)$/,
  /^(?:alle|keine)\s+(?:der\s+)?oben\s+genannten(?:\s+(?:antworten|optionen|aussagen))?$/,
  /^(?:alles\s+oben\s+genannte|nichts\s+davon|alle\s+genannten|keine\s+davon)$/,
  /^(?:todas?|nenhuma?)\s+(?:as|das)\s+(?:anteriores|opcoes\s+anteriores|respostas\s+anteriores|acima)$/,
  /^(?:tutte|nessuna)\s+(?:le|delle)\s+(?:precedenti|risposte\s+precedenti|opzioni\s+precedenti)$/,
  /^(?:все|всё|ничего\s+из|ни\s+один\s+из|ни\s+одна\s+из)\s+(?:вышеперечисленн\p{L}+|перечисленн\p{L}+)$/u,
  /^(?:semua|tidak\s+ada|tidak\s+satu\s+pun)\s+(?:jawaban\s+|pilihan\s+)?(?:di\s+atas|yang\s+benar|di\s+atas\s+yang\s+benar)$/,
  /^(?:tat\s+ca|khong\s+co)\s+(?:cac\s+)?(?:[dđ]ap\s+an|lua\s+chon|phuong\s+an|[dđ]ieu|y)\s+(?:tren|o\s+tren|nao\s+[dđ]ung)$/,
  /^(?:yukar[iı]dakilerin\s+(?:hepsi|tamam[iı]|hicbiri)|hepsi|hicbiri)$/,
  /^(?:ถูกทุกข้อ|ผิดทุกข้อ|ไม่มีข้อใดถูก|ทั้งหมดที่กล่าวมา|ไม่ถูกสักข้อ)$/,
  /^(?:उपरोक्त\s+सभी|उपर्युक्त\s+सभी|उपरोक्त\s+में\s+से\s+कोई\s+नहीं|इनमें\s+से\s+कोई\s+नहीं)$/,
  /^(?:جميع\s+ما\s+سبق|كل\s+ما\s+سبق|لا\s+شيء\s+مما\s+سبق|ليس\s+أيا?\s+مما\s+سبق)$/,
];

export function isPositionDependentOption(option: string): boolean {
  const normalized = normalizeAnswerText(option);
  if (!normalized) return false;
  const plain = stripDiacritics(normalized);
  return POSITION_DEPENDENT_OPTION_PATTERNS.some((pattern) => pattern.test(normalized) || pattern.test(plain));
}

// 選択問題の選択肢を Fisher-Yates でシャッフルし、correctIndex を追従させる。位置依存の選択肢は末尾に固定する。
export function shuffleMcqQuestion(question: McqQuestion, random: () => number = Math.random): McqQuestion {
  const entries = question.options.map((text, index) => ({
    text,
    isCorrect: index === question.correctIndex,
    pinned: isPositionDependentOption(text),
  }));
  const regular = entries.filter((entry) => !entry.pinned);
  const pinned = entries.filter((entry) => entry.pinned);
  for (let i = regular.length - 1; i > 0; i--) {
    const raw = random();
    const value = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 1 - Number.EPSILON) : 0;
    const j = Math.min(i, Math.floor(value * (i + 1)));
    [regular[i], regular[j]] = [regular[j], regular[i]];
  }
  const ordered = [...regular, ...pinned];
  const correctIndex = ordered.findIndex((entry) => entry.isCorrect);
  return {
    ...question,
    options: ordered.map((entry) => entry.text),
    correctIndex,
  };
}

// モデルの返答（JSON 文字列）を厳格に検証する。壊れている・空・要求外の題型が混ざっているときは null（呼び出し側が額度を戻す）。
// 選択問題はトークン署名・返却の前に選択肢をシャッフルし、正解が先頭に偏らないようにする。
export function parseQuizReply(
  raw: string,
  options: QuizOptions,
  fallbackTitle: string,
  random: () => number = Math.random,
): ReviewQuiz | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripOuterJsonFence(raw));
  } catch {
    return null;
  }
  if (!isObject(parsed) || !Array.isArray(parsed.questions) || !parsed.questions.length) return null;
  if (parsed.questions.length > MAX_QUIZ_COUNT + 5) return null;
  const allowed = new Set<QuizQuestionType>(options.types);
  const validated: QuizQuestion[] = [];
  for (let i = 0; i < parsed.questions.length; i++) {
    const question = parseQuestion(parsed.questions[i], i, allowed);
    if (!question) return null;
    validated.push(question);
  }
  const questions = validated
    .slice(0, options.count)
    .map((question) => (question.type === "mcq" ? shuffleMcqQuestion(question, random) : question));
  if (!questions.length) return null;
  const rawTitle = cleanText(parsed.title, MAX_QUIZ_TITLE_CHARS);
  const title = oneLine(rawTitle || fallbackTitle || "Review quiz").slice(0, MAX_QUIZ_TITLE_CHARS).trim() || "Review quiz";
  return { title, questions };
}

// クライアントから送られてきたクイズ本体（ノート保存・通報）を厳格に検証・正規化する。
export function validateReviewQuiz(raw: unknown): ReviewQuiz | null {
  if (!isObject(raw) || !Array.isArray(raw.questions) || !raw.questions.length || raw.questions.length > MAX_QUIZ_COUNT) return null;
  const title = cleanText(raw.title, MAX_QUIZ_TITLE_CHARS);
  if (!title) return null;
  const questions: QuizQuestion[] = [];
  for (let i = 0; i < raw.questions.length; i++) {
    const question = parseQuestion(raw.questions[i], i);
    if (!question) return null;
    questions.push(question);
  }
  const normalizedTitle = oneLine(title).slice(0, MAX_QUIZ_TITLE_CHARS).trim();
  if (!normalizedTitle) return null;
  return { title: normalizedTitle, questions };
}

// 署名付き通報トークンのダイジェスト検証用に、キー順と項目を固定した正規 JSON を作る。
export function canonicalQuizJson(quiz: ReviewQuiz): string {
  const normalized = {
    title: oneLine(quiz.title).slice(0, MAX_QUIZ_TITLE_CHARS).trim(),
    questions: quiz.questions.map((q, index) => {
      const id = `q${index + 1}`;
      switch (q.type) {
        case "mcq":
          return { id, type: q.type, prompt: q.prompt, options: q.options, correctIndex: q.correctIndex, explanation: q.explanation };
        case "true_false":
          return { id, type: q.type, prompt: q.prompt, correct: q.correct, explanation: q.explanation };
        case "fill_blank":
          return { id, type: q.type, prompt: q.prompt, acceptedAnswers: q.acceptedAnswers, explanation: q.explanation };
        case "flashcard":
          return q.explanation
            ? { id, type: q.type, front: q.front, back: q.back, explanation: q.explanation }
            : { id, type: q.type, front: q.front, back: q.back };
      }
    }),
  };
  return JSON.stringify(normalized);
}

// 填空題の自動判定用の正規化：NFKC・小文字化・連続空白の圧縮・前後の句読点や引用符の除去（区間や数式で意味を持つ () [] {} は残す）。
export function normalizeAnswerText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.,!?;:'"“”‘’。、！？；：「」『』《》]+|[.,!?;:'"“”‘’。、！？；：「」『』《》]+$/g, "")
    .trim();
}

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function isFillBlankCorrect(input: string, acceptedAnswers: readonly string[]): boolean {
  const normalized = normalizeAnswerText(input);
  if (!normalized) return false;
  const plain = stripDiacritics(normalized);
  for (const candidate of acceptedAnswers) {
    const target = normalizeAnswerText(candidate);
    if (!target) continue;
    if (normalized === target || plain === stripDiacritics(target)) return true;
  }
  return false;
}

export function parseReviewNoteLabels(raw: unknown): ReviewNoteLabels {
  if (!isObject(raw)) return {};
  const pick = (value: unknown, max = MAX_LABEL_CHARS) => {
    const text = cleanText(value, max);
    return text ? oneLine(text) : undefined;
  };
  const rawTypes = isObject(raw.typeLabels) ? raw.typeLabels : null;
  const typeLabels: Partial<Record<QuizQuestionType, string>> = {};
  if (rawTypes) {
    for (const type of QUIZ_TYPES) {
      const label = pick(rawTypes[type], 60);
      if (label) typeLabels[type] = label;
    }
  }
  return {
    noteTitle: pick(raw.noteTitle, MAX_NOTE_TITLE),
    sourceLabel: pick(raw.sourceLabel, 60),
    answerLabel: pick(raw.answerLabel, 60),
    explanationLabel: pick(raw.explanationLabel, 60),
    trueLabel: pick(raw.trueLabel, 40),
    falseLabel: pick(raw.falseLabel, 40),
    ...(Object.keys(typeLabels).length ? { typeLabels } : {}),
  };
}

const DEFAULT_TYPE_LABELS: Record<QuizQuestionType, string> = {
  mcq: "Multiple choice",
  true_false: "True / False",
  fill_blank: "Fill in the blank",
  flashcard: "Flashcard",
};

// 段落内の先頭記号が別ブロック（見出し・リスト・トグル・表など）に誤認されないよう無害化し、インラインの数式は残す。
function safeParagraphLines(text: string, indent = ""): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n").map((raw) => {
    const line = raw.trim();
    if (!line) return "";
    const escaped = /^(#{1,6}(\s|$)|[-*+](\s|$)|\d+[.)](\s|$)|>|\||▸(\s|$)|`{3}|(-{3,}|_{3,}|\*{3,})$|\[toc\]$)/i.test(line)
      ? `\\${line}`
      : line;
    return `${indent}${escaped}`;
  }).filter(Boolean);
}

function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

// クイズを通常のノート（見出し・箇条書き・折りたたみブロック）へ変換する。
// 答えと解説は ▸ トグルブロックの中に収め、復習時に自分で開いて確認できるようにする。
export function quizToReviewNoteContent(
  quiz: ReviewQuiz,
  labels: ReviewNoteLabels = {},
  source?: { pageId: string; title: string },
) {
  const answerLabel = labels.answerLabel || "Answer";
  const explanationLabel = labels.explanationLabel || "Explanation";
  const trueLabel = labels.trueLabel || "True";
  const falseLabel = labels.falseLabel || "False";
  const sourceLabel = labels.sourceLabel || "Source";
  const typeLabel = (type: QuizQuestionType) => labels.typeLabels?.[type] || DEFAULT_TYPE_LABELS[type];
  const noteTitle = oneLine(labels.noteTitle || quiz.title || "Review quiz").slice(0, MAX_NOTE_TITLE) || "Review quiz";

  const lines: string[] = [];
  quiz.questions.forEach((question, index) => {
    lines.push(`## ${index + 1}. ${typeLabel(question.type)}`);
    if (question.type === "mcq") {
      lines.push(...safeParagraphLines(question.prompt));
      question.options.forEach((option, optIndex) => {
        lines.push(`- ${optionLetter(optIndex)}. ${oneLine(option)}`);
      });
      const correct = question.options[question.correctIndex] ?? "";
      lines.push(`▸ ${answerLabel}`);
      lines.push(`  - **${answerLabel}:** ${optionLetter(question.correctIndex)}. ${oneLine(correct)}`);
      if (question.explanation) {
        lines.push(`  - **${explanationLabel}:** ${oneLine(question.explanation)}`);
      }
    } else if (question.type === "true_false") {
      lines.push(...safeParagraphLines(question.prompt));
      lines.push(`- ${trueLabel}`);
      lines.push(`- ${falseLabel}`);
      lines.push(`▸ ${answerLabel}`);
      lines.push(`  - **${answerLabel}:** ${question.correct ? trueLabel : falseLabel}`);
      if (question.explanation) {
        lines.push(`  - **${explanationLabel}:** ${oneLine(question.explanation)}`);
      }
    } else if (question.type === "fill_blank") {
      lines.push(...safeParagraphLines(question.prompt));
      lines.push(`▸ ${answerLabel}`);
      lines.push(`  - **${answerLabel}:** ${question.acceptedAnswers.map(oneLine).join(" / ")}`);
      if (question.explanation) {
        lines.push(`  - **${explanationLabel}:** ${oneLine(question.explanation)}`);
      }
    } else {
      lines.push(...safeParagraphLines(question.front));
      lines.push(`▸ ${answerLabel}`);
      const backLines = safeParagraphLines(question.back, "  ");
      if (backLines.length) lines.push(...backLines);
      if (question.explanation) {
        lines.push(`  - **${explanationLabel}:** ${oneLine(question.explanation)}`);
      }
    }
    lines.push("");
  });

  const { blocks: bodyBlocks } = fitMarkdownBlocksToNote(noteTitle, lines.join("\n"));
  if (!source || !MENTION_PAGE_ID.test(source.pageId)) return { title: noteTitle, blocks: bodyBlocks };
  const sourceBlock = {
    id: crypto.randomUUID(),
    type: "paragraph",
    props: {},
    content: [
      { type: "text", text: `${sourceLabel}: `, styles: { textColor: "gray" } },
      pageMention(source.pageId, oneLine(source.title) || "Untitled"),
    ],
    children: [],
  };
  const countBlockTree = (list: readonly unknown[]): number =>
    list.reduce<number>((sum, item) => {
      const children = isObject(item) && Array.isArray(item.children) ? item.children : [];
      return sum + 1 + countBlockTree(children);
    }, 0);
  const trimmed = [...bodyBlocks];
  while (trimmed.length > 0 && countBlockTree(trimmed) >= 2_000) {
    trimmed.pop();
  }
  return { title: noteTitle, blocks: [sourceBlock, ...trimmed] };
}

// 通報メール用の読みやすいプレーンテキスト表現。
export function formatQuizForReport(quiz: ReviewQuiz): string {
  const lines: string[] = [`Quiz title: ${quiz.title}`, ""];
  quiz.questions.forEach((q, index) => {
    lines.push(`[${index + 1}] (${q.type})`);
    if (q.type === "mcq") {
      lines.push(`Prompt: ${q.prompt}`);
      q.options.forEach((option, optIndex) => {
        lines.push(`  ${optionLetter(optIndex)}${optIndex === q.correctIndex ? "*" : ""}: ${option}`);
      });
      if (q.explanation) lines.push(`Explanation: ${q.explanation}`);
    } else if (q.type === "true_false") {
      lines.push(`Prompt: ${q.prompt}`);
      lines.push(`Correct: ${q.correct ? "True" : "False"}`);
      if (q.explanation) lines.push(`Explanation: ${q.explanation}`);
    } else if (q.type === "fill_blank") {
      lines.push(`Prompt: ${q.prompt}`);
      lines.push(`Accepted answers: ${q.acceptedAnswers.join(" | ")}`);
      if (q.explanation) lines.push(`Explanation: ${q.explanation}`);
    } else {
      lines.push(`Front: ${q.front}`);
      lines.push(`Back: ${q.back}`);
      if (q.explanation) lines.push(`Explanation: ${q.explanation}`);
    }
    lines.push("");
  });
  return lines.join("\n").trim();
}
