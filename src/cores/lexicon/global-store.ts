import { normalizeStoredEntry } from "./file-format";
import type { LexiconEntry, LexiconEntryInput } from "./types";

/** 词库数据库名；与插件 id 一致，便于在浏览器存储中辨认归属 */
const LEXICON_DB_NAME = "local-speech-recognition";
/** 数据库版本；仅对象仓库结构变化时递增，条目字段增删不改结构 */
const LEXICON_DB_VERSION = 1;
/** 词库对象仓库名 */
const LEXICON_STORE_NAME = "lexicon";

/** 数据库连接缓存；避免每次读写重复 open，失败时复位供下次重试 */
let databasePromise: Promise<IDBDatabase> | null = null;

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

/**
 * 读取全部词条，按 id 降序（最新在前）返回。
 * 纯存储操作：变更广播由路由外观统一处理。
 */
export async function listEntries(): Promise<LexiconEntry[]> {
  const raw = await runTransaction<unknown[]>("readonly", (store): IDBRequest<unknown[]> => store.getAll());
  return raw
    .map((item) => normalizeStoredEntry(item))
    .filter((entry): entry is LexiconEntry => entry !== null)
    .sort((a, b) => b.id - a.id);
}

/**
 * 新增词条，id 由自增主键生成并回填。
 */
export async function addEntry(input: LexiconEntryInput): Promise<LexiconEntry> {
  // 显式重建普通对象：调用方可能传入 Svelte $state 代理，structured clone 无法克隆 Proxy
  const record: LexiconEntryInput = {
    word: input.word,
    pinyin: input.pinyin,
    weight: input.weight,
    enable: input.enable,
  };
  const id = await runTransaction<IDBValidKey>("readwrite", (store) => store.add(record));
  if (typeof id !== "number") throw new Error("unexpected lexicon entry key");
  return { id, ...record };
}

/**
 * 批量新增词条；单事务提交，返回新增条数。id 由自增主键生成，调用方不提供。
 * @param inputs 待新增的词条列表，空列表直接返回 0
 * @returns 实际新增的条数
 */
export async function addEntries(inputs: LexiconEntryInput[]): Promise<number> {
  if (inputs.length === 0) return 0;
  const db = await getDatabase();
  const transaction = db.transaction(LEXICON_STORE_NAME, "readwrite");
  const done = transactionDone(transaction);
  try {
    const store = transaction.objectStore(LEXICON_STORE_NAME);
    for (const input of inputs) {
      // 同 addEntry：先还原为普通对象，避免结构化克隆遇到响应式代理
      const record: LexiconEntryInput = {
        word: input.word,
        pinyin: input.pinyin,
        weight: input.weight,
        enable: input.enable,
      };
      store.add(record);
    }
    await done;
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
export async function updateEntry(entry: LexiconEntry): Promise<void> {
  // 同 addEntry：先还原为普通对象，避免结构化克隆遇到响应式代理
  const record: LexiconEntry = {
    id: entry.id,
    word: entry.word,
    pinyin: entry.pinyin,
    weight: entry.weight,
    enable: entry.enable,
  };
  await runTransaction("readwrite", (store) => store.put(record));
}

/**
 * 删除词条。
 */
export async function deleteEntry(id: number): Promise<void> {
  await runTransaction("readwrite", (store) => store.delete(id));
}

/**
 * 批量删除词条；单事务提交，避免逐条删除的多次往返。
 * @param ids 待删除的词条 id 列表，空列表直接返回
 */
export async function deleteEntries(ids: number[]): Promise<void> {
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
export async function updateEntries(entries: LexiconEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const db = await getDatabase();
  const transaction = db.transaction(LEXICON_STORE_NAME, "readwrite");
  const done = transactionDone(transaction);
  try {
    const store = transaction.objectStore(LEXICON_STORE_NAME);
    for (const entry of entries) {
      // 同 updateEntry：先还原为普通对象，避免结构化克隆遇到响应式代理
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
export async function clearEntries(): Promise<number> {
  const db = await getDatabase();
  const transaction = db.transaction(LEXICON_STORE_NAME, "readwrite");
  const done = transactionDone(transaction);
  try {
    const store = transaction.objectStore(LEXICON_STORE_NAME);
    const count = await requestResult(store.count());
    store.clear();
    await done;
    return count;
  } catch (error) {
    // count 请求失败时 done 仍可能 reject，先消费避免未处理的拒绝
    void done.catch(() => undefined);
    throw error;
  }
}
