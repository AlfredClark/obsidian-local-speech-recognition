import { describe, expect, test } from "bun:test";
import { collectCandidates, pickPreferred, scanTargets, type PinyinCandidatesMap } from "../src/features/lexicon/target-scan";

/** 手工构造映射表：绕开存储层，精确控制候选顺序 */
function mapsOf(entries: Array<[string, string[]]>): PinyinCandidatesMap {
  return new Map(entries);
}

describe("scanTargets", () => {
  test("精确命中坐标与 baseFrom 偏移", () => {
    const maps = [
      mapsOf([
        ["beijing", ["北京"]],
        ["tiananmen", ["天安门", "甜安门"]],
      ]),
    ];
    expect(scanTargets("我爱背景天安门", 100, maps)).toEqual([
      { from: 102, to: 104, keys: ["beijing"], original: "背景" },
      { from: 104, to: 107, keys: ["tiananmen"], original: "天安门" },
    ]);
  });

  test("同 key 多处出现逐个命中", () => {
    const maps = [mapsOf([["beijing", ["北京", "背景"]]])];
    const result = scanTargets("北京北京", 0, maps);
    expect(result.map((target) => [target.from, target.to])).toEqual([
      [0, 2],
      [2, 4],
    ]);
  });

  test("唯一候选与原文一致时跳过", () => {
    expect(scanTargets("北京好", 0, [mapsOf([["beijing", ["北京"]]])])).toEqual([]);
  });

  test("拉丁字符不产生误命中", () => {
    const maps = [mapsOf([["beijing", ["北京", "背景"]]])];
    expect(scanTargets("abc", 0, maps)).toEqual([]);
    expect(scanTargets("abc北京", 0, maps)).toEqual([{ from: 3, to: 5, keys: ["beijing"], original: "北京" }]);
  });

  test("同起点长者赢且与映射顺序无关", () => {
    const text = "北京市";
    const forward = [
      mapsOf([
        ["beijing", ["北京", "背景"]],
        ["beijingshi", ["北京市", "北京市郊"]],
      ]),
    ];
    const reversed = [
      mapsOf([
        ["beijingshi", ["北京市", "北京市郊"]],
        ["beijing", ["北京", "背景"]],
      ]),
    ];
    const expected = [{ from: 0, to: 3, keys: ["beijingshi"], original: "北京市" }];
    expect(scanTargets(text, 0, forward)).toEqual(expected);
    expect(scanTargets(text, 0, reversed)).toEqual(expected);
  });

  test("交错重叠起点早者赢", () => {
    const maps = [
      mapsOf([
        ["zhongguo", ["中国", "种果"]],
        ["guoyinhang", ["国银行", "果银行"]],
      ]),
    ];
    expect(scanTargets("中国银行", 0, maps)).toEqual([{ from: 0, to: 2, keys: ["zhongguo"], original: "中国" }]);
  });

  test("多音片段合并 keys", () => {
    const exact = mapsOf([["xing", ["行", "型"]]]);
    const fuzzy = mapsOf([["hang", ["行", "航"]]]);
    expect(scanTargets("行", 0, [exact, fuzzy])).toEqual([{ from: 0, to: 1, keys: ["xing", "hang"], original: "行" }]);
  });

  test("精确表跳过后模糊表仍可建 span", () => {
    const exact = mapsOf([["xing", ["行"]]]);
    const fuzzy = mapsOf([["hang", ["行", "航"]]]);
    expect(scanTargets("行", 0, [exact, fuzzy])).toEqual([{ from: 0, to: 1, keys: ["hang"], original: "行" }]);
  });

  test("空映射与空文本返回空", () => {
    expect(scanTargets("北京", 0, [])).toEqual([]);
    expect(scanTargets("", 0, [mapsOf([["beijing", ["北京"]]])])).toEqual([]);
  });
});

describe("collectCandidates", () => {
  test("多表按序合并并排除当前文本", () => {
    const exact = mapsOf([["xing", ["行", "型"]]]);
    const fuzzy = mapsOf([["hang", ["行", "航"]]]);
    expect(collectCandidates(["xing", "hang"], "行", [exact, fuzzy])).toEqual(["型", "航"]);
  });
});

describe("pickPreferred", () => {
  test("精确表首项优先且不排除原文", () => {
    const exact = mapsOf([["xing", ["行", "型"]]]);
    const fuzzy = mapsOf([["hang", ["航"]]]);
    expect(pickPreferred(["xing", "hang"], [exact, fuzzy])).toBe("行");
    expect(pickPreferred(["missing"], [exact, fuzzy])).toBeNull();
  });
});
