import { normalizeStoredEntry } from "./file-format";
import type { LexiconEntry, LexiconEntryInput } from "./types";
import type LocalSpeechRecognitionPlugin from "../../main";

/** 仓库词库文件格式版本；结构变化时递增并按需兼容旧版本 */
const VAULT_LEXICON_FILE_VERSION = 1;

/** 仓库词库文件结构；nextId 持久化保证删除后 id 不回退重用 */
interface VaultLexiconFile {
  version: number;
  nextId: number;
  entries: LexiconEntry[];
}

/** 插件实例引用；init 时注入，供文件读写定位仓库配置目录 */
let pluginRef: LocalSpeechRecognitionPlugin | null = null;
/** 仓库词库文件路径；init 时按当前仓库计算 */
let filePath: string | null = null;
/** 内存单源；init 加载后一切读写经此进行，落盘为全量覆写 */
let cachedEntries: LexiconEntry[] = [];
/** 下一个可用 id；init 时按 max(id)+1 与文件值取大，内存自增 */
let nextId = 1;
/** 落盘串行队列；写操作排队执行，避免并发覆写互相覆盖 */
let flushQueue: Promise<void> = Promise.resolve();

/**
 * 初始化仓库文件后端：按当前仓库计算文件路径并加载，没有文件或解析失败时按空词库启动。
 * 由词库 init 在设置加载后调用一次；重复调用直接返回。
 * @param plugin 插件实例；type-only 导入具体类，运行时无循环
 */
export async function initVaultLexiconStore(plugin: LocalSpeechRecognitionPlugin): Promise<void> {
  if (pluginRef !== null) return;
  pluginRef = plugin;
  // 文件随仓库走：路径位于当前仓库的插件配置目录，新仓库天然为空、重命名自动保留
  filePath = `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}/lexicon.json`;
  cachedEntries = [];
  nextId = 1;
  try {
    const adapter = plugin.app.vault.adapter;
    if (!(await adapter.exists(filePath))) return;
    const text = await adapter.read(filePath);
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return;
    const record = parsed as Partial<VaultLexiconFile>;
    const entries = Array.isArray(record.entries)
      ? record.entries.map((item) => normalizeStoredEntry(item)).filter((entry): entry is LexiconEntry => entry !== null)
      : [];
    cachedEntries = entries;
    // nextId 取文件值与实际最大 id 的较大者：手改文件导致回退时仍不重用已存在 id
    const maxId = entries.reduce((max, entry) => Math.max(max, entry.id), 0);
    const fileNextId = typeof record.nextId === "number" ? record.nextId : 1;
    nextId = Math.max(fileNextId, maxId + 1, 1);
  } catch {
    // 缺文件、读失败或 JSON 损坏都按空词库启动，不阻塞插件加载
    cachedEntries = [];
    nextId = 1;
  }
}

/** 落盘当前内存快照；调用方经串行队列进入，失败直接抛给写操作由 Notice 呈现 */
async function writeFile(): Promise<void> {
  if (pluginRef === null || filePath === null) throw new Error("vault lexicon store not initialized");
  const payload: VaultLexiconFile = {
    version: VAULT_LEXICON_FILE_VERSION,
    nextId,
    entries: cachedEntries,
  };
  const adapter = pluginRef.app.vault.adapter;
  const slash = filePath.lastIndexOf("/");
  if (slash > 0) {
    // 父目录多半已存在；已存在时 mkdir 抛错直接忽略，由后续 write 决定成败
    await adapter.mkdir(filePath.slice(0, slash)).catch(() => undefined);
  }
  await adapter.write(filePath, JSON.stringify(payload, null, 2));
}

/** 将内存变更落盘；排队串行执行，调用方 await 到本次写入完成 */
function flush(): Promise<void> {
  const task = flushQueue.then(() => writeFile());
  // 队列本身永不带病：失败只传给当前调用方，不阻塞后续写入
  flushQueue = task.catch(() => undefined);
  return task;
}

/** 内存快照按 id 降序返回副本；调用方改动不影响单源 */
function snapshot(): LexiconEntry[] {
  return cachedEntries.map((entry) => ({ ...entry })).sort((a, b) => b.id - a.id);
}

/**
 * 读取全部词条，按 id 降序（最新在前）返回。
 * 纯存储操作：变更广播由路由外观统一处理。
 */
export async function listEntries(): Promise<LexiconEntry[]> {
  return snapshot();
}

/**
 * 新增词条，id 由内存计数器分配。
 */
export async function addEntry(input: LexiconEntryInput): Promise<LexiconEntry> {
  // 显式重建普通对象：调用方可能传入 Svelte $state 代理，直接缓存会连带响应式语义
  const entry: LexiconEntry = {
    id: nextId,
    word: input.word,
    pinyin: input.pinyin,
    weight: input.weight,
    enable: input.enable,
  };
  nextId += 1;
  cachedEntries.push(entry);
  try {
    await flush();
  } catch (error) {
    // 落盘失败时回滚内存，避免重启后数据丢失却显示成功
    cachedEntries = cachedEntries.filter((item) => item.id !== entry.id);
    nextId -= 1;
    throw error;
  }
  return { ...entry };
}

/**
 * 批量新增词条；一次落盘，返回新增条数。
 * @param inputs 待新增的词条列表，空列表直接返回 0
 * @returns 实际新增的条数
 */
export async function addEntries(inputs: LexiconEntryInput[]): Promise<number> {
  if (inputs.length === 0) return 0;
  const created: LexiconEntry[] = inputs.map((input) => {
    const entry: LexiconEntry = {
      id: nextId,
      word: input.word,
      pinyin: input.pinyin,
      weight: input.weight,
      enable: input.enable,
    };
    nextId += 1;
    return entry;
  });
  cachedEntries.push(...created);
  try {
    await flush();
  } catch (error) {
    const ids = new Set(created.map((entry) => entry.id));
    cachedEntries = cachedEntries.filter((item) => !ids.has(item.id));
    nextId -= created.length;
    throw error;
  }
  return created.length;
}

/**
 * 更新词条；按 id 全量覆盖，不存在时直接抛错。
 */
export async function updateEntry(entry: LexiconEntry): Promise<void> {
  const index = cachedEntries.findIndex((item) => item.id === entry.id);
  if (index === -1) throw new Error(`lexicon entry not found: ${entry.id}`);
  const previous = cachedEntries[index];
  // 同 addEntry：先还原为普通对象，避免缓存响应式代理
  cachedEntries[index] = {
    id: entry.id,
    word: entry.word,
    pinyin: entry.pinyin,
    weight: entry.weight,
    enable: entry.enable,
  };
  try {
    await flush();
  } catch (error) {
    if (previous !== undefined) cachedEntries[index] = previous;
    throw error;
  }
}

/**
 * 删除词条；id 不存在时视为成功（与 IndexedDB delete 语义一致）。
 */
export async function deleteEntry(id: number): Promise<void> {
  const previous = cachedEntries;
  cachedEntries = cachedEntries.filter((item) => item.id !== id);
  if (cachedEntries.length === previous.length) return;
  try {
    await flush();
  } catch (error) {
    cachedEntries = previous;
    throw error;
  }
}

/**
 * 批量删除词条；一次落盘，空列表直接返回。
 * @param ids 待删除的词条 id 列表
 */
export async function deleteEntries(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const idSet = new Set(ids);
  const previous = cachedEntries;
  cachedEntries = cachedEntries.filter((item) => !idSet.has(item.id));
  if (cachedEntries.length === previous.length) return;
  try {
    await flush();
  } catch (error) {
    cachedEntries = previous;
    throw error;
  }
}

/**
 * 批量更新词条；一次落盘，空列表直接返回。
 * @param entries 待更新的词条列表
 */
export async function updateEntries(entries: LexiconEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const previous = cachedEntries.map((item) => ({ ...item }));
  const patch = new Map(entries.map((entry) => [entry.id, entry]));
  cachedEntries = cachedEntries.map((item) => {
    const draft = patch.get(item.id);
    if (draft === undefined) return item;
    // 同 updateEntry：先还原为普通对象，避免缓存响应式代理
    return { id: draft.id, word: draft.word, pinyin: draft.pinyin, weight: draft.weight, enable: draft.enable };
  });
  try {
    await flush();
  } catch (error) {
    cachedEntries = previous;
    throw error;
  }
}

/**
 * 清空词库，返回删除条数。
 * @returns 被删除的条数
 */
export async function clearEntries(): Promise<number> {
  const previous = cachedEntries;
  cachedEntries = [];
  try {
    await flush();
  } catch (error) {
    cachedEntries = previous;
    throw error;
  }
  return previous.length;
}
