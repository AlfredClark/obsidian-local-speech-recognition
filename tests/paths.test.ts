import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { SherpaServerConfig } from "../src/cores/sherpa-server/types";
import { formatPathsDetail, validateSherpaPaths } from "../src/cores/sherpa-server/cores";
import { getRequiredPaths, type SherpaModelId } from "../src/utils/sherpa-process";

/** 建模型目录夹具：files 建空文件，dirs 建子目录 */
function makeModelDir(files: string[] = [], dirs: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "lsr-paths-"));
  for (const file of files) writeFileSync(join(dir, file), "x");
  for (const sub of dirs) mkdirSync(join(dir, sub), { recursive: true });
  return dir;
}

/** 构造服务配置：监听项固定，只换二进制/目录/模型 */
function configWith(binaryPath: string, modelPath: string, modelType: SherpaModelId): SherpaServerConfig {
  return {
    binaryPath,
    modelPath,
    modelType,
    host: "127.0.0.1",
    port: 6006,
    numThreads: 4,
    provider: "cpu",
  };
}

describe("getRequiredPaths", () => {
  test("SenseVoice 与 Paraformer 清单", () => {
    expect(getRequiredPaths("sense-voice-int8", "/m")).toEqual([
      { path: "/m/model.int8.onnx", kind: "file" },
      { path: "/m/tokens.txt", kind: "file" },
    ]);
    expect(getRequiredPaths("paraformer", "/m")).toEqual([
      { path: "/m/model.onnx", kind: "file" },
      { path: "/m/tokens.txt", kind: "file" },
    ]);
  });

  test("FunASR fp32 额外包含 llm.fp32.data", () => {
    expect(getRequiredPaths("fun-asr-fp32", "/m")).toEqual([
      { path: "/m/encoder_adaptor.onnx", kind: "file" },
      { path: "/m/llm.fp32.onnx", kind: "file" },
      { path: "/m/llm.fp32.data", kind: "file" },
      { path: "/m/embedding.onnx", kind: "file" },
      { path: "/m/Qwen3-0.6B", kind: "dir" },
    ]);
  });

  test("Qwen3-ASR 无 tokens 且分词器为目录", () => {
    expect(getRequiredPaths("qwen3-asr-0.6b-int8", "/m")).toEqual([
      { path: "/m/conv_frontend.onnx", kind: "file" },
      { path: "/m/encoder.int8.onnx", kind: "file" },
      { path: "/m/decoder.int8.onnx", kind: "file" },
      { path: "/m/tokenizer", kind: "dir" },
    ]);
  });

  test("目录去尾部斜杠", () => {
    expect(getRequiredPaths("paraformer", "/m/")).toEqual(getRequiredPaths("paraformer", "/m"));
  });
});

describe("validateSherpaPaths", () => {
  test("二进制缺失只报二进制", async () => {
    const result = await validateSherpaPaths(configWith("/nonexistent-lsr/s", "/m", "sense-voice-int8"));
    expect(result).toEqual({ binary: "/nonexistent-lsr/s", missing: [] });
  });

  test("模型目录缺失与非目录", async () => {
    const binary = process.execPath;
    const missingDir = await validateSherpaPaths(configWith(binary, "/nonexistent-lsr-m", "sense-voice-int8"));
    expect(missingDir).toEqual({ binary: null, missing: ["/nonexistent-lsr-m"] });
    const fileAsDir = join(mkdtempSync(join(tmpdir(), "lsr-paths-")), "f");
    writeFileSync(fileAsDir, "x");
    const notDir = await validateSherpaPaths(configWith(binary, fileAsDir, "sense-voice-int8"));
    expect(notDir).toEqual({ binary: null, missing: [fileAsDir] });
  });

  test("缺部分文件精确列出", async () => {
    const dir = makeModelDir(["model.int8.onnx"]);
    const result = await validateSherpaPaths(configWith(process.execPath, dir, "sense-voice-int8"));
    expect(result).toEqual({ binary: null, missing: [join(dir, "tokens.txt")] });
  });

  test("齐了通过且 Qwen3 不需要 tokens", async () => {
    const dir = makeModelDir(["conv_frontend.onnx", "encoder.int8.onnx", "decoder.int8.onnx"], ["tokenizer"]);
    const result = await validateSherpaPaths(configWith(process.execPath, dir, "qwen3-asr-0.6b-int8"));
    expect(result).toEqual({ binary: null, missing: [] });
  });

  test("fp32 缺 .data 即报缺", async () => {
    const dir = makeModelDir(["encoder_adaptor.onnx", "llm.fp32.onnx", "embedding.onnx"], ["Qwen3-0.6B"]);
    const result = await validateSherpaPaths(configWith(process.execPath, dir, "fun-asr-fp32"));
    expect(result).toEqual({ binary: null, missing: [join(dir, "llm.fp32.data")] });
  });
});

describe("formatPathsDetail", () => {
  test("二进制缺失与模型缺失文案（仅文件名）", () => {
    // 测试环境语言回退英文，只断言文件名部分
    expect(formatPathsDetail({ binary: "/x/s", missing: [] })).toBe("Server binary not found or not executable: s");
    expect(formatPathsDetail({ binary: null, missing: ["/m/tokens.txt", "/m/model.onnx"] })).toBe(
      "Model folder is missing required paths: tokens.txt、model.onnx",
    );
  });

  test("齐了返回 null", () => {
    expect(formatPathsDetail({ binary: null, missing: [] })).toBeNull();
  });
});
