import { describe, expect, test } from "bun:test";
import {
  buildOfflineWsPayload,
  chunkRmsLevel,
  downsampleFloat32Mono,
  float32ToInt16Pcm,
  int16ToFloat32Normalized,
  mergeInt16Chunks,
} from "../src/utils/audio";

describe("downsampleFloat32Mono", () => {
  test("空输入返回空数组", () => {
    expect(downsampleFloat32Mono(new Float32Array(0), 48000).length).toBe(0);
  });

  test("同采样率返回内容相同的新数组", () => {
    const input = new Float32Array([0.5, -0.5]);
    const output = downsampleFloat32Mono(input, 16000);
    expect(output).toEqual(input);
    expect(output).not.toBe(input);
  });

  test("线性插值按比例抽点", () => {
    expect(Array.from(downsampleFloat32Mono(new Float32Array([0, 1, 2, 3]), 4, 2))).toEqual([0, 2]);
  });

  test("极小目标长度至少保留一点", () => {
    expect(Array.from(downsampleFloat32Mono(new Float32Array([5]), 100, 1))).toEqual([5]);
  });
});

describe("float32ToInt16Pcm", () => {
  test("满幅与钳制", () => {
    const output = float32ToInt16Pcm(new Float32Array([1, -1, 0, 0.5, -0.5, 1.5, -2]));
    expect(Array.from(output)).toEqual([32767, -32768, 0, 16384, -16384, 32767, -32768]);
  });
});

describe("int16ToFloat32Normalized", () => {
  test("归一化 roundtrip", () => {
    const output = int16ToFloat32Normalized(new Int16Array([32767, -32768, 0]));
    expect(output[0]).toBe(new Float32Array([32767 / 32768])[0]);
    expect(output[1]).toBe(-1);
    expect(output[2]).toBe(0);
  });
});

describe("chunkRmsLevel", () => {
  test("满幅与静音", () => {
    expect(chunkRmsLevel(new Int16Array([32767, -32768]))).toBeGreaterThan(0.99);
    expect(chunkRmsLevel(new Int16Array([0, 0]))).toBe(0);
  });

  test("恒定半幅恰为一半", () => {
    expect(chunkRmsLevel(new Int16Array([16384, 16384]))).toBe(0.5);
  });

  test("空分片返回零", () => {
    expect(chunkRmsLevel(new Int16Array(0))).toBe(0);
  });
});

describe("mergeInt16Chunks", () => {
  test("多分片顺序拼接", () => {
    expect(Array.from(mergeInt16Chunks([new Int16Array([1, 2]), new Int16Array([3])]))).toEqual([1, 2, 3]);
  });

  test("空输入返回空数组", () => {
    expect(mergeInt16Chunks([]).length).toBe(0);
  });
});

describe("buildOfflineWsPayload", () => {
  test("8 字节小端头 + float32 数据", () => {
    const payload = buildOfflineWsPayload(16000, new Float32Array([0.5, -1]));
    expect(payload.length).toBe(16);
    // 16000 = 0x3E80，数据字节数 = 2 * 4 = 8
    expect(Array.from(payload.slice(0, 8))).toEqual([0x80, 0x3e, 0, 0, 8, 0, 0, 0]);
    const view = new DataView(payload.buffer);
    expect(view.getFloat32(8, true)).toBe(0.5);
    expect(view.getFloat32(12, true)).toBe(-1);
  });

  test("空采样只有包头", () => {
    const payload = buildOfflineWsPayload(16000, new Float32Array(0));
    expect(payload.length).toBe(8);
    expect(Array.from(payload.slice(4, 8))).toEqual([0, 0, 0, 0]);
  });
});
