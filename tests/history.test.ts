import { EditorState } from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
import { describe, expect, test } from "bun:test";
import { createTargetsEffect, dismissTargetEffect, targetField } from "../src/features/lexicon";
import type { LexiconTarget } from "../src/features/lexicon";

/** 从装饰读属性：与实现侧同口径的类型收窄，断言 DOM 契约本身 */
function readAttr(value: Decoration, name: string): string | null {
  const spec: unknown = value.spec;
  if (typeof spec !== "object" || spec === null || !("attributes" in spec)) return null;
  const record = spec.attributes as Record<string, unknown>;
  const raw: unknown = record[name];
  return typeof raw === "string" ? raw : null;
}

interface SpanInfo {
  from: number;
  to: number;
  keys: string | null;
  batch: string | null;
  original: string | null;
}

/** 读出当前全部高亮：坐标 + 装饰属性 */
function readSpans(state: EditorState): SpanInfo[] {
  const spans: SpanInfo[] = [];
  state.field(targetField).between(0, state.doc.length, (from, to, value) => {
    spans.push({
      from,
      to,
      keys: readAttr(value, "data-keys"),
      batch: readAttr(value, "data-batch"),
      original: readAttr(value, "data-original"),
    });
  });
  return spans;
}

/** 构造单片段 targets */
function target(from: number, to: number, word: string): LexiconTarget {
  return { from, to, keys: [`k${from}`], original: word };
}

/** 空文档起一批插入：返回插入后状态（调用方自行累积文档） */
function insertBatch(
  state: EditorState,
  insert: { from: number; text: string },
  targets: LexiconTarget[] | null,
  mode: "none" | "count" | "all",
  limit: number,
): EditorState {
  return state.update({
    changes: { from: insert.from, insert: insert.text },
    effects: [createTargetsEffect(targets, mode, limit)],
  }).state;
}

describe("history none", () => {
  test("新插入替换旧高亮", () => {
    let state = EditorState.create({ doc: "aa", extensions: [targetField] });
    state = state.update({ effects: [createTargetsEffect([target(0, 2, "aa")], "none", 3)] }).state;
    expect(readSpans(state).map((span) => [span.from, span.to])).toEqual([[0, 2]]);
    state = insertBatch(state, { from: 2, text: "bb" }, [target(2, 4, "bb")], "none", 3);
    expect(readSpans(state).map((span) => [span.from, span.to])).toEqual([[2, 4]]);
  });

  test("空 targets 清空", () => {
    let state = EditorState.create({ doc: "aa", extensions: [targetField] });
    state = state.update({ effects: [createTargetsEffect([target(0, 2, "aa")], "none", 3)] }).state;
    state = state.update({ effects: [createTargetsEffect(null, "none", 3)] }).state;
    expect(readSpans(state)).toEqual([]);
  });
});

describe("history count", () => {
  test("只留最近 N 批", () => {
    let state = EditorState.create({ doc: "aa", extensions: [targetField] });
    state = state.update({ effects: [createTargetsEffect([target(0, 2, "aa")], "count", 2)] }).state;
    state = insertBatch(state, { from: 2, text: "bb" }, [target(2, 4, "bb")], "count", 2);
    state = insertBatch(state, { from: 4, text: "cc" }, [target(4, 6, "cc")], "count", 2);
    const spans = readSpans(state);
    expect(spans.map((span) => [span.from, span.to])).toEqual([
      [2, 4],
      [4, 6],
    ]);
    expect(spans.map((span) => span.original)).toEqual(["bb", "cc"]);
    expect(new Set(spans.map((span) => span.batch)).size).toBe(2);
  });

  test("空 targets 保留旧集合", () => {
    let state = EditorState.create({ doc: "aa", extensions: [targetField] });
    state = state.update({ effects: [createTargetsEffect([target(0, 2, "aa")], "count", 2)] }).state;
    state = state.update({ effects: [createTargetsEffect(null, "count", 2)] }).state;
    expect(readSpans(state).map((span) => [span.from, span.to])).toEqual([[0, 2]]);
  });
});

describe("history all", () => {
  test("全部保留", () => {
    let state = EditorState.create({ doc: "aa", extensions: [targetField] });
    state = state.update({ effects: [createTargetsEffect([target(0, 2, "aa")], "all", 3)] }).state;
    state = insertBatch(state, { from: 2, text: "bb" }, [target(2, 4, "bb")], "all", 3);
    state = insertBatch(state, { from: 4, text: "cc" }, [target(4, 6, "cc")], "all", 3);
    expect(readSpans(state).map((span) => [span.from, span.to])).toEqual([
      [0, 2],
      [2, 4],
      [4, 6],
    ]);
  });
});

describe("history attrs", () => {
  test("装饰携带 keys/original/batch", () => {
    let state = EditorState.create({ doc: "aa", extensions: [targetField] });
    state = state.update({ effects: [createTargetsEffect([target(0, 2, "aa")], "all", 3)] }).state;
    const spans = readSpans(state);
    expect(spans.length).toBe(1);
    const first = spans[0];
    expect(first?.from).toBe(0);
    expect(first?.to).toBe(2);
    expect(first?.keys).toBe("k0");
    expect(first?.original).toBe("aa");
    expect(typeof first?.batch).toBe("string");
    expect(Number.isNaN(Number.parseInt(first?.batch ?? "x", 10))).toBe(false);
  });
});

describe("history dismiss", () => {
  test("点击替换只清该处，其余随变更映射", () => {
    let state = EditorState.create({ doc: "aabb", extensions: [targetField] });
    state = state.update({
      effects: [createTargetsEffect([target(0, 2, "aa"), target(2, 4, "bb")], "all", 3)],
    }).state;
    state = state.update({ effects: [dismissTargetEffect.of({ from: 0, to: 2 })] }).state;
    expect(readSpans(state).map((span) => [span.from, span.to])).toEqual([[2, 4]]);
    state = state.update({ changes: { from: 0, insert: "x" } }).state;
    expect(readSpans(state).map((span) => [span.from, span.to])).toEqual([[3, 5]]);
  });
});
