import { buildVariantKeys } from "./fuzzy";
import * as globalStore from "./global-store";
import * as vaultStore from "./vault-store";
import type { LexiconEntry, LexiconEntryInput } from "./types";
import { isLexiconStorageMode, type LexiconStorageMode } from "../settings";
import type LocalSpeechRecognitionPlugin from "../../main";

/** 当前读写后端：global 全仓库共享的 IndexedDB，vault 当前仓库独立的 lexicon.json */
let storageMode: LexiconStorageMode = "global";

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

/**
 * 初始化词库存储：加载仓库文件后端缓存，并按持久化设置恢复存储方式。
 * 在 initSettings 之后、业务功能之前调用，features 的首次映射预热经此确定的后端读取。
 * @param plugin 插件实例；type-only 导入具体类，运行时无循环
 */
export async function initLexiconStore(plugin: LocalSpeechRecognitionPlugin): Promise<void> {
  await vaultStore.initVaultLexiconStore(plugin);
  // 旧版本 data.json 无该字段：loadSettings 已归一化，此处再守一次防外部直接篡改
  storageMode = isLexiconStorageMode(plugin.settings.lexiconStorage) ? plugin.settings.lexiconStorage : "global";
}

/** 当前词库读写后端；设置页切换后即时生效，两后端数据相互独立不互相同步 */
export function getLexiconStorageMode(): LexiconStorageMode {
  return storageMode;
}

/**
 * 切换词库读写后端并重建映射：仅改变后续读写位置，不在两后端之间复制数据。
 * 由 features/lexicon 控制器在设置广播到达时调用，经变更广播触发 UI 重载。
 * @param mode 最新存储方式
 */
export async function setLexiconStorageMode(mode: LexiconStorageMode): Promise<void> {
  if (storageMode === mode) return;
  storageMode = mode;
  await refreshEnabledPinyinMap();
  changeListeners.forEach((listener) => listener());
}

/** 按存储方式取后端实例；读操作直接委托，写操作由外观封装广播 */
function storeFor(mode: LexiconStorageMode): typeof globalStore {
  return mode === "vault" ? vaultStore : globalStore;
}

/** 当前读写后端实例；读操作直接委托，写操作由外观封装广播 */
function activeStore(): typeof globalStore {
  return storeFor(storageMode);
}

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

/** 广播词库数据变更；由各写操作在提交成功后调用，并同步重建启用词条映射 */
function notifyLexiconChange(): void {
  void refreshEnabledPinyinMap();
  changeListeners.forEach((listener) => listener());
}

/**
 * 读取指定后端全部词条，按 id 降序（最新在前）返回。
 * 供批量复制/迁移等跨后端操作读取目标或源端数据。
 * @param mode 目标存储方式，不受当前读写位置影响
 */
export async function listLexiconEntriesInStorage(mode: LexiconStorageMode): Promise<LexiconEntry[]> {
  return storeFor(mode).listEntries();
}

/**
 * 读取当前后端全部词条，按 id 降序（最新在前）返回。
 */
export async function listLexiconEntries(): Promise<LexiconEntry[]> {
  return activeStore().listEntries();
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
 * 在指定后端按词语与拼音精确查找词条（严格相等），供右键定向添加等跨后端查重使用。
 * @param mode 目标存储方式，不受当前读写位置影响
 * @param word 待查找的词语；调用方传入 trim 后的值
 * @param pinyin 待查找的拼音；与词语共同构成唯一性判定
 * @returns 命中的词条，未找到返回 null
 */
export async function findLexiconEntryInStorage(
  mode: LexiconStorageMode,
  word: string,
  pinyin: string,
): Promise<LexiconEntry | null> {
  if (word === "" || pinyin === "") return null;
  const entries = await storeFor(mode).listEntries();
  return entries.find((entry) => entry.word === word && entry.pinyin === pinyin) ?? null;
}

/**
 * 新增词条，id 由当前后端分配并回填。
 */
export async function addLexiconEntry(input: LexiconEntryInput): Promise<LexiconEntry> {
  const entry = await activeStore().addEntry(input);
  notifyLexiconChange();
  return entry;
}

/**
 * 向指定后端新增词条，id 由目标后端分配并回填。
 * 映射重建与变更广播走统一路径：当前后端不受影响，订阅方按当前后端重载。
 * @param mode 目标存储方式，不受当前读写位置影响
 * @param input 新增词条输入
 * @returns 目标后端分配 id 后的完整条目
 */
export async function addLexiconEntryToStorage(mode: LexiconStorageMode, input: LexiconEntryInput): Promise<LexiconEntry> {
  const entry = await storeFor(mode).addEntry(input);
  notifyLexiconChange();
  return entry;
}

/**
 * 批量新增词条；返回新增条数。id 由当前后端分配，调用方不提供。
 * @param inputs 待新增的词条列表，空列表直接返回 0
 * @returns 实际新增的条数
 */
export async function addLexiconEntries(inputs: LexiconEntryInput[]): Promise<number> {
  const added = await activeStore().addEntries(inputs);
  if (added > 0) notifyLexiconChange();
  return added;
}

/**
 * 向指定后端批量新增词条；返回新增条数。id 由目标后端分配，调用方不提供。
 * 供侧边栏批量复制/迁移使用；映射重建与变更广播走统一路径。
 * @param mode 目标存储方式，不受当前读写位置影响
 * @param inputs 待新增的词条列表，空列表直接返回 0
 * @returns 实际新增的条数
 */
export async function addLexiconEntriesToStorage(mode: LexiconStorageMode, inputs: LexiconEntryInput[]): Promise<number> {
  const added = await storeFor(mode).addEntries(inputs);
  if (added > 0) notifyLexiconChange();
  return added;
}

/**
 * 更新词条；按 id 全量覆盖。
 */
export async function updateLexiconEntry(entry: LexiconEntry): Promise<void> {
  await activeStore().updateEntry(entry);
  notifyLexiconChange();
}

/**
 * 删除词条。
 */
export async function deleteLexiconEntry(id: number): Promise<void> {
  await activeStore().deleteEntry(id);
  notifyLexiconChange();
}

/**
 * 批量删除词条；空列表直接返回。
 * @param ids 待删除的词条 id 列表
 */
export async function deleteLexiconEntries(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await activeStore().deleteEntries(ids);
  notifyLexiconChange();
}

/**
 * 批量更新词条；空列表直接返回。
 * @param entries 待更新的词条列表
 */
export async function updateLexiconEntries(entries: LexiconEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await activeStore().updateEntries(entries);
  notifyLexiconChange();
}

/**
 * 清空当前后端词库，返回删除条数。
 * @returns 被删除的条数
 */
export async function clearLexiconEntries(): Promise<number> {
  const removed = await activeStore().clearEntries();
  notifyLexiconChange();
  return removed;
}
