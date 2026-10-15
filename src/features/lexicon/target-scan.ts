import { match } from "pinyin-pro";
import type { LexiconTarget } from "./types";

/**
 * 拼音匹配选项：every + lastPrecision every 保证整词严格命中（西安→xian 而不把「先」的尾音并入），
 * continuous 保证汉字下标连续，v 允许拼音 v 匹配 ü（词库存储格式已做 ü→v）。
 */
const MATCH_OPTIONS = { precision: "every", lastPrecision: "every", continuous: true, v: true } as const;

/** 片段必须是纯汉字：match 会把拉丁字符逐字母当拼音匹配（如 xiang 中命中 xian），需过滤 */
const HAN_ONLY = /^\p{Script=Han}+$/u;

/** 拼音映射表形态：与启用词条精确/模糊映射同构，调用方按需传入单张或多张 */
export type PinyinCandidatesMap = ReadonlyMap<string, readonly string[]>;

/**
 * 按拼音键取候选词：多表按传入顺序优先（精确表在前）、同表内保持权重降序；
 * 排除当前文本并去重。鼠标菜单、手柄导航与替换偏好共用此口径。
 * @param keys 片段命中的拼音键
 * @param current 当前文本，需从候选中排除
 * @param maps 待查的映射表，顺序即优先级
 * @returns 去重后的候选词列表
 */
export function collectCandidates(keys: string[], current: string, maps: PinyinCandidatesMap[]): string[] {
  // key 可能来自精确映射或模糊映射（data-keys 不区分来源），多张表都查并合并候选
  const candidates: string[] = [];
  for (const key of keys) {
    for (const map of maps) {
      for (const word of map.get(key) ?? []) {
        if (word !== current && !candidates.includes(word)) candidates.push(word);
      }
    }
  }
  return candidates;
}

/**
 * 按拼音键取首选词：与候选口径同序，不排除任何词；
 * 多键片段取首个非空结果。供优先词库模式决定替换显示用。
 * @param keys 片段命中的拼音键
 * @param maps 待查的映射表，顺序即优先级
 * @returns 首选词，无映射时返回 null
 */
export function pickPreferred(keys: string[], maps: PinyinCandidatesMap[]): string | null {
  for (const key of keys) {
    for (const map of maps) {
      const first = map.get(key)?.[0];
      if (first !== undefined) return first;
    }
  }
  return null;
}

/**
 * 扫描文本中与拼音键同音的片段：逐键经 pinyin-pro match 查找，过滤非纯汉字片段，
 * 跳过无替代项的片段（唯一候选与文本一致），同片段多音合并 keys，
 * 重叠片段按起点升序、同起点长者优先贪心保留（RangeSet 要求互不重叠）。
 * 先收集全部命中再贪心，结论与映射遍历顺序无关。
 * @param text 待扫描文本（本次识别插入的内容）
 * @param baseFrom 文本在文档中的起始位置
 * @param maps 待查的映射表（精确表必传，模糊开启时追加模糊表）
 * @returns 高亮目标列表
 */
export function scanTargets(text: string, baseFrom: number, maps: PinyinCandidatesMap[]): LexiconTarget[] {
  const spans = new Map<string, { start: number; end: number; keys: Set<string> }>();
  for (const map of maps) {
    for (const [key, words] of map) {
      let offset = 0;
      while (offset < text.length) {
        const indices = match(text.slice(offset), key, MATCH_OPTIONS);
        if (indices === null || indices.length === 0) break;
        const first = indices[0];
        const last = indices[indices.length - 1];
        if (first === undefined || last === undefined) break;
        const start = offset + first;
        const end = offset + last + 1;
        offset = end;
        const segment = text.slice(start, end);
        if (!HAN_ONLY.test(segment)) continue;
        // 无替代项：拼音成功匹配、词库中该拼音只有唯一候选、且候选与文本汉字完全一致时跳过，
        // 此时点击也没有其他词可选，高亮只会在正确的识别结果上产生无意义标记
        if (words.length === 1 && words[0] === segment) continue;
        const id = `${start},${end}`;
        const existing = spans.get(id);
        if (existing === undefined) {
          spans.set(id, { start, end, keys: new Set([key]) });
        } else {
          existing.keys.add(key);
        }
      }
    }
  }
  const sorted = [...spans.values()].sort((a, b) => a.start - b.start || b.end - a.end);
  const result: LexiconTarget[] = [];
  let lastEnd = -1;
  for (const span of sorted) {
    if (span.start < lastEnd) continue;
    lastEnd = span.end;
    result.push({
      from: baseFrom + span.start,
      to: baseFrom + span.end,
      keys: [...span.keys],
      original: text.slice(span.start, span.end),
    });
  }
  return result;
}
