import { MarkdownView, Notice, Platform } from "obsidian";
import { startCapture } from "../../cores/audio-capture";
import type { AudioCaptureSession } from "../../cores/audio-capture";
import { transcribePcm16k } from "../../cores/sherpa-client";
import { getSherpaServer } from "../../cores/sherpa-server";
import { t } from "../../cores/i18n";
import { chunkRmsLevel, int16ToFloat32Normalized, mergeInt16Chunks } from "../../utils/audio";
import type LocalSpeechRecognitionPlugin from "../../main";
import type { SpeechRecognitionState } from "./types";
import { getCodeMirrorEditorView } from "../../utils/cm-utils";
import { applyPreferredReplacements, findTargets, setTargetsEffect } from "../lexicon";
import type { NotificationMode } from "../../cores/settings";
import { chunkPeakLevel, renderRecordingStatus, renderTranscribingStatus, shouldShowResultNotice } from "./status-text";
import { createVadState, updateVad, type VadState } from "./vad";

/** 超长录音强制截断秒数：服务端 max-utterance-length 默认 300 秒，客户端提前截断避免被拒连 */
const MAX_RECORDING_SECONDS = 280;

/** 16kHz 单声道每秒采样数：用于截断分片累积 */
const SAMPLES_PER_SECOND_16K = 16000;

/** 命令回调的全局触发器：供手柄等外部入口复用，状态机与 busy 提示保持单一入口 */
let speechTrigger: (() => void) | null = null;

/**
 * 触发一次语音识别：等价于执行切换命令，未初始化或已卸载时静默返回。
 * 由手柄输入等外部入口调用，不经过未公开的 app.commands API。
 */
export function requestSpeechRecognitionTrigger(): void {
  speechTrigger?.();
}

/**
 * 初始化语音识别功能：注册语音识别命令（默认无快捷键，用户在设置→快捷键中绑定），
 * 按 inputMode 分流 toggle/push-to-talk。
 * 返回同步清理函数：录音中禁用插件时同步 stop，不等待识别返回。
 * @param plugin 插件实例；type-only 导入具体类，运行时无循环
 * @returns 卸载时同步停止采集的清理函数
 */
export async function initSpeechRecognition(plugin: LocalSpeechRecognitionPlugin): Promise<() => void> {
  // 状态栏指示：平时隐藏，过程通知走状态栏模式时才显示；元素随控制器 dispose 回收
  const statusEl = plugin.addStatusBarItem();
  statusEl.hide();
  const controller = new SpeechController(plugin, statusEl);
  statusEl.addEventListener("click", () => controller.handleStatusClick());
  plugin.addCommand({
    id: "toggle-speech-recognition",
    name: t("commands.toggleRecognition"),
    callback: () => {
      controller.handleTrigger();
    },
  });
  // push-to-talk 过渡语义：Obsidian hotkey 只给 keydown 回调、无 keyup，
  // 松开 R/Alt 经全局 keyup 兜底停止；再按一次同样可停，等同 toggle 收尾。
  plugin.registerDomEvent(window, "keyup", (event: KeyboardEvent) => {
    controller.handleKeyUp(event);
  });
  // 对外暴露触发器供手柄复用，卸载时同步注销避免悬空调用
  speechTrigger = () => controller.handleTrigger();
  return () => {
    speechTrigger = null;
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
  /** 本轮通知通道：开始录音时快照，中途切设置下轮生效 */
  private channel: NotificationMode = "notice";
  /** 常驻过程 Notice：通知框模式持有，其余模式为 null */
  private progressNotice: Notice | null = null;
  /** 状态栏刷新定时器：仅状态栏模式运行 */
  private statusTimer: number | null = null;
  /** 状态栏成功闪现定时器：插入成功后短暂提示即隐藏 */
  private flashTimer: number | null = null;
  /** 本阶段起始毫秒：录音/识别各记一段，供计时显示 */
  private phaseStartedAt = 0;
  /** 平滑电平：分片峰值经衰减累积，仅状态栏模式计算 */
  private level = 0;
  /** VAD 累积状态：每轮录音开始时重置，静音自停关闭时不更新 */
  private vad: VadState = createVadState();

  constructor(
    plugin: LocalSpeechRecognitionPlugin,
    private statusEl: HTMLElement,
  ) {
    this.plugin = plugin;
  }

  /** 状态栏点击：仅录音中响应为停止，其余状态静默忽略 */
  handleStatusClick(): void {
    if (this.state === "recording") {
      void this.stopAndTranscribe();
    }
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
    this.hideProgress();
    this.statusEl.remove();
    this.state = "idle";
  }

  /** 关闭过程提示：三种通道统一收口，各终态与清理必经 */
  private hideProgress(): void {
    this.stopStatusTimer();
    if (this.flashTimer !== null) {
      window.clearTimeout(this.flashTimer);
      this.flashTimer = null;
    }
    this.progressNotice?.hide();
    this.progressNotice = null;
    this.level = 0;
    this.setStatusVisible(false);
  }

  /** 停状态栏计时器：幂等，阶段切换与清理共用 */
  private stopStatusTimer(): void {
    if (this.statusTimer !== null) {
      window.clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
  }

  /** 状态栏显隐：隐藏时同步清空文本与提示，避免复用残留 */
  private setStatusVisible(visible: boolean): void {
    if (visible) {
      this.statusEl.show();
    } else {
      this.statusEl.hide();
      this.statusEl.textContent = "";
      this.statusEl.title = "";
    }
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
    // 本轮通知通道快照：预检通过后取值，中途切设置下轮生效
    this.channel = this.plugin.settings.notificationMode;
    this.starting = true;
    const generation = this.generation;
    try {
      this.chunks = [];
      this.capturedSamples = 0;
      this.vad = createVadState();
      const session = await startCapture(this.plugin.settings.microphoneDeviceId, (pcm16) => {
        if (generation !== this.generation) return;
        this.chunks.push(pcm16);
        this.capturedSamples += pcm16.length;
        // 状态栏电平：仅该模式累计峰值并衰减，其余模式跳过计算
        if (this.channel === "statusbar") {
          this.level = Math.max(chunkPeakLevel(pcm16), this.level * 0.6);
        }
        // 静音自停：开关默认关闭；尾部时长取“静音时间”设置，达线自动收尾走识别，不丢已录音频
        const chunkMs = (pcm16.length / SAMPLES_PER_SECOND_16K) * 1000;
        const trailingMs = this.plugin.settings.vadSilenceSeconds * 1000;
        if (this.plugin.settings.vadAutoStop && updateVad(this.vad, chunkRmsLevel(pcm16), chunkMs, trailingMs)) {
          void this.stopAndTranscribe();
        }
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
      this.showRecordingProgress();
    } catch (error) {
      if (generation !== this.generation) return;
      this.session = null;
      new Notice(this.resolveMicError(error), 5000);
    } finally {
      if (generation === this.generation) this.starting = false;
    }
  }

  /** 进入录音阶段的过程提示：通知框建常驻条，状态栏起计时电平，无通知则静默 */
  private showRecordingProgress(): void {
    this.hideProgress();
    if (this.channel === "none") return;
    if (this.channel === "notice") {
      this.progressNotice = new Notice(t("recognition.recordingStarted"), 0);
      return;
    }
    this.phaseStartedAt = Date.now();
    this.level = 0;
    this.statusEl.title = t("recognition.recordingStarted");
    this.setStatusVisible(true);
    this.renderRecordingTick();
    this.statusTimer = window.setInterval(() => this.renderRecordingTick(), 250);
  }

  /** 状态栏录音 tick：计时、电平与状态名一次写完，避免高频 DOM */
  private renderRecordingTick(): void {
    this.statusEl.textContent = renderRecordingStatus(
      (Date.now() - this.phaseStartedAt) / 1000,
      this.level,
      t("recognition.recording"),
    );
  }

  /** 进入识别阶段的过程提示：通知框原地变身，状态栏重启计时，无通知则静默 */
  private transitionToTranscribing(): void {
    this.stopStatusTimer();
    if (this.channel === "none") return;
    if (this.channel === "notice") {
      this.progressNotice?.setMessage(t("recognition.recordingStopped"));
      return;
    }
    this.phaseStartedAt = Date.now();
    this.statusEl.title = t("recognition.recordingStopped");
    this.setStatusVisible(true);
    this.renderTranscribingTick();
    this.statusTimer = window.setInterval(() => this.renderTranscribingTick(), 250);
  }

  /** 状态栏识别 tick：计时与状态名，无分片电平可算 */
  private renderTranscribingTick(): void {
    this.statusEl.textContent = renderTranscribingStatus(
      (Date.now() - this.phaseStartedAt) / 1000,
      t("recognition.transcribing"),
    );
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
    this.transitionToTranscribing();
    try {
      const merged = mergeInt16Chunks(this.chunks);
      this.chunks = [];
      this.capturedSamples = 0;
      if (merged.length === 0) {
        this.hideProgress();
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
      // 同代际失败必关通道：新周期被状态机挡在 transcribing 之外，此处隐藏安全
      this.hideProgress();
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
      this.hideProgress();
      new Notice(t("recognition.noAudio"), 3000);
      return;
    }
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = view?.editor;
    if (view !== null && view.getMode() === "source" && editor?.hasFocus() === true) {
      const cmView = getCodeMirrorEditorView(editor);
      if (cmView !== null) {
        try {
          const { from, to } = cmView.state.selection.main;
          // 替换模式：词库优先时按权重首选词改写插入文本，高亮坐标同步重映射
          let insertText = text;
          let targets = findTargets(text, from);
          if (this.plugin.settings.lexiconReplaceMode === "lexicon" && targets.length > 0) {
            const applied = applyPreferredReplacements(text, from, targets);
            insertText = applied.displayText;
            targets = applied.remappedTargets;
          }
          cmView.dispatch({
            changes: { from, to, insert: insertText },
            // selection: { anchor: from, head: from + text.length },   // 自动选中输入文本
            selection: { anchor: from + insertText.length }, // 光标自动移动到末尾
            effects: [setTargetsEffect.of(targets)],
            scrollIntoView: true,
          });
          this.announceInserted();
          return;
        } catch {
          // dispatch 失败回退 Obsidian 编辑器 API，保证本次结果仍可落盘
          editor.replaceSelection(this.resolveInsertText(text));
          this.announceInserted();
          return;
        }
      }
      editor.replaceSelection(this.resolveInsertText(text));
      this.announceInserted();
      return;
    }
    try {
      await navigator.clipboard.writeText(this.resolveInsertText(text));
      this.announceClipboardCopied();
    } catch (error) {
      this.hideProgress();
      new Notice(t("recognition.clipboardFailed", { detail: this.toErrorDetail(error) }), 5000);
    }
  }

  /** 通报插入成功：通知框弹提示，状态栏闪现 2 秒，无通知则静默（编辑器内容即证据） */
  private announceInserted(): void {
    this.hideProgress();
    if (shouldShowResultNotice(this.channel, "inserted")) {
      new Notice(t("recognition.transcribed"), 3000);
    } else if (this.channel === "statusbar") {
      this.flashStatus(t("recognition.transcribed"));
    }
  }

  /** 通报剪贴板交付：写入不可见，回执在三种模式下都弹 */
  private announceClipboardCopied(): void {
    this.hideProgress();
    if (shouldShowResultNotice(this.channel, "clipboard")) {
      new Notice(t("recognition.transcribedToClipboard"), 5000);
    }
  }

  /** 状态栏成功闪现：短暂提示后自动隐藏，供插入成功这类瞬时结果用 */
  private flashStatus(text: string): void {
    this.statusEl.title = text;
    this.statusEl.textContent = text;
    this.setStatusVisible(true);
    this.flashTimer = window.setTimeout(() => this.hideProgress(), 2000);
  }

  /**
   * 无高亮路径的插入文本：回退与剪贴板无装饰可挂，仍需尊重替换偏好；
   * 此处用 0 作扫描基址，只取改写后的文本丢弃坐标。
   * @param text 识别原文
   * @returns 实际应插入的文本
   */
  private resolveInsertText(text: string): string {
    if (this.plugin.settings.lexiconReplaceMode !== "lexicon") return text;
    const targets = findTargets(text, 0);
    if (targets.length === 0) return text;
    return applyPreferredReplacements(text, 0, targets).displayText;
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
