import { describe, expect, test } from "bun:test";
import { shouldShowResultNotice } from "../src/features/speech-recognition/status-text";

describe("shouldShowResultNotice", () => {
  test("编辑器插入仅通知框模式弹", () => {
    expect(shouldShowResultNotice("notice", "inserted")).toBe(true);
    expect(shouldShowResultNotice("statusbar", "inserted")).toBe(false);
    expect(shouldShowResultNotice("none", "inserted")).toBe(false);
  });

  test("剪贴板交付三种模式都弹", () => {
    expect(shouldShowResultNotice("notice", "clipboard")).toBe(true);
    expect(shouldShowResultNotice("statusbar", "clipboard")).toBe(true);
    expect(shouldShowResultNotice("none", "clipboard")).toBe(true);
  });
});
