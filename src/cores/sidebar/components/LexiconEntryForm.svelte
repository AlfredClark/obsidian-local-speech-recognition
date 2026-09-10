<script lang="ts">
  import { Notice } from "obsidian";
  import { untrack } from "svelte";
  import { findLexiconEntry } from "../../lexicon";
  import type { LexiconEntry } from "../../lexicon";
  import type { LexiconEntrySaveHandler } from "../lexicon-entry-modal";
  import { t } from "../../i18n";
  import { toPinyin } from "../../../utils/pinyin";

  /** 表单内容；由词条弹窗挂载，entry 为 null 表示新增 */
  let {
    entry = null,
    onSave,
    onClose,
  }: {
    entry?: LexiconEntry | null;
    onSave: LexiconEntrySaveHandler;
    onClose: () => void;
  } = $props();

  // 弹窗每次打开都重新挂载本组件，初值取一次即可：
  // untrack 读取避免把 prop 误登记为响应依赖，同时消除 state_referenced_locally 告警
  let word = $state(untrack(() => entry?.word ?? ""));
  let pinyin = $state(untrack(() => entry?.pinyin ?? ""));
  let weight = $state(untrack(() => String(entry?.weight ?? 0)));
  let enable = $state(untrack(() => entry?.enable ?? true));
  /** 保存中标志；防止重复提交 */
  let saving = $state(false);
  /** 词语输入框引用；弹窗打开后自动聚焦 */
  let wordInput: HTMLInputElement | null = $state(null);

  // wordInput 绑定完成后触发一次；此后引用不变，不会重复聚焦
  $effect(() => {
    wordInput?.focus();
  });

  /**
   * 词语变更：同步词语并按最新内容重算拼音。
   * 采用直接重算语义（词语是拼音的来源），手动修改过的拼音在再次改词后会被覆盖；
   * 需要恢复自动结果时点"重新生成拼音"。
   */
  function handleWordInput(next: string): void {
    word = next;
    pinyin = toPinyin(next);
  }

  /** 重新生成拼音：按当前词语覆盖拼音输入框，恢复自动结果 */
  function regeneratePinyin(): void {
    pinyin = toPinyin(word);
  }

  /** 提交草稿：校验非空与重复后交由父组件持久化，成功后关闭弹窗 */
  async function submit(): Promise<void> {
    const trimmedWord = word.trim();
    const trimmedPinyin = pinyin.trim();
    if (trimmedWord === "" || trimmedPinyin === "") {
      new Notice(t("sidebar.lexiconRequired"), 3000);
      return;
    }
    saving = true;
    try {
      // 编辑时排除自身，避免未改词时误判重复；word+pinyin 严格一致才视为重复
      if ((await findLexiconEntry(trimmedWord, trimmedPinyin, entry?.id)) !== null) {
        new Notice(t("lexicon.duplicate", { word: trimmedWord }), 3000);
        return;
      }
      const parsedWeight = Number.parseFloat(weight);
      const ok = await onSave({
        word: trimmedWord,
        pinyin: trimmedPinyin,
        weight: Number.isFinite(parsedWeight) ? parsedWeight : 0,
        enable,
      });
      if (ok) onClose();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      new Notice(t("sidebar.lexiconSaveFailed", { detail }), 5000);
    } finally {
      saving = false;
    }
  }
</script>

<form
  class="novel-lexicon-form"
  onsubmit={(event) => {
    event.preventDefault();
    void submit();
  }}
>
  <p>
    <label>
      {t("sidebar.lexiconWord")}<br />
      <input type="text" bind:this={wordInput} value={word} oninput={(event) => handleWordInput(event.currentTarget.value)} />
    </label>
  </p>
  <p>
    <span>{t("sidebar.lexiconPinyin")}</span><br />
    <span style="display: flex; gap: 6px;">
      <input type="text" style="flex: 1;" aria-label={t("sidebar.lexiconPinyin")} bind:value={pinyin} />
      <button type="button" title={t("sidebar.lexiconRegeneratePinyin")} onclick={regeneratePinyin}>
        {t("sidebar.lexiconRegeneratePinyin")}
      </button>
    </span>
  </p>
  <p>
    <label>
      {t("sidebar.lexiconWeight")}<br />
      <input type="number" step="any" bind:value={weight} />
    </label>
  </p>
  <!-- 新增固定启用（默认 true），不展示复选框；编辑时允许在弹窗内调整 -->
  {#if entry !== null}
    <p>
      <label>
        <input type="checkbox" bind:checked={enable} />
        {t("sidebar.enabled")}
      </label>
    </p>
  {/if}
  <p>
    <button type="submit" class="mod-cta" disabled={saving}>{t("sidebar.lexiconSave")}</button>
    <button type="button" onclick={onClose}>{t("sidebar.lexiconCancel")}</button>
  </p>
</form>

<style>
  /* Obsidian 未给弹窗内裸输入框设定宽度，补一条撑满内容区，其余交给浏览器默认样式 */
  .novel-lexicon-form input[type="text"],
  .novel-lexicon-form input[type="number"] {
    width: 100%;
  }
</style>
