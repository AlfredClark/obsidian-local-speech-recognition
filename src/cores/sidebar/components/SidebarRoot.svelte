<script lang="ts">
  import { subscribeLanguageChange, t } from "../../i18n";
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

  // 订阅语言变更并在卸载时自动退订；t() 为普通函数调用，Svelte 无法追踪其依赖，须经 #key 重建
  $effect(() => {
    return subscribeLanguageChange(() => (langTick += 1));
  });

  /** tab 配置列表；新增页面时在此追加条目并在下方 {#if} 分支补充组件 */
  const TABS: Array<{ id: SidebarPage; label: () => string }> = [
    { id: "lexicon", label: () => t("sidebar.lexicon") },
    { id: "service", label: () => t("sidebar.service") },
  ];
</script>

{#key langTick}
  <div class="novel-sidebar">
    <nav class="novel-sidebar-tabs">
      {#each TABS as tab (tab.id)}
        <button
          type="button"
          class="novel-sidebar-tab"
          class:active={activePage === tab.id}
          onclick={() => (activePage = tab.id)}
        >
          {tab.label()}
        </button>
      {/each}
    </nav>
    <div class="novel-sidebar-content">
      {#if activePage === "lexicon"}
        <LexiconPage />
      {:else}
        <ServicePage {plugin} />
      {/if}
    </div>
  </div>
{/key}

<style>
  .novel-sidebar {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .novel-sidebar-tabs {
    display: flex;
    gap: 4px;
    padding: 8px;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .novel-sidebar-tab {
    flex: 1;
    padding: 6px 8px;
    border: none;
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--text-muted);
    font-size: var(--font-ui-small);
    cursor: pointer;
  }

  .novel-sidebar-tab:hover {
    background: var(--background-modifier-hover);
  }

  .novel-sidebar-tab.active {
    background: var(--background-modifier-active-hover);
    color: var(--text-normal);
  }

  .novel-sidebar-content {
    flex: 1;
    padding: 12px;
    overflow-y: auto;
  }
</style>
