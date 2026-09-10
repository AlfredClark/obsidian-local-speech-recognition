import { getInitialAndFinal } from "pinyin-pro";

/** 每个词条最多生成的变体拼写数（含原拼写），防止长词组合爆炸 */
export const MAX_FUZZY_VARIANTS = 32;

/** 声母易混组：平翘舌，组内互为变体 */
const INITIAL_GROUPS: readonly (readonly string[])[] = [
  ["zh", "z"],
  ["ch", "c"],
  ["sh", "s"],
];

/**
 * 韵母易混组：前后鼻音。ian/iang 与 uan/uang 需单列：
 * 拆出的韵母是整体形式（xian→ian、xiang→iang），不会被 ang/an 组命中。
 */
const FINAL_GROUPS: readonly (readonly string[])[] = [
  ["ang", "an"],
  ["eng", "en"],
  ["ing", "in"],
  ["iang", "ian"],
  ["uang", "uan"],
];

/** 统一 ü→v：存储拼音已做该转换，匹配时保持一致 */
function normalize(pinyin: string): string {
  return pinyin.replace(/ü/g, "v");
}

/** 取某声母/韵母所在易混组；不在任何组内时返回自身 */
function groupMembers(value: string, groups: readonly (readonly string[])[]): string[] {
  const group = groups.find((members) => members.includes(value));
  return group ? [...group] : [value];
}

/**
 * 单音节的全部易混拼写，原拼写固定排在首位（保证优先产出精确 key）。
 * 声母与韵母各自归入易混组后做笛卡尔组合，如 zhang → [zhang, zhan, zang, zan]。
 * @param syllable 单个音节拼音
 * @returns 变体拼写列表，首位为原拼写
 */
export function syllableVariants(syllable: string): string[] {
  const self = normalize(syllable);
  const { initial, final } = getInitialAndFinal(self);
  const variants: string[] = [];
  for (const head of groupMembers(initial, INITIAL_GROUPS)) {
    for (const tail of groupMembers(final, FINAL_GROUPS)) {
      const variant = head + tail;
      if (!variants.includes(variant)) variants.push(variant);
    }
  }
  const index = variants.indexOf(self);
  if (index > 0) {
    variants.splice(index, 1);
    variants.unshift(self);
  }
  return variants;
}

/**
 * 由空格分音节的拼音生成模糊变体 key（去空格拼接，与 map 的精确 key 同形态）。
 * 音节数与词语汉字数不符时（如手动录入的无空格拼音）无法可靠切分，返回空数组退化为精确匹配。
 * @param pinyin 词条拼音，音节以空格分隔
 * @param expectedSyllables 期望音节数，通常取词语的汉字数
 * @returns 变体 key 列表，原拼写组合在最前
 */
export function buildVariantKeys(pinyin: string, expectedSyllables: number): string[] {
  const syllables = pinyin
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((syllable) => syllable !== "");
  if (syllables.length === 0 || syllables.length !== expectedSyllables) return [];
  let combos = [""];
  for (const syllable of syllables) {
    const next: string[] = [];
    for (const prefix of combos) {
      for (const variant of syllableVariants(syllable)) {
        next.push(prefix + variant);
        if (next.length >= MAX_FUZZY_VARIANTS) break;
      }
      if (next.length >= MAX_FUZZY_VARIANTS) break;
    }
    combos = next;
  }
  return combos;
}
