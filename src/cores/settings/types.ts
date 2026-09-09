import type { PluginLanguage } from "../i18n";

/** 语音输入触发模式：toggle 单次点击切换，push-to-talk 按住说话 */
export type SpeechInputMode = "toggle" | "push-to-talk";

/**
 * 插件设置结构。声明式设置 API 按 key 直接读写此结构，
 * 新增字段须同步在 DEFAULT_SETTINGS 补默认值。
 */
export interface LocalSpeechRecognitionPluginSettings {
  /** 是否启用折叠行为 */
  collapsible: boolean;
  /** 插件界面语言 */
  language: PluginLanguage;
  /** sherpa-onnx-offline-websocket-server 可执行文件路径 */
  binaryPath: string;
  /** sherpa-onnx 模型文件夹路径 */
  modelPath: string;
  /** 服务监听主机 */
  host: string;
  /** 服务监听端口 */
  port: number;
  /** 服务 CPU 线程数 */
  numThreads: number;
  /** 是否随插件加载自动拉起服务 */
  autoStartServer: boolean;
  /** 语音输入触发模式 */
  inputMode: SpeechInputMode;
}
