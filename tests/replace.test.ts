import { describe, expect, test } from "bun:test";
import { applyPreferredReplacements } from "../src/features/lexicon";
import type { LexiconTarget } from "../src/features/lexicon";

/** 首选解析 stub：beijing 换长词，其余保留原文 */
function stubPreferred(keys: string[]): string | null {
  if (keys.includes("beijing")) return "首都北京";
  return null;
}

describe("applyPreferredReplacements", () => {
  test("替换并重映射后续坐标", () => {
    const targets: LexiconTarget[] = [
      { from: 2, to: 4, keys: ["beijing"], original: "北京" },
      { from: 4, to: 5, keys: ["hao"], original: "好" },
    ];
    const { displayText, remappedTargets } = applyPreferredReplacements("我爱北京好", 0, targets, stubPreferred);
    expect(displayText).toBe("我爱首都北京好");
    expect(remappedTargets).toEqual([
      { from: 2, to: 6, keys: ["beijing"], original: "北京" },
      { from: 6, to: 7, keys: ["hao"], original: "好" },
    ]);
  });

  test("无命中时透传", () => {
    const targets: LexiconTarget[] = [];
    const { displayText, remappedTargets } = applyPreferredReplacements("你好", 0, targets, stubPreferred);
    expect(displayText).toBe("你好");
    expect(remappedTargets).toBe(targets);
  });

  test("首选即原文时保持不动", () => {
    const targets: LexiconTarget[] = [{ from: 0, to: 2, keys: ["beijing"], original: "北京" }];
    const { displayText, remappedTargets } = applyPreferredReplacements("北京好", 0, targets, () => "北京");
    expect(displayText).toBe("北京好");
    expect(remappedTargets).toEqual([{ from: 0, to: 2, keys: ["beijing"], original: "北京" }]);
  });

  test("重叠与越界坐标跳过且不破坏其余替换", () => {
    const targets: LexiconTarget[] = [
      { from: 0, to: 2, keys: ["beijing"], original: "AB" },
      { from: 1, to: 3, keys: ["beijing"], original: "BC" },
      { from: 10, to: 12, keys: ["beijing"], original: "" },
    ];
    const { displayText, remappedTargets } = applyPreferredReplacements("ABCD", 0, targets, stubPreferred);
    expect(displayText).toBe("首都北京CD");
    expect(remappedTargets.length).toBe(1);
  });

  test("未排序输入按起点处理", () => {
    const targets: LexiconTarget[] = [
      { from: 4, to: 5, keys: ["e"], original: "E" },
      { from: 0, to: 2, keys: ["beijing"], original: "AB" },
    ];
    const { displayText, remappedTargets } = applyPreferredReplacements("ABCDE", 0, targets, stubPreferred);
    expect(displayText).toBe("首都北京CDE");
    expect(remappedTargets.map((target) => [target.from, target.to])).toEqual([
      [0, 4],
      [6, 7],
    ]);
  });
});
