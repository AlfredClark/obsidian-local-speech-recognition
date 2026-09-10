/** 词库条目；id 由 IndexedDB 自增主键生成 */
export interface LexiconEntry {
  /** 自增主键 */
  id: number;
  /** 词语 */
  word: string;
  /** 词语对应的拼音 */
  pinyin: string;
  /** 权重；缺省 0 */
  weight: number;
  /** 是否启用；缺省 true */
  enable: boolean;
}

/** 新增词条输入：id 由存储层自增生成，调用方无需提供 */
export type LexiconEntryInput = Omit<LexiconEntry, "id">;
