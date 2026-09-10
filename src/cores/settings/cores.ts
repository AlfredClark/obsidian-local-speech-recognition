import { PluginSettingTab } from "obsidian";
import type { SettingDefinitionItem, SettingGroupItem } from "obsidian";
import type { LocalSpeechRecognitionPluginSettings } from "./types";
import { getSherpaServer } from "../sherpa-server";
import { notifyLanguageChange, t } from "../i18n";
import type LocalSpeechRecognitionPlugin from "../../main";
import { MicrophoneStore } from "./microphone-options";
import { clearLexicon, exportLexicon, importLexicon } from "./lexicon-actions";
import { restartService, startService, stopService, testConnection } from "./service-actions";

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
  microphoneDeviceId: "",
  lexiconEnabled: true,
};

/** 词库开关变更订阅回调集合；设置页写入后广播，词库 feature 与侧边栏据此启停 */
const lexiconEnabledListeners = new Set<(enabled: boolean) => void>();

/**
 * 订阅词库开关变更。开关键仅在设置页被切换（settings 层写入后广播），
 * 订阅方据此动态注册/注销编辑器集成、显隐侧边栏词库页。
 * @param listener 开关变更回调，参数为最新启用状态
 * @returns 取消订阅函数
 */
export function subscribeLexiconEnabledChange(listener: (enabled: boolean) => void): () => void {
  lexiconEnabledListeners.add(listener);
  return () => {
    lexiconEnabledListeners.delete(listener);
  };
}

/** 广播词库开关变更。由 settings 模块在 lexiconEnabled 写入后调用 */
function notifyLexiconEnabledChange(enabled: boolean): void {
  lexiconEnabledListeners.forEach((listener) => listener(enabled));
}

/**
 * 初始化设置模块：加载持久化设置并注册设置页。
 * 必须在业务功能初始化之前调用，后者依赖 settings 已就绪。
 * @param plugin 插件实例；type-only 导入具体类，运行时无循环
 */
export async function initSettings(plugin: LocalSpeechRecognitionPlugin): Promise<void> {
  plugin.settings = await loadSettings(plugin);
  plugin.addSettingTab(new SettingsTab(plugin));
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
 * 设置页。使用 1.13.1+ 声明式 API（getSettingDefinitions），不用已废弃的 display()：
 * 读写 plugin.settings 与持久化由 Obsidian 自动完成，无需手写 onChange。
 */
export class SettingsTab extends PluginSettingTab {
  plugin: LocalSpeechRecognitionPlugin;
  /** 麦克风设备缓存：deviceId 随插拔变化，不进 data.json，只在内存中供下拉框使用 */
  private microphones = new MicrophoneStore();

  constructor(plugin: LocalSpeechRecognitionPlugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
    // 服务状态变化时刷新设置页：started/stopped/error 都会改变按钮显隐
    const unsubscribe = getSherpaServer().subscribeStatus(() => {
      void this.update();
    });
    // Tab 与插件同寿命：用 plugin.register 托管退订，避免热重载残留闭包
    plugin.register(unsubscribe);
    void this.microphones.refreshSilent().then(() => {
      // 成功失败都重渲染一次：失败时下拉框仍需按空缓存绘制
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
      this.buildCollapsibleSection(t("settings.recognition"), t("settings.recognitionDesc"), this.getRecognitionItems()),
      this.buildCollapsibleSection(t("settings.lexicon"), t("settings.lexiconDesc"), this.getLexiconItems()),
    ];
  }

  setControlValue(key: string, value: unknown) {
    void super.setControlValue(key, value);
    // 语言切换广播：设置页 update() 只重渲染自身，依赖 t() 的其他 UI 靠订阅刷新
    if (key === "language") {
      notifyLanguageChange();
    }
    // 词库开关广播：编辑器集成与侧边栏词库页靠订阅动态启停
    if (key === "lexiconEnabled") {
      notifyLexiconEnabledChange(value === true);
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
              void testConnection(this.plugin);
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
              void startService(this.plugin);
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
              stopService(this.plugin);
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
              void restartService(this.plugin);
            }),
          );
        },
      },
    ];
  }

  /**
   * 语音输入条目：麦克风设备下拉、刷新按钮与触发模式。
   * 设备缓存只在内存中，下拉选项每次渲染时由缓存重建。
   */
  private getRecognitionItems(): SettingGroupItem<keyof LocalSpeechRecognitionPluginSettings>[] {
    return [
      {
        name: t("settings.microphone"),
        desc: t("settings.microphoneDesc"),
        control: {
          type: "dropdown",
          key: "microphoneDeviceId",
          defaultValue: "",
          options: this.microphones.options(this.plugin),
        },
      },
      {
        name: t("settings.refreshMicrophones"),
        desc: t("settings.refreshMicrophonesDesc"),
        render: (setting) => {
          setting.addButton((button) =>
            button.setButtonText(t("settings.refreshMicrophones")).onClick(() => {
              void this.microphones.refresh().then(() => {
                void this.update();
              });
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
   * 词库设置条目：启用开关 + 导出/导入（JSON 或每行一词的纯文本）/清空。
   * 开关为持久化设置，其余为动作行（点击委托 lexicon-actions.ts，反馈经 Notice 提示），
   * 动作行随开关隐藏，关闭词库时不再暴露管理入口。
   */
  private getLexiconItems(): SettingGroupItem<keyof LocalSpeechRecognitionPluginSettings>[] {
    return [
      {
        name: t("settings.lexiconEnable"),
        desc: t("settings.lexiconEnableDesc"),
        control: {
          type: "toggle",
          key: "lexiconEnabled",
          defaultValue: true,
        },
      },
      {
        name: t("settings.lexiconExport"),
        desc: t("settings.lexiconExportDesc"),
        visible: () => this.plugin.settings.lexiconEnabled,
        render: (setting) => {
          setting.addButton((button) =>
            button.setButtonText(t("settings.lexiconExport")).onClick(() => {
              void exportLexicon(this.plugin);
            }),
          );
        },
      },
      {
        name: t("settings.lexiconImport"),
        desc: t("settings.lexiconImportDesc"),
        visible: () => this.plugin.settings.lexiconEnabled,
        render: (setting) => {
          setting.addButton((button) =>
            button.setButtonText(t("settings.lexiconImport")).onClick(() => {
              void importLexicon(this.plugin);
            }),
          );
        },
      },
      {
        name: t("settings.lexiconClear"),
        desc: t("settings.lexiconClearDesc"),
        visible: () => this.plugin.settings.lexiconEnabled,
        render: (setting) => {
          setting.addButton((button) =>
            button
              .setButtonText(t("settings.lexiconClear"))
              .setDestructive()
              .onClick(() => {
                void clearLexicon(this.plugin);
              }),
          );
        },
      },
    ];
  }
}
