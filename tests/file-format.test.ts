import { describe, expect, test } from "bun:test";
import {
  normalizeStoredEntry,
  parseLexiconJson,
  parseLexiconTxt,
  serializeLexiconFile,
} from "../src/cores/lexicon/file-format";
import type { LexiconEntry } from "../src/cores/lexicon/types";

describe("serializeLexiconFile", () => {
  test("不含 id 且可 roundtrip", () => {
    const entries: LexiconEntry[] = [{ id: 7, word: "你好", pinyin: "ni hao", weight: 2, enable: false }];
    const parsed = JSON.parse(serializeLexiconFile(entries)) as {
      version: number;
      exportedAt: unknown;
      entries: unknown[];
    };
    expect(parsed.version).toBe(1);
    expect(typeof parsed.exportedAt).toBe("string");
    expect(parsed.entries).toEqual([{ word: "你好", pinyin: "ni hao", weight: 2, enable: false }]);
  });
});

describe("parseLexiconJson", () => {
  test("包装对象与裸数组都兼容", () => {
    const wrapped = parseLexiconJson('{"version":1,"entries":[{"word":"你好","pinyin":"ni hao"}]}');
    expect(wrapped).toEqual({ entries: [{ word: "你好", pinyin: "ni hao", weight: 0, enable: true }], invalid: 0 });
    const bare = parseLexiconJson('[{"word":"你好","pinyin":"ni hao","weight":2,"enable":false}]');
    expect(bare).toEqual({
      entries: [{ word: "你好", pinyin: "ni hao", weight: 2, enable: false }],
      invalid: 0,
    });
  });

  test("缺拼音自动生成，非法权重复位", () => {
    const result = parseLexiconJson('[{"word":"你好"},{"word":"世界","pinyin":"shi jie","weight":"3"}]');
    expect(result).toEqual({
      entries: [
        { word: "你好", pinyin: "ni hao", weight: 0, enable: true },
        { word: "世界", pinyin: "shi jie", weight: 0, enable: true },
      ],
      invalid: 0,
    });
  });

  test("非法条目计数，非对象结构抛错", () => {
    expect(parseLexiconJson('[42,"x",null,{"word":"  "}]')).toEqual({ entries: [], invalid: 4 });
    expect(() => parseLexiconJson("{}")).toThrow();
    expect(() => parseLexiconJson('"str"')).toThrow();
    expect(() => parseLexiconJson("not json")).toThrow();
  });
});

describe("parseLexiconTxt", () => {
  test("权重后缀与空行", () => {
    const result = parseLexiconTxt("你好:3\n世界\n\n   \n");
    expect(result).toEqual({
      entries: [
        { word: "你好", pinyin: "ni hao", weight: 3, enable: true },
        { word: "世界", pinyin: "shi jie", weight: 0, enable: true },
      ],
      invalid: 0,
    });
  });

  test("非数字后缀按普通词语处理", () => {
    const result = parseLexiconTxt("北京:abc");
    expect(result.entries).toEqual([{ word: "北京:abc", pinyin: "bei jing", weight: 0, enable: true }]);
  });

  test("CRLF 换行兼容", () => {
    expect(parseLexiconTxt("你好\r\n世界").entries.length).toBe(2);
  });
});

describe("normalizeStoredEntry", () => {
  test("合法条目透传，缺失字段回退", () => {
    expect(normalizeStoredEntry({ id: 1, word: "你好", pinyin: "ni hao" })).toEqual({
      id: 1,
      word: "你好",
      pinyin: "ni hao",
      weight: 0,
      enable: true,
    });
  });

  test("脏数据丢弃", () => {
    expect(normalizeStoredEntry(null)).toBeNull();
    expect(normalizeStoredEntry({ id: "1", word: "你好", pinyin: "ni hao" })).toBeNull();
    expect(normalizeStoredEntry({ id: 1, pinyin: "ni hao" })).toBeNull();
    expect(normalizeStoredEntry({ id: 1, word: "你好", pinyin: 42 })).toBeNull();
  });
});
