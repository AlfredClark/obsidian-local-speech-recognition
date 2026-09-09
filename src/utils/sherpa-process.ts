/** sherpa-onnx websocket 服务的启动配置，由插件设置组装而来 */
export interface SherpaServerConfig {
  /** sherpa-onnx-offline-websocket-server 可执行文件路径 */
  binaryPath: string;
  /** 模型文件夹路径 */
  modelPath: string;
  /** 服务监听主机 */
  host: string;
  /** 服务监听端口 */
  port: number;
  /** 服务 CPU 线程数 */
  numThreads: number;
}

/** sherpa-onnx 服务存活状态 */
export type SherpaServerStatus = "stopped" | "starting" | "running" | "error";

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
export function validateSherpaConfig(config: SherpaServerConfig): string | null {
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
  return [
    `--port=${config.port}`,
    `--num-threads=${config.numThreads}`,
    `--sense-voice-model=${modelDir}/model.int8.onnx`,
    `--tokens=${modelDir}/tokens.txt`,
  ];
}
