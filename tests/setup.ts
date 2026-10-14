import { mock } from "bun:test";

// obsidian 是纯类型包（运行时无具名导出），单测按需 stub；
// 值导入的类给空壳（import 绑定与 extends 只需存在、可构造），函数给最小实现。
// 被测模块的 window/navigator/IndexedDB 调用都在函数体内，import 阶段安全。
class ObsidianStub {}

mock.module("obsidian", () => ({
  Platform: {
    isDesktop: true,
    isMobile: false,
    isWin: false,
    isLinux: true,
    isMacOS: false,
  },
  getLanguage: () => "en",
  Menu: ObsidianStub,
  Notice: ObsidianStub,
  Modal: ObsidianStub,
  ButtonComponent: ObsidianStub,
  PluginSettingTab: ObsidianStub,
  MarkdownView: ObsidianStub,
  ItemView: ObsidianStub,
  setIcon: () => undefined,
}));
