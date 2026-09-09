import { TARGET_SAMPLE_RATE, WS_CHUNK_BYTES, buildOfflineWsPayload } from "../../utils/audio";
import { resolveSherpaUrl } from "../../utils/sherpa-process";
import type { SherpaClientConfig, TranscriptionResult } from "./types";

/** 整句识别超时毫秒数：offline 模型整句解码可能耗时数十秒，取 60 秒兜底 */
const TRANSCRIBE_TIMEOUT_MS = 60000;

/**
 * 识别 16kHz 归一化浮点单声道音频：一次调用独占一个 WS 连接。
 * 协议与官方 sequential 客户端一致：分片发送 header+float32，收一次文本回包后发 Done 关闭。
 * @param samples 16kHz 归一化浮点单声道采样
 * @param config 服务端连接配置
 * @returns 识别文本与原始回包
 */
export function transcribePcm16k(samples: Float32Array, config: SherpaClientConfig): Promise<TranscriptionResult> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(resolveSherpaUrl(config.host, config.port));
    socket.binaryType = "arraybuffer";
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.close();
      reject(new Error("timeout"));
    }, TRANSCRIBE_TIMEOUT_MS);
    const fail = (detail: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      // 失败必关连接：onerror/send 抛错路径否则 hanging
      try {
        socket.close();
      } finally {
        reject(new Error(detail));
      }
    };
    const succeed = (raw: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      // offline 整句一回包即最终结果（与官方 sequential 客户端一致），故首帧 resolve；
      // send 本身可抛错，包 try/finally 保证连接必关
      try {
        socket.send("Done");
      } finally {
        socket.close();
      }
      resolve({ text: extractText(raw), raw });
    };
    if (config.signal?.aborted === true) {
      fail("aborted");
      return;
    }
    const onAbort = () => fail("aborted");
    config.signal?.addEventListener("abort", onAbort, { once: true });
    socket.onopen = () => {
      try {
        const payload = buildOfflineWsPayload(TARGET_SAMPLE_RATE, samples);
        for (let offset = 0; offset < payload.length; offset += WS_CHUNK_BYTES) {
          socket.send(payload.slice(offset, offset + WS_CHUNK_BYTES));
        }
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    };
    socket.onmessage = (event: MessageEvent) => {
      config.signal?.removeEventListener("abort", onAbort);
      succeed(String(event.data));
    };
    socket.onerror = () => {
      fail("unreachable");
    };
    // 服务端拒连（如超 max-utterance-length）会先 error 后 close：error 已 reject，close 不再重复
    socket.onclose = () => {
      fail("connection closed");
    };
  });
}

/**
 * 提取识别文本：服务端回包为 JSON，text 缺失或解析失败时回退原文，保证投递/Notice 始终有内容。
 * @param raw 服务端原始回包文本
 * @returns 识别文本
 */
function extractText(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && "text" in parsed) {
      const text = parsed.text;
      if (typeof text === "string" && text !== "") return text;
    }
    return raw;
  } catch {
    return raw;
  }
}
