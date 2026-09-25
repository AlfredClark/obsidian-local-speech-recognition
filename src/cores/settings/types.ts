import type { PluginLanguage } from "../i18n";
import type { GamepadPresetId } from "../gamepad";
import type { SherpaModelId } from "../../utils/sherpa-process";

/** 语音输入触发模式：toggle 单次点击切换，push-to-talk 按住说话 */
export type SpeechInputMode = "toggle" | "push-to-talk";

export type ProviderType = "cpu" | "cuda" | "coreml";

/** 词库存储方式：global 全仓库共享的 IndexedDB，vault 仓库内独立的 lexicon.json */
export type LexiconStorageMode = "global" | "vault";

/**
 * 词库存储方式守卫：旧版本或手改 data.json 出现未知标识时回退默认，避免下拉与后端路由落空。
 * @param value 待校验的值
 * @returns 是否为合法的存储方式标识
 */
export function isLexiconStorageMode(value: unknown): value is LexiconStorageMode {
  return value === "global" || value === "vault";
}

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
  /** 使用的识别模型标识（模型登记表键） */
  modelType: SherpaModelId;
  /** 服务监听主机 */
  host: string;
  /** 服务监听端口 */
  port: number;
  /** 服务 CPU 线程数 */
  numThreads: number;
  /** 推理后端 */
  provider: ProviderType;
  /** 是否随插件加载自动拉起服务 */
  autoStartServer: boolean;
  /** 语音输入触发模式 */
  inputMode: SpeechInputMode;
  /** 语音输入麦克风设备 id；空字符串表示系统默认设备 */
  microphoneDeviceId: string;
  /** 是否启用手柄：开启后可用手柄触发录音、移动光标与切换词库候选 */
  gamepadEnabled: boolean;
  /** 手柄预设键位：录音/确认/取消三功能键的映射布局 */
  gamepadPreset: GamepadPresetId;
  /** 是否启用词库：关闭后停用编辑器集成、侧边栏词库页与词库管理动作 */
  lexiconEnabled: boolean;
  /** 词库存储方式：全局共享或仓库独立，两后端数据相互独立不互相同步 */
  lexiconStorage: LexiconStorageMode;
  /** 是否启用模糊音匹配：开启后平翘舌与前后鼻音的差异也视为命中，关闭时仅精确同音 */
  fuzzyMatchEnabled: boolean;
}
