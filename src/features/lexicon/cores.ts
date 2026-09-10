import { Notice } from "obsidian";
import type { Editor, Menu } from "obsidian";
import { addLexiconEntry, findLexiconEntry } from "../../cores/lexicon";
import { t } from "../../cores/i18n";
import { toPinyin } from "../../utils/pinyin";
import type LocalSpeechRecognitionPlugin from "../../main";

/**
 * 初始化词库功能：在编辑器右键菜单注册"添加到词库"项，仅在存在选中文本时出现。
 * 返回同步清理函数：显式退订 editor-menu，由 cleanFeatures 卸载时回收。
 * @param plugin 插件实例；type-only 导入具体类，运行时无循环
 * @returns 卸载时退订菜单监听的清理函数
 */
export async function initLexicon(plugin: LocalSpeechRecognitionPlugin): Promise<() => void> {
  const handler = (menu: Menu, editor: Editor): void => {
    const word = editor.getSelection().trim();
    if (word === "") return;
    menu.addItem((item) =>
      item
        .setTitle(t("lexicon.addSelection"))
        .setIcon("book-plus")
        .onClick(() => void addSelection(word)),
    );
  };
  // 经 EventRef 退订：Workspace.off 的签名是宽泛的 (...data: unknown[])，直接传窄签名回调无法通过类型检查
  const ref = plugin.app.workspace.on("editor-menu", handler);
  return () => {
    plugin.app.workspace.offref(ref);
  };
}

/**
 * 将选中文本写入词库：拼音自动生成、权重 0、默认启用；词条已存在时提示且不写入。
 * @param word 已 trim 的选中文本
 */
async function addSelection(word: string): Promise<void> {
  try {
    const pinyin = toPinyin(word);
    if ((await findLexiconEntry(word, pinyin)) !== null) {
      new Notice(t("lexicon.duplicate", { word }), 3000);
      return;
    }
    await addLexiconEntry({ word, pinyin, weight: 0, enable: true });
    new Notice(t("lexicon.added", { word }), 3000);
  } catch (error) {
    new Notice(t("lexicon.addFailed", { detail: toErrorDetail(error) }), 5000);
  }
}

/**
 * 错误详情提取：Error 取 message，其余类型转字符串，保证 Notice 文案可读。
 * @param error 捕获到的未知错误
 * @returns 可展示的错误详情文本
 */
function toErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
