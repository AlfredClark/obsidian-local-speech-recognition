import { MarkdownView, Notice, Platform } from "obsidian";
import { startCapture } from "../../cores/audio-capture";
import type { AudioCaptureSession } from "../../cores/audio-capture";
import { transcribePcm16k } from "../../cores/sherpa-client";
import { getSherpaServer } from "../../cores/sherpa-server";
import { t } from "../../cores/i18n";
import { int16ToFloat32Normalized, mergeInt16Chunks } from "../../utils/audio";
import type LocalSpeechRecognitionPlugin from "../../main";
import type { SpeechRecognitionState } from "./types";

/** 超长录音强制截断秒数：服务端 max-utterance-length 默认 300 秒，客户端提前截断避免被拒连 */
const MAX_RECORDING_SECONDS = 280;

/** 16kHz 单声道每秒采样数：用于截断分片累积 */
const SAMPLES_PER_SECOND_16K = 16000;

/**
 * 初始化语音识别功能：注册语音识别命令（默认无快捷键，用户在设置→快捷键中绑为 Alt+R），
 * 按 inputMode 分流 toggle/push-to-talk。
 * 返回同步清理函数：录音中禁用插件时同步 stop，不等待识别返回。
 * @param plugin 插件实例；type-only 导入具体类，运行时无循环
 * @returns 卸载时同步停止采集的清理函数
 */
export async function initSpeechRecognition(plugin: LocalSpeechRecognitionPlugin): Promise<() => void> {
  const controller = new SpeechController(plugin);
  plugin.addCommand({
    id: "toggle-speech-recognition",
    name: t("commands.toggleRecognition"),
    callback: () => {
      controller.handleTrigger();
    },
  });
  // push-to-talk 过渡语义：Obsidian hotkey 只给 keydown 回调、无 keyup，
  // 松开 Alt+R 经全局 keyup 兜底停止；再按一次同样可停，等同 toggle 收尾。
  plugin.registerDomEvent(window, "keyup", (event: KeyboardEvent) => {
    controller.handleKeyUp(event);
  });
  return () => {
    controller.dispose();
  };
}

/**
 * 语音识别控制器：持有录音会话与分片累积，串行处理一次“录音→识别”闭环。
 * 识别进行中拒绝新触发，避免并发 WS 连接互相覆盖结果。
 */
class SpeechController {
  private plugin: LocalSpeechRecognitionPlugin;
  private state: SpeechRecognitionState = "idle";
  private session: AudioCaptureSession | null = null;
  private chunks: Array<Int16Array> = [];
  private capturedSamples = 0;

  constructor(plugin: LocalSpeechRecognitionPlugin) {
    this.plugin = plugin;
  }

  /** 快捷键触发入口：按当前状态与 inputMode 分流开始/停止 */
  handleTrigger(): void {
    if (this.state === "transcribing") {
      new Notice(t("recognition.busy"), 3000);
      return;
    }
    if (this.state === "recording") {
      void this.stopAndTranscribe();
      return;
    }
    void this.startRecording();
  }

  /**
   * 全局 keyup 兜底：仅 push-to-talk 且录音中时，松开 R 或 Alt 即停止识别。
   * toggle 模式忽略 keyup，避免抬键误停。
   */
  handleKeyUp(event: KeyboardEvent): void {
    if (this.plugin.settings.inputMode !== "push-to-talk") return;
    if (this.state !== "recording") return;
    if (event.key === "R" || event.key === "Alt" || event.key === "r") {
      void this.stopAndTranscribe();
    }
  }

  /** 卸载时同步释放：停止采集并丢弃分片，不等待识别返回 */
  dispose(): void {
    this.session?.stop();
    this.session = null;
    this.chunks = [];
    this.capturedSamples = 0;
    this.state = "idle";
  }

  /** 开始录音：服务未运行时先提示并返回，麦克风错误按类型翻译 */
  private async startRecording(): Promise<void> {
    if (!Platform.isDesktop) {
      new Notice(t("recognition.desktopOnly"), 3000);
      return;
    }
    if (!getSherpaServer().isRunning()) {
      new Notice(t("recognition.serverNotRunning"), 3000);
      return;
    }
    try {
      this.chunks = [];
      this.capturedSamples = 0;
      this.session = await startCapture(this.plugin.settings.microphoneDeviceId, (pcm16) => {
        this.chunks.push(pcm16);
        this.capturedSamples += pcm16.length;
        // 超长截断：达到上限自动停并走正常识别流程，不丢已录音频
        if (this.capturedSamples >= MAX_RECORDING_SECONDS * SAMPLES_PER_SECOND_16K) {
          void this.stopAndTranscribe();
        }
      });
      this.state = "recording";
      new Notice(t("recognition.recordingStarted"), 3000);
    } catch (error) {
      this.session = null;
      new Notice(this.resolveMicError(error), 5000);
    }
  }

  /** 停止录音并识别：合并 Int16 分片→转 float32→发 WS→插入光标或写入剪贴板 */
  private async stopAndTranscribe(): Promise<void> {
    this.session?.stop();
    this.session = null;
    if (this.state !== "recording") return;
    this.state = "transcribing";
    new Notice(t("recognition.recordingStopped"), 2000);
    try {
      const merged = mergeInt16Chunks(this.chunks);
      this.chunks = [];
      this.capturedSamples = 0;
      if (merged.length === 0) {
        new Notice(t("recognition.noAudio"), 3000);
        return;
      }
      const { host, port } = this.plugin.settings;
      const result = await transcribePcm16k(int16ToFloat32Normalized(merged), { host, port });
      await this.deliverResult(result.text);
    } catch (error) {
      new Notice(t("recognition.recognizeFailed", { detail: this.toErrorDetail(error) }), 5000);
    } finally {
      if (this.state === "transcribing") this.state = "idle";
    }
  }

  /**
   * 投递识别结果：编辑器聚焦时经 replaceSelection 插入光标处，
   * 否则写入剪贴板并 Notice 提示；剪贴板异常透出原文。
   * @param text 识别文本
   */
  private async deliverResult(text: string): Promise<void> {
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = view?.editor;
    if (view !== null && view.getMode() === "source" && editor?.hasFocus() === true) {
      editor.replaceSelection(text);
      new Notice(t("recognition.transcribed"), 3000);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      new Notice(t("recognition.transcribedToClipboard"), 5000);
    } catch (error) {
      new Notice(t("recognition.clipboardFailed", { detail: this.toErrorDetail(error) }), 5000);
    }
  }

  /**
   * 麦克风错误翻译：权限拒绝与设备缺失给固定文案，其余透出原文。
   * @param error getUserMedia 抛出的未知错误
   * @returns 可展示的错误文本
   */
  private resolveMicError(error: unknown): string {
    if (error instanceof DOMException) {
      if (error.name === "NotAllowedError") return t("recognition.micDenied");
      if (error.name === "NotFoundError" || error.name === "OverconstrainedError") return t("recognition.micNotFound");
    }
    return t("recognition.recognizeFailed", { detail: this.toErrorDetail(error) });
  }

  /**
   * 错误详情提取：Error 取 message，其余类型转字符串，保证 Notice 文案可读。
   * @param error 捕获到的未知错误
   * @returns 可展示的错误详情文本
   */
  private toErrorDetail(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
