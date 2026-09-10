import { initI18n } from "./i18n";
import { initSettings } from "./settings";
import type LocalSpeechRecognitionPlugin from "../main";
import { initSidebar } from "./sidebar";

/**
 * 聚合初始化全部 core 模块（设置、i18n 等共享基础设施）。
 * init 型模块（i18n/settings）在此调用；单例型模块（sherpa-server/audio-capture/sherpa-client/lexicon）
 * 无 init，由 features 按需经单例/函数调用，不在此聚合。
 * 新增 core 模块时只需在此追加一行 init 调用，main.ts 无需改动。
 * @param plugin 插件实例；type-only 导入具体类，运行时无循环
 */
export async function initCores(plugin: LocalSpeechRecognitionPlugin): Promise<void> {
  initI18n(plugin);
  await initSettings(plugin);
  await initSidebar(plugin);
}
