<script lang="ts">
  import { Menu, Notice, setIcon } from "obsidian";
  import {
    addLexiconEntry,
    deleteLexiconEntries,
    deleteLexiconEntry,
    listLexiconEntries,
    subscribeLexiconChange,
    updateLexiconEntries,
    updateLexiconEntry,
  } from "../../lexicon";
  import type { LexiconEntry, LexiconEntryInput } from "../../lexicon";
  import { t } from "../../i18n";
  import type LocalSpeechRecognitionPlugin from "../../../main";
  import { openLexiconEntryModal } from "../lexicon-entry-modal";

  /** 启用状态筛选值；all 不过滤，与搜索关键字叠加生效 */
  type LexiconEnableFilter = "all" | "enabled" | "disabled";

  /** 插件实例；新增/编辑弹窗经 plugin.app 构造 */
  let { plugin }: { plugin: LocalSpeechRecognitionPlugin } = $props();

  /** 词库全量条目；加载后筛选、编辑、删除均在前端内存中进行，不再访问 IndexedDB */
  let entries = $state<LexiconEntry[]>([]);
  /** 搜索关键字；仅前端过滤 word/pinyin */
  let query = $state("");
  /** 启用状态筛选；与搜索关键字同时生效 */
  let enableFilter = $state<LexiconEnableFilter>("all");
  /** 加载状态；首次加载与重试共用 */
  let loading = $state(true);
  /** 加载失败详情；非空时展示错误态与重试入口 */
  let loadError = $state<string | null>(null);
  /** 待确认删除的条目 id；两步删除，同一时刻只允许一行处于确认态 */
  let pendingDeleteId = $state<number | null>(null);
  /** 已勾选的条目 id；用于多选与批量删除，搜索过滤不影响已有勾选 */
  let selectedIds = $state<number[]>([]);
  /** 全选框 DOM 引用；indeterminate 是纯 DOM 属性，无同名 HTML 属性可绑定 */
  let selectAllInput: HTMLInputElement | null = $state(null);

  /** 加载代际号；仅用于丢弃过期回包，不参与渲染 */
  let loadGeneration = 0;

  /**
   * 读取全部词条并替换内存列表；挂载与重试走非静默（切换加载态），
   * 词库变更订阅触发静默刷新（保留旧列表与勾选，避免闪烁），代际号防止旧回包覆盖新结果。
   * @param silent 静默刷新：不切换加载态、失败保留旧数据
   */
  async function loadEntries(silent = false): Promise<void> {
    const generation = ++loadGeneration;
    if (!silent) {
      loading = true;
      loadError = null;
    }
    try {
      const loaded = await listLexiconEntries();
      if (generation !== loadGeneration) return;
      entries = loaded;
      loadError = null;
      // 外部变更可能删除已勾选/待确认条目，清理瞬态状态避免操作指向不存在的行
      const ids = new Set(loaded.map((entry) => entry.id));
      selectedIds = selectedIds.filter((id) => ids.has(id));
      if (pendingDeleteId !== null && !ids.has(pendingDeleteId)) pendingDeleteId = null;
    } catch (error) {
      if (generation !== loadGeneration) return;
      if (!silent) loadError = toDetail(error);
    } finally {
      if (generation === loadGeneration) loading = false;
    }
  }

  // 挂载后加载一次，并订阅词库变更（右键菜单添加、批量操作等）静默刷新；
  // 语言切换由 SidebarRoot 的 #key 重建本组件并触发重新加载
  $effect(() => {
    void loadEntries();
    const unsubscribe = subscribeLexiconChange(() => void loadEntries(true));
    return () => {
      unsubscribe();
      // 卸载后推进代际号，作废在途回包
      loadGeneration += 1;
    };
  });

  /**
   * 前端筛选与排序：启用状态与搜索关键字叠加，对 word/pinyin 做大小写不敏感的子串匹配；
   * 展示顺序为权重降序、同权重 id 降序（最新在前），与后处理映射的候选优先级一致。
   */
  const filtered = $derived.by(() => {
    const keyword = query.trim().toLowerCase();
    const matched = entries.filter((entry) => {
      if (enableFilter === "enabled" && !entry.enable) return false;
      if (enableFilter === "disabled" && entry.enable) return false;
      if (keyword === "") return true;
      return entry.word.toLowerCase().includes(keyword) || entry.pinyin.toLowerCase().includes(keyword);
    });
    return matched.sort((a, b) => b.weight - a.weight || b.id - a.id);
  });

  /** 当前筛选结果中的勾选数量 */
  const selectedFilteredCount = $derived(filtered.filter((entry) => selectedIds.includes(entry.id)).length);
  /** 筛选结果是否全部勾选；结果为空时视为未全选 */
  const allSelected = $derived(filtered.length > 0 && selectedFilteredCount === filtered.length);
  /** 是否存在勾选（含被搜索过滤掉的条目）；批量删除按钮据此显隐 */
  const hasSelection = $derived(selectedIds.length > 0);

  // 部分勾选时全选框显示半选态；indeterminate 无属性可绑定，只能经 DOM 引用同步
  $effect(() => {
    if (selectAllInput !== null) {
      selectAllInput.indeterminate = selectedFilteredCount > 0 && !allSelected;
    }
  });

  /** 勾选/取消勾选单个条目 */
  function toggleSelected(id: number, next: boolean): void {
    selectedIds = next ? [...selectedIds, id] : selectedIds.filter((item) => item !== id);
  }

  /** 全选/取消全选筛选结果；不影响被搜索过滤掉的已勾选条目 */
  function toggleSelectAll(next: boolean): void {
    if (next) {
      selectedIds = [...new Set([...selectedIds, ...filtered.map((entry) => entry.id)])];
    } else {
      const filteredIds = new Set(filtered.map((entry) => entry.id));
      selectedIds = selectedIds.filter((id) => !filteredIds.has(id));
    }
  }

  /** 打开新增弹窗 */
  function openCreateForm(): void {
    openLexiconEntryModal(plugin.app, {
      entry: null,
      onSave: (draft) => saveDraft(null, draft),
    });
  }

  /** 打开编辑弹窗；回填该行原值 */
  function openEditForm(entry: LexiconEntry): void {
    openLexiconEntryModal(plugin.app, {
      entry,
      onSave: (draft) => saveDraft(entry, draft),
    });
  }

  /** 持久化草稿：新增走 add 后头插（自增 id 最大），编辑走 put 后原位替换；返回是否成功供弹窗决定关闭 */
  async function saveDraft(entry: LexiconEntry | null, draft: LexiconEntryInput): Promise<boolean> {
    try {
      if (entry === null) {
        const created = await addLexiconEntry(draft);
        entries = [created, ...entries];
      } else {
        const updated: LexiconEntry = { id: entry.id, ...draft };
        await updateLexiconEntry(updated);
        entries = entries.map((item) => (item.id === updated.id ? updated : item));
      }
      return true;
    } catch (error) {
      new Notice(t("sidebar.lexiconSaveFailed", { detail: toDetail(error) }), 5000);
      return false;
    }
  }

  /** 请求删除：首次点击进入二次确认态 */
  function requestDelete(id: number): void {
    pendingDeleteId = id;
  }

  /** 确认删除：先落库再移除内存行，并同步清理勾选与待确认态 */
  async function confirmDelete(id: number): Promise<void> {
    try {
      await deleteLexiconEntry(id);
      entries = entries.filter((item) => item.id !== id);
      selectedIds = selectedIds.filter((item) => item !== id);
    } catch (error) {
      new Notice(t("sidebar.lexiconDeleteFailed", { detail: toDetail(error) }), 5000);
    } finally {
      pendingDeleteId = null;
    }
  }

  /** 批量删除已勾选条目；单事务落库后同步内存与勾选状态 */
  async function batchDelete(): Promise<void> {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    try {
      await deleteLexiconEntries(ids);
      const removed = new Set(ids);
      entries = entries.filter((item) => !removed.has(item.id));
      selectedIds = [];
      if (pendingDeleteId !== null && removed.has(pendingDeleteId)) pendingDeleteId = null;
    } catch (error) {
      new Notice(t("sidebar.lexiconDeleteFailed", { detail: toDetail(error) }), 5000);
    }
  }

  /** 批量设置已勾选条目的启用状态；单事务落库后同步内存并清空勾选 */
  async function batchSetEnable(next: boolean): Promise<void> {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const updated = entries.filter((item) => idSet.has(item.id)).map((item) => ({ ...item, enable: next }));
    try {
      await updateLexiconEntries(updated);
      entries = entries.map((item) => (idSet.has(item.id) ? { ...item, enable: next } : item));
      selectedIds = [];
    } catch (error) {
      new Notice(t("sidebar.lexiconSaveFailed", { detail: toDetail(error) }), 5000);
    }
  }

  /** 打开批量操作菜单：菜单挂到鼠标位置，删除项以警示色区分 */
  function openBatchMenu(event: MouseEvent): void {
    if (!hasSelection) return;
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle(t("sidebar.lexiconBatchEnable"))
        .setIcon("toggle-right")
        .onClick(() => void batchSetEnable(true)),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("sidebar.lexiconBatchDisable"))
        .setIcon("toggle-left")
        .onClick(() => void batchSetEnable(false)),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(t("sidebar.lexiconBatchDelete"))
        .setIcon("trash-2")
        .setWarning(true)
        .onClick(() => void batchDelete()),
    );
    menu.showAtMouseEvent(event);
  }

  /** 启用开关持久化：先本地翻转即时反馈，失败再回滚 */
  async function toggleEnable(id: number, next: boolean): Promise<void> {
    const target = entries.find((item) => item.id === id);
    if (!target) return;
    target.enable = next;
    try {
      await updateLexiconEntry({ ...target });
    } catch (error) {
      target.enable = !next;
      new Notice(t("sidebar.lexiconSaveFailed", { detail: toDetail(error) }), 5000);
    }
  }

  /** 错误详情提取：组件层就近实现，避免为一行转换反向依赖 settings 的同类工具 */
  function toDetail(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /** 图标按钮动作：把 lucide 图标渲染进按钮，参数变化时同步刷新 */
  function iconButton(node: HTMLButtonElement, icon: string) {
    setIcon(node, icon);
    return {
      update(next: string): void {
        setIcon(node, next);
      },
    };
  }
</script>

<!--
  布局用内联样式而非组件 <style>：Svelte 注入的 <style> 按文件路径哈希固定 id，
  热重载时组件检测到同 id 样式已存在便跳过重注入，类名规则会停留在旧版本（重启 Obsidian 才更新），
  内联样式随最新 DOM 一起生成，开发期即时生效。
-->
<div class="novel-lexicon-toolbar" style="display: flex; align-items: center; gap: 6px;">
  <input
    type="checkbox"
    bind:this={selectAllInput}
    checked={allSelected}
    disabled={filtered.length === 0}
    title={t("sidebar.lexiconSelectAll")}
    aria-label={t("sidebar.lexiconSelectAll")}
    onchange={(event) => toggleSelectAll(event.currentTarget.checked)}
  />
  <input
    type="search"
    style="flex: 1;"
    placeholder={t("sidebar.lexiconSearch")}
    aria-label={t("sidebar.lexiconSearch")}
    bind:value={query}
  />
  <select bind:value={enableFilter} title={t("sidebar.lexiconFilter")} aria-label={t("sidebar.lexiconFilter")}>
    <option value="all">{t("sidebar.lexiconFilterAll")}</option>
    <option value="enabled">{t("sidebar.lexiconFilterEnabled")}</option>
    <option value="disabled">{t("sidebar.lexiconFilterDisabled")}</option>
  </select>
  <button
    type="button"
    title={t("sidebar.lexiconAdd")}
    aria-label={t("sidebar.lexiconAdd")}
    disabled={loading}
    onclick={openCreateForm}
  >
    +
  </button>
  {#if hasSelection}
    <button
      type="button"
      title={t("sidebar.lexiconBatchActions")}
      aria-label={t("sidebar.lexiconBatchActions")}
      onclick={openBatchMenu}
    >
      {t("sidebar.lexiconBatchActions")}
    </button>
  {/if}
</div>

{#if loading}
  <p>{t("sidebar.lexiconLoading")}</p>
{:else if loadError !== null}
  <p>{t("sidebar.lexiconLoadFailed", { detail: loadError })}</p>
  <button type="button" onclick={() => void loadEntries()}>{t("sidebar.lexiconRetry")}</button>
{:else if entries.length === 0}
  <p>{t("sidebar.lexiconEmpty")}</p>
{:else if filtered.length === 0}
  <p>{t("sidebar.lexiconNoMatch")}</p>
{:else}
  <div class="novel-lexicon-list" style="display: flex; flex-direction: column; gap: 4px; margin-top: 4px;">
    {#each filtered as entry (entry.id)}
      <div class="novel-lexicon-item" style="display: flex; align-items: center; gap: 6px; opacity: {entry.enable ? 1 : 0.55};">
        <input
          type="checkbox"
          checked={selectedIds.includes(entry.id)}
          aria-label={entry.word}
          onchange={(event) => toggleSelected(entry.id, event.currentTarget.checked)}
        />
        <div class="novel-lexicon-info" style="flex: 1; min-width: 0; overflow-wrap: anywhere;">
          <span class="novel-lexicon-word">{entry.word}</span>
          <span class="novel-lexicon-pinyin" style="color: var(--text-muted);">[{entry.pinyin}]</span>
        </div>
        <div class="novel-lexicon-actions" style="display: flex; align-items: center; gap: 4px; white-space: nowrap;">
          <span class="novel-lexicon-weight" style="color: var(--text-muted);">({entry.weight})</span>
          {#if pendingDeleteId === entry.id}
            <button type="button" onclick={() => void confirmDelete(entry.id)}>
              {t("sidebar.lexiconConfirmDelete")}
            </button>
            <button type="button" onclick={() => (pendingDeleteId = null)}>{t("sidebar.lexiconCancel")}</button>
          {:else}
            <button
              type="button"
              class="clickable-icon"
              title={entry.enable ? t("sidebar.lexiconDisable") : t("sidebar.lexiconEnable")}
              aria-label={entry.enable ? t("sidebar.lexiconDisable") : t("sidebar.lexiconEnable")}
              use:iconButton={entry.enable ? "toggle-right" : "toggle-left"}
              onclick={() => void toggleEnable(entry.id, !entry.enable)}
            ></button>
            <button type="button" onclick={() => openEditForm(entry)}>{t("sidebar.lexiconEdit")}</button>
            <button type="button" onclick={() => requestDelete(entry.id)}>{t("sidebar.lexiconDelete")}</button>
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}
