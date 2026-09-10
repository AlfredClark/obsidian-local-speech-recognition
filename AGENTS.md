# Local Speech Recognition — 开发规范

## 项目概览

- Obsidian 社区插件：TypeScript → esbuild → `main.js`
- 发布产物：`main.js` / `manifest.json` / `styles.css`（位于根目录，GitHub Release 使用）
- 插件 ID：`local-speech-recognition`；许可证：GPL-3.0-only；`minAppVersion` 1.13.1；`isDesktopOnly: true`
- 功能定位：调用本地部署的 sherpa-onnx offline-websocket 服务做离线语音识别；快捷键触发录音，结果插入光标处或写入剪贴板

## 技术栈

- **bun**：包管理器（锁文件 `bun.lock`）
- **TypeScript 6**：原生编译器，仅用于类型检查（`tsc -noEmit -skipLibCheck`）
- **esbuild 0.28**：CJS 打包；`obsidian`/`electron`/`@codemirror/*`/`@lezer/*`/node 内置模块（`builtinModules` 与 `node:` 前缀形式均列入）外部化；esbuild-svelte 插件（`css: "injected"`、dev 关闭压缩）；dev 模式用 `context.rebuild()` + `fs.watch`（100ms 防抖）自行调度，构建完成后同步 dist
- **Svelte 5**：UI 组件框架；`$props`/`$state`/`$derived`/`$effect` runes；svelte-check（`--fail-on-warnings`，经 `scripts/svelte-check.ts` 仅在存在 `.svelte` 时执行）类型检查；eslint-plugin-svelte/prettier-plugin-svelte 配套
- **CodeMirror 6**（`codemirror`/`@codemirror/state`/`@codemirror/view`/`@codemirror/lint`）：用于识别结果经 CM6 单事务插入与词库后处理高亮/替换；外部化，值导入仅限编辑器扩展实现（`@codemirror/state`/`@codemirror/view`），其余场景一律 `import type`（见代码规范）
- **pinyin-pro 3**：中文转拼音（词库录入自动填充）；纯 JS 依赖打进 main.js，不加入 esbuild `external`（`pinyin` API 压缩后约 300 KB）
- **ESLint 10 + eslint-plugin-obsidianmd**：Obsidian 专用规则（`recommendedWithLocalesEn`）；`esbuild.config.ts`/`scripts/*.ts` 等构建期文件由 globalIgnores 排除
- **Stylelint 17 + stylelint-config-standard**：CSS 专用检查
- **Prettier 3 + prettier-plugin-svelte**：统一代码格式（`bun run format`）
- 忽略清单：`.prettierignore`（node_modules/dist/main.js/bun.lock/LICENSE）、`.stylelintignore`（node_modules/dist）

## 常用命令

| 命令                   | 作用                                                   |
| ---------------------- | ------------------------------------------------------ |
| `bun run dev`          | 监听 src 与静态资源（100ms 防抖）→ 构建并同步 dist     |
| `bun run build`        | tsc 类型检查 + svelte-check + 生产构建 + 同步 dist     |
| `bun run lint`         | ESLint 检查（提交前必须零错误）                        |
| `bun run format`       | Prettier + stylelint 格式化全部代码                    |
| `bun run format:check` | Prettier + stylelint 检查（提交前必须通过）            |
| `bun run version`      | 版本提升（package.json → manifest.json/versions.json） |
| `bun run link <路径>`  | 将 dist 链接到 vault 插件目录（默认启用热重载）        |
| `bun run unlink`       | 取消链接                                               |

## 目录结构

```
├── .github/workflows/       # lint.yml（路径过滤 + lint/format:check）、release.yml（tag 触发构建、changelog、附件 + attestation）
├── dist/                    # 构建产物副本（gitignore，可 link 至 vault）
├── docs/                    # 文档（README 简体中文版；根 README 为英文版）
├── scripts/                 # 构建辅助脚本（不得被插件运行时引用）
├── src/
│   ├── cores/               # 核心能力：跨功能共享的基础设施（模块三段式见代码规范）
│   │   ├── audio-capture/   # 采集：麦克风枚举 + AudioWorklet 采集（worklet 源码内联）
│   │   ├── i18n/            # 国际化模块：手动实现的多语言支持
│   │   │   └── locales/     # 语言资源目录（文件说明见核心能力）
│   │   ├── lexicon/         # 词库：IndexedDB 持久化 + 词条增删改查 + 导入导出格式 + 模糊音变体（见核心能力）
│   │   ├── settings/        # 设置模块：持久化设置 + 声明式设置页
│   │   ├── sherpa-client/   # 识别客户端：offline-websocket 单次整句识别
│   │   ├── sherpa-server/   # 服务管理：sherpa-onnx 子进程生命周期（状态见核心能力）
│   │   └── sidebar/         # 侧边栏：自定义视图 + Svelte 页面
│   │       └── components/  # Svelte 组件（SidebarRoot / LexiconPage / LexiconEntryForm / ServicePage）
│   ├── features/            # 业务功能：用户可感知的具体功能
│   │   ├── lexicon/         # 词库：编辑器右键菜单添加选中文本 + 识别后处理高亮/替换（见业务功能）
│   │   ├── sherpa-server/   # 服务编排：autoStart 拉起 + 退出/卸载回收（状态见业务功能）
│   │   └── speech-recognition/ # 语音识别：命令注册 + 录音→识别→投递控制器（见业务功能）
│   ├── utils/               # 无状态纯函数工具（如音频处理、Svelte 挂载，说明见 utils）
│   └── main.ts              # 插件入口：仅调用 initCores()/initFeatures() 聚合初始化
├── .editorconfig            # 编辑器统一格式（与 .prettierrc 对齐）
├── .gitignore               # git 忽略（main.js/dist/data.json/*.map/.commandcode 等）
├── .prettierignore          # Prettier 忽略（node_modules/dist/main.js/bun.lock/LICENSE）
├── .prettierrc              # Prettier 格式配置（2 空格/双引号/128 列/LF）
├── .stylelintignore         # Stylelint 忽略（node_modules/dist）
├── .stylelintrc.json        # Stylelint 配置（CSS 检查）
├── bun.lock                 # bun 依赖锁文件
├── cliff.toml               # git-cliff 变更日志配置（与提交规范对齐）
├── esbuild.config.ts        # esbuild 构建配置（CJS 打包、obsidian 等外部化）
├── eslint.config.mts        # ESLint 配置（含 obsidianmd 专用规则）
├── LICENSE                  # GPL-3.0-only 许可证
├── manifest.json            # Obsidian 插件清单（id/name/version/minAppVersion）
├── package.json             # 包定义与脚本命令（bun 执行）
├── README.md                # 英文说明（docs/README_zh-CN.md 为中文版）
├── styles.css               # 插件样式（发布产物）
├── tsconfig.json            # TypeScript 类型检查配置（strict 全开）
└── versions.json            # 版本兼容映射（minAppVersion）
```

## 核心能力

`src/cores/` 下共享基础设施模块的专项说明。

### i18n（国际化）

- 手动实现，零第三方依赖；`t(key, vars?)` 为全局翻译入口，支持 `{name}` 插值，键由 `TranslationKey` 类型自动推导（`types.ts` 由 `en.ts` 递归展平点分键）
- 语言解析优先级：`settings.language`（system/en/zh/zh-TW）→ `system` 依据 Obsidian 应用语言（`getLanguage()`）判定，`zh-TW`/`zh-HK`/`zh-MO` 归入繁体，其余中文归入简体，未知语言回退 en
- 语言资源位于 `locales/`：`en.ts` 为类型源（as const，推导 `TranslationResource`）；`zh.ts` 导出简体 `zh` 与繁体 `zhTW`，标注 `TranslationResource` 强制与英文键同构，增删键即编译报错。当前命名空间：`settings`/`commands`/`lexicon`/`sidebar`/`recognition`
- 语言切换通知：`t()` 为普通函数调用，Svelte 组件无法追踪其依赖，模板中的 `t()` 仅在渲染时求值一次；settings 层在 `language` 设置写入后经 `notifyLanguageChange()` 广播，Svelte UI 经 `subscribeLanguageChange(listener)` 订阅并在回调中递增 `langTick` 版号，配合 `{#key langTick}` 强制重建内容块使 `t()` 重新求值（`activePage` 等 `{#key}` 块外状态保留，页面切换不丢；重建会销毁重建子组件实例，有状态页面需自行保留）
- 添加新语言步骤：
  1. 新建 `locales/<标识>.ts`，按 `en.ts` 结构书写并标注 `TranslationResource`（缺失键即编译报错）
  2. `types.ts`：`PluginLanguage`/`SupportedLanguage` 追加语言标识
  3. `cores.ts`：`LOCALES` 注册新资源；`system` 自动判定如需覆盖新语言，补充映射规则
  4. `settings/cores.ts`：下拉框 `options` 追加选项（label 用对应语言本名）
  5. 所有语言资源的 `languageOptions` 同步追加该语言的本名条目
- 初始化须在 `initSettings` 之前（其内部 `addSettingTab` 会同步触发设置页渲染，`t()` 依赖 `pluginRef` 已就绪）

### settings（设置）

- `DEFAULT_SETTINGS` 提供默认值（`collapsible`/`language`/`binaryPath`/`modelPath`/`host`/`port`/`numThreads`/`autoStartServer`/`inputMode`/`microphoneDeviceId`/`lexiconEnabled`/`fuzzyMatchEnabled`），`loadSettings` 从 data.json 读取后与默认值浅合并（展开运算，避免共享默认对象被意外修改），旧版本缺字段时自动兜底
- 设置页使用 1.13.1+ 声明式 API（`getSettingDefinitions`），读写 `plugin.settings` 与持久化由 Obsidian 自动完成；覆写 `setControlValue` 触发 `update()` 重渲染，并在 `language`/`lexiconEnabled`/`fuzzyMatchEnabled` 写入时分别调用 `notifyLanguageChange()`/`notifyLexiconEnabledChange()`/`notifyFuzzyMatchChange()` 广播，语言切换与词库/模糊音开关等联动即时生效；`subscribeLexiconEnabledChange`/`subscribeFuzzyMatchChange`（同 `subscribeLanguageChange` 模式）分别供词库 feature（含侧边栏）订阅
- 控件类型全部走 `obsidian` 的 `SettingDefinitionItem`/`SettingGroupItem` 等声明式类型；`obsidian` 的值导入仅保留运行时需要的类（如 `PluginSettingTab`），其余一律 `import type`
- 分组约定：通用设置组（语言、折叠）恒为内联 `group`；服务设置（`getSherpaItems`）、语音输入（`getRecognitionItems`）与词库设置（`getLexiconItems`）经 `buildCollapsibleSection(name, desc, items)` 按 `settings.collapsible` 切换容器形态（开启时渲染为可导航子页 `page`，关闭时内联展开 `group`，`group` 需同时传 `name` 与 `heading`）；分组 `name` 优先用四字中文（如通用设置/服务设置，其他语言用对应译文），保证标题视觉对齐；条目增删只改 `getXxxItems`，不碰容器逻辑
- 动作行约定：按钮等非持久化行走 `render` 回调（如 `setting.addButton(...)`），不占用 `control/key`，点击处理委托给 `service-actions.ts`/`lexicon-actions.ts` 的私有函数（`startService`/`stopService`/`restartService`/`testConnection`/`openSettings`/`exportLexicon`/`importLexicon`/`clearLexicon`），内部反馈经 `Notice` + `t()` 提示；`render` 回调内不直接读写 `plugin.settings` 以外的副作用；破坏性按钮经 `ButtonComponent.setDestructive()`（`setWarning()` 已废弃）
- 服务启停按钮显隐：按 `getSherpaServer().isRunning()` 经 `visible` 谓词切换（启动行取反），SettingsTab 构造器订阅 `subscribeStatus(() => this.update())` 并经 `plugin.register` 托管退订；配置变更仅手动生效，不自动重启
- 麦克风下拉：`MicrophoneStore`（`microphone-options.ts`）在内存中缓存设备列表（deviceId 随插拔变化，不进 data.json），构造器 `refreshSilent()` 预拉一次，下拉 `options()` 首项恒为系统默认并保留已保存但未枚举到的 id；刷新失败经 `Notice` 提示
- 连接测试：`connection.ts` 的 `openWebSocket(url)` 拨号即判活（5 秒超时），不消费消息
- 词库启用开关：`getLexiconItems` 首位为 `lexiconEnabled` 开关（持久化，默认 `true`，关闭时停用全部词库界面与编辑器集成），其后为 `fuzzyMatchEnabled` 模糊音开关（持久化，默认 `false`），导出/导入/清空三行经 `visible: () => plugin.settings.lexiconEnabled` 随开关隐藏，模糊音开关同样随词库关闭隐藏；开关切换分别经 `notifyLexiconEnabledChange()`/`notifyFuzzyMatchChange()` 广播
- 词库管理动作：`lexicon-actions.ts` 提供导出（`serializeLexiconFile` → Blob + 临时 `<a download>` 触发系统保存对话框，文件名为本地时间戳）、导入（隐藏 `<input type="file">` 选文件，按扩展名/首字符分流 JSON 与纯文本，与库内词条按 word+pinyin 严格去重保留已有、文件内重复保留首条，Notice 汇总新增/跳过/无效条数）与清空（`Modal` + `ButtonComponent.setDestructive()` 二次确认不可恢复，确认后 `clearLexiconEntries` 并提示删除条数）；空词库执行导出/清空前经 Notice 提示并中止；文件选择与下载锚点须挂在 `activeDocument`（设置窗口可能运行在弹出窗口，全局 `document` 不持有该窗口的用户激活，文件选择框会被 Chromium 拒绝）
- 依赖 i18n 模块：界面文案经 `t()` 翻译，`PluginLanguage` 类型自 `../i18n` 导入（依赖方向 settings → i18n，无环）
- 跨层例外：声明式设置 API 迫使按钮/下拉与行定义同处一 Tab，`settings` 允许经 `service-actions.ts`/`microphone-options.ts`/`lexicon-actions.ts` 三个特有文件单向调用 `sherpa-server`（启停/状态/配置组装）、`audio-capture`（设备枚举）与 `lexicon`（导入导出清空），`cores.ts` 本体不直连进程、硬件与词库存储；方向仍为 settings → i18n 为主，此为例外且仅限这三个文件

### sidebar（侧边栏）

- `SidebarView`（`cores.ts`，extends `ItemView`）只负责挂载/回收 Svelte 根组件：`onOpen` 经 `mountComponent(this.contentEl, SidebarRoot, { plugin })` 挂载，`onClose` 调 `mounted.destroy()`；视图内容全部由组件渲染
- 视图标识 `SIDEBAR_VIEW_TYPE = "novelists-assistant-sidebar"`，图标 `mic-vocal`，标题常量 `PLUGIN_NAME` 与 manifest 的 name 一致
- `activateSidebar`：已有叶子（`getLeavesOfType`）则 `revealLeaf` 直接激活，否则 `getRightLeaf(false)` 建叶子 + `setViewState({ type, active: true })` + `revealLeaf`；仅负责激活，不做关闭逻辑
- `initSidebar`：`registerView` + `addRibbonIcon`，两者由 Obsidian 卸载时自动回收（与官方文档行为一致），无需手动清理
- 页面模型：`SidebarPage = "lexicon" | "service"`；`SidebarRoot.svelte` 维护 `activePage` 与 `langTick`（`{#key langTick}` 重建），tab 配置表 `TABS`（`$derived`，词库 `lexiconEnabled` 关闭时仅保留服务页并在停留词库页时自动切页，初值经 `untrack` 取一次快照，订阅 `subscribeLexiconEnabledChange`）+ 内容区 `{#if}` 分支，新增页面需同时扩展联合类型、`TABS` 与分支；`LexiconPage.svelte` 为词库管理页（见 lexicon），挂载时经 `listLexiconEntries` 一次性加载，筛选结果按权重降序、同权重 id 降序渲染，并订阅 `subscribeLexiconChange` 作静默刷新（不切换加载态、失败保留旧数据，同时清理已不存在条目的勾选/待确认状态），使右键菜单添加等外部写入实时反映到列表；筛选状态下拉（全部/已启用/已禁用）与搜索框对 word/pinyin 纯前端过滤且叠加生效，加号与行内编辑经 `lexicon-entry-modal.ts` 的 `openLexiconEntryModal` 打开 Obsidian `Modal`（内嵌 `LexiconEntryForm.svelte`，新增/编辑复用、打开即聚焦词语输入、校验非空与经 `findLexiconEntry` 按 word+pinyin 严格一致查重（编辑排除自身，重复则 Notice 且不写入）、保存成功由表单回调关闭，新增隐藏启用复选框并固定 enable=true，编辑保留以便弹窗内调整，词语输入经 `toPinyin` 实时重算拼音且拼音框旁提供"重新生成拼音"按钮，手动改词后覆盖人工拼音），行内复选框为多选（搜索框左侧全选框带半选态，有勾选时加号右侧出现批量操作按钮，点击经 Obsidian `Menu.showAtMouseEvent` 弹出批量启用/批量禁用/批量删除（`setWarning`）三项），行内操作依次为启用开关（`setIcon` 图标按钮，编辑按钮左侧）、编辑与两步删除（确认/取消）；`ServicePage.svelte` 展示服务状态徽标与配置并复用 `settings/service-actions` 的启停/重启/连接测试/打开设置
- 组件内样式经 `css: "injected"` 内联，class 前缀统一 `novel-`（如 `novel-sidebar`/`novel-service-badge`），配合编译期 class 哈希隔离
- 热重载样式盲区：Svelte 注入的 `<style>` 以文件路径哈希为固定 id，热重载时组件发现同 id 样式已存在便跳过重注入，类名规则会停留在旧版本（重启 Obsidian 才更新）；布局关键规则改用内联 `style`（如 `LexiconPage` 工具栏与列表行），内联样式随最新 DOM 生成，开发期即时生效

### sherpa-server（服务管理）

- 三层分工：`utils/sherpa-process.ts` 纯函数（参数拼接 `buildSherpaArgs`、配置校验 `validateSherpaConfig`、地址组装 `resolveSherpaUrl`，无状态无 init）；`cores/sherpa-server` 持有进程句柄与 `stopped/starting/running/error` 状态，导出 `getSherpaServer()` 单例（`start/stop/restart/dispose/getStatus/isRunning/subscribeStatus`）；`features/sherpa-server` 只做 autoStart 编排 + 向 `cleanups` 注册同步回收
- 进程拉起：`Platform.isDesktop` 守卫后同步 `require("child_process").spawn`（src 内零顶层 `node:` 导入，含 type-only，窄 `ManagedProcess`/`LogStream` 结构类型代替 `ChildProcess`）；`spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] })`，stdout/stderr 经 `attachLogDrain` 消费（pipe 无人读取会阻塞子进程）并打 console；就绪探测按 300ms 轮询 ws 拨号，open 即 running，10s 超时或异常退出置 error 并透出退出码；`starting/running` 重复 start 直接返回 `already-running`
- 状态广播：`setStatus` 触发订阅者，设置页与侧边栏服务页靠其刷新；`stop()` 必须同步返回（适配 `cleanups: Array<() => void>`），SIGTERM 后 3s 未退升级 SIGKILL
- 取消与旧代事件：`cancelProbe` 结算在途 `start()`（stop/dispose 时返回 `cancelled`），`cancelled` 守卫丢弃旧进程延迟事件，避免 stop 后再翻活
- restart 串行锁：`stop` 是 fire-and-forget，前一次 `restart` 未完成时返回 `already-restarting`；重启路径用 `stopImmediate()` 直接 SIGKILL，不让老进程占端口导致新进程 EADDRINUSE
- 退出释放：应用关闭不保证走插件 `onunload`，feature 层同时订阅 `workspace.on("quit")` 与窗口 `beforeunload`，双路径调用同步强杀的 `dispose()`（直接 SIGKILL，不等 SIGTERM 宽限回调）；插件禁用/卸载仍走 `stop()` 正常关闭流程
- 失败详情翻译：`resolveDetail` 将 `settings.missingBinaryPath`/`settings.missingModelPath` 映射为 `t()` 文案，运行时错误（退出码/超时等）原文透出；`toServerConfig` 从最近一次 `plugin.settings` 组装配置
- sense-voice int8 参数（`buildSherpaArgs` 占位实现）：`--port=` + `--num-threads=` + `--sense-voice-model=<modelDir>/model.int8.onnx` + `--sense-voice-use-itn=1` + `--tokens=<modelDir>/tokens.txt`，实测后按真实模型结构调整

### sherpa-client（识别客户端）

- `transcribePcm16k(samples, config)`：一次调用独占一个 WS 连接，协议与官方 sequential 客户端一致——分片发送 8 字节小端头（采样率 + 数据字节数）+ float32 LE（`buildOfflineWsPayload`，按 `WS_CHUNK_BYTES` 10240 切片），收一次文本回包即判为最终结果，发 `Done` 后关闭连接并 resolve
- 超时 60s（`TRANSCRIBE_TIMEOUT_MS`）；`config.signal` abort 时关连接并 reject `aborted`，供卸载/重触发取消；`onerror`→`unreachable`、`onclose`→`connection closed`，`settled` 守卫保证只结算一次
- 回包解析 `extractText`：JSON 取 `text` 字段，缺失或解析失败回退原文，保证投递/Notice 始终有内容
- 单例型模块（无 init），由 `features/speech-recognition` 按需调用

### audio-capture（音频采集）

- `enumerateAudioInputDevices()`：供设置页麦克风下拉使用；`Platform.isDesktop` 守卫，过滤 `audioinput`，未授权时 label 为空按枚举序号兜底为 `Microphone N`
- `startCapture(deviceId, onChunk)`：`getUserMedia`（`echoCancellation`/`noiseSuppression` 开、`autoGainControl` 关、`deviceId` 为空表示系统默认）→ `AudioContext` → 加载 worklet → `MediaStreamSource` 接 `AudioWorkletNode`；回调仅接受 `Float32Array`，经 `downsampleFloat32Mono` + `float32ToInt16Pcm` 统一输出 16kHz 16-bit 单声道分片
- `stop()` 幂等：发 `flush` 讨要尾帧、关闭 port、断开节点与源、停 track、关 AudioContext；构造期抛错则关流 + 关 context 后原样上抛
- worklet 源码以字符串内联（`worklet.ts` 的 `buildCaptureWorkletCode`），经 Blob URL `addModule` 后立即 `revokeObjectURL`，避免额外文件与构建配置；`CAPTURE_WORKLET_NAME = "local-speech-capture"`，按 `CAPTURE_BUFFER_SIZE` 攒批再 post，同名重复 addModule 的 `InvalidStateError` 忽略
- 单例型模块（无 init）

### lexicon（词库）

- 词库经 `window.indexedDB` 持久化（`window.indexedDB` 为纯浏览器 API，无 Node 依赖）：数据库名 `local-speech-recognition`、对象仓库 `lexicon`（`keyPath: "id"` + `autoIncrement`），条目字段 `id/word/pinyin/weight/enable`；字段增删不改变仓库结构，仅仓库形态变化才提升 `LEXICON_DB_VERSION`
- 单例型模块（无 init），导出无状态 Promise API：`listLexiconEntries`（`getAll` 归一化后按 id 降序）、`findLexiconEntry`（按 word+pinyin 严格一致查找，`excludeId` 供编辑时排除自身，未命中返回 null；多音字可并存）、`addLexiconEntry`（`add` 取自增 id 并回填）、`addLexiconEntries`（批量新增，单事务，返回新增条数）、`updateLexiconEntry`（`put` 全量覆盖）、`deleteLexiconEntry`（单条）、`deleteLexiconEntries`（批量删除，单事务提交避免多次往返）、`updateLexiconEntries`（批量更新，单事务提交；词库页批量启用/禁用经此落库）、`clearLexiconEntries`（单事务 count+clear，返回删除条数）；另有 `subscribeLexiconChange(listener)` 变更订阅（返回退订函数）：各写操作在事务提交成功后广播，供 UI（如侧边栏词库页）重新读取列表，保证右键菜单与词库页等多入口写入后视图一致；由 sidebar 词库页、lexicon feature 与 settings 的 `lexicon-actions.ts` 按需调用
- 启用词条映射：`getEnabledPinyinMap()` 返回 `ReadonlyMap<string, readonly string[]>`（key 为拼音去空白并小写，value 为词语列表按权重降序、同权重按 id 降序，数组内词语去重）；`refreshEnabledPinyinMap()` 重建映射，仅收录启用条目、key 为空则跳过，读取失败静默保留旧值（消费方降级不打断主流程），带代际号防并发旧读覆盖；映射为模块级单例且原地 clear+set，调用方持有的引用持续有效，由 `initLexicon` 启动预热、`notifyLexiconChange` 在每次写入广播时自动重建
- 运行时开关：模块级 `lexiconEnabled`（默认 true）经 `setLexiconEnabled(enabled)`（关闭时清空精确与模糊两张映射并递增代际号作废在途重建，开启时重建映射）与 `isLexiconEnabled()` 读写；`refreshEnabledPinyinMap()` 在关闭时直接返回，使写入触发的重建同样被拦截；`findTargets` 据此短路，关闭后识别后处理不产生候选
- 模糊音匹配：`fuzzy.ts`（模块特有文件）把词条拼音按易混规则展开为变体——声母组（平翘舌 `zh/z`、`ch/c`、`sh/s`）与韵母组（前后鼻音 `ang/an`、`eng/en`、`ing/in`、`iang/ian`、`uang/uan`，后两组需单列——拆出的韵母是 `ian`/`iang`/`uan`/`uang` 整体形式，不被 `ang/an` 组命中）各自归组后做笛卡尔组合，如 `zhang → [zhang, zhan, zang, zan]`；`buildVariantKeys(pinyin, expectedSyllables)` 依赖 `entry.pinyin` 的空格分音节（音节数与汉字数不符时返回空数组，手动录入无空格拼音自动退化为精确匹配），按词条设 `MAX_FUZZY_VARIANTS`(32) 上限防长词组合爆炸；模块级 `fuzzyMatchEnabled`（默认 false）经 `setFuzzyMatchEnabled(enabled)`（值未变直接返回，变化后重建映射）与 `isFuzzyMatchEnabled()` 读写，`getEnabledFuzzyPinyinMap()` 暴露 `ReadonlyMap`（关闭时为空表，`refreshEnabledPinyinMap` 顺带清空）
- `file-format.ts`：导入导出文本格式（模块特有文件）。`serializeLexiconFile(entries)` 输出 `{ version, exportedAt, entries: [{ word, pinyin, weight, enable }] }`（不含 id，导入时重新分配自增 id）；`parseLexiconJson(text)` 兼容包装对象与裸条目数组，逐条归一化——word 缺失/非字符串丢弃计 invalid，`pinyin` 缺失用 `toPinyin` 生成，`weight` 非数字回退 0，`enable` 非布尔回退 true，结构不符抛错；`parseLexiconTxt(text)` 每行一个词语（空行跳过），行尾 `:\d+` 为整数权重（未带后缀回退 0），拼音一律自动生成
- 连接懒打开并缓存为模块级 Promise；open 失败/被阻塞时复位缓存供下次重试；`onversionchange` 主动关闭连接并作废缓存，避免旧连接阻塞未来版本升级
- 事务封装 `runTransaction`：先挂 complete/error 监听再发起请求（事务提交可能早于 await 恢复，晚挂监听会永久挂起），再经 `Promise.all` 同时等待请求结果与事务提交；读取结果经 `normalizeLexiconEntry` 运行时归一化——id/word/pinyin 类型不符的脏数据丢弃，`weight` 缺失回退 0、`enable` 缺失回退 true（兼容旧记录）
- 写库前显式重建普通对象：调用方可能传入 Svelte `$state` 代理，structured clone 无法克隆 Proxy，直接写入会抛 DataCloneError

## 业务功能

`src/features/` 下用户可感知功能的专项说明。各 feature 的 `initXxx()` 返回同步清理函数，由 `features/index.ts` 收集进 `cleanups`，`main.ts` 的 `onunload` 经 `cleanFeatures()` 依序回收并排空队列（支持热重载重复 onload）。

### sherpa-server（服务编排）

- `initSherpaServer`：`autoStartServer` 开启且桌面端时随插件加载拉起服务，结果经 `Notice` 提示；订阅 `workspace.on("quit")` 与 `window` 的 `beforeunload` 双路径 `dispose()`；返回 `() => getSherpaServer().stop()` 供卸载回收

### speech-recognition（语音识别）

- `initSpeechRecognition`：注册命令 `toggle-speech-recognition`（名称 `commands.toggleRecognition`，插件不预设快捷键，用户自行绑定），并注册全局 `keyup` 监听兜底 push-to-talk 松键停止；返回 `() => controller.dispose()`
- `SpeechController` 串行处理一次「录音→识别→投递」闭环：状态机 `idle/recording/transcribing`，`starting` 标志防双流泄漏，`generation` 代际号使卸载/重触发后的过期异步回包失效，`transcribeAbort` 取消在途识别；识别中再次触发经 `Notice` 拒绝，避免并发 WS 互相覆盖
- 触发语义：toggle 模式按一次开始、再按一次停止；push-to-talk 为过渡实现（Obsidian 快捷键只给 keydown，无 keyup），松开 `R`/`Alt` 或再按一次均停止
- 录音前校验服务已运行与桌面端；单次录音上限 280s（服务端 300s 拒连），到时自动停止并走正常识别流程，不丢已录音频
- 投递策略：Markdown 编辑器聚焦且为 source 模式时，经 `getCodeMirrorEditorView` 取 CM6 视图，用单事务 `dispatch`（`changes` + `selection` 置于末尾 + `effects: [setTargetsEffect.of(findTargets(text, from))]` 触发词库后处理高亮 + `scrollIntoView`）插入光标处，失败回退 `editor.replaceSelection`；无聚焦时写剪贴板并 `Notice` 提示；空结果视同未采集到音频
- 麦克风错误按 `DOMException.name` 翻译（`NotAllowedError`→权限拒绝、`NotFoundError`/`OverconstrainedError`→设备缺失），其余透出原文

### lexicon（词库）

- `initLexicon`：创建 `LexiconIntegration` 控制器并订阅 `subscribeLexiconEnabledChange`，按 `plugin.settings.lexiconEnabled` 首次 `apply()`（含映射预热），随后订阅 `subscribeFuzzyMatchChange` 并 `setFuzzyMatchEnabled(plugin.settings.fuzzyMatchEnabled)`（先 apply 再设模糊，避免启动时重建两次），返回 `unsubscribe + dispose` 供 `cleanFeatures` 回收；控制器启停编辑器集成——启用时预热映射、注册 `workspace.on("editor-menu")`（选中非空时追加"添加到词库"项，图标 `book-plus`）并向扩展数组补入 `targetField` + `targetClickHandler`，关闭时移除扩展、`offref` 注销菜单并清空映射；`registerEditorExtension` 只注册一次空数组，靠增删数组 + `workspace.updateOptions()` 运行时生效（Obsidian 无注销 API，此为官方指定的热配置方式）
- 添加语义：拼音经 `toPinyin` 自动生成、权重 0、默认启用；写入前经 `findLexiconEntry` 按 word+pinyin 严格一致查重，已存在则 `Notice` 提示且不写入；成功与失败分别经 `lexicon.added`/`lexicon.addFailed` 提示；写入经词库 core 广播变更，已打开的侧边栏词库页静默刷新实时反映
- 识别后处理：`findTargets(text, baseFrom)` 以 `getEnabledPinyinMap()` 的键为匹配目标（`isFuzzyMatchEnabled()` 为真时并入 `getEnabledFuzzyPinyinMap()`，使平翘舌与前后鼻音差异的识别结果也能命中），逐键经 pinyin-pro `match`（`every` + `lastPrecision: every` + `continuous` + `v`，整词严格同音）扫描本次识别插入的文本，过滤非纯汉字片段（`match` 会把拉丁字符逐字母当拼音），跳过无替代项片段（该拼音唯一候选且与文本一致），同片段多音合并 keys，重叠片段按起点升序贪心保留（RangeSet 要求互不重叠）；结果经 `setTargetsEffect` 由 `targetField` 渲染 `.target-word` 装饰（`data-keys` 存拼音键）
- 点击替换：`EditorView.domEventHandlers` 的 click 处理器（编辑器视图直接可得、弹出窗口同样生效）打开 `Menu`，候选取自 keys 对应的最新精确与模糊两张映射（data-keys 不区分来源）并排除当前文本，空则不弹；选中后单事务替换并携带 `dismissTargetEffect`（旧坐标）只清除该处高亮，其余装饰随变更自动映射；样式为 `--text-accent` 点状下划线 + 指针（styles.css）

## utils（工具）

`src/utils/` 下通用工具功能模块专项说明。

- 无状态纯函数工具目录，无生命周期，不受模块三段式约束：单文件同时导出函数与类型，无 init 方法
- `svelte.ts`：`mountComponent(target, component, ...args)` 将 Svelte 组件挂载到目标容器（如视图的 `contentEl`），先清空容器再挂载，返回 `{ instance, destroy() }`；destroy 卸载组件并清空容器。参数侧用 `{} extends Props` 分支重载：无 props 可省、有 props 必传。组件样式经构建配置 `css: "injected"` 注入 `<head>`，卸载后样式标签残留，但编译期 class 哈希保证样式隔离
- `ambient.d.ts`：`*.svelte` 模块声明，tsc 层放宽 props 类型，精确类型由 svelte-check 校验（build 命令内执行）；不与 `svelte.ts` 同名——TS 对同名 .ts/.d.ts 只保留 .ts，且模块文件内 `declare module` 会被视为模块增强而非法
- `audio.ts`：识别管线纯函数与常量——`TARGET_SAMPLE_RATE`(16k)/`WS_CHUNK_BYTES`(10240)/`CAPTURE_BUFFER_SIZE`(4096)，`downsampleFloat32Mono`（线性重采样）、`float32ToInt16Pcm`、`int16ToFloat32Normalized`、`mergeInt16Chunks`（合并分片）、`buildOfflineWsPayload`（组装 8 字节头 + float32 LE 请求体）
- `cm-utils.ts`：`getCodeMirrorEditorView(editor)` 鸭子类型取 CM6 `EditorView`；`@codemirror/view` 外部化，仅 `import type` 零运行时成本，运行时逐层校验 `cm`/`dispatch`/`state`/`selection`/`main`/`from`/`to` 形态，不符返回 `null`
- `pinyin.ts`：`toPinyin(text)` 中文转拼音，选项 `{ toneType: "none", v: true, nonZh: "consecutive" }`（无声调、ü→v、非汉字连续段原样保留），并对结果折叠连续空白；供词库录入表单自动填充，词条拼音以此为存储格式
- `sherpa-process.ts`：纯函数（参数拼接 `buildSherpaArgs`、配置校验 `validateSherpaConfig`、地址组装 `resolveSherpaUrl`），无状态无 init
- `.svelte` 组件文件属于模块特有文件，置于所属模块目录下（如 `cores/sidebar/components/`），不受三段式约束

## 代码规范

1. **命名**：类/接口 PascalCase，函数/变量 camelCase，常量 UPPER_SNAKE_CASE，文件 kebab-case
2. **类型**：strict 全开（含 `noUncheckedIndexedAccess`）；禁止 `any` 与隐式 any
3. **模块**：`cores/`（核心能力）与 `features/`（业务功能）下的每个模块均按三段式组织：`index.ts`（统一出口，仅 re-export）、`types.ts`（类型定义）、`cores.ts`（核心逻辑）。其中 init 型模块（i18n/settings/sidebar）导出 `init<模块>()` 并由 `src/cores/index.ts` 聚合为 `initCores()`；单例型模块（sherpa-server/audio-capture/sherpa-client/lexicon）无 init，暴露单例/函数由 features 或 settings 按需调用；feature 模块导出 `init<模块>()` 并返回同步清理函数，由 `src/features/index.ts` 聚合为 `initFeatures()`/`cleanFeatures()`；`main.ts` 各调用一次；init 方法参数一律使用具体类 `LocalSpeechRecognitionPlugin`，且导入一律为 `import type`（类型层循环在编译期擦除，运行时无循环）；模块特有文件（如 i18n 的 `locales/`、sidebar 的 `components/` 与 `lexicon-entry-modal.ts`、settings 的 `connection.ts`/`service-actions.ts`/`microphone-options.ts`、audio-capture 的 `worklet.ts`）直接置于模块目录下，不受三段式约束
4. **注释**：中文，写"为什么"而非"是什么"；不做多余注释。导出声明（类/接口/函数/常量/属性）一律使用 JSDoc（`/** */`），内部逻辑用行注释；`@param`/`@returns` 仅在参数或返回值存在需要说明的语义时使用，不机械全量添加；纯 re-export 的 index.ts 无需注释
5. **约束**：桌面 Node 能力（`child_process` 等）须 `Platform.isDesktop` 守卫后同步 `require()`（Obsidian 以 CJS 加载插件，原生动态 `import("node:...")` 会被当网络模块抓取而失败；`require` 处加带描述的 eslint-disable）；src 内禁止顶层 `node:` 导入（含 `import type`，用窄结构类型代替 Node 类型），对应 `obsidianmd/no-nodejs-modules` 规则；禁止 Electron API；`@codemirror/*` 已外部化，值导入仅限编辑器扩展实现所需的 `@codemirror/state`/`@codemirror/view`（与 Obsidian 共享同一模块实例），`cm-utils.ts` 等鸭子类型探测仍 `import type`；涉及用户激活的 DOM 操作（文件选择、下载锚点）一律使用 `activeDocument`/`activeWindow`——设置窗口可能运行在弹出窗口，全局 `document` 指向主窗口会丢失用户激活
6. **依赖**：确认可 bundle 或需加入 esbuild `external` 列表；跨模块依赖方向为 utils ← cores ← features，例外为 `utils/sherpa-process.ts` 对 `cores/*/types` 的 type-only 回指与 settings 对进程/硬件的两个特有文件调用（见核心能力）
7. **Svelte**：组件使用 runes（`$props`/`$state`/`$derived`/`$effect`），`$effect` 内订阅须返回退订函数；模板中的 `t()` 需外包 `{#key langTick}` 以支持语言切换重建；组件样式作用域内，class 前缀统一 `novel-`
8. **格式**：由 `.prettierrc` 统一控制——2 空格缩进、双引号、128 列、LF 行尾（与 `.editorconfig` 一致）

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
- **CI**：lint.yml 按 paths-filter 命中 `src`/`scripts`/配置等文件才跑 lint 与 format:check
- **Release**：打 tag（`*.*.*`）触发 GitHub Action（bun 环境）构建，git-cliff 生成 changelog，产物取根目录 `main.js`/`manifest.json`/`styles.css` 并生成 attestation
