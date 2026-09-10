import { Modal } from "obsidian";
import type { App } from "obsidian";
import { t } from "../i18n";
import { mountComponent } from "../../utils/svelte";
import type { MountedComponent } from "../../utils/svelte";
import type { LexiconEntry, LexiconEntryInput } from "../lexicon";
import LexiconEntryForm from "./components/LexiconEntryForm.svelte";

/** 草稿保存回调；返回 true 表示持久化成功，弹窗据此关闭 */
export type LexiconEntrySaveHandler = (draft: LexiconEntryInput) => Promise<boolean>;

/** 词条弹窗参数 */
export interface LexiconEntryModalOptions {
  /** 编辑对象；null 表示新增 */
  entry: LexiconEntry | null;
  /** 提交回调；返回 true 表示保存成功并关闭弹窗，false 保持打开供用户修改 */
  onSave: LexiconEntrySaveHandler;
}

/** 词条新增/编辑弹窗。表单由 Svelte 组件渲染，关闭时经挂载句柄回收 */
class LexiconEntryModal extends Modal {
  /** 调用方传入的编辑对象与提交回调 */
  private options: LexiconEntryModalOptions;
  /** 表单组件挂载句柄；onClose 时回收 */
  private mounted: MountedComponent | null = null;
  /** 关闭标记；保存中按 Esc 关闭后成功回调仍会再调 close()，保证只走一次关闭流程 */
  private closing = false;

  constructor(app: App, options: LexiconEntryModalOptions) {
    super(app);
    this.options = options;
  }

  onOpen(): void {
    this.setTitle(this.options.entry === null ? t("sidebar.lexiconAdd") : t("sidebar.lexiconEditEntry"));
    this.mounted = mountComponent(this.contentEl, LexiconEntryForm, {
      entry: this.options.entry,
      onSave: this.options.onSave,
      onClose: () => this.close(),
    });
  }

  onClose(): void {
    this.mounted?.destroy();
    this.mounted = null;
  }

  close(): void {
    if (this.closing) return;
    this.closing = true;
    super.close();
  }
}

/**
 * 打开词条弹窗；新增与编辑复用同一表单，仅标题与初始值不同。
 * @param app Obsidian App 实例（取自 plugin.app）
 * @param options 编辑对象与提交回调
 */
export function openLexiconEntryModal(app: App, options: LexiconEntryModalOptions): void {
  new LexiconEntryModal(app, options).open();
}
