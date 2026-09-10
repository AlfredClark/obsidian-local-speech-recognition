import type { TranslationKey } from "../cores/i18n";
// 方向为例外：SherpaServerConfig 唯一源在 cores/sherpa-server/types，utils 仅借类型签名；type-only 跨层回指编译期擦除，运行时无循环。
import type { SherpaServerConfig } from "../cores/sherpa-server";
import { Platform } from "obsidian";

/**
 * 组装 websocket 服务地址。host 为空时回退 127.0.0.1，避免拼出非法地址。
 * @param host 监听主机
 * @param port 监听端口
 * @returns ws 地址，如 ws://127.0.0.1:6006
 */
export function resolveSherpaUrl(host: string, port: number): string {
  return `ws://${host.trim() === "" ? "127.0.0.1" : host.trim()}:${port}`;
}

/**
 * 校验启动配置。只做启动前置检查，不做端口占用等运行时探测。
 * @param config 待校验的服务配置
 * @returns 缺失项对应的 i18n 键，无缺失时返回 null
 */
export function validateSherpaConfig(config: SherpaServerConfig): TranslationKey | null {
  if (config.binaryPath.trim() === "") return "settings.missingBinaryPath";
  if (config.modelPath.trim() === "") return "settings.missingModelPath";
  return null;
}

/** 模型参数上下文：模型专属参数按模型文件夹路径展开 */
export interface SherpaModelArgsContext {
  /** 模型文件夹路径（已去除尾部斜杠） */
  readonly modelDir: string;
}

/** 模型登记表条目：展示名称 + 该模型专属的启动参数 */
export interface SherpaModelDefinition {
  /** 下拉框展示名称（模型专有名词，不参与翻译） */
  readonly name: string;
  /** 组装该模型专属的启动参数，每一项单独列出便于后期维护 */
  readonly buildArgs: (context: SherpaModelArgsContext) => readonly string[];
}

/**
 * sherpa-onnx 模型登记表：新增模型在此追加一条，名称与参数逐项填写。
 * 条目只列模型专属参数，--port / --num-threads / --log-file 由 buildSherpaArgs 统一追加。
 */
export const SHERPA_MODELS = {
  /** SenseVoice 量化模型（int8），历史默认 */
  "sense-voice-int8": {
    name: "SenseVoice (int8)",
    buildArgs: ({ modelDir }: SherpaModelArgsContext) => [
      `--sense-voice-model=${modelDir}/model.int8.onnx`,
      `--sense-voice-use-itn=1`,
      `--tokens=${modelDir}/tokens.txt`,
    ],
  },
  /** SenseVoice 全精度模型，仅模型文件名与 int8 不同 */
  "sense-voice": {
    name: "SenseVoice",
    buildArgs: ({ modelDir }: SherpaModelArgsContext) => [
      `--sense-voice-model=${modelDir}/model.onnx`,
      `--sense-voice-use-itn=1`,
      `--tokens=${modelDir}/tokens.txt`,
    ],
  },
  /** FunASR 量化模型（int8） */
  "fun-asr-int8": {
    name: "FunASR (int8)",
    buildArgs: ({ modelDir }: SherpaModelArgsContext) => [
      `--funasr-nano-encoder-adaptor=${modelDir}/encoder_adaptor.int8.onnx`,
      `--funasr-nano-llm=${modelDir}/llm.int8.onnx`,
      `--funasr-nano-embedding=${modelDir}/embedding.int8.onnx`,
      `--funasr-nano-tokenizer=${modelDir}/Qwen3-0.6B`,
    ],
  },
  /** FunASR 量化模型（fp16） */
  "fun-asr-fp16": {
    name: "FunASR (fp16)",
    buildArgs: ({ modelDir }: SherpaModelArgsContext) => [
      `--funasr-nano-encoder-adaptor=${modelDir}/encoder_adaptor.int8.onnx`,
      `--funasr-nano-llm=${modelDir}/llm.fp16.onnx`,
      `--funasr-nano-embedding=${modelDir}/embedding.int8.onnx`,
      `--funasr-nano-tokenizer=${modelDir}/Qwen3-0.6B`,
    ],
  },
  /** FunASR 全精度模型（fp32） */
  "fun-asr-fp32": {
    name: "FunASR (fp32)",
    buildArgs: ({ modelDir }: SherpaModelArgsContext) => [
      `--funasr-nano-encoder-adaptor=${modelDir}/encoder_adaptor.onnx`,
      `--funasr-nano-llm=${modelDir}/llm.fp32.onnx`,
      `--funasr-nano-embedding=${modelDir}/embedding.onnx`,
      `--funasr-nano-tokenizer=${modelDir}/Qwen3-0.6B`,
    ],
  },
  /** Paraformer 量化模型（int8） */
  "paraformer-int8": {
    name: "Paraformer (int8)",
    buildArgs: ({ modelDir }: SherpaModelArgsContext) => [
      `--paraformer=${modelDir}/model.int8.onnx`,
      `--tokens=${modelDir}/tokens.txt`,
    ],
  },
  /** Paraformer 全精度模型 */
  paraformer: {
    name: "Paraformer",
    buildArgs: ({ modelDir }: SherpaModelArgsContext) => [
      `--paraformer=${modelDir}/model.onnx`,
      `--tokens=${modelDir}/tokens.txt`,
    ],
  },
} as const satisfies Record<string, SherpaModelDefinition>;

/** 模型标识联合类型，由登记表键推导；新增模型无需手改 */
export type SherpaModelId = keyof typeof SHERPA_MODELS;

/** 默认模型标识：设置缺字段或标识失效时兜底，保持历史 int8 行为 */
export const DEFAULT_SHERPA_MODEL_ID: SherpaModelId = "sense-voice-int8";

/**
 * 判断任意值是否为已登记的模型标识。data.json 可能残留被移除或改名的标识，
 * 读取设置时经此归一化，避免下拉与启动参数落空。
 * @param value 待判断的值
 */
export function isSherpaModelId(value: unknown): value is SherpaModelId {
  return typeof value === "string" && value in SHERPA_MODELS;
}

/**
 * 拼接服务端启动参数：运行参数（端口/线程/日志）统一追加，
 * 模型专属参数取自模型登记表中对应条目。
 * @param config 服务配置
 * @returns 传给 spawn 的参数数组
 */
export function buildSherpaArgs(config: SherpaServerConfig): string[] {
  const modelDir = config.modelPath.trim().replace(/[/\\]+$/, "");
  const logPath = Platform.isWin ? `--log-file=NUL` : Platform.isLinux || Platform.isMacOS ? `--log-file=/dev/null` : ``;
  return [
    `--port=${config.port}`,
    `--num-threads=${config.numThreads}`,
    ...SHERPA_MODELS[config.modelType].buildArgs({ modelDir }),
    logPath,
  ];
}
