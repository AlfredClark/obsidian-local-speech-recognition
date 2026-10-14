import { describe, expect, test } from "bun:test";
import type { Editor } from "obsidian";
import { getCodeMirrorEditorView } from "../src/utils/cm-utils";

/** 构造鸭子类型编辑器：缺的层级即返回 null 的用例 */
function fakeEditor(cm: unknown): Editor {
  return { cm } as unknown as Editor;
}

describe("getCodeMirrorEditorView", () => {
  test("形态不符逐层返回 null", () => {
    expect(getCodeMirrorEditorView(null as unknown as Editor)).toBeNull();
    expect(getCodeMirrorEditorView(fakeEditor(undefined))).toBeNull();
    expect(getCodeMirrorEditorView(fakeEditor(null))).toBeNull();
    expect(getCodeMirrorEditorView(fakeEditor({}))).toBeNull();
    expect(getCodeMirrorEditorView(fakeEditor({ cm: { state: {} } }))).toBeNull();
    expect(getCodeMirrorEditorView(fakeEditor({ cm: { dispatch: 1, state: {} } }))).toBeNull();
    expect(getCodeMirrorEditorView(fakeEditor({ cm: { dispatch(): void {}, state: {} } }))).toBeNull();
    expect(getCodeMirrorEditorView(fakeEditor({ cm: { dispatch(): void {}, state: { selection: {} } } }))).toBeNull();
    expect(getCodeMirrorEditorView(fakeEditor({ cm: { dispatch(): void {}, state: { selection: { main: {} } } } }))).toBeNull();
    expect(
      getCodeMirrorEditorView(
        fakeEditor({ cm: { dispatch(): void {}, state: { selection: { main: { from: "1", to: 2 } } } } }),
      ),
    ).toBeNull();
  });

  test("完整形态返回同一实例", () => {
    const cm = { dispatch(): void {}, state: { selection: { main: { from: 1, to: 2 } } } };
    expect(getCodeMirrorEditorView(fakeEditor(cm))).toBe(cm);
  });
});
