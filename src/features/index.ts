import type LocalSpeechRecognitionPlugin from "../main";
import { initLexicon } from "./lexicon";
import { initSherpaServer } from "./sherpa-server";
import { initSpeechRecognition } from "./speech-recognition";

/** 各 feature 注册的清理函数，cleanFeatures 在卸载时依序回收 */
const cleanups: Array<() => void> = [];

/**
 * 聚合初始化全部 feature 模块（命令、视图等业务功能）。
 * 新增 feature 只需在此追加 init 调用，main.ts 无需改动。
 * @param plugin 插件实例；type-only 导入具体类，运行时无循环
 */
export async function initFeatures(plugin: LocalSpeechRecognitionPlugin): Promise<void> {
  cleanups.push(await initSherpaServer(plugin));
  cleanups.push(await initSpeechRecognition(plugin));
  cleanups.push(await initLexicon(plugin));
}

/** 卸载时依序回收各 feature 注册的资源（视图叶子、服务进程等），并排空队列以支持热重载重复 onload */
export function cleanFeatures(): void {
  cleanups.splice(0).forEach((cleanup) => cleanup());
}
