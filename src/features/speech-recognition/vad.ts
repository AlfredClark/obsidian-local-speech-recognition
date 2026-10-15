/** 有声阈值：RMS 达到此值视为出现过语音，解锁尾部静音停 */
const SPEECH_RMS = 0.04;

/** 静音阈值：低于此值累计静音时长，迟滞区间防阈值抖动误杀 */
const SILENCE_RMS = 0.02;

/** 前导静音上限毫秒：全程无语音达到此时长自动收尾（走无音频提示） */
const LEADING_SILENCE_LIMIT_MS = 8000;

/** 默认尾部静音毫秒：见过语音后持续静音达到此时长自动收尾走识别 */
const DEFAULT_TRAILING_SILENCE_MS = 1800;

/** 起步保护毫秒：按下瞬间底噪不参与判定 */
const WARMUP_MS = 500;

/** VAD 累积状态：调用方持有，逐分片传入更新 */
export interface VadState {
  /** 是否出现过语音 */
  speechSeen: boolean;
  /** 已录音毫秒（含保护期） */
  elapsedMs: number;
  /** 当前连续静音毫秒 */
  silenceMs: number;
}

/** 新建 VAD 累积状态：每轮录音开始时重置 */
export function createVadState(): VadState {
  return { speechSeen: false, elapsedMs: 0, silenceMs: 0 };
}

/**
 * 逐分片更新静音判断：迟滞双阈值 + 前导/尾部双超时，达线返回 true。
 * 纯函数，调用方据此决定是否调 stopAndTranscribe；误判代价仅为提前收尾，不丢已录音频。
 * @param state 累积状态（原地更新）
 * @param rms 本分片 RMS 电平
 * @param chunkMs 本分片时长毫秒
 * @param trailingMs 尾部静音阈值毫秒，默认 1800（对应设置项“静音时间”）
 * @returns 是否达到自动停止条件
 */
export function updateVad(state: VadState, rms: number, chunkMs: number, trailingMs = DEFAULT_TRAILING_SILENCE_MS): boolean {
  state.elapsedMs += chunkMs;
  // 起步保护期内只计时，不判定
  if (state.elapsedMs <= WARMUP_MS) return false;
  if (rms >= SPEECH_RMS) {
    state.speechSeen = true;
    state.silenceMs = 0;
    return false;
  }
  if (rms >= SILENCE_RMS) {
    // 迟滞区间：不累计不清零，等明确有声或明确静音再结算，避免阈值抖动误杀
    return false;
  }
  state.silenceMs += chunkMs;
  if (!state.speechSeen) {
    return state.silenceMs >= LEADING_SILENCE_LIMIT_MS;
  }
  return state.silenceMs >= trailingMs;
}
