import { Platform } from "obsidian";
import { TARGET_SAMPLE_RATE, downsampleFloat32Mono, float32ToInt16Pcm } from "../../utils/audio";
import type { AudioCaptureSession, AudioDeviceInfo } from "./types";
import { CAPTURE_WORKLET_NAME, buildCaptureWorkletCode } from "./worklet";

/** 未授权时 label 为空的兜底前缀：按枚举顺序编号，保证下拉框始终有可选项 */
const UNLABELED_DEVICE_PREFIX = "Microphone";

/**
 * 枚举音频输入设备：供设置页麦克风下拉框使用。
 * 未授权麦克风时 label 为空属浏览器预期行为，调用方点刷新前需先允许一次权限。
 * @returns 音频输入设备列表
 */
export async function enumerateAudioInputDevices(): Promise<AudioDeviceInfo[]> {
  if (!Platform.isDesktop) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter((device) => device.kind === "audioinput");
  return inputs.map((device, index) => ({
    deviceId: device.deviceId,
    label: device.label === "" ? `${UNLABELED_DEVICE_PREFIX} ${index + 1}` : device.label,
  }));
}

/**
 * 启动麦克风采集：按设备 id 拉流，经 AudioWorklet 统一降采样为 16kHz 16-bit 单声道 PCM 分片回调。
 * @param deviceId 设备 id；空字符串表示系统默认设备
 * @param onChunk 16kHz Int16 单声道分片回调
 * @returns 采集会话句柄，stop() 同步释放全部资源
 */
export async function startCapture(deviceId: string, onChunk: (pcm16: Int16Array) => void): Promise<AudioCaptureSession> {
  if (!Platform.isDesktop) throw new Error("desktop-only");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId === "" ? undefined : { exact: deviceId },
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
    },
  });
  const context = new AudioContext();
  try {
    await loadCaptureWorklet(context);
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, CAPTURE_WORKLET_NAME);
    let stopped = false;
    node.port.onmessage = (event: MessageEvent) => {
      if (stopped) return;
      // worklet 只应投递 Float32Array 批帧：flush 回声/坏帧直接丢弃，不污染降采样
      if (!(event.data instanceof Float32Array)) return;
      const resampled = downsampleFloat32Mono(event.data, context.sampleRate, TARGET_SAMPLE_RATE);
      onChunk(float32ToInt16Pcm(resampled));
    };
    source.connect(node);
    return {
      sampleRate: TARGET_SAMPLE_RATE,
      stop: () => {
        // stop 幂等：快捷键重复触发与卸载清理可能并发调用
        if (stopped) return;
        stopped = true;
        // 尾帧回收：不足一批的残留经 flush 讨要，onmessage 侧 stopped 守卫先置 true，
        // flush 回包被丢弃属预期（stop 即停，后续 stopAndTranscribe 只用已累积分片）
        node.port.postMessage("flush");
        node.port.close();
        node.disconnect();
        source.disconnect();
        stream.getTracks().forEach((track) => track.stop());
        void context.close();
      },
    };
  } catch (error) {
    // 构造期抛错（worklet 加载/createSource/WorkletNode 任一）：关流+关 context 后上抛
    stream.getTracks().forEach((track) => track.stop());
    await context.close();
    throw error;
  }
}

/**
 * 加载采集 worklet：源码以 Blob URL 内联进包，避免额外文件与构建配置。
 * 同名重复 addModule 会抛错，忽略 Name 冲突以支持连续两次录音。
 * @param context 采集用的 AudioContext
 */
async function loadCaptureWorklet(context: AudioContext): Promise<void> {
  const url = URL.createObjectURL(new Blob([buildCaptureWorkletCode()], { type: "application/javascript" }));
  try {
    await context.audioWorklet.addModule(url);
  } catch (error) {
    // 同一 context 重复加载同名处理器会报 InvalidStateError；本管线每次录音新建 context，
    // 此分支仅防御多实例复用同一 context 的场景，其他错误继续上抛
    if (!(error instanceof DOMException && error.name === "InvalidStateError")) throw error;
  } finally {
    URL.revokeObjectURL(url);
  }
}
