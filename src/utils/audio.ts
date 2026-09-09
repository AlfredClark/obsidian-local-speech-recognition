/** 识别管线统一采样率：offline-websocket 协议头填写此值，服务端按此解析 */
export const TARGET_SAMPLE_RATE = 16000;

/** offline-websocket 二进制分片上限：与官方 Python 客户端的 10240 保持一致 */
export const WS_CHUNK_BYTES = 10240;

/** 采集回调的脚本处理缓冲帧数：4096 在延迟与回调频率间折中 */
export const CAPTURE_BUFFER_SIZE = 4096;

/**
 * 单声道浮点采样线性重采样。
 * 麦克风原始采样率（48k/44.1k）与管线采样率不一致时做归一，避免服务端重采样负担。
 * @param input 原始单声道采样
 * @param fromRate 原始采样率
 * @param toRate 目标采样率，默认 16k
 * @returns 重采样后的新数组；同采样率时返回切片，避免调用方意外修改原数组
 */
export function downsampleFloat32Mono(
  input: Float32Array,
  fromRate: number,
  toRate: number = TARGET_SAMPLE_RATE,
): Float32Array {
  if (input.length === 0) return new Float32Array(0);
  if (fromRate === toRate) return input.slice();
  const outputLength = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const output = new Float32Array(outputLength);
  if (outputLength === 1) {
    output[0] = input[0] ?? 0;
    return output;
  }
  const ratio = input.length / outputLength;
  for (let i = 0; i < outputLength; i++) {
    const pos = i * ratio;
    const low = Math.floor(pos);
    const high = Math.min(low + 1, input.length - 1);
    const frac = pos - low;
    const lowValue = input[low] ?? 0;
    const highValue = input[high] ?? 0;
    output[i] = lowValue + (highValue - lowValue) * frac;
  }
  return output;
}

/**
 * 浮点采样转 16-bit PCM：管线内统一用 Int16 累积，保证“16-bit 单声道”需求可验证。
 * @param input 取值 [-1, 1] 的浮点采样
 * @returns 16-bit PCM 数组
 */
export function float32ToInt16Pcm(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const clamped = Math.max(-1, Math.min(1, input[i] ?? 0));
    output[i] = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
  }
  return output;
}

/**
 * 16-bit PCM 转归一化浮点：offline-websocket 协议体要求 float32 LE，特在此桥接。
 * @param input 16-bit PCM 数组
 * @returns 取值 [-1, 1] 的浮点数组
 */
export function int16ToFloat32Normalized(input: Int16Array): Float32Array {
  const output = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    output[i] = (input[i] ?? 0) / 32768;
  }
  return output;
}

/**
 * 合并采集回调的 Int16 分片：录音结束时一次性组包，避免发送阶段多次拷贝。
 * @param chunks 采集回调累积的分片
 * @returns 连续 PCM 数组；空输入返回空数组
 */
export function mergeInt16Chunks(chunks: Array<Int16Array>): Int16Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const output = new Int16Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

/**
 * 组装 offline-websocket 请求体：8 字节小端头（采样率 + 数据字节数）+ float32 LE 数据。
 * 协议与官方 sequential 客户端一致：sampleRate 可任意，本管线统一填 16k。
 * @param sampleRate 采样率，本管线传 TARGET_SAMPLE_RATE
 * @param pcmFloat32 归一化单声道浮点采样
 * @returns 可直接切片发送的二进制体
 */
export function buildOfflineWsPayload(sampleRate: number, pcmFloat32: Float32Array): Uint8Array {
  const buffer = new ArrayBuffer(8 + pcmFloat32.length * 4);
  const view = new DataView(buffer);
  view.setUint32(0, sampleRate, true);
  view.setUint32(4, pcmFloat32.length * 4, true);
  for (let i = 0; i < pcmFloat32.length; i++) {
    view.setFloat32(8 + i * 4, pcmFloat32[i] ?? 0, true);
  }
  return new Uint8Array(buffer);
}
