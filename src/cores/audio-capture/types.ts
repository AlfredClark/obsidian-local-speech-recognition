/** 音频输入设备信息：下拉框选项的数据源 */
export interface AudioDeviceInfo {
  /** 设备 id；空字符串表示系统默认，不持久化之外的设备缓存 */
  deviceId: string;
  /** 展示名称；未授权时为空，由调用方兜底编号 */
  label: string;
}

/** 采集会话句柄：调用 stop() 结束采集并释放硬件与音频图资源 */
export interface AudioCaptureSession {
  /** 采集回调输出的统一采样率，恒为 16k */
  readonly sampleRate: number;
  /** 同步停止采集：关 track、断音频图、关 AudioContext，幂等 */
  stop(): void;
}
