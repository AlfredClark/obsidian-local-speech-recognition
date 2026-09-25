import type { GamepadButtonName } from "./types";

/** 左摇杆角色：另一角色自动归属右摇杆 */
export type GamepadStickRole = "cursor" | "scroll";

/** 上下轴角色：切片段或段内选候选 */
export type GamepadDpadRole = "span" | "candidate";

/** 左右轴角色：切片段、段内选候选或单步一字 */
export type GamepadDpadLRRole = GamepadDpadRole | "char";

/** 单个预设的完整键位：功能键为标准映射物理索引，摇杆与十字键为角色 */
export interface GamepadPreset {
  record: number;
  confirm: number;
  cancel: number;
  /** 换行键物理索引；缺省表示该预设无换行键 */
  newline?: number;
  /** 精确左移物理索引；缺省表示该预设无此键 */
  cursorLeft?: number;
  /** 精确右移物理索引；缺省表示该预设无此键 */
  cursorRight?: number;
  /** 上一片段物理索引；缺省表示该预设无此键 */
  spanPrev?: number;
  /** 下一片段物理索引；缺省表示该预设无此键 */
  spanNext?: number;
  leftStick: GamepadStickRole;
  dpadLeftRight: GamepadDpadLRRole;
  dpadUpDown: GamepadDpadRole;
}

/**
 * 预设登记表：新增预设只需追加条目，轮询映射、执行分流与设置页展示自动跟随。
 * 索引为标准映射位置（0 下/1 右/2 左/3 上/5 RB），与键帽印刷无关。
 */
export const GAMEPAD_PRESETS = {
  /** 标准预设：左滚视口、右动光标，左右切换候选段、上下段内选候选，X 换行、LB/RB 精确单步 */
  standard: {
    record: 3,
    confirm: 0,
    cancel: 1,
    newline: 2,
    cursorLeft: 4,
    cursorRight: 5,
    leftStick: "scroll",
    dpadLeftRight: "span",
    dpadUpDown: "candidate",
  },
  /** 肩键预设：LB/RB 切换片段，左右单步一字，其余与标准预设相同 */
  shoulder: {
    record: 3,
    confirm: 0,
    cancel: 1,
    newline: 2,
    spanPrev: 4,
    spanNext: 5,
    leftStick: "scroll",
    dpadLeftRight: "char",
    dpadUpDown: "candidate",
  },
} as const;

/** 预设标识，由登记表键推导 */
export type GamepadPresetId = keyof typeof GAMEPAD_PRESETS;

/** 默认预设：标准布局 */
export const DEFAULT_GAMEPAD_PRESET_ID: GamepadPresetId = "standard";

/**
 * 预设标识守卫：旧版本或手改 data.json 出现未知标识时回退默认，避免下拉与映射落空。
 * @param value 待校验的值
 * @returns 是否为合法的预设标识
 */
export function isGamepadPresetId(value: unknown): value is GamepadPresetId {
  return typeof value === "string" && value in GAMEPAD_PRESETS;
}

/** 常驻逻辑动作到轮询按键名的映射：换行键可选，单列处理 */
const ACTION_TO_BUTTON: ReadonlyArray<readonly ["record" | "confirm" | "cancel", GamepadButtonName]> = [
  ["record", "record"],
  ["confirm", "confirm"],
  ["cancel", "cancel"],
];

/**
 * 按预设构建轮询用的索引映射：物理索引到逻辑动作，固定十字键一并纳入。
 * 可选键（换行/精确移动）仅在预设定义时纳入，未定义则对应动作无输入源。
 * @param preset 当前预设的映射表
 * @param dpadIndices 固定十字键索引（上/下/左/右），不随预设变化
 * @returns 物理索引到逻辑动作的映射
 */
export function buildButtonMap(
  preset: GamepadPreset,
  dpadIndices: readonly [number, number, number, number],
): ReadonlyMap<number, GamepadButtonName> {
  const map = new Map<number, GamepadButtonName>();
  const [up, down, left, right] = dpadIndices;
  map.set(up ?? -1, "dpadUp");
  map.set(down ?? -1, "dpadDown");
  map.set(left ?? -1, "dpadLeft");
  map.set(right ?? -1, "dpadRight");
  for (const [action, name] of ACTION_TO_BUTTON) {
    map.set(preset[action], name);
  }
  if (preset.newline !== undefined) map.set(preset.newline, "newline");
  if (preset.cursorLeft !== undefined) map.set(preset.cursorLeft, "cursorLeft");
  if (preset.cursorRight !== undefined) map.set(preset.cursorRight, "cursorRight");
  if (preset.spanPrev !== undefined) map.set(preset.spanPrev, "spanPrev");
  if (preset.spanNext !== undefined) map.set(preset.spanNext, "spanNext");
  return map;
}

/** 物理按键展示名：专有名词不翻译，同模型名处理 */
const BUTTON_LABELS: ReadonlyMap<number, string> = new Map([
  [0, "A"],
  [1, "B"],
  [2, "X"],
  [3, "Y"],
  [4, "LB"],
  [5, "RB"],
  [6, "LT"],
  [7, "RT"],
  [8, "Back"],
  [9, "Start"],
  [10, "L3"],
  [11, "R3"],
]);

/**
 * 物理索引转展示名：供设置页展示区使用，未登记时回退索引本身。
 * @param index 标准映射物理索引
 * @returns 按键展示名
 */
export function describeGamepadButton(index: number): string {
  return BUTTON_LABELS.get(index) ?? `#${index}`;
}
