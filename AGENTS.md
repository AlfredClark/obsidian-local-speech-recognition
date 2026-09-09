# Local Speech Recognition — 开发规范

## 项目概览

- Obsidian 社区插件：TypeScript → esbuild → `main.js`
- 发布产物：`main.js` / `manifest.json` / `styles.css`（位于根目录，GitHub Release 使用）
- 插件 ID：`local-speech-recognition`；许可证：GPL-3.0-only

## 技术栈

- **bun**：包管理器（锁文件 `bun.lock`）
- **TypeScript 6**：原生编译器，仅用于类型检查（`tsc -noEmit`）
- **esbuild 0.28**：CJS 打包；`obsidian`/`electron`/`@codemirror/*`/`@lezer/*`/node 内置模块外部化
- **Svelte 5**：UI 组件框架；esbuild-svelte 编译 `.svelte`（`css: "injected"` 内联进 JS），svelte-check 类型检查，eslint-plugin-svelte/prettier-plugin-svelte 配套
- **ESLint 10 + eslint-plugin-obsidianmd**：Obsidian 专用规则
- **Stylelint 17 + stylelint-config-standard**：CSS 专用检查
- **Prettier 3 + stylelint**：统一代码格式（`bun run format`）

## 常用命令

| 命令                   | 作用                                                   |
| ---------------------- | ------------------------------------------------------ |
| `bun run dev`          | 监听 src 与静态资源 → 构建并同步 dist                  |
| `bun run build`        | 类型检查 + 生产构建 + 同步 dist                        |
| `bun run lint`         | ESLint 检查（提交前必须零错误）                        |
| `bun run format`       | Prettier + stylelint 格式化全部代码                    |
| `bun run format:check` | Prettier + stylelint 检查（提交前必须通过）            |
| `bun run version`      | 版本提升（package.json → manifest.json/versions.json） |
| `bun run link <路径>`  | 将 dist 链接到 vault 插件目录（默认启用热重载）        |
| `bun run unlink`       | 取消链接                                               |

## 目录结构

```
├── .github/workflows/       # GitHub Actions（lint 检查 + Release 自动构建）
├── dist/                    # 构建产物副本（gitignore，可 link 至 vault）
├── scripts/                 # 构建辅助脚本（不得被插件运行时引用）
├── src/
│   ├── cores/               # 核心能力：跨功能共享的基础设施（模块三段式见代码规范）
│   │   ├── i18n/            # 国际化模块：手动实现的多语言支持
│   │   │   └── locales/     # 语言资源目录（文件说明见核心能力）
│   │   ├── settings/        # 设置模块：持久化设置 + 声明式设置页
│   │   ├── sherpa-server/   # 服务管理：sherpa-onnx 子进程生命周期（状态见核心能力）
│   ├── features/            # 业务功能：用户可感知的具体功能
│   │   └── sherpa-server/   # 服务编排：autoStart 拉起 + 卸载回收（状态见核心能力）
│   ├── utils/               # 无状态纯函数工具（如 svelte 组件挂载，说明见核心能力）
│   └── main.ts              # 插件入口：仅调用 initCores()/initFeatures() 聚合初始化
├── .editorconfig            # 编辑器统一格式（与 .prettierrc 对齐）
├── .gitignore               # git 忽略（main.js/dist/data.json/*.map 等）
├── .prettierrc              # Prettier 格式配置（2 空格/双引号/128 列/LF）
├── .stylelintrc.json        # Stylelint 配置（CSS 检查）
├── bun.lock                 # bun 依赖锁文件
├── cliff.toml               # git-cliff 变更日志配置（与提交规范对齐）
├── esbuild.config.ts        # esbuild 构建配置（CJS 打包、obsidian 等外部化）
├── eslint.config.mts        # ESLint 配置（含 obsidianmd 专用规则）
├── LICENSE                  # GPL-3.0-only 许可证
├── manifest.json            # Obsidian 插件清单（id/name/version）
├── package.json             # 包定义与脚本命令（bun 执行）
├── styles.css               # 插件样式（发布产物）
├── tsconfig.json            # TypeScript 类型检查配置（strict 全开）
└── versions.json            # 版本兼容映射（minAppVersion）
```

## 核心能力

`src/cores/` 下共享基础设施模块的专项说明。

### i18n（国际化）

- 手动实现，零第三方依赖；`t(key, vars?)` 为全局翻译入口，支持 `{name}` 插值，键由 `TranslationKey` 类型自动推导
- 语言解析优先级：`settings.language`（system/en/zh/zh-TW）→ `system` 依据 Obsidian 应用语言（`getLanguage()`）判定，未知语言回退 en
- 语言资源位于 `locales/`：`en.ts` 为类型源（as const，推导 `TranslationResource`）；`zh.ts` 导出简体 `zh` 与繁体 `zhTW`，标注 `TranslationResource` 强制与英文键同构，增删键即编译报错
- 语言切换通知：`t()` 为普通函数调用，Svelte 组件无法追踪其依赖，模板中的 `t()` 仅在渲染时求值一次；settings 层在 `language` 设置写入后经 `notifyLanguageChange()` 广播，Svelte UI 经 `subscribeLanguageChange(listener)` 订阅并在回调中递增 `langTick` 版号，配合 `{#key langTick}` 强制重建内容块使 `t()` 重新求值（`activePage` 等 `{#key}` 块外状态保留，页面切换不丢；重建会销毁重建子组件实例，有状态页面需自行保留）
- 添加新语言步骤：
  1. 新建 `locales/<标识>.ts`，按 `en.ts` 结构书写并标注 `TranslationResource`（缺失键即编译报错）
  2. `types.ts`：`PluginLanguage`/`SupportedLanguage` 追加语言标识
  3. `core.ts`：`LOCALES` 注册新资源；`system` 自动判定如需覆盖新语言，补充映射规则
  4. `settings/core.ts`：下拉框 `options` 追加选项（label 用对应语言本名）
  5. 所有语言资源的 `languageOptions` 同步追加该语言的本名条目
- 初始化须在 `initSettings` 之前（其内部 `addSettingTab` 会同步触发设置页渲染，`t()` 依赖 `pluginRef` 已就绪）

### settings（设置）

- `DEFAULT_SETTINGS` 提供默认值，`loadSettings` 从 data.json 读取后与默认值浅合并（展开运算，避免共享默认对象被意外修改），旧版本缺字段时自动兜底
- 设置页使用 1.13.0+ 声明式 API（`getSettingDefinitions`），读写 `plugin.settings` 与持久化由 Obsidian 自动完成；覆写 `setControlValue` 触发 `update()` 重渲染，语言切换等联动即时生效
- 控件类型全部走 `obsidian` 的 `SettingDefinitionItem`/`SettingGroupItem` 等声明式类型；`obsidian` 的值导入仅保留运行时需要的类（如 `PluginSettingTab`），其余一律 `import type`
- 可折叠分组约定：分组条目抽为 `getXxxItems(): SettingGroupItem<...>[]` 私有方法返回条目数组，容器形态经 `buildCollapsibleSection(name, desc, items)` 按 `settings.collapsible` 切换（开启时渲染为可导航子页 `page`，关闭时内联展开 `group`，`group` 需同时传 `name` 与 `heading`）；通用设置组保持内联，不走该方法；条目增删只改 `getXxxItems`，不碰容器逻辑；分组 `name` 优先用四字中文（如通用设置/服务设置，其他语言用对应译文），保证标题视觉对齐
- 动作行约定：按钮等非持久化行走 `render` 回调（如 `setting.addButton(...)`），不占用 `control/key`，点击处理委托给私有方法（如 `testConnection()`），内部反馈经 `Notice` + `t()` 提示；`render` 回调内不直接读写 `plugin.settings` 以外的副作用
- 服务启停按钮显隐：按 `getSherpaServer().isRunning()` 经 `visible` 谓词切换（启动行取反），SettingsTab 构造器订阅 `subscribeStatus(() => this.update())` 刷新；配置变更仅手动生效，不自动重启
- 依赖 i18n 模块：界面文案经 `t()` 翻译，`PluginLanguage` 类型自 `../i18n` 导入（依赖方向 settings → i18n，无环）

### sherpa-server（服务管理）

- 三层分工：`utils/sherpa-process.ts` 纯函数（参数拼接 `buildSherpaArgs`、配置校验 `validateSherpaConfig`、地址组装 `resolveSherpaUrl`，无状态无 init）；`cores/sherpa-server` 持有进程句柄与 `stopped/starting/running/error` 状态，导出 `start/stop/restart/getStatus/isRunning/subscribeStatus` 单例（`getSherpaServer()`）；`features/sherpa-server` 只做 autoStart 编排 + 向 `cleanups` 注册同步回收
- 进程拉起：`Platform.isDesktop` 守卫后同步 `require()` 取 `spawn`（src 内零顶层 `node:` 导入，含 type-only，窄 `ManagedProcess` 结构类型代替 `ChildProcess`）；`spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] })`，日志走 console；ws 轮询探测 open 即 running，超时/异常退出置 error 并透出退出码；`starting/running` 重复 start 直接返回 `already-running`
- 状态广播：`setStatus` 触发订阅者，设置页与外部调用方靠其刷新；`stop()` 必须同步 kill（适配 `cleanups: Array<() => void>`）
- 退出释放：应用关闭不保证走插件 `onunload`，feature 层同时订阅 `workspace.on("quit")` 与窗口 `beforeunload`，双路径调用同步强杀的 `dispose()`（直接 SIGKILL，不等 SIGTERM 宽限回调）；插件禁用/卸载仍走 `stop()` 正常关闭流程
- sense-voice int8 占位参数：`--port/--num-threads` + `--sherpa-onnx-sense-voice-model=<modelDir>/model.int8.onnx` + `--sherpa-onnx-tokens=<modelDir>/tokens.txt`，实测后按真实模型结构调整 `buildSherpaArgs`

## utils（工具）

`src/utils/` 下通用工具功能模块专项说明。

- 无状态纯函数工具目录，无生命周期，不受模块三段式约束：单文件同时导出函数与类型，无 init 方法
- `svelte.ts`：`mountComponent(target, Component, props?)` 将 Svelte 组件挂载到目标容器（如视图的 `contentEl`），返回 `{ instance, destroy() }`；destroy 卸载组件并清空容器。组件样式经构建配置 `css: "injected"` 注入 `<head>`，卸载后样式标签残留，但编译期 class 哈希保证样式隔离
- `ambient.d.ts`：`*.svelte` 模块声明，tsc 层放宽 props 类型，精确类型由 svelte-check 校验（build 命令内执行）；不与 `svelte.ts` 同名——TS 对同名 .ts/.d.ts 只保留 .ts，且模块文件内 `declare module` 会被视为模块增强而非法
- `.svelte` 组件文件属于模块特有文件，置于所属模块目录下（如 `features/<模块>/components/`），不受三段式约束
- `sherpa-process.ts`：纯函数（参数拼接 `buildSherpaArgs`、配置校验 `validateSherpaConfig`、地址组装 `resolveSherpaUrl`），无状态无 init

## 代码规范

1. **命名**：类/接口 PascalCase，函数/变量 camelCase，常量 UPPER_SNAKE_CASE，文件 kebab-case
2. **类型**：strict 全开（含 `noUncheckedIndexedAccess`）；禁止 `any` 与隐式 any
3. **模块**：`cores/`（核心能力）与 `features/`（业务功能）下的每个模块均按三段式组织：`index.ts`（统一出口，仅 re-export）、`types.ts`（类型定义）、`core.ts`（核心逻辑，导出 `init<模块>()` 初始化方法）；各模块 init 方法由 `src/cores/index.ts`/`src/features/index.ts` 分别聚合为 `initCores()`/`initFeatures()`，main.ts 各调用一次；init 方法参数一律使用具体类 `LocalSpeechRecognitionPlugin`，且导入一律为 `import type`（类型层循环在编译期擦除，运行时无循环）；模块特有文件（如 i18n 的 `locales/`）直接置于模块目录下，不受三段式约束
4. **注释**：中文，写"为什么"而非"是什么"；不做多余注释。导出声明（类/接口/函数/常量/属性）一律使用 JSDoc（`/** */`），内部逻辑用行注释；`@param`/`@returns` 仅在参数或返回值存在需要说明的语义时使用，不机械全量添加；纯 re-export 的 index.ts 无需注释
5. **约束**：桌面 Node 能力（`child_process` 等）须 `Platform.isDesktop` 守卫后同步 `require()`（Obsidian 以 CJS 加载插件，原生动态 `import("node:...")` 会被当网络模块抓取而失败；`require` 处加带描述的 eslint-disable），
   src 内禁止顶层 `node:` 导入（含 `import type`，用窄结构类型代替 Node 类型），对应 `obsidianmd/no-nodejs-modules` 规则；禁止 Electron API
6. **依赖**：确认可 bundle 或需加入 esbuild `external` 列表
7. **格式**：由 `.prettierrc` 统一控制——2 空格缩进、双引号、128 列、LF 行尾（与 `.editorconfig` 一致）

## 提交规范（Conventional Commits，与 cliff.toml 对齐）

- 格式：`<type>(<scope>): <描述>`（type 用英文标准前缀，描述用英文，无需首字母大写，尽可能一句话解决）
- 类型映射：

  | type           | 分组      |
  | -------------- | --------- |
  | `feat`         | 新功能    |
  | `fix`          | 缺陷修复  |
  | `doc`          | 文档      |
  | `perf`         | 性能优化  |
  | `refactor`     | 重构      |
  | `style`        | 样式/格式 |
  | `test`         | 测试      |
  | `chore` / `ci` | 杂务/CI   |
  | `revert`       | 回滚      |

- breaking change 使用 `!` 或 `BREAKING CHANGE:` 标记
- 禁止提交：`main.js`、`dist/`、`data.json`、`*.map`、`node_modules`

## 代理行为约束（AI 助手）

1. 修改代码前先阅读相关文件与本规范
2. 每次修改后必须运行 `bun run format` 与 `bun run lint` 验证通过
3. 依赖变更统一通过 `bun install`，不手动修改 `bun.lock`
4. 版本变更使用 `bun run version`，不手动修改 manifest 版本
5. 格式统一使用 `bun run format`，提交前 `bun run format:check` 必须通过
6. 不提交用户未要求的变更（如无关格式化）
7. 提交信息遵循"提交规范"一节，只提供提交信息（英文），提交由用户手动进行

## 构建与发布

- **开发热重载**：`bun run link <vault>/.obsidian/plugins/local-speech-recognition` + `bun run dev`，配合 obsidian-hot-reload 插件自动重载
- **版本流程**：`bun run version`（读 package.json 版本 → 更新 manifest.json/versions.json）
- **Release**：打 tag 触发 GitHub Action（bun 环境）自动构建，产物取自根目录
