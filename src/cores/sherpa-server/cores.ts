import { Platform } from "obsidian";
import { buildSherpaArgs, resolveSherpaUrl, validateSherpaConfig } from "../../utils/sherpa-process";
import type { SherpaServerConfig, SherpaServerStatus } from "../../utils/sherpa-process";
import { t } from "../i18n";
import type LocalSpeechRecognitionPlugin from "../../main";
import type { SherpaServerManager, SherpaServerResult } from "./types";

/**
 * 可读流窄类型：仅消费子进程管道输出。
 * stdio 为 pipe 时若无人读取，子进程写满管道缓冲会阻塞，必须消费。
 */
interface LogStream {
  /** 订阅数据事件 */
  on(event: "data", listener: (chunk: unknown) => void): void;
}

/**
 * 受管进程窄类型：只声明 manager 实际使用的成员，
 * 避免顶层导入 node:child_process 类型触发 no-nodejs-modules 规则。
 */
interface ManagedProcess {
  /** 进程 id，不可用时为空 */
  pid: number | undefined;
  /** 正常退出的退出码；信号致死或运行中时为 null */
  exitCode: number | null;
  /** 致死信号名；运行中或正常退出时为 null */
  signalCode: string | null;
  /**
   * kill() 信号投递成功标记，不代表进程已退出：
   * 发送 SIGTERM 成功后即为 true，存活判断必须看 exitCode/signalCode。
   */
  killed: boolean;
  /** 同步终止进程，可指定信号 */
  kill(signal?: string): boolean;
  /** 订阅进程事件 */
  on(event: "error" | "exit", listener: (...args: Array<unknown>) => void): void;
  /** 标准输出管道 */
  stdout: LogStream | null;
  /** 标准错误管道 */
  stderr: LogStream | null;
}

/** 动态加载的 spawn 签名，与 child_process.spawn 对齐的最小子集 */
type SpawnFn = (command: string, args: Array<string>, options: { stdio: Array<string> }) => ManagedProcess;

/** 服务就绪探测间隔毫秒数：轮询 ws 拨号，open 即判活 */
const READY_POLL_INTERVAL_MS = 300;

/** 服务就绪探测超时毫秒数：超时未 open 则判启动失败 */
const READY_TIMEOUT_MS = 10000;

/** 关闭信号升级超时毫秒数：SIGTERM 无效后升级为 SIGKILL */
const KILL_ESCALATION_TIMEOUT_MS = 3000;

/**
 * 拨号指定 ws 地址：open 即 resolve，不消费消息。
 * @param url 待拨号的 ws 地址
 */
function probeWebSocket(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.onopen = () => {
      socket.close();
      resolve();
    };
    socket.onerror = () => {
      reject(new Error("unreachable"));
    };
  });
}

/**
 * sherpa-onnx 服务管理器：持有进程句柄与状态，供设置页与 feature 共用。
 * 状态变更经订阅广播，设置页订阅后 update() 刷新按钮显隐。
 */
class SherpaServer implements SherpaServerManager {
  /** 当前服务状态 */
  private status: SherpaServerStatus = "stopped";
  /** 受管子进程句柄，空值表示未持有 */
  private handle: ManagedProcess | null = null;
  /** 状态订阅回调集合 */
  private listeners = new Set<() => void>();
  /** 就绪探测定时器，启动失败或成功后清理 */
  private readyTimer: number | null = null;

  getStatus(): SherpaServerStatus {
    return this.status;
  }

  isRunning(): boolean {
    return this.status === "running" || this.status === "starting";
  }

  subscribeStatus(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async start(config: SherpaServerConfig): Promise<SherpaServerResult> {
    if (this.isRunning()) return { ok: false, detail: "already-running" };
    if (!Platform.isDesktop) return { ok: false, detail: "desktop-only" };
    const missingKey = validateSherpaConfig(config);
    if (missingKey !== null) return { ok: false, detail: missingKey };
    // Obsidian 桌面端以 CJS 形式加载插件：Node 内建模块须走 require 同步加载；
    // 原生 import("node:child_process") 会被当作网络模块抓取而报 Failed to fetch。
    // require 写法被 @typescript-eslint/no-require-imports 禁止，此处为桌面 CJS 唯一可行路径。
    let spawn: SpawnFn;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- 桌面 CJS 插件加载 Node 内建模块的唯一可行路径
      spawn = (require("child_process") as { spawn: SpawnFn }).spawn;
    } catch (error) {
      return { ok: false, detail: toErrorDetail(error) };
    }
    return this.spawnAndWait(spawn, config);
  }

  stop(): void {
    this.clearReadyTimer();
    this.killProcess();
    this.handle = null;
    this.setStatus("stopped");
  }

  dispose(): void {
    this.clearReadyTimer();
    this.killNow();
    this.handle = null;
    this.setStatus("stopped");
  }

  async restart(config: SherpaServerConfig): Promise<SherpaServerResult> {
    this.stop();
    return this.start(config);
  }

  /**
   * 拉起子进程并等待就绪：open 探测成功置 running，进程异常退出或超时置 error。
   * 就绪前进程退出大概率是参数错误，透出退出码便于排查。
   */
  private async spawnAndWait(spawn: SpawnFn, config: SherpaServerConfig): Promise<SherpaServerResult> {
    const url = resolveSherpaUrl(config.host, config.port);
    let handle: ManagedProcess;
    try {
      handle = spawn(config.binaryPath, buildSherpaArgs(config), { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      return { ok: false, detail: toErrorDetail(error) };
    }
    this.handle = handle;
    this.attachLogDrain(handle);
    this.setStatus("starting");
    return new Promise((resolve) => {
      let settled = false;
      const fail = (detail: string) => {
        if (settled) return;
        settled = true;
        this.clearReadyTimer();
        this.handle = null;
        this.setStatus("error");
        resolve({ ok: false, detail });
      };
      const succeed = () => {
        if (settled) return;
        settled = true;
        this.clearReadyTimer();
        this.setStatus("running");
        resolve({ ok: true });
      };
      handle.on("error", (error) => {
        fail(toErrorDetail(error));
      });
      handle.on("exit", (code) => {
        fail(`exit code ${String(code)}`);
      });
      const startedAt = Date.now();
      const poll = () => {
        if (settled) return;
        if (Date.now() - startedAt > READY_TIMEOUT_MS) {
          this.stopSpawned(handle);
          fail("timeout");
          return;
        }
        void probeWebSocket(url).then(succeed, () => {
          if (!settled) {
            this.readyTimer = window.setTimeout(poll, READY_POLL_INTERVAL_MS);
          }
        });
      };
      poll();
    });
  }

  /** 停止尚在就绪探测中的子进程：只杀进程不清状态，状态由 fail/succeed 收尾 */
  private stopSpawned(handle: ManagedProcess): void {
    if (!handle.killed) {
      handle.kill();
    }
  }

  /**
   * 终止当前持有的子进程：SIGTERM 宽限后升级为 SIGKILL，
   * 宽限等待只检查 exitCode/signalCode，不阻塞 stop() 返回。
   */
  private killProcess(): void {
    const handle = this.handle;
    if (handle === null || handle.exitCode !== null || handle.signalCode !== null) return;
    handle.kill("SIGTERM");
    window.setTimeout(() => {
      if (handle.exitCode === null && handle.signalCode === null) {
        handle.kill("SIGKILL");
      }
    }, KILL_ESCALATION_TIMEOUT_MS);
  }

  /**
   * 同步强杀当前子进程：供应用退出路径使用。
   * 退出时渲染进程随时会被销毁，SIGTERM 的 3 秒升级等待等不到回调，
   * 必须直接 SIGKILL，不依赖任何异步收尾。
   */
  private killNow(): void {
    const handle = this.handle;
    if (handle === null || handle.exitCode !== null || handle.signalCode !== null) return;
    handle.kill("SIGKILL");
  }

  /**
   * 消费子进程管道输出：pipe 无人读取时写满缓冲会阻塞子进程，
   * 且异常退出前的 stderr 是定位参数错误的唯一线索。
   * @param handle 刚拉起的子进程句柄
   */
  private attachLogDrain(handle: ManagedProcess): void {
    handle.stdout?.on("data", (chunk) => {
      console.debug(`[sherpa-onnx] ${String(chunk).trimEnd()}`);
    });
    handle.stderr?.on("data", (chunk) => {
      console.error(`[sherpa-onnx] ${String(chunk).trimEnd()}`);
    });
  }

  /** 状态写入并广播订阅者 */
  private setStatus(status: SherpaServerStatus): void {
    this.status = status;
    this.listeners.forEach((listener) => {
      listener();
    });
  }

  /** 清理就绪探测定时器 */
  private clearReadyTimer(): void {
    if (this.readyTimer !== null) {
      window.clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
  }
}

/** 模块单例：插件内全局唯一服务管理器 */
const manager = new SherpaServer();

/**
 * 获取服务管理器单例。cores/settings 与 features 共用同一实例，
 * 保证按钮状态与 autoStart 操作的是同一进程。
 * @returns 服务管理器
 */
export function getSherpaServer(): SherpaServerManager {
  return manager;
}

/**
 * 从插件设置组装服务启动配置。读取时取最新值，
 * 配置变更仅手动生效，下次启动时读取新值。
 * @param plugin 插件实例
 * @returns 服务启动配置
 */
export function toServerConfig(plugin: LocalSpeechRecognitionPlugin): SherpaServerConfig {
  const { binaryPath, modelPath, host, port, numThreads } = plugin.settings;
  return { binaryPath, modelPath, host, port, numThreads };
}

/**
 * 服务操作失败详情翻译：缺失项返回 i18n 键需翻译，
 * 运行时错误（退出码/超时等）直接展示原文。
 * @param detail manager 返回的失败详情
 * @returns 可展示的详情文本
 */
export function resolveDetail(detail: string | undefined): string {
  if (detail === undefined) return "";
  if (detail === "settings.missingBinaryPath") return t("settings.missingBinaryPath");
  if (detail === "settings.missingModelPath") return t("settings.missingModelPath");
  return detail;
}

/**
 * 错误详情提取：Error 取 message，其余类型转字符串，保证 Notice 文案可读。
 * @param error 捕获到的未知错误
 * @returns 可展示的错误详情文本
 */
function toErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
