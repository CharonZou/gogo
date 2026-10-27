# GoGo IDE 深度定制方案（对标 Cursor / Trae）

> 状态：方案稿（v1）｜适用引擎：openvscode-server 1.105.1（commit 7d842fb85a0275a4a8e4d7e040d2625abbf7f084）
> 目标：把 GoGo 的 IDE 从"套壳原版"升级为"深度定制的 AI 开发工作台"，在品牌、UX、AI 能力三个层面逼近 Cursor/Trae，同时保持可升级、可回滚。

---

## 1. 现状与证据基线

| 资产 | 位置 | 现状 |
|---|---|---|
| 引擎 | `ide/runtime/openvscode-server/`（184 MB，编译产物 out/，无源码） | 原版发布物 + 已定制 |
| 品牌补丁 | `ide/scripts/patch-product.js`（product.json 品牌） | 已有，产物层 |
| 图标 | `ide/scripts/gen-icons.py` | 已有 |
| 内置扩展 | `ide/extension/gogo-ai/`（0.1.0：activitybar 视图、chat webview、右键菜单） | 已有，浅层 |
| 中文化 | `out/nls.messages.zh-cn.js` + `data/User/languagepacks.json` + workbench.html 注入 | 已完成核心 |
| 品牌主题 | workbench.html 内联 CSS（深色 + 强调色 #635bff） | 已有 |
| 打包 | `evopanel/src-tauri/tauri.conf.json`：`resources: ../../ide/runtime/openvscode-server` | 引擎随安装包分发，运行时独立 node 进程 |

**结论**：GoGo 目前处于**产物层定制**（改发布物，不动内核）。Cursor/Trae 是**源码 fork + 内核改造**。差距 = 内核可改造性 + AI 深度集成。

---

## 2. 路线对比（真实决策）

### 路线 A：产物层增强（继续当前方式）
- 机制：改 workbench.html/js、out 产物、product.json、加扩展；不改内核
- 可达深度：品牌、主题、默认配置、扩展级 AI（补全/内联聊天经扩展 API）
- 上限：worker 扩展翻译、编辑器内核 UX、瘦身、深度 NLS 全链路**不可达**
- 失效条件：每次升级（改版）需重做补丁；补丁冲突面大
- 恢复成本：低（改前备份产物）
- **决策：作为 Phase 0 保留，不单独作为长期路线**

### 路线 B：内置扩展深度化（不 fork 源码，把 AI 能力做进扩展层）
- 机制：gogo-ai 扩展深度开发（InlineCompletionItemProvider、InlineChat、diff apply、终端、树视图、状态栏、权限模式）
- 可达深度：Cursor 80% 的**功能**体验（补全、Chat、Agent 操作）——VS Code 扩展 API 已覆盖大部分
- 上限：补全渲染 UX、全局透明主题、扩展翻译、包体积、协议深度（如改 worker 架构）不可达
- 失效条件：扩展 API 能力边界（VS Code 1.105 已很全，边界在"编辑器内部渲染"）
- 恢复成本：低（扩展可禁用）
- **决策：作为 Phase 1 主路线，收益最高/成本最低**

### 路线 C：源码 fork（对标 Cursor/Trae 的最终形态）
- 机制：fork `gitpod-io/openvscode-server` 源码仓库（VS Code 1.105.1 的 openvscode 分支），自建构建链（npm ci + gulp 产 out/），改动落在 src/ 源码，patch 化维护，升级 = 切 upstream tag + 重放补丁
- 可达深度：全部（内核 UX、NLS 全链路含扩展、瘦身、自研 AI 直连内核、worker 架构）
- 成本：构建环境搭建 + 每次 upstream 合流 + 补丁冲突治理
- 失效条件：upstream 合流冲突失控、构建链在 Windows 依赖缺失（python/gulp/node 版本）
- 恢复成本：中高（patch 化后回滚 = 切回旧 tag/dist）
- **决策：作为 Phase 2 目标路线，在 Phase 1 验证扩展层价值后再投入**

---

## 3. 推荐方案（分阶段）

```
Phase 0（当前）→ 产物层加固、品牌/主题/配置完备化
Phase 1（近中期）→ gogo-ai 扩展深度化，AI 功能对标 Cursor 80%
Phase 2（远期，条件触发）→ 源码 fork，内核级定制
```

### Phase 0：产物层完备化（低成本，先做）
1. **品牌闭环**：欢迎页（product.json welcomePage）、图标、标题栏、about、命令面板 logo
2. **默认配置固化**：Machine/settings.json 固化 GoGo 主题、字号、透明化开关、预装扩展启停
3. **工作区挂载**：默认打开 `D:/Myproject`（现 URL 参数方式 → 启动参数 `--default-folder`）
4. **通信协议**：定义 evopanel ↔ IDE 的 postMessage 契约（打开文件、跳转行、执行命令、切主题、读取文件），在 IdeApp.tsx + workbench.html 各落一侧
5. **验证**：每次改动后跑启动冒烟（18080 + UI 中文 + gogo-ai 视图激活）

### Phase 1：gogo-ai 扩展深度化（主战场）
扩展层可达到的 Cursor 级能力清单：
| 能力 | VS Code API | 落点 |
|---|---|---|
| Tab 式补全 | `InlineCompletionItemProvider` | gogo-ai/src/completion/ |
| 内联聊天（选中即问、apply diff） | `InlineChatProvider` + workspace edit | gogo-ai/src/chat/ |
| 代码追踪/定位（从对话跳转到文件行） | `commands.executeCommand('vscode.open')` + reveal | 复用 evopanel 路由 |
| 任务/Agent 面板 | webview + TreeView + Task API | gogo-ai/src/agent/ |
| 终端执行（完全访问模式） | `vscode.window.createTerminal` + 网关授权 | gogo-ai/src/exec/ |
| 状态栏/通知/进度 | statusBar + window API | 各模块 |
| 权限模式（只读/建议/完全访问） | workspace edit 前检查 + 网关鉴权 | gogo-ai/src/policy/ |
| 快捷键/命令面板 | contributes.commands + keybindings | package.json |
| 主题联动 | 读/写 workbench.colorCustomizations | 配置模块 |

架构：扩展 webview 内嵌 evopanel 对话 UI（iframe 复用）或独立 UI，消息经 postMessage 走同一协议。

### Phase 2：源码 fork（条件触发）
触发条件（满足其一即启动）：
- 需要内核级 UX（补全渲染、编辑器内部改造）
- 需要扩展翻译全链路中文（worker 侧）
- 需要瘦身（移除 node_modules 外无用模块，发布体积）
- 需要协议级深度（如 IDE 内多 Agent 编排）

工程结构（fork 后）：
```
gogo-app/ide/
  src/            # fork 源码（git 子模块或 vendored，锁 tag openvscode-server-v1.105.x）
  patches/        # GoGo 定制补丁（按主题分文件，git format-patch 风格）
  build/          # 构建脚本（npm ci、node build、产出 dist）
  dist/           # 构建产物（= 现 runtime/openvscode-server 的 out/）
  runtime/        # 运行期目录（data/、extensions/ 布局保持）
  extension/gogo-ai/
  scripts/        # 现有补丁工具迁移
```
- **patch 系统**：每个定制主题一个 .patch（如 `0001-brand.patch`、`0002-nls-zh.patch`、`0003-theme-translucent.patch`）；升级 = `git checkout 新tag` + `git am patches/*` + 冲突处理
- **构建链**：VS Code 官方 gulp 链（`node build`），Windows 可构建；node 版本以 openvscode-server 仓库要求为准（待校准）
- **分发**：Tauri resources 改引 `ide/dist`；版本化目录（`openvscode-server-1.105.1/`）支持多版本并存回滚

---

## 4. 采用合同与恢复

| 性质 | 合同 | 反例与恢复 |
|---|---|---|
| 可升级 | 锁 tag + patches 重放；升级前出差异清单 | 合流冲突 → 该 patch 标注"需人工"，不阻塞其他 patch |
| 可回滚 | dist 版本化，Tauri resources 可指向旧版本目录 | 新版本启动失败 → 切回旧目录 + 保留 data 迁移点 |
| 可验证 | 冒烟清单（18080、中文、gogo-ai 激活、补全/内联聊天手动路径） | 任一失败 → 阻止发布，回到上一验证点 |
| 扩展安全 | gogo-ai 所有写操作（文件/终端）走网关授权，完全访问才放行 | 未授权写 = 拒绝并通知前端 |

---

## 5. 风险与开放决定（unknown / 待校准）

- **fork 构建链**：Windows 上 python/gulp/node 完整依赖未验证（`unknown`，Phase 2 启动时用最小构建冒烟校准）
- **upstream 合流频率**：openvscode-server 跟随 VS Code 每月版本；GoGo 是否每月跟进 vs 锁定 LTS（待决策，建议锁定 + 季度评估）
- **worker 扩展翻译源码位置**：需在 src/ 中定位 NLS worker 链路后确认改动点（`unknown`，Phase 2 首个侦察任务）
- **工作量**：Phase 1 ≈ 2-4 周（单扩展）；Phase 2 基线搭建 ≈ 1-2 周 + 每 patch 半天到数天（待校准）
- **性能基线**：fork 后产物体积/启动耗时需与现 184 MB/秒级启动对比（待校准，先量化再动）

---

## 6. 建议立即动作（下一步）

1. Phase 0-4、5 先落地（协议契约 + 默认挂载），半天工作量，即时收益
2. Phase 1 按清单从「Tab 补全 + 内联聊天」两个能力起步（最高频、最显眼）
3. 建 `ide/patches/` 目录，把现有产物改动（product.json、workbench.html、nls）**补丁化归档**——为 Phase 2 迁移做准备
4. 决定升级策略（锁定 vs 跟进），写入 README
