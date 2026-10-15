import { describe, expect, test } from "bun:test";
import { createVadState, updateVad, type VadState } from "../src/features/speech-recognition/vad";

/** 喂入电平序列直到触发或耗尽：每片 256ms（4096 采样 @16k） */
function runToStop(levels: number[], trailingMs = 1800): { stopped: boolean; steps: number } {
  const state: VadState = createVadState();
  let steps = 0;
  for (const level of levels) {
    steps += 1;
    if (updateVad(state, level, 256, trailingMs)) return { stopped: true, steps };
  }
  return { stopped: false, steps };
}

/** 构造指定电平与片数的序列 */
function repeat(level: number, chunks: number): number[] {
  return Array.from({ length: chunks }, () => level);
}

describe("updateVad", () => {
  test("说后静音 1.8s 触发", () => {
    const result = runToStop([...repeat(0.2, 4), ...repeat(0.005, 8)]);
    expect(result).toEqual({ stopped: true, steps: 12 });
  });

  test("全程无语音 8s 触发（含首片起步保护）", () => {
    const result = runToStop(repeat(0.005, 40));
    expect(result).toEqual({ stopped: true, steps: 33 });
  });

  test("短静音与句间停顿不触发", () => {
    expect(runToStop(repeat(0.005, 10)).stopped).toBe(false);
    expect(runToStop([...repeat(0.2, 4), ...repeat(0.005, 5), ...repeat(0.2, 2), ...repeat(0.005, 5)]).stopped).toBe(false);
  });

  test("迟滞区间冻结累计", () => {
    // 0.03 介于有声与静音阈值之间：20 片既不解锁也不累计，随后明确静音才触发
    const result = runToStop([...repeat(0.2, 2), ...repeat(0.03, 20), ...repeat(0.005, 8)]);
    expect(result).toEqual({ stopped: true, steps: 30 });
  });

  test("起步保护期内不判定", () => {
    expect(updateVad(createVadState(), 0.2, 256)).toBe(false);
  });

  test("全程有声不停", () => {
    expect(runToStop(repeat(0.2, 40)).stopped).toBe(false);
  });

  test("尾部时长可配：1s 更早触发，5s 内不触发", () => {
    expect(runToStop([...repeat(0.2, 4), ...repeat(0.005, 4)], 1000)).toEqual({ stopped: true, steps: 8 });
    expect(runToStop([...repeat(0.2, 4), ...repeat(0.005, 8)], 5000).stopped).toBe(false);
  });
});
