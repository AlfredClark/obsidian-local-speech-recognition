import { describe, expect, test } from "bun:test";
import { stripModelPrefix } from "../src/utils/transcript";

describe("stripModelPrefix", () => {
  test("剥离 Qwen3-ASR 语言前缀", () => {
    expect(stripModelPrefix("language Cantonese<asr_text>今次寻寻觅觅")).toBe("今次寻寻觅觅");
    expect(stripModelPrefix("language Chinese<asr_text>开放时间")).toBe("开放时间");
  });

  test("无前缀时原文返回", () => {
    expect(stripModelPrefix("Raptorium Bergbau scheint")).toBe("Raptorium Bergbau scheint");
    expect(stripModelPrefix("今次寻寻觅觅")).toBe("今次寻寻觅觅");
    expect(stripModelPrefix("")).toBe("");
  });

  test("无 <asr_text> 标记的 language 开头不动", () => {
    expect(stripModelPrefix("language learning is fun")).toBe("language learning is fun");
  });

  test("前缀不在行首时不动", () => {
    expect(stripModelPrefix("你好 language Chinese<asr_text>开放")).toBe("你好 language Chinese<asr_text>开放");
  });
});
