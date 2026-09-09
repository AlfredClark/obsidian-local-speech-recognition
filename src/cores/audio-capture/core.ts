import { Platform } from "obsidian";
import { CAPTURE_BUFFER_SIZE, TARGET_SAMPLE_RATE, downsampleFloat32Mono, float32ToInt16Pcm } from "../../utils/audio";
import type { AudioCaptureSession, AudioDeviceInfo } from "./types";

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
 * 启动麦克风采集：按设备 id 拉流，经 AudioContext 统一降采样为 16kHz 16-bit 单声道 PCM 分片回调。
 * 首期用 ScriptProcessorNode（已废弃但零打包成本）；AudioWorklet 需额外 worklet 文件与构建适配，留后续优化。
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
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(CAPTURE_BUFFER_SIZE, 1, 1);
  let stopped = false;
  processor.onaudioprocess = (event) => {
    if (stopped) return;
    const channel = event.inputBuffer.getChannelData(0);
    const resampled = downsampleFloat32Mono(channel, context.sampleRate, TARGET_SAMPLE_RATE);
    onChunk(float32ToInt16Pcm(resampled));
  };
  source.connect(processor);
  processor.connect(context.destination);
  return {
    sampleRate: TARGET_SAMPLE_RATE,
    stop: () => {
      // stop 幂等：快捷键重复触发与卸载清理可能并发调用
      if (stopped) return;
      stopped = true;
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
    },
  };
}
