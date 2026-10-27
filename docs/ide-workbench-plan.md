# GoGo IDE 工作台集成方案（openvscode-server + deepseek-harness/main）

> 状态：待确认 · 作者：Doubao · 日期：2026-10-11
> 目标形态：像 Cursor / Trae / GoLand 一样，左侧文件树 + 编辑器，右侧 AI 对话。

---

## 一、需求与目标

在 GoGo（`gogo-app`）中集成 GitHub 开源 VSCode（openvscode-server），形成**左侧文件资源管理器 + 中间编辑器 + 右侧 AI 对话**的 IDE 工作台布局。右侧对话面板**只与用户在智能体中心创建的角色 `deepseek-harness`（标识 `main`）对话**，整体体验对齐 Cursor / Trae 的 AI IDE。

预期布局：

```
┌──────────────────────────────────────────────────────────┐
│  GoGo 顶栏（可保留）                                       │
├───────────────────────────────┬──────────────────────────┤
│                               │  右侧 AI 对话面板          │
│  openvscode-server (iframe)   │  · deepseek-harness(main) │
│  ┌──────────┬──────────────┐  │  · 消息流式收发           │
│  │ 文件树    │  编辑器       │  │  · 新对话 / 历史 / 停止   │
│  └──────────┴──────────────┘  │                          │
│  （VSCode Web 完整能力）       │                          │
├───────────────────────────────┴──────────────────────────┤
│  GoGo 侧栏（可保留，含新入口「IDE 工作台」）                │
└──────────────────────────────────────────────────────────┘
```

---

## 二、现状探查结论（已完成的事实）

### 2.1 GoGo 技术栈

| 模块 | 说明 |
|---|---|
| `gogo-app/evopanel` | 前端面板：React 19 + Vite + Tailwind，Tauri 2 / Electron 双壳；dev 端口 **1421**；`/api` 由 Vite 代理到 Gateway |
| `gogo-app/backend` | Python Gateway（FastAPI，端口 **8012**）+ LangGraph 智能体运行时 |
| `gogo-app/plugins/dsh` | 用户自行引入的插件集合（与 deepseek-harness 命名相关，非官方组件） |
| 对话链路 | `POST /api/chat/sessions`（建会话，`agentId='main'`）→ `api.chatSend`（SSE `/runs/stream`）→ `wsClient.onEvent` 订阅事件流 |

### 2.2 deepseek-harness（标识 main）

- 是用户在 GoGo「智能体中心」（`#/expert`）创建的自定义角色，**角色标识（agent_id）为 `main`**，默认主智能体：问答、改代码、编排任务。
- 已配置：26 个工具 + 全量 MCP + 4 个技能（seedream 图像、deep-research、preset-role-assistant 等）。
- 前端创建会话默认即 `api.chatSessionsCreate('main', …)`，与「普通对话」同链路，**无需后端改造即可对接**。

### 2.3 对话接口（前端可直接复用）

| 能力 | 接口 | 关键参数 |
|---|---|---|
| 创建会话 | `POST /api/chat/sessions` | `{agentId:'main', title, context:{local_workspace_root, use_virtual_paths:false, workspace_user_pinned:true}, ensureThread:false}` → 返回 `sessionKey` |
| 绑定工作区 | `wsClient.bindSessionWorkspace(sk, path, {userPinned:true})` | 让 main agent 可读写与 VSCode 相同的目录 |
| 发送消息 | `api.chatSend(sk, text, [], [], {})` | 内部自动 ensure-thread + POST `/runs/stream` |
| 流式接收 | `wsClient.onEvent(fn)` | 事件 `{event:'chat', payload:{sessionKey, runId, state, message}}`；`state=delta/reasoning/done/aborted/usage` |
| 历史 | `api.chatHistory(sk, limit)` | `{messages, messageCount}` |
| 面板 SSE | `subscribeThreadPanelSse(threadId, onData)` | 备用流式通道 |

### 2.4 本机环境

| 项 | 状态 |
|---|---|
| Docker | ✅ 29.5.3（Docker Desktop） |
| WSL2 | ✅ Ubuntu（版本 2） |
| Node.js | ✅ v22.23.2 |
| Git | ✅ 2.54.0 |

---

## 三、技术选型（关键决策）

### 3.1 开源 VSCode 内核对比

| 方案 | Windows 原生支持 | 说明 | 结论 |
|---|---|---|---|
| **openvscode-server（官方 Docker 镜像）** | ✅（容器） | GitHub 开源，官方发布物仅 Linux 包与 Docker 镜像；容器是 Windows 上官方支持路径 | ✅ **采用** |
| openvscode-server（Linux 包直跑） | ❌ | 官方发布物仅 linux-x64/arm64；native 模块（.so）在 Windows Node 下无法运行 | ✗ |
| code-server（Coder） | ❌ | 官方明确不支持 Windows | ✗ |
| monaco-editor 自研布局 | ✅ | 仅编辑器内核，文件树/终端需自建，工作量最大；最像 Cursor 定制 UI | 备选 |
| Theia IDE | ✅ | VSCode 兼容但非 VSCode 本体 | 备选 |

**结论：openvscode-server 官方 Docker 镜像（`gitpod/openvscode-server:latest`）** —— Windows 上唯一「官方支持 + 完整 VSCode Web（文件树/编辑器/终端/扩展）」路径，本机 Docker 已就绪，一条 `docker run` 即可起。

### 3.2 为什么不选 monaco 自研

用户点名「GitHub 下开源的 vscode」→ openvscode-server 就是官方开源 VSCode Web；monaco 只是编辑器内核，要自建文件树、打开保存、终端、设置、扩展体系，工程量数倍且体验难及 VSCode。

---

## 四、总体架构

```
┌──────────────────────────── 浏览器（GoGo evopanel :1421） ────────────────────────────┐
│  #/ide  IDE 工作台页面                                                                │
│  ┌───────────────────────────────┬────────────────────────────────────────────┐   │
│  │ iframe → openvscode-server    │ 右侧对话面板（React）                       │   │
│  │   http://127.0.0.1:18080      │  · api.chatSessionsCreate('main')          │   │
│  └───────────────────────────────┴──────────────┬─────────────────────────────┘   │
└──────────────────────────────────────────────────┬────────────────────────────────┘
                                                   │  /api（Vite 代理）
┌──────────────────────────────────────────────────▼────────────────────────────────┐
│  GoGo Gateway（:8012，Python）   →  LangGraph 运行时 → 智能体 deepseek-harness(main) │
└───────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────── Docker Desktop ──────────────────────────┐
│  容器 gogo-ide-vscode（gitpod/openvscode-server）                                   │
│  · 端口映射 18080 → 3000                                                            │
│  · 卷挂载 D:\Myproject\GoGo → /home/workspace（文件树/编辑/终端读写同一份文件）        │
│  · 启动参数 --without-connection-token（仅本机）                                     │
└────────────────────────────────────────────────────────────────────────────────────┘
```

数据流要点：
- **VSCode 侧**：openvscode-server 容器直接读写本地工作区（卷挂载），不经过 GoGo 后端。
- **对话侧**：右侧面板走 GoGo 现有对话链路，创建/复用 `main` 会话，并把 `local_workspace_root` 设为同一工作区 → **AI 看到的就是 VSCode 里的项目文件**，改代码与聊天上下文一致（Cursor/Trae 同款体验）。

---

## 五、实现方案（分模块）

### 5.1 模块 A：IDE 引擎（容器化 openvscode-server）

新建 `gogo-app/evopanel/scripts/ide-vscode.ps1`，提供子命令：

| 命令 | 行为 |
|---|---|
| `start` | 检测 Docker 就绪 → 容器不存在则 `docker pull` + `docker run -d --name gogo-ide-vscode --restart unless-stopped -p 18080:3000 -v "D:/Myproject/GoGo:/home/workspace" gitpod/openvscode-server --without-connection-token`；已存在则 `docker start`；输出访问地址 |
| `stop` | `docker stop gogo-ide-vscode` |
| `status` | 容器状态 + HTTP 18080 探测 |
| `logs` | 查看容器日志 |
| `remove` | 删除容器（重建用） |

参数：`-Workspace`（默认 `D:\Myproject\GoGo`）、`-Port`（默认 18080）。
首次启动自动拉取镜像（约 1 GB，数分钟）；后续秒级启动。脚本**幂等**，可重复执行。

### 5.2 模块 B：前端路由与页面壳

| 文件 | 说明 |
|---|---|
| `src/main.js` | 追加 `registerRoute('/ide', () => import('./pages/ide.js'))` |
| `src/pages/ide.js` | React 挂载壳（仿 `pages/chat-react.js`：createRoot 挂载 IdeApp，导出 render/cleanup） |
| `src/react/ide/IdeApp.tsx` | IDE 工作台主组件 |
| `src/react/ide/ide.css` | 页面样式 |
| `src/components/shell-aside.js` | 主导航「员工」之后新增「IDE 工作台」入口（`data-shell-nav="/ide"`，代码图标） |

### 5.3 模块 C：IDE 工作台组件（IdeApp）

**布局**（页面自适应，若确认保留 GoGo 壳）：
- 顶栏：页面标题、「deepseek-harness · main」徽标、工作区路径、引擎状态灯、新对话按钮
- 主体 `flex`：左侧 `iframe`（flex:1）承载 openvscode-server；右侧对话面板（固定约 360px，可加拖拽分隔条）

**引擎状态管理**：
- 挂载时 `fetch('http://127.0.0.1:18080/')` 探测
- 未启动：显示引擎未启动卡片 + 启动命令（复制按钮）+「重新检测」；已启动：渲染 iframe（`http://127.0.0.1:18080/?folder=/home/workspace`）

**对话面板**：
- 会话：首次进入 `api.chatSessionsCreate('main', {title:'IDE 工作台', context:{local_workspace_root: 工作区, use_virtual_paths:false, workspace_user_pinned:true}})`，`sessionKey` 存 localStorage 复用；「新对话」重建
- 发送：`api.chatSend(sk, text)`，Enter 发送 / Shift+Enter 换行，发送中转圈
- 接收：`wsClient.onEvent` 过滤 `event==='chat' && payload.sessionKey===sk`：
  - `state=reasoning` → 折叠的「思考中」块
  - `state=delta` → 追加到当前助手气泡（流式光标）
  - `state=done/final` → 结束本轮
  - `state=aborted` → 提示已停止
- 历史：进入时 `api.chatHistory(sk, 50)` 回填；「停止生成」调 `stopSessionExecution`
- 展示：用户/助手气泡、Markdown 渲染（复用现有 `lib/markdown.js`）、代码块等宽样式

### 5.4 模块 D：启动编排

开发流程两条命令（写进 README）：
```powershell
powershell -ExecutionPolicy Bypass -File evopanel\scripts\ide-vscode.ps1 -Action start   # 1. 起 IDE 引擎
npm run dev                                                                              # 2. 起 GoGo（:1421）
```
浏览器打开 `http://localhost:1421/#/ide`。

---

## 六、UI 设计要点（Cursor / Trae 风格）

- 对话面板浅色/深色跟随 GoGo 主题变量（`var(--bg-secondary)` 等），保持原生一致
- 助手消息左侧对齐、用户消息右侧对齐；流式输出带闪烁光标（CSS 动画）
- 思考过程默认折叠为一行「🧠 思考中…」，点击展开（首次实现为折叠静态块）
- 空态：首次进入显示引导文案「向 deepseek-harness 描述你想改的代码」
- 图标与按钮风格复用现有 `react-chat-aside-nav-*` 视觉语言

---

## 七、风险与注意事项

| 项 | 说明 | 应对 |
|---|---|---|
| Docker Desktop 未运行 | 脚本 `docker info` 失败即报错 | 提示启动 Docker Desktop；可选 WSL2 备选路径 |
| 首次拉镜像约 1 GB | 耗时数分钟 | 脚本输出进度；后续秒级启动 |
| 容器内文件 IO | 卷挂载映射，大仓库首开较慢（VSCode 索引） | 挂载目录为工作区根；可按需换成子目录 |
| 安全 | `--without-connection-token` 仅限本机 | 生产/内网可换 `--connection-token` |
| 端口冲突 | 18080 被占用 | `-Port` 参数可改，前端探测地址同步 |
| iframe 与父页通信 | openvscode-server 无 postMessage 桥接 | 文件改动靠文件系统同步，不做实时事件桥（首版） |
| `.trae` 等点目录 | 容器内可见（Linux 无隐藏限制） | 属预期行为 |

---

## 八、验收标准

1. `ide-vscode.ps1 start` 幂等执行，18080 可访问 VSCode Web，文件树显示工作区内容
2. 打开 `#/ide`：左侧加载 VSCode，右侧面板显示 deepseek-harness（main）
3. 发送消息 → main agent 流式回复（思考/正文逐步渲染）；历史回填、新对话、停止生成可用
4. 工作区绑定一致：AI 能读取/修改 VSCode 打开的项目文件
5. 重启（容器重启 + GoGo 刷新）后会话与状态正常恢复

---

## 九、待确认决策点

| # | 决策 | 推荐 | 备选 |
|---|---|---|---|
| 1 | **IDE 引擎运行方式** | **Docker 容器**（官方镜像，本机已就绪） | WSL2 原生跑 Linux 包；仅手动脚本（不自动拉取） |
| 2 | **页面布局** | **保留 GoGo 侧栏/顶栏**（改动小、可随时切回） | 全屏沉浸（更接近 Trae，需做返回入口） |
| 3 | **对话会话策略** | **固定复用同一 main 会话**（localStorage 记忆） | 每次进入新建会话 |
| 4 | **默认工作区** | **D:\Myproject\GoGo**（与项目一致） | 其它目录（URL 参数 `?dir=` 可覆盖） |
| 5 | 对话面板宽度 | 固定 360px | 可拖拽（首版不做） |

> 确认以上决策（或修改任意一项）后，我再按本方案实施；任何未确认的改动不会先行落地。
