import { Notice } from "obsidian";
import { enumerateAudioInputDevices } from "../audio-capture";
import type { AudioDeviceInfo } from "../audio-capture";
import { t } from "../i18n";
import type LocalSpeechRecognitionPlugin from "../../main";
import { toErrorDetail } from "./service-actions";

/**
 * 麦克风设备缓存：deviceId 随插拔变化，不进 data.json，只在内存中供下拉框使用。
 * 从 SettingsTab 私有字段提升为独立小类，设置页只做组装与委托。
 */
export class MicrophoneStore {
  /** 设备缓存 */
  private microphones: Array<AudioDeviceInfo> = [];

  /**
   * 组装麦克风下拉选项：首项恒为系统默认，其余来自设备缓存。
   * 已保存但当前未枚举到的 id 会保留原值展示，避免下拉框显示空白。
   * @param plugin 插件实例（读已保存的 microphoneDeviceId）
   */
  options(plugin: LocalSpeechRecognitionPlugin): Record<string, string> {
    const options: Record<string, string> = { "": t("settings.defaultMicrophone") };
    const saved = plugin.settings.microphoneDeviceId;
    if (saved !== "" && !this.microphones.some((device) => device.deviceId === saved)) {
      options[saved] = saved;
    }
    const seen = new Set<string>(["", saved]);
    for (const device of this.microphones) {
      if (device.deviceId === "" || seen.has(device.deviceId)) continue;
      seen.add(device.deviceId);
      options[device.deviceId] = device.label;
    }
    return options;
  }

  /** 手动刷新麦克风：重新枚举设备，失败经 Notice 提示，由调用方重渲染 */
  async refresh(): Promise<void> {
    try {
      this.microphones = await enumerateAudioInputDevices();
    } catch (error) {
      new Notice(t("settings.refreshMicrophonesFailed", { detail: toErrorDetail(error) }), 3000);
    }
  }

  /**
   * 静默刷新麦克风：构造器中预拉一次设备列表，无提示。
   * 未授权等失败直接忽略，等用户手动点刷新按钮。
   */
  async refreshSilent(): Promise<void> {
    try {
      this.microphones = await enumerateAudioInputDevices();
    } catch {
      return;
    }
  }
}
