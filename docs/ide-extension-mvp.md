# GoGo IDE 扩展 MVP 设计文档

## 一、定位

GoGo IDE 扩展是一个 **VSCode 扩展 + MCP Client**，让开发者在 IDE 内直接与 GoGo 后端对话，AI 实时改代码。

```
VSCode 扩展 (MCP Client)         GoGo 后端 (MCP Server)
┌──────────────────────┐         ┌──────────────────────┐
│  侧边栏聊天面板       │──HTTP──→│  POST /mcp           │
│  # 引用文件           │←─SSS────│  tools/list          │
│  AI 代码高亮         │         │  tools/call          │
│  逐行接受/拒绝        │         │  read/write/terminal │
└──────────────────────┘         └──────────────────────┘
```

## 二、MVP 功能清单

### 1. 侧边栏聊天面板
- 左侧活动栏加 GoGo 小熊图标
- 点开右侧 webview 聊天面板
- 流式输出 token，支持中断生成
- 多轮对话历史

### 2. MCP Client 连接
- 自动连接 `http://localhost:8012/mcp`
- initialize 握手 → tools/list → tools/call
- SSE 接收流式事件

### 3. # 引用文件
- 输入 `#` 弹出文件选择菜单
- 支持选文件 / 文件夹 / 当前打开的代码段
- 选中后插入到消息中发给 AI

### 4. AI 代码高亮
- AI 新增的代码行 → 淡绿色背景
- AI 删除的代码行 → 红色删除线
- 行号旁显示小熊小图标

### 5. 逐行接受/拒绝
- 高亮行旁边悬浮按钮
- 单行接受 / 单行拒绝
- 全部接受 / 全部拒绝

### 6. 一键全部应用
- 满意后点"应用到文件"
- 批量写入磁盘
- 自动刷新编辑器

## 三、技术栈

| 层 | 技术 |
|---|---|
| 扩展宿主 | VSCode Extension API (TypeScript) |
| UI | Webview (React + Tailwind) |
| MCP Client | @modelcontextprotocol/sdk/client |
| 通信 | HTTP POST /mcp + SSE 流式 |
| 图标 | GoGo 蓝色小熊 logo |

## 四、后续扩展（MVP 之后）

- @ 切换子智能体
- Todo List 勾选
- 内置浏览器预览
- 思维链折叠展示
- /spec /plan /goal 命令
- 审批模式切换
- .gogo/ 项目规则自动加载
- JetBrains IDEA 版本（Kotlin 重写 UI）

## 五、发布

- VSCode Marketplace: `vsce publish`
- JetBrains Marketplace: `./gradlew publishPlugin`
