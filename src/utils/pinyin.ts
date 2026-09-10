import { pinyin } from "pinyin-pro";

/**
 * 中文词语转拼音：无声调、空格分隔、ü 转 v、非汉字移除。
 * @param text 待转换的文本
 * @returns 转换后的拼音字符串；空输入返回空串
 */
export function toPinyin(text: string): string {
  // 非汉字连续段本身可能含空格，转换结果会出现连续空白，统一折叠为单空格
  return pinyin(text, { toneType: "none", v: true, nonZh: "removed" }).replace(/\s+/g, " ").trim();
}
