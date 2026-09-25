/** 手柄输入 feature 模块对外类型 */

/** 候选会话中的高亮片段：from/to 为重建时的文档坐标，candidates 已排除当前文本 */
export interface GamepadCandidateSpan {
  from: number;
  to: number;
  keys: string[];
  original: string;
  candidates: string[];
}
