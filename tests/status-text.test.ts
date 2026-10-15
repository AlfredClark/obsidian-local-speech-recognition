import { describe, expect, test } from "bun:test";
import {
  chunkPeakLevel,
  formatElapsed,
  levelToBar,
  renderRecordingStatus,
  renderTranscribingStatus,
} from "../src/features/speech-recognition";

describe("formatElapsed", () => {
  test("补零 mm:ss", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(7.8)).toBe("00:07");
    expect(formatElapsed(65)).toBe("01:05");
    expect(formatElapsed(280)).toBe("04:40");
  });

  test("负数钳制为零", () => {
    expect(formatElapsed(-3)).toBe("00:00");
  });
});

describe("levelToBar", () => {
  test("静音与满幅边界", () => {
    expect(levelToBar(0)).toBe("░░░░░░░░");
    expect(levelToBar(1)).toBe("████████");
  });

  test("越界钳制", () => {
    expect(levelToBar(-0.5)).toBe("░░░░░░░░");
    expect(levelToBar(2)).toBe("████████");
  });

  test("中段按比例填充", () => {
    expect(levelToBar(0.5)).toBe("████░░░░");
  });
});

describe("chunkPeakLevel", () => {
  test("峰值归一化", () => {
    expect(chunkPeakLevel(new Int16Array([0, 16384, -32768]))).toBe(1);
    expect(chunkPeakLevel(new Int16Array([0, 0]))).toBe(0);
  });

  test("空分片返回零", () => {
    expect(chunkPeakLevel(new Int16Array(0))).toBe(0);
  });
});

describe("renderRecordingStatus", () => {
  test("标记 + 计时 + 电平条 + 状态名", () => {
    expect(renderRecordingStatus(12.4, 0.5, "录音中")).toBe("● 00:12 ████░░░░ 录音中");
    expect(renderRecordingStatus(0, 0, "录音中")).toBe("● 00:00 ░░░░░░░░ 录音中");
  });
});

describe("renderTranscribingStatus", () => {
  test("标记 + 计时 + 状态名", () => {
    expect(renderTranscribingStatus(3.2, "识别中")).toBe("◌ 00:03 识别中");
  });
});
