import type { LexiconEntry, LexiconEntryInput } from "./types";
import { toPinyin } from "../../utils/pinyin";

/** 导出文件的格式版本；导入时按需兼容旧版本 */
export const LEXICON_FILE_VERSION = 1;

/** 导出文件结构；不含 id，导入时由 IndexedDB 自增重新分配，保证文件可移植 */
interface LexiconFilePayload {
  version: number;
  exportedAt: string;
  entries: Array<Pick<LexiconEntry, "word" | "pinyin" | "weight" | "enable">>;
}

/** 解析结果：有效条目与因结构异常被丢弃的条数 */
export interface ParsedLexiconFile {
  /** 解析出的有效条目 */
  entries: LexiconEntryInput[];
  /** word 缺失/非字符串等无法修复而被丢弃的条数 */
  invalid: number;
}

/** 一行带权重的纯文本格式：`词语:123`，冒号后必须为纯数字 */
const TXT_WEIGHT_PATTERN = /^(.+):(\d+)$/;

/**
 * 将词条序列化为导出文件文本；不含 id，便于跨库导入。
 * @param entries 当前词库条目
 * @returns 带版本与导出时间的 JSON 文本
 */
export function serializeLexiconFile(entries: LexiconEntry[]): string {
  const payload: LexiconFilePayload = {
    version: LEXICON_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    entries: entries.map((entry) => ({
      word: entry.word,
      pinyin: entry.pinyin,
      weight: entry.weight,
      enable: entry.enable,
    })),
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * 解析 JSON 导入文本：兼容带 version/entries 的包装对象与裸条目数组。
 * 逐条归一化——word 缺失条目丢弃；pinyin 缺失时用 toPinyin 生成；
 * weight 非数字回退 0；enable 非布尔回退 true。
 * @param text 文件文本
 * @returns 有效条目与被丢弃条数
 */
export function parseLexiconJson(text: string): ParsedLexiconFile {
  const parsed: unknown = JSON.parse(text);
  let rawEntries: unknown[] | null = null;
  if (Array.isArray(parsed)) {
    rawEntries = parsed;
  } else if (typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { entries?: unknown }).entries)) {
    rawEntries = (parsed as { entries: unknown[] }).entries;
  }
  if (rawEntries === null) throw new Error("invalid lexicon file structure");
  const entries: LexiconEntryInput[] = [];
  let invalid = 0;
  for (const raw of rawEntries) {
    const entry = normalizeInput(raw);
    if (entry === null) {
      invalid += 1;
    } else {
      entries.push(entry);
    }
  }
  return { entries, invalid };
}

/**
 * 解析纯文本导入文本：每行一个词语，空行跳过；行尾 `:\d+` 作为整数权重，其余部分为词语，
 * 未带后缀时权重 0；拼音一律经 toPinyin 自动生成。
 * @param text 文件文本
 * @returns 有效条目（无因格式丢弃的条目）
 */
export function parseLexiconTxt(text: string): ParsedLexiconFile {
  const entries: LexiconEntryInput[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;
    const match = TXT_WEIGHT_PATTERN.exec(line);
    const word = match ? match[1] : line;
    if (word === undefined) continue;
    const weight = match ? Number.parseInt(match[2] ?? "0", 10) : 0;
    entries.push({ word, pinyin: toPinyin(word), weight, enable: true });
  }
  return { entries, invalid: 0 };
}

/** 归一化单条导入数据：无法修复的条目返回 null，缺失字段按默认值补齐 */
function normalizeInput(raw: unknown): LexiconEntryInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const { word, pinyin, weight, enable } = record;
  if (typeof word !== "string" || word.trim() === "") return null;
  const trimmedWord = word.trim();
  return {
    word: trimmedWord,
    pinyin: typeof pinyin === "string" && pinyin.trim() !== "" ? pinyin.trim() : toPinyin(trimmedWord),
    weight: typeof weight === "number" && Number.isFinite(weight) ? weight : 0,
    enable: typeof enable === "boolean" ? enable : true,
  };
}
