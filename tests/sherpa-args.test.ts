import { describe, expect, test } from "bun:test";
import type { SherpaServerConfig } from "../src/cores/sherpa-server/types";
import { buildSherpaArgs, type SherpaModelId } from "../src/utils/sherpa-process";

/** 构造服务配置：二进制与监听项固定，只换模型标识与目录 */
function configWith(modelType: SherpaModelId, modelPath = "/m"): SherpaServerConfig {
  return {
    binaryPath: "/bin/sherpa-onnx-offline-websocket-server",
    modelPath,
    modelType,
    host: "127.0.0.1",
    port: 6006,
    numThreads: 4,
    provider: "cpu",
  };
}

describe("buildSherpaArgs", () => {
  test("SenseVoice 两精度", () => {
    expect(buildSherpaArgs(configWith("sense-voice-int8"))).toEqual([
      "--port=6006",
      "--provider=cpu",
      "--num-threads=4",
      "--sense-voice-model=/m/model.int8.onnx",
      "--sense-voice-use-itn=1",
      "--tokens=/m/tokens.txt",
      "--log-file=/dev/null",
    ]);
    expect(buildSherpaArgs(configWith("sense-voice"))).toEqual([
      "--port=6006",
      "--provider=cpu",
      "--num-threads=4",
      "--sense-voice-model=/m/model.onnx",
      "--sense-voice-use-itn=1",
      "--tokens=/m/tokens.txt",
      "--log-file=/dev/null",
    ]);
  });

  test("FunASR 三精度文件名", () => {
    expect(buildSherpaArgs(configWith("fun-asr-int8"))).toEqual([
      "--port=6006",
      "--provider=cpu",
      "--num-threads=4",
      "--funasr-nano-encoder-adaptor=/m/encoder_adaptor.int8.onnx",
      "--funasr-nano-llm=/m/llm.int8.onnx",
      "--funasr-nano-embedding=/m/embedding.int8.onnx",
      "--funasr-nano-tokenizer=/m/Qwen3-0.6B",
      "--log-file=/dev/null",
    ]);
    expect(buildSherpaArgs(configWith("fun-asr-fp16"))).toEqual([
      "--port=6006",
      "--provider=cpu",
      "--num-threads=4",
      "--funasr-nano-encoder-adaptor=/m/encoder_adaptor.int8.onnx",
      "--funasr-nano-llm=/m/llm.fp16.onnx",
      "--funasr-nano-embedding=/m/embedding.int8.onnx",
      "--funasr-nano-tokenizer=/m/Qwen3-0.6B",
      "--log-file=/dev/null",
    ]);
    expect(buildSherpaArgs(configWith("fun-asr-fp32"))).toEqual([
      "--port=6006",
      "--provider=cpu",
      "--num-threads=4",
      "--funasr-nano-encoder-adaptor=/m/encoder_adaptor.onnx",
      "--funasr-nano-llm=/m/llm.fp32.onnx",
      "--funasr-nano-embedding=/m/embedding.onnx",
      "--funasr-nano-tokenizer=/m/Qwen3-0.6B",
      "--log-file=/dev/null",
    ]);
  });

  test("Paraformer 两精度", () => {
    expect(buildSherpaArgs(configWith("paraformer-int8"))).toEqual([
      "--port=6006",
      "--provider=cpu",
      "--num-threads=4",
      "--paraformer=/m/model.int8.onnx",
      "--tokens=/m/tokens.txt",
      "--log-file=/dev/null",
    ]);
    expect(buildSherpaArgs(configWith("paraformer"))).toEqual([
      "--port=6006",
      "--provider=cpu",
      "--num-threads=4",
      "--paraformer=/m/model.onnx",
      "--tokens=/m/tokens.txt",
      "--log-file=/dev/null",
    ]);
  });

  test("Qwen3-ASR 双版本（无 tokens，生成预算显式 512）", () => {
    const common = [
      "--port=6006",
      "--provider=cpu",
      "--num-threads=4",
      "--qwen3-asr-conv-frontend=/m/conv_frontend.onnx",
      "--qwen3-asr-encoder=/m/encoder.int8.onnx",
      "--qwen3-asr-decoder=/m/decoder.int8.onnx",
      "--qwen3-asr-tokenizer=/m/tokenizer",
      "--qwen3-asr-max-total-len=512",
      "--qwen3-asr-max-new-tokens=512",
      "--qwen3-asr-temperature=1e-6",
      "--qwen3-asr-top-p=0.8",
      "--qwen3-asr-seed=42",
      "--log-file=/dev/null",
    ];
    expect(buildSherpaArgs(configWith("qwen3-asr-0.6b-int8"))).toEqual(common);
    expect(buildSherpaArgs(configWith("qwen3-asr-1.7b-int8"))).toEqual(common);
  });

  test("模型目录去尾部斜杠", () => {
    expect(buildSherpaArgs(configWith("paraformer", "/m/"))).toEqual(buildSherpaArgs(configWith("paraformer", "/m")));
  });
});
