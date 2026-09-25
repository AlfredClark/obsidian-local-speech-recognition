import type LocalSpeechRecognitionPlugin from "../../main";
import type { GamepadButtonName, GamepadFrame, GamepadFrameHandler, GamepadStickState } from "./types";

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
/** 扳机索引：左 LT=6（后退）、右 RT=7（前进），标准映射固定位置 */
export const BUTTON_INDEX_LT = 6;
export const BUTTON_INDEX_RT = 7;

/** 默认摇杆死区：低于此幅度的漂移视为 0，避免手柄回中不准导致光标自走 */
export const DEFAULT_GAMEPAD_DEADZONE = 0.25;

/**
 * 物理索引到逻辑动作的静态映射（固定键位：Y录音/A确认/B取消/X撤销/LB上行/RB下行，
 * 十字键上/下/左/右固定方向语义；扳机走模拟量通道，不进此表）。
 */
const BUTTON_INDEX_TO_ACTION: ReadonlyMap<number, GamepadButtonName> = new Map([
  [3, "record"],
  [0, "confirm"],
  [1, "cancel"],
  [2, "undo"],
  [4, "lineUp"],
  [5, "lineDown"],
  [BUTTON_INDEX_DPAD_UP, "dpadUp"],
  [BUTTON_INDEX_DPAD_DOWN, "dpadDown"],
  [BUTTON_INDEX_DPAD_LEFT, "dpadLeft"],
  [BUTTON_INDEX_DPAD_RIGHT, "dpadRight"],
]);

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
 * 轮询输入配置：死区阈值，feature 侧逐帧供给，设置页拖动下帧即生效。
 */
export interface GamepadInputConfig {
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
      const pressed = new Set<GamepadButtonName>();
      const held = new Set<GamepadButtonName>();
      for (const [index, name] of BUTTON_INDEX_TO_ACTION) {
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
      triggers: { left: 0, right: 0 },
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
  return { frame: { connected: true, leftStick, rightStick, triggers: readTriggers(active) }, buttons };
}

/**
 * 采样扳机模拟量：value 0..1 原样透出（不经死区，执行层按阈值与深度调速）；
 * 数字手柄无 value 时按 pressed 回退 0/1，满按即基准速度。
 * @param pad 已连接的手柄
 * @returns 左右扳机深度
 */
function readTriggers(pad: Gamepad): { left: number; right: number } {
  return { left: readTriggerValue(pad, BUTTON_INDEX_LT), right: readTriggerValue(pad, BUTTON_INDEX_RT) };
}

/** 读取单个扳机深度并钳制到 0..1 */
function readTriggerValue(pad: Gamepad, index: number): number {
  const button = pad.buttons[index];
  if (button === undefined || button === null) return 0;
  if (typeof button.value === "number" && Number.isFinite(button.value)) {
    return Math.min(Math.max(button.value, 0), 1);
  }
  return button.pressed ? 1 : 0;
}
