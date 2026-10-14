import { describe, expect, test } from "bun:test";
import { toPinyin } from "../src/utils/pinyin";

describe("toPinyin", () => {
  test("中文转无声调拼音", () => {
    expect(toPinyin("你好")).toBe("ni hao");
  });

  test("ü 转 v", () => {
    expect(toPinyin("女")).toBe("nv");
  });

  test("连续空白折叠", () => {
    expect(toPinyin("你  好")).toBe("ni hao");
  });

  test("非汉字移除", () => {
    expect(toPinyin("ABC你好")).toBe("ni hao");
  });

  test("首尾空白与空输入", () => {
    expect(toPinyin("  你好  ")).toBe("ni hao");
    expect(toPinyin("")).toBe("");
  });
});
