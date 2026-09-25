import { MarkdownView, Platform } from "obsidian";
import { dismissTargetEffect } from "../lexicon";
import { requestSpeechRecognitionTrigger } from "../speech-recognition";
import { getEnabledFuzzyPinyinMap, getEnabledPinyinMap, isLexiconEnabled } from "../../cores/lexicon";
import { startGamepadPolling } from "../../cores/gamepad";
import type { GamepadButtonName, GamepadFrame, GamepadStickState } from "../../cores/gamepad";
import { getCodeMirrorEditorView } from "../../utils/cm-utils";
import type LocalSpeechRecognitionPlugin from "../../main";
import type { EditorView } from "@codemirror/view";
import type { GamepadCandidateSpan } from "./types";

/** 满偏每帧滚动像素基数：乘以滚动倍率设置，60fps 满偏默认约 1300px/s */
const SCROLL_PIXELS_PER_FRAME = 22;
/** 扳机最小间隔毫秒：满按再快也不低于此值，防极端设置刷屏 */
const TRIGGER_MIN_INTERVAL_MS = 20;
/** 手柄当前高亮片段的激活样式类：左右切换时跟随，退出导航即清除 */
const ACTIVE_SPAN_CLASS = "lsr-target-active";
/** 候选浮层类名：选项容器/候选项/当前高亮项，样式见 styles.css */
const POPUP_CLASS = "lsr-candidate-popup";
const POPUP_ITEM_CLASS = "lsr-candidate-item";
const POPUP_ACTIVE_CLASS = "lsr-candidate-active";

/**
 * 初始化手柄输入功能：录音键触发录音、左摇杆移动光标、右摇杆滚动视口、十字键导航词库候选。
 * 默认关闭（gamepadEnabled），关闭时轮询空转且无任何行为。
 * 返回同步清理函数：停止轮询并退出候选导航，由 cleanFeatures 卸载时回收。
 * @param plugin 插件实例；type-only 导入具体类，运行时无循环
 * @returns 卸载时停止轮询并清理导航状态的清理函数
 */
export async function initGamepad(plugin: LocalSpeechRecognitionPlugin): Promise<() => void> {
  // 桌面端限定：插件本身 isDesktopOnly，移动端不会加载到此处，双重守卫
  if (!Platform.isDesktop) {
    return () => {
      /* 非桌面端不启动手柄轮询 */
    };
  }
  const controller = new GamepadInputController(plugin);
  const stopPolling = startGamepadPolling(
    plugin,
    (frame, pressed, held) => controller.handleFrame(frame, pressed, held),
    () => plugin.settings.gamepadEnabled,
    // 死区逐帧供给：设置页拖动下帧即生效，无需重启
    () => ({ deadzone: plugin.settings.gamepadDeadzone }),
  );
  return () => {
    stopPolling();
    controller.dispose();
  };
}

/** 手柄输入编排器：帧回调分流录音/确认取消/十字键连发/摇杆，视图解析统一收口 */
class GamepadInputController {
  private plugin: LocalSpeechRecognitionPlugin;
  private session = new CandidateNavigator();
  private lastCharFire = 0;
  private lastLineFire = 0;
  // 十字键按住连发计时：记录按住起点与上次触发，松开即清
  private dpadHoldStart = new Map<GamepadButtonName, number>();
  private dpadLastFire = new Map<GamepadButtonName, number>();
  // 扳机按住计时：左右独立，阈值以下或失焦即清零
  private triggerBack = { start: 0, last: 0 };
  private triggerForward = { start: 0, last: 0 };
  // 选取会话锚点：双扳机共享，松开保留以支持换向缩小；外部改动选区后下次边沿自动重建
  private selectAnchor: number | null = null;

  constructor(plugin: LocalSpeechRecognitionPlugin) {
    this.plugin = plugin;
  }

  /** 轮询帧入口：开关关闭时即停并退出导航，各按键分流处理 */
  handleFrame(frame: GamepadFrame, pressed: ReadonlySet<GamepadButtonName>, held: ReadonlySet<GamepadButtonName>): void {
    // 开关在 core 层已问询，此处二次读取保证关闭瞬间即停且退出导航
    if (!this.plugin.settings.gamepadEnabled) {
      this.session.exit();
      this.dpadHoldStart.clear();
      this.triggerBack.start = 0;
      this.triggerBack.last = 0;
      this.triggerForward.start = 0;
      this.triggerForward.last = 0;
      this.selectAnchor = null;
      return;
    }
    // 分发总览（改分流逻辑时逐项核对，防调用掉线；工具链不报未使用的私有方法）：
    // 录音/确认/撤销/取消/跳行×2/扳机选取×2/左右切段/上下选候选/双摇杆
    if (pressed.has("record")) this.triggerRecognition();
    if (pressed.has("confirm")) this.confirmSession();
    if (pressed.has("undo")) this.undoOnce();
    const now = performance.now();
    this.handleButtonB(pressed, held, now);
    // LB/RB 精确跳行：起跳手感与十字键一致、步进节奏与逐行一致
    const lineTiming = {
      delay: this.plugin.settings.gamepadHoldDelay,
      interval: this.plugin.settings.gamepadLineInterval,
    };
    this.handleDpad("lineUp", pressed, held, now, () => this.jumpLine(-1), lineTiming);
    this.handleDpad("lineDown", pressed, held, now, () => this.jumpLine(1), lineTiming);
    this.handleTriggers(frame, now);
    this.handleDpad("dpadLeft", pressed, held, now, () => this.navigateSpan(-1));
    this.handleDpad("dpadRight", pressed, held, now, () => this.navigateSpan(1));
    this.handleDpad("dpadUp", pressed, held, now, () => this.cycleCandidate(-1));
    this.handleDpad("dpadDown", pressed, held, now, () => this.cycleCandidate(1));
    if (frame.connected) {
      this.handleLeftStick(frame);
      this.handleRightStick(frame, now);
    }
  }

  /** 卸载时退出导航并清空连发计时与选取锚点，不等待任何异步 */
  dispose(): void {
    this.session.exit();
    this.dpadHoldStart.clear();
    this.dpadLastFire.clear();
    this.triggerBack.start = 0;
    this.triggerBack.last = 0;
    this.triggerForward.start = 0;
    this.triggerForward.last = 0;
    this.selectAnchor = null;
  }

  /** 录音键触发：复用语音识别的全局触发器，状态机与 busy 提示保持单一入口 */
  private triggerRecognition(): void {
    // 录音后识别会插入文本，已开浮层的锚点随即过期，先关浮层
    this.session.closePopup();
    requestSpeechRecognitionTrigger();
  }

  /** 确认键：浮层打开时落盘当前高亮候选并留在原地，文本中则换行（换行自带退导航） */
  private confirmSession(): void {
    if (this.session.isPopupOpen()) {
      this.session.confirmPopup();
      return;
    }
    this.insertNewlineOnce();
  }

  /**
   * 取消键分发：浮层打开时仅响应按下边沿关闭一次（按住不连发）；
   * 无浮层时为退格删除，要求编辑器聚焦，支持按住连删。
   */
  private handleButtonB(pressed: ReadonlySet<GamepadButtonName>, held: ReadonlySet<GamepadButtonName>, now: number): void {
    if (!held.has("cancel")) {
      this.dpadHoldStart.delete("cancel");
      return;
    }
    // 浮层打开时取消键只做取消：响应边沿一次，按住期间不再触发
    if (this.session.isPopupOpen()) {
      if (pressed.has("cancel")) this.session.closePopup();
      return;
    }
    const view = this.resolveEditorView(true);
    if (view === null) {
      this.dpadHoldStart.delete("cancel");
      return;
    }
    if (pressed.has("cancel")) {
      this.dpadHoldStart.set("cancel", now);
      this.dpadLastFire.set("cancel", now);
      this.deleteBackwardOnce(view);
      return;
    }
    const start = this.dpadHoldStart.get("cancel") ?? now;
    const last = this.dpadLastFire.get("cancel") ?? 0;
    if (now - start >= this.plugin.settings.gamepadHoldDelay && now - last >= this.plugin.settings.gamepadBackspaceInterval) {
      this.dpadLastFire.set("cancel", now);
      this.deleteBackwardOnce(view);
    }
  }

  /** 单次退格：删完即退出导航并废弃选取锚点（文档写入使缓存坐标过期），装饰经映射保留 */
  private deleteBackwardOnce(view: EditorView): void {
    deleteBackward(view);
    this.session.exit();
    this.selectAnchor = null;
  }

  /** 换行：边沿触发一次（不连发，防误触刷出空行），要求编辑器聚焦 */
  private insertNewlineOnce(): void {
    const view = this.resolveEditorView(true);
    if (view === null) return;
    this.session.closePopup();
    insertNewline(view);
    this.session.exit();
    this.selectAnchor = null;
  }

  /** 撤销：边沿触发一次（不连发），等效 Ctrl+Z，要求编辑器聚焦否则静默 */
  private undoOnce(): void {
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (view === null || view.getMode() !== "source") return;
    const editor = view.editor;
    if (!editor.hasFocus()) return;
    this.session.closePopup();
    editor.undo();
    this.session.exit();
    this.selectAnchor = null;
  }

  /** 肩键跳段：逻辑行整行跳转、列位保持，首尾无操作；仅关浮层不退导航 */
  private jumpLine(delta: -1 | 1): void {
    const view = this.resolveEditorView(true);
    if (view === null) return;
    this.session.closePopup();
    moveCursorByLogicalLine(view, delta);
  }

  /**
   * 扳机扩展选取：左退右进，共享锚点；按下沿新方向继续（同向追加、反向缩小），
   * 外部改动选区后自动新建锚点；按住持续扩展，深度连续控速。
   * 阈值以下视为松开（选区与锚点保留）；双扳机同按各走各的方向。
   */
  private handleTriggers(frame: GamepadFrame, now: number): void {
    this.handleTrigger("back", frame.triggers.left, -1, now);
    this.handleTrigger("forward", frame.triggers.right, 1, now);
  }

  /** 单扳机分发：边沿建锚或恢复会话并单步，按住按深度动态间隔扩展选区 */
  private handleTrigger(side: "back" | "forward", depth: number, delta: -1 | 1, now: number): void {
    const state = side === "back" ? this.triggerBack : this.triggerForward;
    const threshold = this.plugin.settings.gamepadTriggerThreshold;
    if (depth < threshold) {
      state.start = 0;
      state.last = 0;
      return;
    }
    const view = this.resolveEditorView(true);
    if (view === null) {
      state.start = 0;
      state.last = 0;
      return;
    }
    if (state.start === 0) {
      state.start = now;
      state.last = now;
      // 会话恢复：选区未折叠且实时锚点命中共享锚点时沿新方向继续（同向追加、反向缩小）；
      // 否则以光标新建锚点，外部改动选区后自动走此分支
      const main = view.state.selection.main;
      if (this.selectAnchor === null || main.anchor !== this.selectAnchor || main.anchor === main.head) {
        this.selectAnchor = main.head;
      }
      this.session.closePopup();
      extendSelection(view, this.selectAnchor, delta);
      return;
    }
    if (now - state.start >= this.plugin.settings.gamepadHoldDelay && now - state.last >= this.triggerInterval(depth)) {
      state.last = now;
      this.session.closePopup();
      extendSelection(view, this.selectAnchor, delta);
    }
  }

  /** 扳机动态间隔：深度归一化后线性映射，轻按 2 倍间隔、满按等于逐字基准 */
  private triggerInterval(depth: number): number {
    const threshold = this.plugin.settings.gamepadTriggerThreshold;
    const normalized = Math.min(Math.max((depth - threshold) / (1 - threshold), 0), 1);
    return Math.max(this.plugin.settings.gamepadCharInterval / (0.5 + 0.5 * normalized), TRIGGER_MIN_INTERVAL_MS);
  }

  /** 十字键分发：边沿立即触发，按住超阈值后连发，松开复位 */
  private handleDpad(
    name: GamepadButtonName,
    pressed: ReadonlySet<GamepadButtonName>,
    held: ReadonlySet<GamepadButtonName>,
    now: number,
    action: () => void,
    timing?: { delay: number; interval: number },
  ): void {
    if (!held.has(name)) {
      this.dpadHoldStart.delete(name);
      return;
    }
    if (pressed.has(name)) {
      this.dpadHoldStart.set(name, now);
      this.dpadLastFire.set(name, now);
      action();
      return;
    }
    const delay = timing?.delay ?? this.plugin.settings.gamepadHoldDelay;
    const interval = timing?.interval ?? this.plugin.settings.gamepadDpadInterval;
    const start = this.dpadHoldStart.get(name) ?? now;
    const last = this.dpadLastFire.get(name) ?? 0;
    if (now - start >= delay && now - last >= interval) {
      this.dpadLastFire.set(name, now);
      action();
    }
  }

  /** 左右切高亮片段：无候选段时回退逐字（与键盘左右键同语义）；词库关闭不拦回退 */
  private navigateSpan(delta: -1 | 1): void {
    if (this.isMouseMenuOpen()) return;
    const view = this.resolveEditorView(true);
    if (view === null) return;
    if (isLexiconEnabled() && this.session.ensure(view)) {
      this.session.closePopup();
      this.session.moveActive(delta);
      return;
    }
    this.session.closePopup();
    moveCursorByChar(view, delta);
  }

  /** 上下切候选：无候选段时回退视觉跳行（含折行，与键盘上下键同语义）；词库关闭不拦回退 */
  private cycleCandidate(delta: -1 | 1): void {
    if (this.isMouseMenuOpen()) return;
    const view = this.resolveEditorView(true);
    if (view === null) return;
    if (isLexiconEnabled() && this.session.ensure(view)) {
      this.session.cyclePopup(delta);
      return;
    }
    this.session.closePopup();
    moveCursorByLine(view, delta);
  }

  /** 左摇杆滚动视口、右摇杆移动光标，角色固定互补 */
  private handleLeftStick(frame: GamepadFrame): void {
    this.scrollByStick(frame.leftStick);
  }

  /** 右摇杆移动光标 */
  private handleRightStick(frame: GamepadFrame, now: number): void {
    this.moveCursorByStick(frame.rightStick, now);
  }

  /** 摇杆光标移动：X 逐字、Y 逐行，要求编辑器聚焦，避免焦点在别处时光标暗改 */
  private moveCursorByStick(stick: GamepadStickState, now: number): void {
    const { x, y } = stick;
    if (x === 0 && y === 0) {
      this.lastCharFire = 0;
      this.lastLineFire = 0;
      return;
    }
    const view = this.resolveEditorView(true);
    if (view === null) return;
    // 光标移动使浮层锚点过期，先关浮层
    this.session.closePopup();
    if (x !== 0 && now - this.lastCharFire >= this.plugin.settings.gamepadCharInterval) {
      this.lastCharFire = now;
      moveCursorByChar(view, x > 0 ? 1 : -1);
    }
    if (y !== 0 && now - this.lastLineFire >= this.plugin.settings.gamepadLineInterval) {
      this.lastLineFire = now;
      moveCursorByLine(view, y > 0 ? 1 : -1);
    }
  }

  /** 摇杆视口滚动：纯视口位移，不要求聚焦、不移动光标，无位移时不关浮层 */
  private scrollByStick(stick: GamepadStickState): void {
    const deltaY = stick.y;
    if (deltaY === 0) return;
    const view = this.resolveEditorView(false);
    if (view === null) return;
    this.session.closePopup();
    // 像素 = 基数 × 倍率 × 反转符号，反转仅作用于滚动轴
    const direction = this.plugin.settings.gamepadInvertScrollY ? -1 : 1;
    view.scrollDOM.scrollBy(0, deltaY * SCROLL_PIXELS_PER_FRAME * this.plugin.settings.gamepadScrollSpeed * direction);
  }

  /** 鼠标候选菜单打开时手柄让路：同片段双写会互相覆盖坐标 */
  private isMouseMenuOpen(): boolean {
    return activeDocument.querySelector(".menu") !== null;
  }

  /** 解析当前 Markdown 源码视图的 CM6 实例，形态不符或失焦时返回 null */
  private resolveEditorView(requireFocus: boolean): EditorView | null {
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (view === null || view.getMode() !== "source") return null;
    const editor = view.editor;
    if (requireFocus && !editor.hasFocus()) return null;
    return getCodeMirrorEditorView(editor);
  }
}

// 会话内片段：携带 DOM 引用（文档变更即重建，不长期持有）
interface SessionSpan extends GamepadCandidateSpan {
  el: Element;
}

// 浮层预览态：确认前不写文档，B/切换/滚动直接关闭且无副作用
interface PopupState {
  spanIndex: number;
  candidateIndex: number;
  el: HTMLElement;
}

/** 候选导航会话：数据源为鼠标链路写入的 .target-word 高亮，两套入口操作同一批装饰 */
class CandidateNavigator {
  private view: EditorView | null = null;
  private spans: SessionSpan[] = [];
  private active = 0;
  private popup: PopupState | null = null;

  hasSpans(): boolean {
    return this.spans.length > 0;
  }

  /** 浮层是否打开：打开期间上/下只动高亮，确认键落盘、取消键关闭 */
  isPopupOpen(): boolean {
    return this.popup !== null;
  }

  /** 保证会话与给定视图一致：视图切换或高亮消失时重建 */
  ensure(view: EditorView): boolean {
    if (this.view !== view || this.spans.length === 0) {
      if (!this.rebuild(view)) return false;
    }
    return true;
  }

  /**
   * 从 .target-word 高亮重建会话：候选检索与鼠标菜单同口径（精确+模糊双表、排除当前文本），
   * 无候选的片段直接跳过，保持导航列表与可替换项一致。
   */
  rebuild(view: EditorView): boolean {
    // 重建后旧坐标与 DOM 引用失效，已开浮层一并关闭
    this.closePopup();
    this.view = view;
    this.spans = [];
    this.active = 0;
    const maps = [getEnabledPinyinMap(), getEnabledFuzzyPinyinMap()];
    let elements: NodeListOf<Element>;
    try {
      elements = view.scrollDOM.querySelectorAll(".target-word");
    } catch {
      return false;
    }
    // 下标遍历而非 for..of：NodeList 的迭代协议在 lint 的 TS 程序下退化为 any
    for (let index = 0; index < elements.length; index++) {
      const el = elements[index];
      if (el === undefined) continue;
      const keys = (el.getAttribute("data-keys") ?? "").split(",").filter((key) => key !== "");
      if (keys.length === 0) continue;
      let from = 0;
      let to = 0;
      try {
        from = view.posAtDOM(el);
        to = view.posAtDOM(el, el.childNodes.length);
      } catch {
        // 视图销毁中的坐标查询失败可忽略，跳过该片段
        continue;
      }
      const current = view.state.sliceDoc(from, to);
      const candidates: string[] = [];
      for (const key of keys) {
        for (const map of maps) {
          for (const word of map.get(key) ?? []) {
            if (word !== current && !candidates.includes(word)) candidates.push(word);
          }
        }
      }
      if (candidates.length === 0) continue;
      this.spans.push({ from, to, keys, original: current, candidates, el });
    }
    this.spans.sort((a, b) => a.from - b.from);
    if (this.spans.length === 0) return false;
    this.paint();
    return true;
  }

  /** 左右切换：只动激活样式与滚动，不改文本 */
  moveActive(delta: -1 | 1): void {
    if (this.spans.length === 0) return;
    this.active = (this.active + delta + this.spans.length) % this.spans.length;
    this.paint();
  }

  /** 上下切换：无浮层时打开预览，有浮层时只动高亮，确认前不写文档 */
  cyclePopup(delta: -1 | 1): void {
    const view = this.view;
    if (view === null) return;
    const popup = this.popup;
    if (popup === null) {
      this.openPopup(view);
      return;
    }
    const span = this.spans[popup.spanIndex];
    if (span === undefined) {
      this.closePopup();
      return;
    }
    popup.candidateIndex = (popup.candidateIndex + delta + span.candidates.length) % span.candidates.length;
    this.paintPopup();
  }

  /**
   * 确认键：单事务替换当前高亮候选并留在原地。
   * 与鼠标点击走同一写入路径，一次确认对应一次可撤销。
   */
  confirmPopup(): void {
    const popup = this.popup;
    const view = this.view;
    if (popup === null || view === null) return;
    const span = this.spans[popup.spanIndex];
    const word = span?.candidates[popup.candidateIndex];
    if (span === undefined || word === undefined) {
      this.closePopup();
      return;
    }
    this.closePopup();
    try {
      view.dispatch({
        changes: { from: span.from, to: span.to, insert: word },
        selection: { anchor: span.from + word.length },
        effects: [dismissTargetEffect.of({ from: span.from, to: span.to })],
        scrollIntoView: true,
      });
    } catch {
      // 期间有键盘编辑导致坐标过期：重建后静默返回，不吞下次操作
      this.rebuild(view);
      return;
    }
    view.focus();
    // 确认后留在原地：光标已由本次事务置于替换文本之后，直接退出导航，不自动进下一处
    this.exit();
  }

  /** 关闭浮层：纯移除 DOM，会话 spans/active 保留，文本无任何改动 */
  closePopup(): void {
    this.popup?.el.remove();
    this.popup = null;
  }

  /** 打开浮层：候选就地渲染、首项高亮，失败时静默返回（无浮层即无预览） */
  private openPopup(view: EditorView): boolean {
    const span = this.spans[this.active];
    if (span === undefined) return false;
    this.closePopup();
    const doc = view.scrollDOM.ownerDocument;
    // createDiv 自带挂载语义：挂到 body 而非 document（document 下只允许一个根元素）
    const el = doc.body.createDiv();
    el.className = POPUP_CLASS;
    for (const candidate of span.candidates) {
      const item = el.createDiv();
      item.className = POPUP_ITEM_CLASS;
      item.textContent = candidate;
    }
    doc.body.appendChild(el);
    this.popup = { spanIndex: this.active, candidateIndex: 0, el };
    this.paintPopup();
    this.placePopup(view, span);
    return this.popup !== null;
  }

  // 浮层高亮只在 DOM 层面切换类名，不碰文档
  private paintPopup(): void {
    const popup = this.popup;
    if (popup === null) return;
    const children = popup.el.children;
    for (let index = 0; index < children.length; index++) {
      const item = children[index];
      if (item === undefined) continue;
      if (index === popup.candidateIndex) item.classList.add(POPUP_ACTIVE_CLASS);
      else item.classList.remove(POPUP_ACTIVE_CLASS);
    }
  }

  /** 浮层定位：跟随片段视口坐标并钳制在窗口内，不可见时滚入视野后重试一次 */
  private placePopup(view: EditorView, span: SessionSpan): void {
    const popup = this.popup;
    if (popup === null) return;
    let coords = view.coordsAtPos(span.from);
    if (coords === null) {
      span.el.scrollIntoView({ block: "nearest" });
      coords = view.coordsAtPos(span.from);
    }
    if (coords === null) {
      this.closePopup();
      return;
    }
    const win = view.scrollDOM.ownerDocument.defaultView;
    const width = popup.el.offsetWidth;
    const height = popup.el.offsetHeight;
    const margin = 8;
    let left = coords.left;
    let top = coords.bottom + 4;
    if (win !== null) {
      if (left + width > win.innerWidth - margin) left = Math.max(margin, win.innerWidth - width - margin);
      if (top + height > win.innerHeight - margin) top = Math.max(margin, coords.top - height - 4);
    }
    popup.el.style.left = `${left}px`;
    popup.el.style.top = `${top}px`;
  }

  /** 退出导航并清除激活样式与浮层，已替换的保留（B 仅取消导航，不回滚） */
  exit(): void {
    this.closePopup();
    this.clearActiveStyle();
    this.view = null;
    this.spans = [];
    this.active = 0;
  }

  // 激活样式只在 DOM 层面增删类，不碰 DecorationSet，点击链路坐标不受影响
  private paint(): void {
    this.clearActiveStyle();
    const span = this.spans[this.active];
    if (span === undefined) return;
    span.el.classList.add(ACTIVE_SPAN_CLASS);
    span.el.scrollIntoView({ block: "nearest" });
  }

  private clearActiveStyle(): void {
    const root = this.view?.scrollDOM;
    if (root === undefined || root === null) return;
    try {
      root.querySelectorAll(`.${ACTIVE_SPAN_CLASS}`).forEach((el) => el.classList.remove(ACTIVE_SPAN_CLASS));
    } catch {
      // 视图销毁中的查询失败可忽略，会话本就随即清空
    }
  }
}

// 逐字移动：钳制在文档范围内，单次 dispatch 保证单步可撤销
function moveCursorByChar(view: EditorView, delta: -1 | 1): void {
  const head = view.state.selection.main.head;
  const next = Math.min(Math.max(head + delta, 0), view.state.doc.length);
  if (next === head) return;
  view.dispatch({ selection: { anchor: next }, scrollIntoView: true });
}

// 退格删除：选区未折叠删选区并塌缩到起点，折叠删光标前一字；文首空操作，单次 dispatch 单步可撤销
function deleteBackward(view: EditorView): void {
  const { from, to } = view.state.selection.main;
  if (from !== to) {
    view.dispatch({ changes: { from, to }, selection: { anchor: from }, scrollIntoView: true });
    return;
  }
  if (from === 0) return;
  // 代理对成对删除：避免把 emoji 等拆成非法半字
  const text = view.state.doc.sliceString(Math.max(from - 2, 0), from);
  const pair = /[\uD800-\uDBFF][\uDC00-\uDFFF]$/u.exec(text);
  const deleteFrom = pair !== null ? from - 2 : from - 1;
  view.dispatch({ changes: { from: deleteFrom, to: from }, selection: { anchor: deleteFrom }, scrollIntoView: true });
}

// 插入换行：折叠选区直接断行，非折叠先替换选区再断行，光标落到新行行首，单次 dispatch 单步可撤销
function insertNewline(view: EditorView): void {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: "\n" },
    selection: { anchor: from + 1 },
    scrollIntoView: true,
  });
}

// 逐行移动：经视图视觉行移动（含折行），语义与键盘上下方向键一致；
// 连按时不携带列记忆，列位置按当前位置重算
function moveCursorByLine(view: EditorView, delta: -1 | 1): void {
  const moved = view.moveVertically(view.state.selection.main, delta > 0);
  if (moved.head === view.state.selection.main.head) return;
  view.dispatch({ selection: { anchor: moved.head }, scrollIntoView: true });
}

// 逻辑行跳转：整段为单位、同列偏移保持并钳制到目标行尾，文档首尾无操作；
// 与视觉行步进互补，长折行段落上一跳整段
function moveCursorByLogicalLine(view: EditorView, delta: -1 | 1): void {
  const doc = view.state.doc;
  const head = view.state.selection.main.head;
  const line = doc.lineAt(head);
  const targetNumber = Math.min(Math.max(line.number + delta, 1), doc.lines);
  if (targetNumber === line.number) return;
  const target = doc.line(targetNumber);
  const next = Math.min(target.from + (head - line.from), target.to);
  if (next === head) return;
  view.dispatch({ selection: { anchor: next }, scrollIntoView: true });
}

// 扩展选取：锚点固定、活动端按字步进，单次 dispatch；中途光标被别处移动时以当前位置为准
function extendSelection(view: EditorView, anchor: number | null, delta: -1 | 1): void {
  if (anchor === null) return;
  const head = view.state.selection.main.head;
  const next = Math.min(Math.max(head + delta, 0), view.state.doc.length);
  view.dispatch({ selection: { anchor, head: next }, scrollIntoView: true });
}
