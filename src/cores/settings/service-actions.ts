import { Notice } from "obsidian";
import { getSherpaServer, resolveDetail, toServerConfig } from "../sherpa-server";
import { resolveSherpaUrl } from "../../utils/sherpa-process";
import { t } from "../i18n";
import type LocalSpeechRecognitionPlugin from "../../main";
import { openWebSocket } from "./connection";

/**
 * 错误详情提取：Error 取 message，其余类型转字符串，保证 Notice 文案可读。
 * settings 模块内复用，原散落在 cores.ts 与 sherpa-server/cores.ts 两处，此处收敛一处。
 * @param error 捕获到的未知错误
 * @returns 可展示的错误详情文本
 */
export function toErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 连接测试：按当前 host/port 拨号 sherpa-onnx websocket 服务，
 * 连接建立即判活并关闭，不发送音频数据；结果经 Notice 提示。
 * @param plugin 插件实例
 */
export async function testConnection(plugin: LocalSpeechRecognitionPlugin): Promise<void> {
  const { host, port } = plugin.settings;
  new Notice(t("settings.testingConnection"), 1000);
  try {
    await openWebSocket(resolveSherpaUrl(host, port));
    new Notice(t("settings.connectionSucceeded"), 3000);
  } catch (error) {
    new Notice(t("settings.connectionFailed", { detail: toErrorDetail(error) }), 3000);
  }
}

/**
 * 手动启动服务：按当前设置拉起进程，成功失败均经 Notice 提示，
 * 状态广播会触发设置页刷新，无需调用方手动 update。
 * @param plugin 插件实例
 */
export async function startService(plugin: LocalSpeechRecognitionPlugin): Promise<void> {
  new Notice(t("settings.serverStarting"), 1000);
  const result = await getSherpaServer().start(toServerConfig(plugin));
  if (result.ok) {
    new Notice(t("settings.serverStarted"), 3000);
  } else if (result.detail === "already-running") {
    new Notice(t("settings.serverAlreadyRunning"), 3000);
  } else {
    new Notice(t("settings.serverStartFailed", { detail: resolveDetail(result.detail) }), 5000);
  }
}

/**
 * 手动关闭服务：同步 kill 进程，状态广播触发按钮显隐刷新。
 * @param plugin 插件实例
 */
export function stopService(plugin: LocalSpeechRecognitionPlugin): void {
  void plugin;
  getSherpaServer().stop();
  new Notice(t("settings.serverStopped"), 3000);
}

/**
 * 手动重启服务：先同步关闭再按当前设置拉起，结果经 Notice 提示。
 * @param plugin 插件实例
 */
export async function restartService(plugin: LocalSpeechRecognitionPlugin): Promise<void> {
  new Notice(t("settings.serverStarting"), 1000);
  const result = await getSherpaServer().restart(toServerConfig(plugin));
  if (result.ok) {
    new Notice(t("settings.serverStarted"), 3000);
  } else {
    new Notice(t("settings.serverStartFailed", { detail: resolveDetail(result.detail) }), 5000);
  }
}
