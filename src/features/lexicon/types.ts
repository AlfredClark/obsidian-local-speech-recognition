/** 词库 feature 模块对外类型 */

/** 识别文本中命中词库拼音的片段；keys 为该片段命中的拼音键，点击时据此解析候选词 */
export interface LexiconTarget {
  from: number;
  to: number;
  keys: string[];
}
