/** 词库 feature 模块对外类型 */

/** 识别文本中命中词库拼音的片段；keys 为该片段命中的拼音键，点击时据此解析候选词 */
export interface LexiconTarget {
  from: number;
  to: number;
  keys: string[];
  /** 该片段的识别原文；优先词库模式下替换后仍以此作菜单最后一项兜底 */
  original: string;
}
