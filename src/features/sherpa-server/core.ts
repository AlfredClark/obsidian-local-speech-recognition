import { Notice, Platform } from "obsidian";
import { getSherpaServer, resolveDetail, toServerConfig } from "../../cores/sherpa-server";
import { t } from "../../cores/i18n";
import type LocalSpeechRecognitionPlugin from "../../main";

/**
 * 初始化 sherpa 服务功能：autoStartServer 开启时随插件启动拉起服务，
 * 结果经 Notice 提示；返回同步清理函数供 cleanFeatures 卸载时关闭进程。
 * @param plugin 插件实例；type-only 导入具体类，运行时无循环
 * @returns 卸载时同步关闭服务的清理函数
 */
export async function initSherpaServer(plugin: LocalSpeechRecognitionPlugin): Promise<() => void> {
  if (Platform.isDesktop && plugin.settings.autoStartServer) {
    const result = await getSherpaServer().start(toServerConfig(plugin));
    if (result.ok) {
      new Notice(t("settings.serverStarted"));
    } else {
      new Notice(t("settings.serverStartFailed", { detail: resolveDetail(result.detail) }));
    }
  }
  // 应用退出不保证走插件 onunload：quit 事件不一定触发，且回调只是尽力清理；
  // 因此同时监听应用窗口关闭做同步强杀，双路径都指向 dispose()，互不冲突。
  plugin.registerEvent(
    plugin.app.workspace.on("quit", () => {
      getSherpaServer().dispose();
    }),
  );
  plugin.registerDomEvent(window, "beforeunload", () => {
    getSherpaServer().dispose();
  });
  // 插件禁用/卸载走正常关闭流程：SIGTERM 宽限，无需强杀
  return () => {
    getSherpaServer().stop();
  };
}
