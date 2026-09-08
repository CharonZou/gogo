# RocheFlow 架构

> 无头（headless）智能体引擎（Agent Engine）· 独立产品
> 对标 DeerFlow 2.0 与 EvoFlow（evovexai.com）：编排 / 沙箱 / 记忆 / 技能 / MCP / 调度

## 1. 定位与边界

- **RocheFlow 是引擎，不是壳**：无 UI，通过本地 RPC 被任意客户端集成（CLI / IM 网关 / 自定义前端）。
- 核心循环：**Plan → Execute → Verify**，任务全流程可看、可干预、可恢复、可验收。
- 竞品对照：DeerFlow 2.0（运行时底座参考）、EvoFlow（产品规格参考：Plan DAG、任务中心、智能体员工、应用中心、护栏）。

## 2. 总体架构

```
┌────────────────────────────────────────────────────────────┐
│ 客户端（外部）                                             │
│   CLI / IM 网关（飞书等） / 自定义前端                      │
└───────────────────────┬────────────────────────────────────┘
                        │ 本地 RPC
        FastAPI HTTP + WebSocket · 流式输出 · OpenAI 兼容 API
┌───────────────────────▼────────────────────────────────────┐
│ ① RPC 层   FastAPI / WebSocket · 任务中心 API · 流式输出    │
├────────────────────────────────────────────────────────────┤
│ ② 编排层   Plan→Execute→Verify 状态机 · 计划 DAG(networkx) │
│            Supervisor 澄清意图 · 子智能体按需生成 / 并行     │
├────────────────────────────────────────────────────────────┤
│ ③ 执行层   沙箱(本地/Docker/K8s) · 工具执行器               │
│            浏览器自动化(Playwright) · 上下文按需加载        │
├────────────────────────────────────────────────────────────┤
│ ④ 能力层   技能体系(SKILL.md 渐进暴露) · MCP(stdio/SSE/HTTP)│
│            知识库 RAG(文档 / Obsidian Vault)                │
├────────────────────────────────────────────────────────────┤
│ ⑤ 记忆层   跨会话记忆 · 资产中心(画像/记忆/经验/反思/专长)  │
├────────────────────────────────────────────────────────────┤
│ ⑥ 治理层   任务中心 · 定时/值班调度 · 审批护栏 · 审计        │
├────────────────────────────────────────────────────────────┤
│ ⑦ 存储层   SQLite(aiosqlite) · sqlite-vec 向量 · 文件资产   │
└────────────────────────────────────────────────────────────┘
```

## 3. 核心模块

### 3.1 编排（Orchestration）—— 核心

- **状态机**：`PENDING → PLANNED → APPROVED → RUNNING → VERIFYING → DONE / FAILED`，非法迁移直接拒绝。
- **计划 DAG**：networkx `DiGraph`，上游完成解锁下游，支持分支与汇合点，可序列化、可持久化。
- **Supervisor**：澄清意图 → 拆子任务 DAG → 授权后执行 → 验收，全程可追溯。
- **子智能体**：按需生成，并行执行，隔离上下文，结构化结果回传汇总。

### 3.2 执行（Execution）

- **沙箱抽象**：`Sandbox` 接口，实现 Local / Docker / K8s 三种模式，同一套代码可切换。
- **工具执行器**：注册式工具（WebSearch / CodeRunner / Browser / Mail / Office…），统一注册、鉴权、审计。
- **浏览器自动化**：Playwright，负责网页交互与抓取类工具。

### 3.3 记忆与上下文

- 跨会话记忆：SQLite 存储 + sqlite-vec 向量检索。
- 资产中心：画像 / 记忆 / 经验 / 反思 / 专长，一句话沉淀、可复用。
- 上下文按需加载：长任务只注入当前步骤所需内容，避免上下文膨胀。

### 3.4 能力（Capability）

- **技能（Skills）**：SKILL.md 目录制，渐进暴露，按场景收敛上下文。
- **MCP**：官方 Python SDK，stdio / SSE / HTTP 三种传输，工具审批与热更新。
- **RAG**：文档 / Obsidian Vault → 向量库，Agent 先检索再作答，口径可追溯。

### 3.5 治理（Governance）

- **任务中心**：跨来源看板，暂停 / 恢复 / 重试 / 诊断条，任务总结可验收。
- **调度**：定时自动化（固定 Prompt 到点跑）+ 智能体员工（值班 / 审批 / 工作汇报）。
- **护栏**：PlanGuard 拦截副作用工具、工具审批、策略评估、沙箱隔离与命令管控。

## 4. 技术栈

| 模块 | 选型 |
|---|---|
| 语言 / 运行时 | Python 3.12+ · uv |
| RPC 层 | FastAPI / Uvicorn · WebSocket |
| 编排 | asyncio 自研状态机 · networkx（计划 DAG） |
| 存储 | SQLite（aiosqlite）· sqlite-vec（向量） |
| 沙箱 | docker-py / subprocess（本地）· K8s（预留） |
| 浏览器自动化 | Playwright |
| 模型网关 | httpx（默认 DeepSeek，可换 OpenAI 兼容任意模型） |
| MCP | 官方 mcp SDK |
| 办公库（Work 能力） | python-pptx / openpyxl / python-docx / reportlab / pandas |

## 5. 目录结构

```
backend/
├── main.py              # FastAPI 入口（HTTP + WebSocket 本地 RPC）
├── core/                # 配置 / schema
├── orchestration/       # Plan→Execute→Verify 状态机 + networkx 计划 DAG + Supervisor
├── sandbox/             # 沙箱抽象（本地 / Docker / K8s）
├── tools/               # 工具执行器
├── memory/              # 跨会话记忆 / 资产
├── skills/              # 技能体系（SKILL.md 渐进加载）
├── mcp/                 # MCP 客户端（stdio / SSE / HTTP）
└── scheduler/           # 定时 / 值班调度
```

## 6. 与 DeerFlow 2.0 / EvoFlow 对照

| 能力 | DeerFlow 2.0 | EvoFlow（evovexai.com） | RocheFlow |
|---|---|---|---|
| 运行时形态 | LangGraph Harness | 桌面端 + 内嵌 LangGraph 运行时 | **无头引擎（本地 RPC）** |
| 编排 | Lead Agent + Middleware 链 | Supervisor → Plan DAG → 授权执行（LangGraph） | Supervisor → 状态机 + networkx DAG |
| 沙箱 | Local / Docker / K8s | Local / Docker / K8s | Local / Docker / K8s |
| 记忆 | memory.json 事实 | 资产中心 | SQLite + sqlite-vec 资产中心 |
| 技能 | SKILL.md 渐进加载 | 技能市场 | SKILL.md 渐进加载 |
| MCP | ✓ | stdio / SSE / HTTP | 官方 SDK |
| 调度 | — | 自动化 + 智能体员工 | 定时 / 值班调度 |
| 护栏 | 沙箱隔离 | PlanGuard / 工具审批 | 审批护栏 / 副作用拦截 |

## 7. 开发路线

- **Phase 1 ✅**：RPC 层 + 编排状态机接口桩 + 工具执行器骨架。
- **Phase 2（进行中）**：Plan DAG 落库（aiosqlite）✅ · Supervisor 真实 LLM 规划（DeepSeek/OpenAI 兼容）✅ · DAG 执行引擎（拓扑推进/并行/重试）✅ · 本地沙箱 + 默认工具（bash/读写文件）✅ · 记忆存储（LIKE 检索）✅；待办：向量检索（sqlite-vec）、WebSocket 流式输出、任务中心管理 API。
- **Phase 3**：技能体系 / MCP / RAG · 上下文摘要压缩（长任务防失焦）· 文件上传注入 · 任务级工作目录（workspace/uploads/outputs）。
- **Phase 4**：调度值班、IM 网关、应用中心（工作流沉淀为可复用应用）· 断点续跑与中断工具调用修补。

## 8. 设计决策记录（ADR）

- **2026-09-08 · 自研状态机而非 LangGraph（ADR-001，复审见 ADR-004）**：无头引擎需要最小依赖与完全可控的本地 RPC 面；编排核心逻辑简单直接，避免框架抽象带来不可控的黑盒行为。
- **2026-09-08 · networkx 做计划 DAG**：天然支持有向图分析、序列化与可视化，计划图即数据。
- **2026-09-08 · SQLite 本地优先**：单机产品默认零部署依赖，aiosqlite 异步访问，sqlite-vec 提供向量能力；多用户场景再迁移 PostgreSQL + 独立向量库。
- **2026-09-08 · ADR-004 · LangGraph 运行时 vs 自研状态机（EvoFlow 实测情报复审）**

  情报：调研 EvoFlow（evovexai.com）官方仓库 README，其 Native Agent Runtime 本身即基于 **LangGraph** 构建（LangGraph Server :2024 + Lead Agent + 10 层 Middleware 链）——即参考对象实际采用了 ADR-001 中我们放弃的方案。

  | 维度 | LangGraph（EvoFlow 所用） | 自研 asyncio 状态机 + networkx（当前决策） |
  |---|---|---|
  | 中间件链 | 10 层链现成（Sandbox / Summarization / PlanGuard / Memory…） | 自建，逐步补 |
  | 断点续跑 | 内置 checkpoint，持久化现成 | 自建（SQLite 落库） |
  | 并发 / 分支 | 图原生支持 | asyncio + networkx 自实现 |
  | 依赖 | 引入 LangGraph / LangChain 框架栈 | 最小依赖（仅 networkx） |
  | 可控性 | 框架黑盒行为需熟悉 | 完全可控、可单测 |
  | 计划 DAG | 图结构表达 | networkx 原生（两者可共存） |

  **结论**：维持 ADR-001 的自研决策（无头引擎以最小依赖、可控 RPC 面优先），标记为**待复审**——若 Phase 2 实现断点续跑 / 中间件链时成本超预期，切换 LangGraph 的成本仍可控（计划 DAG 与 networkx 兼容，Supervisor 接口可保留）。

- **2026-09-08 · ADR-005 · DeerFlow 2.0 中间件链 / 子智能体设计对照与借鉴**

  情报：核验字节 DeerFlow 2.0（2026-02 开源，MIT，基于 LangGraph + LangChain 彻底重写，与 v1 无共用代码）。官方定位 **Super Agent Harness**；核心骨架 = Lead Agent + 中间件链 + ThreadState。中间件实测清单：ThreadData（线程目录）→ Uploads（上传注入）→ Sandbox（沙箱分配）→ DanglingToolCall（修补中断的工具调用）→ Summarization（上下文摘要压缩）→ TodoList（计划模式）→ Title（自动标题）→ Memory…；子智能体**按需生成并行执行（≤3）**；沙箱虚拟路径 `/mnt/user-data/`；SKILL.md 技能 + MCP 网关。官方案例：同一对话跨数十轮完成「调研 → 科普图 → PPT → 视频」不丢目标，关键能力即 Summarization 摘要压缩与 TodoList。

  | DeerFlow 2.0 中间件 | RocheFlow 现状 | 判断 |
  |---|---|---|
  | ThreadData 线程目录（workspace/uploads/outputs） | 本地沙箱 root + 路径越界校验 | **采纳**：任务级自动建 workspace/uploads/outputs 子目录 |
  | Uploads 上传注入 | 无 | 采纳（随 P2 文件上传 / 知识库） |
  | Sandbox 沙箱分配 | LocalSandbox ✅（30s 超时 / 越界拦截） | 已有；待补 Docker / K8s |
  | DanglingToolCall 中断修补 | 无 | 暂缓（随 P3 断点续跑一起做） |
  | Summarization 上下文摘要压缩 | 无（facts 仅 LIKE 检索） | **采纳**（P2 记忆增强，直接治"半途而废"） |
  | TodoList 计划模式 | planner + subtasks 表 ✅ | 已等价，无需引入 |
  | Title 自动标题 | 无 | 低优先，可后补 |
  | Memory 记忆 | facts 表 ✅（待向量） | 已有雏形，P2 继续 |
  | 子智能体 ≤3 并行 | executor max_concurrency=2 | 对齐为 ≤3（settings） |

  **决策**：
  1. **近期采纳**——任务级工作目录三件套（workspace/uploads/outputs）；并行上限对齐 3。
  2. **排期采纳（P2/P3）**——上下文摘要压缩（长任务防失焦）；文件上传注入；断点续跑 + 中断工具调用修补。
  3. **维持不采纳**——LangGraph 框架本身（ADR-001/004 复审结论不变：中间件是**模式**不是框架，可在自研状态机上逐个落地）。
