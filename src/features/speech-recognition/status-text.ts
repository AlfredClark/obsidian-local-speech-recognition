import type { NotificationMode } from "../../cores/settings/types";

/** 交付结果形态：inserted 有编辑器内容为证，clipboard 写入不可见 */
export type DeliveryOutcome = "inserted" | "clipboard";

/** 电平条字符：填充块与底块，固定宽度下对比明显 */
const LEVEL_FILL = "█";
const LEVEL_EMPTY = "░";

/** 电平条默认宽度：状态栏里够醒目又不占地方 */
const LEVEL_BAR_WIDTH = 8;

/** 状态栏录音标记：纯字符，不依赖主题样式 */
const RECORDING_MARK = "●";

/** 状态栏识别标记：纯字符，不依赖主题样式 */
const TRANSCRIBING_MARK = "◌";

/**
 * 秒数格式化为 mm:ss：录音上限 280 秒内够用，状态栏与通知共用。
 * @param totalSeconds 秒数
 * @returns 补零的 mm:ss
 */
export function formatElapsed(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * 电平渲染为固定宽度横条：填充数随电平增减，底块占位，变化比单字符明显。
 * @param level 0~1 的电平
 * @param width 横条宽度，默认 8
 * @returns 如 `████░░░░` 的横条
 */
export function levelToBar(level: number, width: number = LEVEL_BAR_WIDTH): string {
  const clamped = Math.min(1, Math.max(0, level));
  const filled = Math.round(clamped * width);
  return LEVEL_FILL.repeat(filled) + LEVEL_EMPTY.repeat(Math.max(0, width - filled));
}

/**
 * 单分片峰值电平：Int16 取绝对值峰值归一化，供状态栏电平指示用。
 * @param chunk 16kHz 单声道 Int16 分片
 * @returns 0~1 的电平
 */
export function chunkPeakLevel(chunk: Int16Array): number {
  if (chunk.length === 0) return 0;
  let peak = 0;
  for (let i = 0; i < chunk.length; i++) {
    const magnitude = Math.abs(chunk[i] ?? 0);
    if (magnitude > peak) peak = magnitude;
  }
  return peak / 32768;
}

/**
 * 录音中状态栏文本：标记 + 计时 + 电平条 + 状态名（最右），label 由调用方翻译传入。
 * @param elapsedSeconds 已录音秒数
 * @param level 0~1 的平滑电平
 * @param stateLabel 状态名（如“录音中”）
 * @returns 状态栏文本
 */
export function renderRecordingStatus(elapsedSeconds: number, level: number, stateLabel: string): string {
  return `${RECORDING_MARK} ${formatElapsed(elapsedSeconds)} ${levelToBar(level)} ${stateLabel}`;
}

/**
 * 识别中状态栏文本：标记 + 计时 + 状态名（最右），label 由调用方翻译传入。
 * @param elapsedSeconds 已识别秒数
 * @param stateLabel 状态名（如“识别中”）
 * @returns 状态栏文本
 */
export function renderTranscribingStatus(elapsedSeconds: number, stateLabel: string): string {
  return `${TRANSCRIBING_MARK} ${formatElapsed(elapsedSeconds)} ${stateLabel}`;
}

/**
 * 插入成功是否弹 Notice：剪贴板交付不可见，回执在三种模式下都弹；
 * 编辑器插入以内容为证，仅通知框模式弹。
 * @param mode 本轮快照的通知方式
 * @param outcome 交付结果形态
 * @returns 是否弹出成功通知
 */
export function shouldShowResultNotice(mode: NotificationMode, outcome: DeliveryOutcome): boolean {
  if (outcome === "clipboard") return true;
  return mode === "notice";
}
