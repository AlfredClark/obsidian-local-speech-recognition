/** offline-websocket 识别服务端连接配置：与服务管理的 host/port 同源 */
export interface SherpaClientConfig {
  /** 服务监听主机 */
  host: string;
  /** 服务监听端口 */
  port: number;
  /** 取消信号：abort 时关闭连接并 reject，调用方凭此在卸载/重触发时取消 */
  signal?: AbortSignal;
}

/** 识别结果：text 为解析出的文本，raw 为服务端原始回包 */
export interface TranscriptionResult {
  /** 识别文本；服务端无 text 字段时回退原文 */
  text: string;
  /** 服务端原始回包文本 */
  raw: string;
}
