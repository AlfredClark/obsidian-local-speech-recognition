/** 模型输出前缀：Qwen3-ASR 的 text 偶带语言标记，正则锚定行首且须含 <asr_text> 才剥离 */
const MODEL_PREFIX_PATTERN = /^language [^<]*<asr_text>/;

/**
 * 剥离模型输出前缀：命中才改写，未命中原文返回，避免误伤正常口述。
 * @param text 待清洗的识别文本
 * @returns 去前缀后的文本
 */
export function stripModelPrefix(text: string): string {
  return text.replace(MODEL_PREFIX_PATTERN, "");
}
