<script lang="ts">
  import { getSherpaServer } from "../../sherpa-server";
  import type { SherpaServerStatus } from "../../sherpa-server";
  import { resolveSherpaUrl, SHERPA_MODELS } from "../../../utils/sherpa-process";
  import { subscribeLanguageChange, t } from "../../i18n";
  import type { TranslationKey } from "../../i18n";
  import { openSettings, restartService, startService, stopService, testConnection } from "../../settings/service-actions";
  import type LocalSpeechRecognitionPlugin from "../../../main";

  /** 插件实例；启停服务时按最新设置组装配置，挂载时由 SidebarRoot 传入 */
  let { plugin }: { plugin: LocalSpeechRecognitionPlugin } = $props();

  /** 当前服务状态；订阅 sherpa 单例广播刷新，卸载时自动退订 */
  let status = $state<SherpaServerStatus>(getSherpaServer().getStatus());

  // 状态订阅与语言订阅均在组件挂载时注册，卸载时自动退订；
  // t() 为普通函数调用，Svelte 无法追踪其依赖，语言切换经 #key 重建
  $effect(() => {
    const unsubscribeStatus = getSherpaServer().subscribeStatus(() => {
      status = getSherpaServer().getStatus();
    });
    const unsubscribeLanguage = subscribeLanguageChange(() => (langTick += 1));
    return () => {
      unsubscribeStatus();
      unsubscribeLanguage();
    };
  });

  /** 语言版本标记；语言切换时递增，{#key} 强制重建内容块使模板中的 t() 重新求值 */
  let langTick = $state(0);

  /** 状态徽标文案键；四状态与翻译键一一对应 */
  function statusKey(value: SherpaServerStatus): TranslationKey {
    if (value === "running") return "sidebar.serviceRunning";
    if (value === "starting") return "sidebar.serviceStarting";
    if (value === "error") return "sidebar.serviceError";
    return "sidebar.serviceStopped";
  }

  /** 服务是否处于可操作状态；starting 时禁用按钮，避免并发启停互相覆盖 */
  const busy = $derived(status === "starting");

  /** 展示地址与配置同源：直接读最新设置，配置页修改后切回即刷新 */
  const address = $derived(resolveSherpaUrl(plugin.settings.host, plugin.settings.port));

  /** 未配置路径显示占位而非空行，视觉与 Obsidian 设置页 placeholder 对齐 */
  function displayPath(value: string): string {
    return value.trim() === "" ? t("sidebar.notSet") : value;
  }

  /** 自动启动开关布尔转文案 */
  function displayAutoStart(value: boolean): string {
    return value ? t("sidebar.enabled") : t("sidebar.disabled");
  }
</script>

{#key langTick}
  <div>
    <h4>{t("sidebar.serviceStatus")}</h4>
    <p>
      <strong class="novel-service-badge" data-status={status}>{t(statusKey(status))}</strong>
    </p>
    <h4>{t("sidebar.serviceBinary")}</h4>
    <p class="novel-service-value">{displayPath(plugin.settings.binaryPath)}</p>
    <h4>{t("sidebar.serviceModel")}</h4>
    <p class="novel-service-value">{displayPath(plugin.settings.modelPath)}</p>
    <h4>{t("settings.modelType")}</h4>
    <p>{SHERPA_MODELS[plugin.settings.modelType].name}</p>
    <h4>{t("settings.host")}</h4>
    <p>{plugin.settings.host}</p>
    <h4>{t("settings.port")}</h4>
    <p>{plugin.settings.port}</p>
    <h4>{t("sidebar.serviceThreads")}</h4>
    <p>{plugin.settings.numThreads}</p>
    <h4>{t("sidebar.serviceAutoStart")}</h4>
    <p>{displayAutoStart(plugin.settings.autoStartServer)}</p>
    <h4>{t("sidebar.serviceAddress")}</h4>
    <p class="novel-service-value">{address}</p>
    <p>
      {#if status === "stopped" || status === "error"}
        <button type="button" disabled={busy} onclick={() => void startService(plugin)}>
          {t("settings.serviceStart")}
        </button>
      {:else}
        <button type="button" disabled={busy} onclick={() => stopService(plugin)}>
          {t("settings.serviceStop")}
        </button>
        <button type="button" disabled={busy} onclick={() => void restartService(plugin)}>
          {t("settings.serviceRestart")}
        </button>
      {/if}
      <button type="button" disabled={busy} onclick={() => void testConnection(plugin)}>
        {t("settings.testConnection")}
      </button>
      <button type="button" onclick={() => openSettings(plugin)}>
        {t("sidebar.openSettings")}
      </button>
    </p>
  </div>
{/key}

<style>
  /* 长路径不断行会撑破侧边栏，仅保留换行规则；行间距与字号字重全部交给 h4/p 原生边距 */
  .novel-service-value {
    overflow-wrap: anywhere;
  }

  .novel-service-badge[data-status="running"] {
    color: var(--text-success);
  }

  .novel-service-badge[data-status="starting"] {
    color: var(--text-warning);
  }

  .novel-service-badge[data-status="error"] {
    color: var(--text-error);
  }
</style>
