import { MarkdownView, Notice, Platform } from "obsidian";
import type { StateEffect } from "@codemirror/state";
import { startCapture } from "../../cores/audio-capture";
import type { AudioCaptureSession } from "../../cores/audio-capture";
import { transcribePcm16k } from "../../cores/sherpa-client";
import { getSherpaServer } from "../../cores/sherpa-server";
import { t } from "../../cores/i18n";
import { int16ToFloat32Normalized, mergeInt16Chunks } from "../../utils/audio";
import type LocalSpeechRecognitionPlugin from "../../main";
import type { SpeechRecognitionState } from "./types";
import { getCodeMirrorEditorView } from "../../utils/cm-utils";

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
  // 启动中标志：startCapture 未 resolve 前再次触发直接 busy，避免双流泄漏
  private starting = false;
  // 代际号：dispose 自增，过期异步（startCapture/transcribe 回包）凭此失效
  private generation = 0;
  private transcribeAbort: AbortController | null = null;

  constructor(plugin: LocalSpeechRecognitionPlugin) {
    this.plugin = plugin;
  }

  /** 快捷键触发入口：按当前状态与 inputMode 分流开始/停止 */
  handleTrigger(): void {
    if (this.state === "transcribing" || this.starting) {
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
    this.transcribeAbort?.abort();
    this.transcribeAbort = null;
    this.generation++;
    this.starting = false;
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
    if (this.starting || this.state !== "idle") return;
    this.starting = true;
    const generation = this.generation;
    try {
      this.chunks = [];
      this.capturedSamples = 0;
      const session = await startCapture(this.plugin.settings.microphoneDeviceId, (pcm16) => {
        if (generation !== this.generation) return;
        this.chunks.push(pcm16);
        this.capturedSamples += pcm16.length;
        // 超长截断：达到上限自动停并走正常识别流程，不丢已录音频
        if (this.capturedSamples >= MAX_RECORDING_SECONDS * SAMPLES_PER_SECOND_16K) {
          void this.stopAndTranscribe();
        }
      });
      // 卸载/二次 dispose 后回包直接释放，不复活
      if (generation !== this.generation) {
        session.stop();
        return;
      }
      this.session = session;
      this.state = "recording";
      new Notice(t("recognition.recordingStarted"), 3000);
    } catch (error) {
      if (generation !== this.generation) return;
      this.session = null;
      new Notice(this.resolveMicError(error), 5000);
    } finally {
      if (generation === this.generation) this.starting = false;
    }
  }

  /** 停止录音并识别：合并 Int16 分片→转 float32→发 WS→插入光标或写入剪贴板 */
  private async stopAndTranscribe(): Promise<void> {
    this.session?.stop();
    this.session = null;
    if (this.state !== "recording") return;
    this.state = "transcribing";
    const generation = this.generation;
    this.transcribeAbort?.abort();
    const controller = new AbortController();
    this.transcribeAbort = controller;
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
      const result = await transcribePcm16k(int16ToFloat32Normalized(merged), { host, port, signal: controller.signal });
      // 卸载后回包不再投递：不插光标、不写剪贴板
      if (generation !== this.generation) return;
      await this.deliverResult(result.text);
    } catch (error) {
      if (generation !== this.generation) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (error instanceof Error && error.message === "aborted") return;
      new Notice(t("recognition.recognizeFailed", { detail: this.toErrorDetail(error) }), 5000);
    } finally {
      if (this.state === "transcribing" && generation === this.generation) this.state = "idle";
      if (this.transcribeAbort === controller) this.transcribeAbort = null;
    }
  }

  /**
   * 投递识别结果：编辑器聚焦时经 CM6 单事务插入光标处（插入+选区一次提交，单次 undo 整体撤销），
   * 有聚焦但拿不到 CM6 视图时回退 replaceSelection；无聚焦时写入剪贴板并 Notice 提示。
   * @param text 识别文本
   */
  private async deliverResult(text: string): Promise<void> {
    if (text === "") {
      // 静音句等空结果：不产生空事务，直接视同未采集到音频
      new Notice(t("recognition.noAudio"), 3000);
      return;
    }
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = view?.editor;
    if (view !== null && view.getMode() === "source" && editor?.hasFocus() === true) {
      const cmView = getCodeMirrorEditorView(editor);
      if (cmView !== null) {
        // 后处理注入点：setDiagnostics() 等 StateEffect 在此拼入，勿删 key，保持单事务原子性
        const diagnosticsEffects: Array<StateEffect<unknown>> = [];
        try {
          const { from, to } = cmView.state.selection.main;
          cmView.dispatch({
            changes: { from, to, insert: text },
            selection: { anchor: from, head: from + text.length },
            effects: diagnosticsEffects,
            scrollIntoView: true,
          });
          new Notice(t("recognition.transcribed"), 3000);
          return;
        } catch {
          // dispatch 失败回退 Obsidian 编辑器 API，保证本次结果仍可落盘
          editor.replaceSelection(text);
          new Notice(t("recognition.transcribed"), 3000);
          return;
        }
      }
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
