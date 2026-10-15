import { describe, expect, test } from "bun:test";
import { buildVariantKeys, MAX_FUZZY_VARIANTS, syllableVariants } from "../src/cores/lexicon";

describe("syllableVariants", () => {
  test("平翘舌展开且原拼写首位", () => {
    expect(syllableVariants("zhang")).toEqual(["zhang", "zhan", "zang", "zan"]);
    expect(syllableVariants("shi")).toEqual(["shi", "si"]);
  });

  test("韵母整体形式单列分组", () => {
    expect(syllableVariants("xian")).toEqual(["xian", "xiang"]);
    expect(syllableVariants("guang")).toEqual(["guang", "guan"]);
  });

  test("无声母音节同样展开", () => {
    expect(syllableVariants("an")).toEqual(["an", "ang"]);
  });
});

describe("buildVariantKeys", () => {
  test("多音节笛卡尔组合且原拼写在前", () => {
    const keys = buildVariantKeys("zhang shi", 2);
    expect(keys.length).toBe(8);
    expect(keys[0]).toBe("zhangshi");
    expect(keys).toContain("zangsi");
  });

  test("音节数不符退化为空", () => {
    expect(buildVariantKeys("zhangshi", 2)).toEqual([]);
    expect(buildVariantKeys("", 1)).toEqual([]);
  });

  test("长词组合按上限截断", () => {
    const keys = buildVariantKeys("zhang chang shang", 3);
    expect(keys.length).toBe(MAX_FUZZY_VARIANTS);
    expect(keys[0]).toBe("zhangchangshang");
  });
});
