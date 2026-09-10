<script lang="ts">
  import { untrack } from "svelte";
  import { subscribeLanguageChange, t } from "../../i18n";
  import { subscribeLexiconEnabledChange } from "../../settings";
  import type LocalSpeechRecognitionPlugin from "../../../main";
  import type { SidebarPage } from "../types";
  import LexiconPage from "./LexiconPage.svelte";
  import ServicePage from "./ServicePage.svelte";

  /** 插件实例；服务页启停服务时按最新设置组装配置，挂载时由 sidebar 视图传入 */
  let { plugin }: { plugin: LocalSpeechRecognitionPlugin } = $props();

  /** 当前激活页面；tab 点击切换，缺省展示词库页 */
  let activePage = $state<SidebarPage>("lexicon");

  /** 语言版本标记；语言切换时递增，{#key} 强制重建内容块使模板中的 t() 重新求值 */
  let langTick = $state(0);

  /** 词库启用状态；关闭时隐藏词库 tab，与设置页开关经广播保持同步。初始值只取一次快照（plugin.settings 非响应式） */
  let lexiconEnabled = $state(untrack(() => plugin.settings.lexiconEnabled));

  // 订阅语言与词库开关变更并在卸载时自动退订；t() 为普通函数调用，Svelte 无法追踪其依赖，须经 #key 重建
  $effect(() => {
    const unsubscribeLanguage = subscribeLanguageChange(() => (langTick += 1));
    const unsubscribeLexicon = subscribeLexiconEnabledChange((enabled) => (lexiconEnabled = enabled));
    return () => {
      unsubscribeLanguage();
      unsubscribeLexicon();
    };
  });

  // 词库被关闭时若正停留在词库页则切到服务页，避免渲染已隐藏页面的内容
  $effect(() => {
    if (!lexiconEnabled && activePage === "lexicon") activePage = "service";
  });

  /** tab 配置列表；词库关闭时仅保留服务页，新增页面时在此追加条目并在下方 {#if} 分支补充组件 */
  const TABS: Array<{ id: SidebarPage; label: () => string }> = $derived(
    lexiconEnabled
      ? [
          { id: "lexicon", label: () => t("sidebar.lexicon") },
          { id: "service", label: () => t("sidebar.service") },
        ]
      : [{ id: "service", label: () => t("sidebar.service") }],
  );
</script>

{#key langTick}
  <div class="lsr-sidebar">
    <nav class="lsr-sidebar-tabs">
      {#each TABS as tab (tab.id)}
        <button
          type="button"
          class="lsr-sidebar-tab"
          class:active={activePage === tab.id}
          onclick={() => (activePage = tab.id)}
        >
          {tab.label()}
        </button>
      {/each}
    </nav>
    <div class="lsr-sidebar-content">
      {#if activePage === "lexicon" && lexiconEnabled}
        <LexiconPage {plugin} />
      {:else}
        <ServicePage {plugin} />
      {/if}
    </div>
  </div>
{/key}

<style>
  .lsr-sidebar {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .lsr-sidebar-tabs {
    display: flex;
    gap: 4px;
    padding: 8px;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .lsr-sidebar-tab {
    flex: 1;
    padding: 6px 8px;
    border: none;
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--text-muted);
    font-size: var(--font-ui-small);
    cursor: pointer;
  }

  .lsr-sidebar-tab:hover {
    background: var(--background-modifier-hover);
  }

  .lsr-sidebar-tab.active {
    background: var(--background-modifier-active-hover);
    color: var(--text-normal);
  }

  .lsr-sidebar-content {
    flex: 1;
    width: 100%;
    padding: 12px;
    overflow-y: auto;
  }
</style>
