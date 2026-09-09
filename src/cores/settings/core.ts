import { Notice, PluginSettingTab } from "obsidian";
import type { SettingDefinitionItem, SettingGroupItem } from "obsidian";
import type { LocalSpeechRecognitionPluginSettings } from "./types";
import { getSherpaServer, resolveDetail, toServerConfig } from "../sherpa-server";
import { notifyLanguageChange, t } from "../i18n";
import type LocalSpeechRecognitionPlugin from "../../main";

/** 设置默认值。data.json 缺失字段时（如旧版本升级）以此为兜底合并 */
export const DEFAULT_SETTINGS: LocalSpeechRecognitionPluginSettings = {
  collapsible: false,
  language: "system",
  binaryPath: "",
  modelPath: "",
  host: "127.0.0.1",
  port: 6006,
  numThreads: 4,
  autoStartServer: false,
  inputMode: "toggle",
};

/**
 * 初始化设置模块：加载持久化设置并注册设置页。
 * 必须在业务功能初始化之前调用，后者依赖 settings 已就绪。
 * @param plugin 插件实例；type-only 导入具体类，运行时无循环
 */
export async function initSettings(plugin: LocalSpeechRecognitionPlugin): Promise<void> {
  plugin.settings = await loadSettings(plugin);
  plugin.addSettingTab(new SettingsTab(plugin));
}

/** 连接测试超时毫秒数：局域网拨号无响应时兜底失败，避免按钮长挂起 */
const CONNECTION_TEST_TIMEOUT_MS = 5000;

/**
 * 拨号指定 websocket 地址：open 即 resolve 并关闭连接，
 * error/超时即 reject；调用方只关心可达性，不消费消息。
 * @param url 待拨号的 websocket 地址
 */
function openWebSocket(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = window.setTimeout(() => {
      socket.close();
      reject(new Error("timeout"));
    }, CONNECTION_TEST_TIMEOUT_MS);
    socket.onopen = () => {
      window.clearTimeout(timer);
      socket.close();
      resolve();
    };
    socket.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("unreachable"));
    };
  });
}

/**
 * 错误详情提取：Error 取 message，其余类型转字符串，保证 Notice 文案可读。
 * @param error 捕获到的未知错误
 * @returns 可展示的错误详情文本
 */
function toErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 从 data.json 读取设置并与默认值浅合并。
 * 用展开运算而非 Object.assign，避免共享默认对象被意外修改。
 * @param plugin 插件实例
 * @returns 合并后的完整设置对象
 */
export async function loadSettings(plugin: LocalSpeechRecognitionPlugin): Promise<LocalSpeechRecognitionPluginSettings> {
  const data = (await plugin.loadData()) as Partial<LocalSpeechRecognitionPluginSettings> | null;
  return { ...DEFAULT_SETTINGS, ...data };
}

/**
 * 设置页。使用 1.13.0+ 声明式 API（getSettingDefinitions），不用已废弃的 display()：
 * 读写 plugin.settings 与持久化由 Obsidian 自动完成，无需手写 onChange。
 */
export class SettingsTab extends PluginSettingTab {
  plugin: LocalSpeechRecognitionPlugin;

  constructor(plugin: LocalSpeechRecognitionPlugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
    // 服务状态变化时刷新设置页：started/stopped/error 都会改变按钮显隐
    getSherpaServer().subscribeStatus(() => {
      void this.update();
    });
  }

  getSettingDefinitions(): SettingDefinitionItem<keyof LocalSpeechRecognitionPluginSettings>[] {
    return [
      {
        type: "group",
        name: t("settings.general"),
        heading: t("settings.general"),
        items: [
          {
            name: t("settings.language"),
            desc: t("settings.languageDesc"),
            control: {
              type: "dropdown",
              key: "language",
              defaultValue: "system",
              options: {
                system: t("settings.languageOptions.system"),
                en: t("settings.languageOptions.en"),
                zh: t("settings.languageOptions.zh"),
                "zh-TW": t("settings.languageOptions.zh-TW"),
              },
            },
          },
          {
            name: t("settings.collapsible"),
            desc: t("settings.collapsibleDesc"),
            control: {
              type: "toggle",
              key: "collapsible",
              defaultValue: false,
            },
          },
        ],
      },
      this.buildCollapsibleSection(t("settings.sherpa"), t("settings.sherpaDesc"), this.getSherpaItems()),
    ];
  }

  setControlValue(key: string, value: unknown) {
    void super.setControlValue(key, value);
    // 语言切换广播：设置页 update() 只重渲染自身，依赖 t() 的其他 UI 靠订阅刷新
    if (key === "language") {
      notifyLanguageChange();
    }
    void this.update();
  }

  /**
   * 可折叠分组：collapsible 开启时渲染为可导航子页（page），否则内联展开（group）。
   * 两种容器共用条目，仅容器形态由 collapsible 决定。
   */
  private buildCollapsibleSection<K extends string>(
    name: string,
    desc: string | undefined,
    items: SettingGroupItem<K>[],
  ): SettingDefinitionItem<K> {
    return this.plugin.settings.collapsible
      ? { type: "page", name, desc, items }
      : { type: "group", name, heading: name, items };
  }

  /**
   * sherpa-onnx 服务条目：服务端路径、监听地址、线程数与触发模式等。
   * 与其他可折叠分组共用条目结构，容器形态由 collapsible 决定。
   */
  private getSherpaItems(): SettingGroupItem<keyof LocalSpeechRecognitionPluginSettings>[] {
    return [
      {
        name: t("settings.binaryPath"),
        desc: t("settings.binaryPathDesc"),
        control: {
          type: "text",
          key: "binaryPath",
          defaultValue: "",
          placeholder: t("settings.binaryPathPlaceholder"),
        },
      },
      {
        name: t("settings.modelPath"),
        desc: t("settings.modelPathDesc"),
        control: {
          type: "text",
          key: "modelPath",
          defaultValue: "",
          placeholder: t("settings.modelPathPlaceholder"),
        },
      },
      {
        name: t("settings.host"),
        desc: t("settings.hostDesc"),
        control: {
          type: "text",
          key: "host",
          defaultValue: "127.0.0.1",
          placeholder: t("settings.hostPlaceholder"),
        },
      },
      {
        name: t("settings.port"),
        desc: t("settings.portDesc"),
        control: {
          type: "number",
          key: "port",
          defaultValue: 6006,
          min: 1,
          max: 65535,
        },
      },
      {
        name: t("settings.numThreads"),
        desc: t("settings.numThreadsDesc"),
        control: {
          type: "number",
          key: "numThreads",
          defaultValue: 4,
          min: 1,
        },
      },
      {
        name: t("settings.testConnection"),
        desc: t("settings.testConnectionDesc"),
        render: (setting) => {
          setting.addButton((button) =>
            button.setButtonText(t("settings.testConnection")).onClick(() => {
              void this.testConnection();
            }),
          );
        },
      },
      {
        name: t("settings.autoStartServer"),
        desc: t("settings.autoStartServerDesc"),
        control: {
          type: "toggle",
          key: "autoStartServer",
          defaultValue: false,
        },
      },
      {
        name: t("settings.serviceStart"),
        desc: t("settings.serviceStartDesc"),
        visible: () => !getSherpaServer().isRunning(),
        render: (setting) => {
          setting.addButton((button) =>
            button.setButtonText(t("settings.serviceStart")).onClick(() => {
              void this.startService();
            }),
          );
        },
      },
      {
        name: t("settings.serviceStop"),
        desc: t("settings.serviceStopDesc"),
        visible: () => getSherpaServer().isRunning(),
        render: (setting) => {
          setting.addButton((button) =>
            button.setButtonText(t("settings.serviceStop")).onClick(() => {
              void this.stopService();
            }),
          );
        },
      },
      {
        name: t("settings.serviceRestart"),
        desc: t("settings.serviceRestartDesc"),
        visible: () => getSherpaServer().isRunning(),
        render: (setting) => {
          setting.addButton((button) =>
            button.setButtonText(t("settings.serviceRestart")).onClick(() => {
              void this.restartService();
            }),
          );
        },
      },
      {
        name: t("settings.inputMode"),
        desc: t("settings.inputModeDesc"),
        control: {
          type: "dropdown",
          key: "inputMode",
          defaultValue: "toggle",
          options: {
            toggle: t("settings.inputModeOptions.toggle"),
            "push-to-talk": t("settings.inputModeOptions.push-to-talk"),
          },
        },
      },
    ];
  }

  /**
   * 连接测试：按当前 host/port 拨号 sherpa-onnx websocket 服务，
   * 连接建立即判活并关闭，不发送音频数据；结果经 Notice 提示。
   */
  private async testConnection(): Promise<void> {
    const { host, port } = this.plugin.settings;
    new Notice(t("settings.testingConnection"), 1000);
    try {
      await openWebSocket(`ws://${host}:${port}`);
      new Notice(t("settings.connectionSucceeded"), 3000);
    } catch (error) {
      new Notice(t("settings.connectionFailed", { detail: toErrorDetail(error) }), 3000);
    }
  }

  /**
   * 手动启动服务：按当前设置拉起进程，成功失败均经 Notice 提示，
   * 状态广播会触发设置页刷新，无需此处手动 update。
   */
  private async startService(): Promise<void> {
    new Notice(t("settings.serverStarting"), 1000);
    const result = await getSherpaServer().start(toServerConfig(this.plugin));
    if (result.ok) {
      new Notice(t("settings.serverStarted"), 3000);
    } else if (result.detail === "already-running") {
      new Notice(t("settings.serverAlreadyRunning"), 3000);
    } else {
      new Notice(t("settings.serverStartFailed", { detail: resolveDetail(result.detail) }), 5000);
    }
  }

  /**
   * 手动关闭服务：同步 kill 进程，状态广播触发按钮显隐刷新。
   */
  private stopService(): void {
    getSherpaServer().stop();
    new Notice(t("settings.serverStopped"), 3000);
  }

  /**
   * 手动重启服务：先同步关闭再按当前设置拉起，结果经 Notice 提示。
   */
  private async restartService(): Promise<void> {
    new Notice(t("settings.serverStarting"), 1000);
    const result = await getSherpaServer().restart(toServerConfig(this.plugin));
    if (result.ok) {
      new Notice(t("settings.serverStarted"), 3000);
    } else {
      new Notice(t("settings.serverStartFailed", { detail: resolveDetail(result.detail) }), 5000);
    }
  }
}
