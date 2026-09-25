/** 手柄输入 core 模块对外类型 */

/** 手柄逻辑动作名：布尔动作映射到固定物理按键，十字键固定方向语义；扳机走模拟量通道 */
export type GamepadButtonName =
  "record" | "confirm" | "cancel" | "undo" | "lineUp" | "lineDown" | "dpadUp" | "dpadDown" | "dpadLeft" | "dpadRight";

/** 死区过滤后的摇杆向量，分量已归一化到 -1..1，死区内为 0 */
export interface GamepadStickState {
  x: number;
  y: number;
}

/** 扳机模拟量原始值：左扳机后退、右扳机前进，各自 0..1 */
export interface GamepadTriggerState {
  left: number;
  right: number;
}

/** 单帧手柄快照：摇杆为死区后向量，connected 表示本帧是否读到手柄 */
export interface GamepadFrame {
  /** 本帧是否读到已连接的手柄，未读到时摇杆与扳机均为 0 */
  connected: boolean;
  /** 左摇杆：X 逐字、Y 逐行移动编辑器光标 */
  leftStick: GamepadStickState;
  /** 右摇杆：仅 Y 生效，控制编辑器视口滚动 */
  rightStick: GamepadStickState;
  /** 扳机模拟量：左退右进，各自 0..1（数字手柄回退为 0/1） */
  triggers: GamepadTriggerState;
}

/** 轮询帧回调：pressed 仅含本帧新按下的按键，held 含本帧保持按住的按键 */
export interface GamepadFrameHandler {
  (frame: GamepadFrame, pressed: ReadonlySet<GamepadButtonName>, held: ReadonlySet<GamepadButtonName>): void;
}
