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

/**
 * 拼接服务端启动参数。sense-voice int8 模型占位实现：
 * 模型文件夹映射为 model.int8.onnx 与 tokens.txt 两个子路径，
 * 实测通过后再按真实模型结构调整。
 * @param config 服务配置
 * @returns 传给 spawn 的参数数组
 */
export function buildSherpaArgs(config: SherpaServerConfig): string[] {
  const modelDir = config.modelPath.trim().replace(/[/\\]+$/, "");
  const logPath = Platform.isWin ? `--log-file=NUL` : Platform.isLinux || Platform.isMacOS ? `--log-file=/dev/null` : ``;
  return [
    `--port=${config.port}`,
    `--num-threads=${config.numThreads}`,
    `--sense-voice-model=${modelDir}/model.int8.onnx`,
    `--sense-voice-use-itn=1`,
    `--tokens=${modelDir}/tokens.txt`,
    logPath,
  ];
}
