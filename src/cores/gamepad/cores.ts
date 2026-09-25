import type LocalSpeechRecognitionPlugin from "../../main";
import type { GamepadButtonName, GamepadFrame, GamepadFrameHandler, GamepadStickState } from "./types";
import { buildButtonMap } from "./presets";
import type { GamepadPreset } from "./presets";

/** 标准映射十字键索引：上 12、下 13、左 14、右 15，不随预设变化 */
export const BUTTON_INDEX_DPAD_UP = 12;
export const BUTTON_INDEX_DPAD_DOWN = 13;
export const BUTTON_INDEX_DPAD_LEFT = 14;
export const BUTTON_INDEX_DPAD_RIGHT = 15;
/** 摇杆轴索引：左摇杆 XY=0/1，右摇杆 XY=2/3 */
export const AXIS_INDEX_LEFT_X = 0;
export const AXIS_INDEX_LEFT_Y = 1;
export const AXIS_INDEX_RIGHT_X = 2;
export const AXIS_INDEX_RIGHT_Y = 3;

/** 默认摇杆死区：低于此幅度的漂移视为 0，避免手柄回中不准导致光标自走 */
export const DEFAULT_GAMEPAD_DEADZONE = 0.25;

/** 按键索引到逻辑动作的映射；功能键随预设变化，十字键固定方向语义 */
const DPAD_INDICES: readonly [number, number, number, number] = [
  BUTTON_INDEX_DPAD_UP,
  BUTTON_INDEX_DPAD_DOWN,
  BUTTON_INDEX_DPAD_LEFT,
  BUTTON_INDEX_DPAD_RIGHT,
];

/**
 * 摇杆死区过滤：幅度内归 0，之外保持符号并重归一化到 0..1。
 * @param value 原始轴值（-1..1）
 * @param deadzone 死区阈值，默认 DEFAULT_GAMEPAD_DEADZONE
 * @returns 过滤后的轴值
 */
export function applyDeadzone(value: number, deadzone: number = DEFAULT_GAMEPAD_DEADZONE): number {
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  const sign = value > 0 ? 1 : -1;
  return sign * ((magnitude - deadzone) / (1 - deadzone));
}

/**
 * 轮询输入配置：预设映射与死区阈值，feature 侧逐帧供给，设置页拖动下帧即生效。
 */
export interface GamepadInputConfig {
  preset: GamepadPreset;
  deadzone: number;
}

/**
 * 启动手柄轮询：每帧按当前配置换算边沿后回调。
 * 关闭开关期间跳过回调并复位上一帧状态，避免重新启用时把按住的旧键误判为新按下。
 * @param plugin 插件实例；type-only 导入具体类，运行时无循环
 * @param handler 帧回调，处理按键边沿与摇杆向量
 * @param isActive 是否启用问询，关闭时轮询空转
 * @param resolveInput 当前输入配置问询，切换后下帧即生效
 * @returns 停止轮询的清理函数，取消 rAF（连接监听经 registerDomEvent 随插件卸载自动回收）
 */
export function startGamepadPolling(
  plugin: LocalSpeechRecognitionPlugin,
  handler: GamepadFrameHandler,
  isActive: () => boolean,
  resolveInput: () => GamepadInputConfig,
): () => void {
  // 断连时复位上一帧，避免残留的按住状态在下次连接时误触发
  plugin.registerDomEvent(window, "gamepaddisconnected", () => {
    previous.clear();
  });
  let stopped = false;
  let frameId = 0;
  const previous = new Map<GamepadButtonName, boolean>();
  const tick = (): void => {
    if (stopped) return;
    if (isActive()) {
      const input = resolveInput();
      const snapshot = readFirstGamepad(input.deadzone);
      const buttonMap = buildButtonMap(input.preset, DPAD_INDICES);
      const pressed = new Set<GamepadButtonName>();
      const held = new Set<GamepadButtonName>();
      for (const [index, name] of buttonMap) {
        const down = snapshot.buttons.get(index) === true;
        if (down) held.add(name);
        if (down && previous.get(name) !== true) pressed.add(name);
        previous.set(name, down);
      }
      handler(snapshot.frame, pressed, held);
    } else if (previous.size > 0) {
      previous.clear();
    }
    // 计时器走主窗口：obsidianmd 规则要求 timer 用 window，且轮询与用户激活无关
    frameId = window.requestAnimationFrame(tick);
  };
  frameId = window.requestAnimationFrame(tick);
  return () => {
    stopped = true;
    window.cancelAnimationFrame(frameId);
  };
}

/** 单次读取结果：标准化帧 + 按索引的按键按下表 */
interface GamepadSnapshot {
  frame: GamepadFrame;
  buttons: ReadonlyMap<number, boolean>;
}

/** 读取首个已连接手柄并标准化，未连接或 API 不可用时返回空快照 */
function readFirstGamepad(deadzone: number): GamepadSnapshot {
  const empty: GamepadSnapshot = {
    frame: {
      connected: false,
      leftStick: { x: 0, y: 0 },
      rightStick: { x: 0, y: 0 },
    },
    buttons: new Map(),
  };
  const navigatorRef = window.navigator;
  if (typeof navigatorRef.getGamepads !== "function") return empty;
  const pads = navigatorRef.getGamepads();
  if (pads === null) return empty;
  let active: Gamepad | null = null;
  for (const pad of pads) {
    if (pad !== null && pad.connected) {
      active = pad;
      break;
    }
  }
  if (active === null) return empty;
  const buttons = new Map<number, boolean>();
  for (let index = 0; index < active.buttons.length; index++) {
    const button = active.buttons[index];
    buttons.set(index, button?.pressed === true);
  }
  const leftStick: GamepadStickState = {
    x: applyDeadzone(active.axes[AXIS_INDEX_LEFT_X] ?? 0, deadzone),
    y: applyDeadzone(active.axes[AXIS_INDEX_LEFT_Y] ?? 0, deadzone),
  };
  const rightStick: GamepadStickState = {
    x: applyDeadzone(active.axes[AXIS_INDEX_RIGHT_X] ?? 0, deadzone),
    y: applyDeadzone(active.axes[AXIS_INDEX_RIGHT_Y] ?? 0, deadzone),
  };
  return { frame: { connected: true, leftStick, rightStick }, buttons };
}
