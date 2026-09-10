import { type Editor, type EventRef, Menu, Notice } from "obsidian";
import { match } from "pinyin-pro";
import {
  addLexiconEntry,
  findLexiconEntry,
  getEnabledPinyinMap,
  isLexiconEnabled,
  setLexiconEnabled,
} from "../../cores/lexicon";
import { subscribeLexiconEnabledChange } from "../../cores/settings";
import { t } from "../../cores/i18n";
import { toPinyin } from "../../utils/pinyin";
import type LocalSpeechRecognitionPlugin from "../../main";
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";
import type { LexiconTarget } from "./types";

/**
 * 拼音匹配选项：every + lastPrecision every 保证整词严格命中（西安→xian 而不把「先」的尾音并入），
 * continuous 保证汉字下标连续，v 允许拼音 v 匹配 ü（词库存储格式已做 ü→v）。
 */
const MATCH_OPTIONS = { precision: "every", lastPrecision: "every", continuous: true, v: true } as const;

/** 片段必须是纯汉字：match 会把拉丁字符逐字母当拼音匹配（如 xiang 中命中 xian），需过滤 */
const HAN_ONLY = /^\p{Script=Han}+$/u;

/**
 * 初始化词库功能：按「启用词库」开关动态挂载编辑器集成——
 * 右键菜单"添加到词库"与识别后处理扩展（高亮 + 点击替换），并预热启用词条拼音映射。
 * 订阅设置广播，开关切换时即时注册/注销，关闭后不残留监听与扩展。
 * 返回同步清理函数：退订广播并整体停用，由 cleanFeatures 卸载时回收。
 * @param plugin 插件实例；type-only 导入具体类，运行时无循环
 * @returns 卸载时停用集成并退订的清理函数
 */
export async function initLexicon(plugin: LocalSpeechRecognitionPlugin): Promise<() => void> {
  const integration = new LexiconIntegration(plugin);
  const unsubscribe = subscribeLexiconEnabledChange((enabled) => void integration.apply(enabled));
  await integration.apply(plugin.settings.lexiconEnabled);
  return () => {
    unsubscribe();
    integration.dispose();
  };
}

/**
 * 词库编辑器集成的启停控制器。
 * CM6 扩展经可变数组承载：registerEditorExtension 只注册一次，之后增删数组内容并调用
 * workspace.updateOptions 即可运行时生效（Obsidian 官方指定的热配置方式，无注销 API）。
 */
class LexiconIntegration {
  private plugin: LocalSpeechRecognitionPlugin;
  /** 可变扩展数组；空数组表示关闭，扩展整体不生效 */
  private extensions: Extension[] = [];
  /** editor-menu 事件句柄；非空表示已注册，经 offref 注销 */
  private menuRef: EventRef | null = null;
  /** 已停用标志；dispose 后到达的广播回调直接丢弃 */
  private disposed = false;

  constructor(plugin: LocalSpeechRecognitionPlugin) {
    this.plugin = plugin;
    // 注册一次空数组，后续靠增删 + updateOptions 启停，避免重复注册导致扩展叠加
    plugin.registerEditorExtension(this.extensions);
  }

  /**
   * 应用开关状态：启用时补挂扩展与菜单并预热映射，关闭时移除扩展、注销菜单并清空映射。
   * @param enabled 最新启用状态
   */
  async apply(enabled: boolean): Promise<void> {
    if (this.disposed) return;
    if (enabled) {
      if (this.extensions.length === 0) {
        this.extensions.push(targetField, targetClickHandler);
        this.plugin.app.workspace.updateOptions();
      }
      if (this.menuRef === null) {
        this.menuRef = this.plugin.app.workspace.on("editor-menu", handleEditorMenu);
      }
    } else {
      if (this.extensions.length > 0) {
        this.extensions.length = 0;
        this.plugin.app.workspace.updateOptions();
      }
      if (this.menuRef !== null) {
        this.plugin.app.workspace.offref(this.menuRef);
        this.menuRef = null;
      }
    }
    // 词库 core 运行时开关：关闭时清空映射，识别后处理自然无候选
    await setLexiconEnabled(enabled);
  }

  /** 停用集成并退订菜单；映射一并清空，卸载后不残留高亮候选 */
  dispose(): void {
    this.disposed = true;
    if (this.menuRef !== null) {
      this.plugin.app.workspace.offref(this.menuRef);
      this.menuRef = null;
    }
    if (this.extensions.length > 0) {
      this.extensions.length = 0;
    }
    void setLexiconEnabled(false);
  }
}

/**
 * 右键菜单处理器：仅在存在非空选中文本时追加"添加到词库"。
 * @param menu 右键菜单
 * @param editor 触发菜单的编辑器
 */
function handleEditorMenu(menu: Menu, editor: Editor): void {
  const word = editor.getSelection().trim();
  if (word === "") return;
  menu.addItem((item) =>
    item
      .setTitle(t("lexicon.addSelection"))
      .setIcon("book-plus")
      .onClick(() => void addSelection(word)),
  );
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

/** 全量替换高亮片段；value 为 null 或空数组时清空 */
export const setTargetsEffect = StateEffect.define<LexiconTarget[] | null>();

/** 点击替换后仅清除被替换的那处高亮；携带替换前的文档区间（旧坐标） */
export const dismissTargetEffect = StateEffect.define<{ from: number; to: number }>();

const targetField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    for (const e of tr.effects) {
      if (e.is(setTargetsEffect)) {
        if (e.value === null || e.value.length === 0) {
          return Decoration.none;
        }
        // effect 携带的坐标已基于插入后的文档，直接构建；sort 避免位置无序时 RangeSetBuilder 报错
        const list = e.value.map((target) =>
          Decoration.mark({
            class: "target-word",
            attributes: {
              "data-keys": target.keys.join(","),
            },
          }).range(target.from, target.to),
        );
        return Decoration.set(list, true);
      }
      if (e.is(dismissTargetEffect)) {
        // 先按旧坐标滤掉被替换的那处，再统一 map 让其余高亮随本次变更移动
        const { from, to } = e.value;
        decos = decos.update({ filter: (filterFrom, filterTo) => filterFrom !== from || filterTo !== to });
      }
    }
    return decos.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

const targetClickHandler = EditorView.domEventHandlers({
  click(event, view) {
    // 仅处理无修饰符的左键点击，其余组合留给编辑器默认行为
    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
    // 跨窗口元素与主窗口构造函数不同源，instanceof 不可靠，经鸭子类型探测 closest
    const node = event.target as { closest?(selector: string): Element | null } | null;
    const el = node?.closest?.(".target-word") ?? null;
    if (el === null) return false;
    openTargetMenu(view, el, event);
    return true;
  },
});

/**
 * 打开候选词菜单：候选来自片段命中拼音键对应的最新词库映射，排除与当前文本相同的词；
 * 无候选时不弹菜单。选中后经 CM6 单事务替换并清除该处高亮。
 * @param view 编辑器视图
 * @param el 高亮片段 DOM
 * @param event 触发点击事件，菜单定位用
 */
function openTargetMenu(view: EditorView, el: Element, event: MouseEvent): void {
  const keys = (el.getAttribute("data-keys") ?? "").split(",").filter((key) => key !== "");
  const from = view.posAtDOM(el);
  const to = view.posAtDOM(el, el.childNodes.length);
  const current = view.state.sliceDoc(from, to);
  const map = getEnabledPinyinMap();
  const candidates: string[] = [];
  for (const key of keys) {
    for (const word of map.get(key) ?? []) {
      if (word !== current && !candidates.includes(word)) candidates.push(word);
    }
  }
  if (candidates.length === 0) return;
  const menu = new Menu();
  for (const word of candidates) {
    menu.addItem((item) =>
      item.setTitle(word).onClick(() => {
        view.dispatch({
          changes: { from, to, insert: word },
          selection: { anchor: from + word.length },
          effects: [dismissTargetEffect.of({ from, to })],
          scrollIntoView: true,
        });
        view.focus();
      }),
    );
  }
  menu.showAtMouseEvent(event);
}

/**
 * 扫描文本中与启用词条拼音键同音的片段：逐键经 pinyin-pro match 查找，过滤非纯汉字片段，
 * 跳过无替代项的片段（唯一候选与文本一致），同片段多音合并 keys，
 * 重叠片段按起点升序、同起点长者优先贪心保留（RangeSet 要求互不重叠）。
 * @param text 待扫描文本（本次识别插入的内容）
 * @param baseFrom 文本在文档中的起始位置
 * @returns 高亮目标列表
 */
export function findTargets(text: string, baseFrom: number): LexiconTarget[] {
  // 词库关闭时直接跳过扫描：映射已清空，此处短路同时避免无谓遍历
  if (!isLexiconEnabled()) return [];
  const map = getEnabledPinyinMap();
  const spans = new Map<string, { start: number; end: number; keys: Set<string> }>();
  for (const [key, words] of map) {
    let offset = 0;
    while (offset < text.length) {
      const indices = match(text.slice(offset), key, MATCH_OPTIONS);
      if (indices === null || indices.length === 0) break;
      const first = indices[0];
      const last = indices[indices.length - 1];
      if (first === undefined || last === undefined) break;
      const start = offset + first;
      const end = offset + last + 1;
      offset = end;
      const segment = text.slice(start, end);
      if (!HAN_ONLY.test(segment)) continue;
      // 无替代项：拼音成功匹配、词库中该拼音只有唯一候选、且候选与文本汉字完全一致时跳过，
      // 此时点击也没有其他词可选，高亮只会在正确的识别结果上产生无意义标记
      if (words.length === 1 && words[0] === segment) continue;
      const id = `${start},${end}`;
      const existing = spans.get(id);
      if (existing === undefined) {
        spans.set(id, { start, end, keys: new Set([key]) });
      } else {
        existing.keys.add(key);
      }
    }
  }
  const sorted = [...spans.values()].sort((a, b) => a.start - b.start || b.end - a.end);
  const result: LexiconTarget[] = [];
  let lastEnd = -1;
  for (const span of sorted) {
    if (span.start < lastEnd) continue;
    lastEnd = span.end;
    result.push({ from: baseFrom + span.start, to: baseFrom + span.end, keys: [...span.keys] });
  }
  return result;
}
