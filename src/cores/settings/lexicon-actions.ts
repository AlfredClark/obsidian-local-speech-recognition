import { ButtonComponent, Modal, Notice } from "obsidian";
import type { App } from "obsidian";
import {
  addLexiconEntries,
  clearLexiconEntries,
  listLexiconEntries,
  parseLexiconJson,
  parseLexiconTxt,
  serializeLexiconFile,
} from "../lexicon";
import type { LexiconEntry, LexiconEntryInput } from "../lexicon";
import { t } from "../i18n";
import type LocalSpeechRecognitionPlugin from "../../main";

/**
 * 导出词库为 JSON 文件：空词库时提示并中止，否则经 Blob 触发系统保存对话框。
 * @param plugin 插件实例；保留参数以与其余设置页动作同构
 */
export async function exportLexicon(plugin: LocalSpeechRecognitionPlugin): Promise<void> {
  void plugin;
  try {
    const entries = await listLexiconEntries();
    if (entries.length === 0) {
      new Notice(t("lexicon.empty"), 3000);
      return;
    }
    downloadTextFile(serializeLexiconFile(entries), buildExportFileName());
    new Notice(t("lexicon.exported", { count: entries.length }), 3000);
  } catch (error) {
    new Notice(t("lexicon.exportFailed", { detail: toErrorDetail(error) }), 5000);
  }
}

/**
 * 从 JSON 或纯文本文件导入词库：同 word+pinyin 的词条保留库内已有、跳过文件项，
 * 文件内重复保留首条；结果经 Notice 汇总新增/跳过/无效条数。
 * @param plugin 插件实例；保留参数以与其余设置页动作同构
 */
export async function importLexicon(plugin: LocalSpeechRecognitionPlugin): Promise<void> {
  void plugin;
  const file = await pickFile();
  if (file === null) return;
  try {
    const text = await file.text();
    const isJson = file.name.toLowerCase().endsWith(".json") || /^\s*[[{]/.test(text);
    const parsed = isJson ? parseLexiconJson(text) : parseLexiconTxt(text);
    const existing = await listLexiconEntries();
    const keys = new Set(existing.map(entryKey));
    const fresh: LexiconEntryInput[] = [];
    let skipped = parsed.invalid;
    for (const entry of parsed.entries) {
      const key = entryKey(entry);
      if (keys.has(key)) {
        skipped += 1;
        continue;
      }
      keys.add(key);
      fresh.push(entry);
    }
    const added = await addLexiconEntries(fresh);
    new Notice(t("lexicon.imported", { added, skipped }), 5000);
  } catch (error) {
    new Notice(t("lexicon.importFailed", { detail: toErrorDetail(error) }), 5000);
  }
}

/**
 * 清空词库：空词库时提示并中止，否则弹出不可恢复确认框，确认后清空并提示删除条数。
 * @param plugin 插件实例
 */
export async function clearLexicon(plugin: LocalSpeechRecognitionPlugin): Promise<void> {
  try {
    const entries = await listLexiconEntries();
    if (entries.length === 0) {
      new Notice(t("lexicon.empty"), 3000);
      return;
    }
    new ClearLexiconModal(plugin.app, entries.length).open();
  } catch (error) {
    new Notice(t("lexicon.clearFailed", { detail: toErrorDetail(error) }), 5000);
  }
}

/** 清空确认弹窗：展示待删除条数与不可恢复提示，确认按钮为破坏性样式 */
class ClearLexiconModal extends Modal {
  /** 待删除条数；用于文案插值 */
  private count: number;
  /** 确认中标志；防止清空完成前重复点击 */
  private clearing = false;

  constructor(app: App, count: number) {
    super(app);
    this.count = count;
  }

  onOpen(): void {
    this.setTitle(t("settings.lexiconClear"));
    this.contentEl.createEl("p", { text: t("lexicon.clearDesc", { count: this.count }) });
    const actions = this.contentEl.createDiv();
    new ButtonComponent(actions).setButtonText(t("sidebar.lexiconCancel")).onClick(() => this.close());
    new ButtonComponent(actions)
      .setButtonText(t("lexicon.clearConfirm"))
      .setDestructive()
      .onClick(() => {
        if (this.clearing) return;
        this.clearing = true;
        this.close();
        void confirmClearLexicon();
      });
  }
}

/** 确认后的清空动作：与弹窗解耦，便于确认按钮直接委托 */
async function confirmClearLexicon(): Promise<void> {
  try {
    const removed = await clearLexiconEntries();
    new Notice(t("lexicon.cleared", { count: removed }), 3000);
  } catch (error) {
    new Notice(t("lexicon.clearFailed", { detail: toErrorDetail(error) }), 5000);
  }
}

/**
 * 选择本地文件的隐藏 input；用户取消（cancel 事件）或未选文件时返回 null。
 * input 必须挂在用户点击所在窗口的 document（activeDocument）：Obsidian 设置窗口
 * 可能运行在弹出窗口，全局 document 指向主窗口，不持有本次点击的瞬时用户激活，
 * 文件选择框会因缺少用户激活而无法打开。
 */
async function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = activeDocument.body.createEl("input", {
      type: "file",
      attr: { accept: ".json,.txt,application/json,text/plain" },
    });
    input.hidden = true;
    let settled = false;
    const finish = (file: File | null): void => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => finish(null), { once: true });
    input.click();
  });
}

/** 经 Blob 与临时锚点触发系统保存对话框，随后回收锚点与 URL；同 pickFile 使用 activeDocument */
function downloadTextFile(text: string, fileName: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = activeDocument.body.createEl("a", { href: url, attr: { download: fileName } });
  anchor.hidden = true;
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** 导出文件名：本地时间戳到秒，便于多次导出区分 */
function buildExportFileName(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `local-speech-recognition-lexicon-${date}-${time}.json`;
}

/** 去重键：word 与 pinyin 严格一致视为同一条 */
function entryKey(entry: Pick<LexiconEntry, "word" | "pinyin">): string {
  return `${entry.word}\u0000${entry.pinyin}`;
}

/**
 * 错误详情提取：Error 取 message，其余类型转字符串，保证 Notice 文案可读。
 * @param error 捕获到的未知错误
 * @returns 可展示的错误详情文本
 */
function toErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
