import { buildVariantKeys } from "./fuzzy";
import type { LexiconEntry, LexiconEntryInput } from "./types";

/** 词库数据库名；与插件 id 一致，便于在浏览器存储中辨认归属 */
const LEXICON_DB_NAME = "local-speech-recognition";
/** 数据库版本；仅对象仓库结构变化时递增，条目字段增删不改结构 */
const LEXICON_DB_VERSION = 1;
/** 词库对象仓库名 */
const LEXICON_STORE_NAME = "lexicon";

/** 数据库连接缓存；避免每次读写重复 open，失败时复位供下次重试 */
let databasePromise: Promise<IDBDatabase> | null = null;

/** 词库数据变更订阅回调集合；写操作提交后广播，供 UI（如侧边栏词库页）实时刷新 */
const changeListeners = new Set<() => void>();

/** 启用词条的归一化拼音 → 词语列表；模块级单例，原地更新保证调用方持有的引用持续有效 */
const enabledPinyinMap = new Map<string, string[]>();

/** 启用词条的模糊变体 key → 词语列表；与精确映射同构，仅在模糊开关开启时填充 */
const enabledFuzzyPinyinMap = new Map<string, string[]>();

/** 映射重建代际号：并发重建时仅最后一次回包生效，防止旧读覆盖新数据 */
let pinyinRefreshGeneration = 0;

/** 词库功能总开关；关闭时映射清空，识别后处理不产生候选，读写词条不受影响 */
let lexiconEnabled = true;

/** 模糊音匹配开关；关闭时模糊映射为空，消费方按精确同音匹配 */
let fuzzyMatchEnabled = false;

/** 当前词库功能是否启用；供需要短路的高频路径（如识别后处理）判断 */
export function isLexiconEnabled(): boolean {
  return lexiconEnabled;
}

/**
 * 设置词库运行时开关：关闭时清空拼音映射并作废在途重建（防止关闭后被旧回包重新填充），
 * 开启时重建映射。由 features/lexicon 控制器在设置开关变化时调用，与持久化设置保持同步。
 * @param enabled 是否启用词库功能
 */
export async function setLexiconEnabled(enabled: boolean): Promise<void> {
  lexiconEnabled = enabled;
  if (!enabled) {
    pinyinRefreshGeneration += 1;
    enabledPinyinMap.clear();
    enabledFuzzyPinyinMap.clear();
    return;
  }
  await refreshEnabledPinyinMap();
}

/** 当前是否启用模糊音匹配；供识别后处理决定是否并入模糊映射 */
export function isFuzzyMatchEnabled(): boolean {
  return fuzzyMatchEnabled;
}

/**
 * 设置模糊音匹配开关并重建映射；值未变化时直接返回，避免无谓重建。
 * 由 features/lexicon 控制器在设置开关变化时调用。
 * @param enabled 是否启用模糊音匹配
 */
export async function setFuzzyMatchEnabled(enabled: boolean): Promise<void> {
  if (fuzzyMatchEnabled === enabled) return;
  fuzzyMatchEnabled = enabled;
  await refreshEnabledPinyinMap();
}

/**
 * 获取启用词条映射：key 为去空白并小写的拼音，value 为词语列表（权重降序、其次 id 降序）。
 * 返回只读视图且为同一实例，词库变更后自动可见新数据。
 */
export function getEnabledPinyinMap(): ReadonlyMap<string, readonly string[]> {
  return enabledPinyinMap;
}

/**
 * 获取启用词条的模糊变体映射：key 为易混变体拼写，value 为词语列表（顺序同精确映射）。
 * 返回只读视图且为同一实例；模糊开关关闭时为空表。
 */
export function getEnabledFuzzyPinyinMap(): ReadonlyMap<string, readonly string[]> {
  return enabledFuzzyPinyinMap;
}

/**
 * 重建启用词条映射：仅收录启用条目，拼音去除全部空白并转小写后作键；
 * 同一拼音下词语按权重降序排列，同权重时 id 大者在前（稳定排序保留 listLexiconEntries 的 id 降序）。
 * 模糊开关开启时同步重建模糊变体映射，关闭时清空。
 * 读取失败静默保留旧映射，消费方降级为无增强，不打断主流程。
 */
export async function refreshEnabledPinyinMap(): Promise<void> {
  // 关闭状态下不重建：写入变更触发的重建同样被拦截，映射保持为空
  if (!lexiconEnabled) return;
  const generation = ++pinyinRefreshGeneration;
  try {
    const entries = await listLexiconEntries();
    if (generation !== pinyinRefreshGeneration) return;
    const sorted = entries.filter((entry) => entry.enable).sort((a, b) => b.weight - a.weight);
    const next = new Map<string, string[]>();
    for (const entry of sorted) {
      const key = entry.pinyin.replace(/\s+/g, "").toLowerCase();
      if (key === "") continue;
      const words = next.get(key);
      if (words === undefined) {
        next.set(key, [entry.word]);
      } else if (!words.includes(entry.word)) {
        words.push(entry.word);
      }
    }
    // 模糊变体：按词条拼音的音节展开易混拼写，供识别偏差（平翘舌、前后鼻音）也能命中
    const nextFuzzy = new Map<string, string[]>();
    if (fuzzyMatchEnabled) {
      for (const entry of sorted) {
        for (const key of buildVariantKeys(entry.pinyin, [...entry.word].length)) {
          const words = nextFuzzy.get(key);
          if (words === undefined) {
            nextFuzzy.set(key, [entry.word]);
          } else if (!words.includes(entry.word)) {
            words.push(entry.word);
          }
        }
      }
    }
    // 原地替换：保持单例引用不变，已持有引用的调用方持续有效
    enabledPinyinMap.clear();
    for (const [key, words] of next) {
      enabledPinyinMap.set(key, words);
    }
    // 关闭时 nextFuzzy 为空表，顺带清空旧模糊键，无需单独分支
    enabledFuzzyPinyinMap.clear();
    for (const [key, words] of nextFuzzy) {
      enabledFuzzyPinyinMap.set(key, words);
    }
  } catch {
    // 静默：保留上一次映射
  }
}

/**
 * 订阅词库数据变更。新增/更新/删除事务提交成功后触发，
 * 调用方据此重新读取列表，保证多处入口（右键菜单、词库页自身）写入后 UI 一致。
 * @param listener 变更回调
 * @returns 取消订阅函数
 */
export function subscribeLexiconChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

/** 广播词库数据变更；由各写操作在事务提交成功后调用，并同步重建启用词条映射 */
function notifyLexiconChange(): void {
  void refreshEnabledPinyinMap();
  changeListeners.forEach((listener) => listener());
}

/**
 * 打开数据库：首次调用建库建表，此后复用同一连接。
 * open 失败或被阻塞时复位缓存，让下一次调用重新尝试。
 */
function getDatabase(): Promise<IDBDatabase> {
  if (databasePromise !== null) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(LEXICON_DB_NAME, LEXICON_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LEXICON_STORE_NAME)) {
        db.createObjectStore(LEXICON_STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // 其他实例请求升级（如未来版本）时主动让出连接，否则会阻塞对方的 versionchange 事务
      db.onversionchange = () => {
        db.close();
        databasePromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error("failed to open lexicon database"));
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(new Error("lexicon database upgrade blocked"));
    };
  });
  return databasePromise;
}

/** 将 IDBRequest 包装为 Promise，失败统一转换错误 */
function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb request failed"));
  });
}

/** 等待事务提交；请求成功不等于写入落盘，写操作必须再等 complete */
function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("indexeddb transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("indexeddb transaction aborted"));
  });
}

/**
 * 在词库表上执行一次事务。
 * 先挂 complete/error 监听再发起请求：事务提交可能早于 await 恢复，晚挂监听会永久挂起。
 */
async function runTransaction<T>(mode: IDBTransactionMode, handler: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await getDatabase();
  const transaction = db.transaction(LEXICON_STORE_NAME, mode);
  const done = transactionDone(transaction);
  try {
    const request = handler(transaction.objectStore(LEXICON_STORE_NAME));
    const [value] = await Promise.all([requestResult(request), done]);
    return value;
  } catch (error) {
    // handler 同步抛错时 done 仍可能 reject，先消费避免未处理的拒绝
    void done.catch(() => undefined);
    throw error;
  }
}

/** 运行时归一化条目：脏数据丢弃，后加的可选字段缺失时按默认值补齐 */
function normalizeLexiconEntry(raw: unknown): LexiconEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const { id, word, pinyin, weight, enable } = record;
  if (typeof id !== "number" || typeof word !== "string" || typeof pinyin !== "string") return null;
  return {
    id,
    word,
    pinyin,
    weight: typeof weight === "number" ? weight : 0,
    // enable 为后加字段，旧记录缺失时按启用处理
    enable: typeof enable === "boolean" ? enable : true,
  };
}

/**
 * 读取全部词条，按 id 降序（最新在前）返回。
 */
export async function listLexiconEntries(): Promise<LexiconEntry[]> {
  const raw = await runTransaction<unknown[]>("readonly", (store): IDBRequest<unknown[]> => store.getAll());
  return raw
    .map((item) => normalizeLexiconEntry(item))
    .filter((entry): entry is LexiconEntry => entry !== null)
    .sort((a, b) => b.id - a.id);
}

/**
 * 按词语与拼音精确查找词条（严格相等，多音字可并存）。
 * @param word 待查找的词语；调用方传入 trim 后的值
 * @param pinyin 待查找的拼音；与词语共同构成唯一性判定
 * @param excludeId 需排除的词条 id；编辑场景传入自身，避免未改词时误判重复
 * @returns 命中的词条，未找到返回 null
 */
export async function findLexiconEntry(word: string, pinyin: string, excludeId?: number): Promise<LexiconEntry | null> {
  if (word === "" || pinyin === "") return null;
  const entries = await listLexiconEntries();
  return entries.find((entry) => entry.word === word && entry.pinyin === pinyin && entry.id !== excludeId) ?? null;
}

/**
 * 新增词条，id 由自增主键生成并回填。
 */
export async function addLexiconEntry(input: LexiconEntryInput): Promise<LexiconEntry> {
  // 显式重建普通对象：调用方可能传入 Svelte $state 代理，structured clone 无法克隆 Proxy
  const record: LexiconEntryInput = {
    word: input.word,
    pinyin: input.pinyin,
    weight: input.weight,
    enable: input.enable,
  };
  const id = await runTransaction<IDBValidKey>("readwrite", (store) => store.add(record));
  if (typeof id !== "number") throw new Error("unexpected lexicon entry key");
  notifyLexiconChange();
  return { id, ...record };
}

/**
 * 批量新增词条；单事务提交，返回新增条数。id 由自增主键生成，调用方不提供。
 * @param inputs 待新增的词条列表，空列表直接返回 0
 * @returns 实际新增的条数
 */
export async function addLexiconEntries(inputs: LexiconEntryInput[]): Promise<number> {
  if (inputs.length === 0) return 0;
  const db = await getDatabase();
  const transaction = db.transaction(LEXICON_STORE_NAME, "readwrite");
  const done = transactionDone(transaction);
  try {
    const store = transaction.objectStore(LEXICON_STORE_NAME);
    for (const input of inputs) {
      // 同 addLexiconEntry：先还原为普通对象，避免结构化克隆遇到响应式代理
      const record: LexiconEntryInput = {
        word: input.word,
        pinyin: input.pinyin,
        weight: input.weight,
        enable: input.enable,
      };
      store.add(record);
    }
    await done;
    notifyLexiconChange();
    return inputs.length;
  } catch (error) {
    // store 取用同步抛错时 done 仍可能 reject，先消费避免未处理的拒绝
    void done.catch(() => undefined);
    throw error;
  }
}

/**
 * 更新词条；按 id 全量覆盖。
 */
export async function updateLexiconEntry(entry: LexiconEntry): Promise<void> {
  // 同 addLexiconEntry：先还原为普通对象，避免结构化克隆遇到响应式代理
  const record: LexiconEntry = {
    id: entry.id,
    word: entry.word,
    pinyin: entry.pinyin,
    weight: entry.weight,
    enable: entry.enable,
  };
  await runTransaction("readwrite", (store) => store.put(record));
  notifyLexiconChange();
}

/**
 * 删除词条。
 */
export async function deleteLexiconEntry(id: number): Promise<void> {
  await runTransaction("readwrite", (store) => store.delete(id));
  notifyLexiconChange();
}

/**
 * 批量删除词条；单事务提交，避免逐条删除的多次往返。
 * @param ids 待删除的词条 id 列表，空列表直接返回
 */
export async function deleteLexiconEntries(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDatabase();
  const transaction = db.transaction(LEXICON_STORE_NAME, "readwrite");
  const done = transactionDone(transaction);
  try {
    const store = transaction.objectStore(LEXICON_STORE_NAME);
    for (const id of ids) {
      store.delete(id);
    }
    await done;
    notifyLexiconChange();
  } catch (error) {
    // store 取用同步抛错时 done 仍可能 reject，先消费避免未处理的拒绝
    void done.catch(() => undefined);
    throw error;
  }
}

/**
 * 批量更新词条；单事务提交，避免逐条更新的多次往返。
 * @param entries 待更新的词条列表，空列表直接返回
 */
export async function updateLexiconEntries(entries: LexiconEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const db = await getDatabase();
  const transaction = db.transaction(LEXICON_STORE_NAME, "readwrite");
  const done = transactionDone(transaction);
  try {
    const store = transaction.objectStore(LEXICON_STORE_NAME);
    for (const entry of entries) {
      // 同 updateLexiconEntry：先还原为普通对象，避免结构化克隆遇到响应式代理
      const record: LexiconEntry = {
        id: entry.id,
        word: entry.word,
        pinyin: entry.pinyin,
        weight: entry.weight,
        enable: entry.enable,
      };
      store.put(record);
    }
    await done;
    notifyLexiconChange();
  } catch (error) {
    // store 取用同步抛错时 done 仍可能 reject，先消费避免未处理的拒绝
    void done.catch(() => undefined);
    throw error;
  }
}

/**
 * 清空词库；单事务内先计数再清空，返回删除条数。
 * @returns 被删除的条数
 */
export async function clearLexiconEntries(): Promise<number> {
  const db = await getDatabase();
  const transaction = db.transaction(LEXICON_STORE_NAME, "readwrite");
  const done = transactionDone(transaction);
  try {
    const store = transaction.objectStore(LEXICON_STORE_NAME);
    const count = await requestResult(store.count());
    store.clear();
    await done;
    notifyLexiconChange();
    return count;
  } catch (error) {
    // count 请求失败时 done 仍可能 reject，先消费避免未处理的拒绝
    void done.catch(() => undefined);
    throw error;
  }
}
