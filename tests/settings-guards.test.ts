import { describe, expect, test } from "bun:test";
import { isLexiconReplaceMode, isLexiconStorageMode, isNotificationMode } from "../src/cores/settings/types";
import { isSherpaModelId } from "../src/utils/sherpa-process";

describe("isLexiconStorageMode", () => {
  test("合法标识", () => {
    expect(isLexiconStorageMode("global")).toBe(true);
    expect(isLexiconStorageMode("vault")).toBe(true);
  });

  test("非法标识", () => {
    expect(isLexiconStorageMode("")).toBe(false);
    expect(isLexiconStorageMode("GLOBAL")).toBe(false);
    expect(isLexiconStorageMode(null)).toBe(false);
    expect(isLexiconStorageMode(undefined)).toBe(false);
  });
});

describe("isLexiconReplaceMode", () => {
  test("合法标识", () => {
    expect(isLexiconReplaceMode("original")).toBe(true);
    expect(isLexiconReplaceMode("lexicon")).toBe(true);
  });

  test("非法标识", () => {
    expect(isLexiconReplaceMode("")).toBe(false);
    expect(isLexiconReplaceMode("prefer")).toBe(false);
    expect(isLexiconReplaceMode(null)).toBe(false);
  });
});

describe("isNotificationMode", () => {
  test("合法标识", () => {
    expect(isNotificationMode("notice")).toBe(true);
    expect(isNotificationMode("statusbar")).toBe(true);
    expect(isNotificationMode("none")).toBe(true);
  });

  test("非法标识", () => {
    expect(isNotificationMode("")).toBe(false);
    expect(isNotificationMode("banner")).toBe(false);
    expect(isNotificationMode(null)).toBe(false);
  });
});

describe("isSherpaModelId", () => {
  test("已登记的九个标识", () => {
    for (const id of [
      "sense-voice-int8",
      "sense-voice",
      "fun-asr-int8",
      "fun-asr-fp16",
      "fun-asr-fp32",
      "paraformer-int8",
      "paraformer",
      "qwen3-asr-0.6b-int8",
      "qwen3-asr-1.7b-int8",
    ]) {
      expect(isSherpaModelId(id)).toBe(true);
    }
  });

  test("未知或非字符串", () => {
    expect(isSherpaModelId("sensevoice")).toBe(false);
    expect(isSherpaModelId("")).toBe(false);
    expect(isSherpaModelId(null)).toBe(false);
    expect(isSherpaModelId(42)).toBe(false);
  });
});
