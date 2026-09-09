import { CAPTURE_BUFFER_SIZE } from "../../utils/audio";

/** 采集 worklet 处理器名：主线程实例化与 worklet 内注册共用此标识 */
export const CAPTURE_WORKLET_NAME = "local-speech-capture";

/**
 * 采集 worklet 源码：以字符串内联进包，避免额外 worklet 文件与构建配置。
 * 调用方经 Blob URL 喂给 audioWorklet.addModule，加载后立即 revoke。
 * worklet 侧按 CAPTURE_BUFFER_SIZE 攒批再 post，主线程降低消息频率；
 * stop 时主线程发 flush 讨要不足一批的尾帧。
 */
export function buildCaptureWorkletCode(): string {
  return `
class LocalSpeechCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(${CAPTURE_BUFFER_SIZE});
    this.offset = 0;
    this.port.onmessage = (event) => {
      if (event.data === "flush" && this.offset > 0) {
        this.port.postMessage(this.buffer.slice(0, this.offset));
        this.offset = 0;
      }
    };
  }
  process(inputs) {
    const channel = inputs[0] ? inputs[0][0] : undefined;
    if (channel) {
      let pos = 0;
      while (pos < channel.length) {
        const room = this.buffer.length - this.offset;
        const rest = channel.length - pos;
        const size = room < rest ? room : rest;
        this.buffer.set(channel.subarray(pos, pos + size), this.offset);
        this.offset += size;
        pos += size;
        if (this.offset >= this.buffer.length) {
          this.port.postMessage(this.buffer.slice());
          this.offset = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("${CAPTURE_WORKLET_NAME}", LocalSpeechCaptureProcessor);
`;
}
