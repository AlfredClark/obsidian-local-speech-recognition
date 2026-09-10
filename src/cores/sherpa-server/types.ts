import type { SherpaModelId } from "../../utils/sherpa-process";

/** sherpa-onnx websocket 服务的启动配置，由插件设置组装而来 */
export interface SherpaServerConfig {
  /** sherpa-onnx-offline-websocket-server 可执行文件路径 */
  binaryPath: string;
  /** 模型文件夹路径 */
  modelPath: string;
  /** 识别模型标识：模型登记表键，决定 --xxx-model 等模型专属参数 */
  modelType: SherpaModelId;
  /** 服务监听主机 */
  host: string;
  /** 服务监听端口 */
  port: number;
  /** 服务 CPU 线程数 */
  numThreads: number;
  /** 推理后端 */
  provider: string;
}

/** sherpa-onnx 服务存活状态 */
export type SherpaServerStatus = "stopped" | "starting" | "running" | "error";

/** 服务操作结果：ok 为是否成功，失败时 detail 携带可展示的错误详情 */
export interface SherpaServerResult {
  /** 操作是否成功 */
  ok: boolean;
  /** 失败时的错误详情，成功时为空 */
  detail?: string;
}

/** 服务管理器接口：持有进程句柄与状态，设置页与 feature 共用 */
export interface SherpaServerManager {
  /** 按配置拉起服务；starting/running 时直接返回已运行，不重复拉起 */
  start(config: SherpaServerConfig): Promise<SherpaServerResult>;
  /** 同步关闭服务；同步签名以适配 cleanups 回收 */
  stop(): void;
  /** 退出前释放服务：SIGKILL 同步强杀，避免应用退出时 on 多阶段 SIGTERM 不及生效 */
  dispose(): void;
  /** 先同步关闭再拉起 */
  restart(config: SherpaServerConfig): Promise<SherpaServerResult>;
  /** 当前服务状态 */
  getStatus(): SherpaServerStatus;
  /** 服务是否处于运行中 */
  isRunning(): boolean;
  /** 订阅状态变更，返回取消订阅函数 */
  subscribeStatus(listener: () => void): () => void;
}
