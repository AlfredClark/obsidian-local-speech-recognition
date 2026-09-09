/** 英文资源。结构作为 TranslationResource 的类型源，其余语言与其同构保证键一致 */
const en = {
  settings: {
    collapsible: "Collapsible groups",
    collapsibleDesc: "Allow settings groups to be collapsed",
    general: "General",
    language: "Plugin language",
    languageDesc: "Set the plugin interface language",
    languageOptions: {
      system: "Follow system",
      en: "English",
      zh: "简体中文",
      "zh-TW": "繁體中文",
    },
  },
  sidebar: {
    tabs: {
      page1: "Page 1",
      page2: "Page 2",
      page3: "Page 3",
    },
    placeholders: {
      page1: "Page 1 placeholder",
      page2: "Page 2 placeholder",
      page3: "Page 3 placeholder",
    },
  },
} as const;

export default en;
