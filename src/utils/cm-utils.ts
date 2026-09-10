import type { Editor } from "obsidian";
import type { EditorView } from "@codemirror/view";

/**
 * 从 editor 获取 CM6 的 EditorView。
 * 运行时仍按 dispatch 与选区形态做鸭子类型识别，不用 instanceof：@codemirror/view 经 esbuild 外部化，
 * 值导入会在运行时 require 且跨包实例不可靠；此处仅 import type，编译期擦除、零运行时成本，
 * 返回完整 EditorView 以获得 IDE 补全与类型检查。
 * @param editor Obsidian 编辑器对象
 * @returns CM6 视图实例，形态不符时返回 null
 */
export function getCodeMirrorEditorView(editor: Editor): EditorView | null {
  const host: unknown = editor;
  if (typeof host !== "object" || host === null || !("cm" in host)) return null;
  const cm: unknown = host.cm;
  if (typeof cm !== "object" || cm === null) return null;
  if (!("dispatch" in cm) || !("state" in cm)) return null;
  if (typeof cm.dispatch !== "function") return null;
  const state: unknown = cm.state;
  if (typeof state !== "object" || state === null || !("selection" in state)) return null;
  const selection: unknown = state.selection;
  if (typeof selection !== "object" || selection === null || !("main" in selection)) return null;
  const main: unknown = selection.main;
  if (typeof main !== "object" || main === null || !("from" in main) || !("to" in main)) return null;
  if (typeof main.from !== "number" || typeof main.to !== "number") return null;
  return cm as EditorView;
}
