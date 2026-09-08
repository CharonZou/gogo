# RocheFlow

> 用AI帮你干活的工作平台

记待办、派任务、跑工作流，也可以养「智能体员工」帮你执行。跟AI说说你要做什么，它就能在对应模块里帮你创建和管理。

## 功能模块

| 模块 | 干什么 |
|---|---|
| **任务中心 / 我的事项** | 记待办、看协作进度、把事派给员工 |
| **工作流** | 把多步骤工作串起来，让系统按流程自动跑 |
| **智能体 / 智能体员工** | 你的AI同事：负责回答、执行、日常上班 |
| **知识库** | 存资料、文档，让AI按你的材料来回答 |
| **自动化** | 到点或满足条件就自动触发，不用人天天盯 |
| **扩展应用** | 接入更多外部工具，扩展平台能力 |

## 怎么创建这些内容

打开**小秘书小R**（或使用超级助手），用平常说话的方式告诉它，例如：

- 「帮我记一条待办」
- 「雇佣一个智能体员工」

它会帮你创建好；你再到对应页面里查看结果即可。各个功能还不熟悉也没关系：记待办、派任务、搭工作流、雇员工等，都可以直接跟小秘书小R说，页面用来看进度和结果。

## 技术架构

RocheFlow 底层是**无头（headless）智能体引擎**：独立运行时，可被任意客户端（CLI / IM 网关 / 自定义前端）通过本地 RPC 集成，对标 DeerFlow 2.0 与 EvoFlow（编排 / 沙箱 / 记忆 / 技能 / MCP / 调度）。

### 规划能力

- **编排**：Plan → Execute → Verify、计划 DAG、子智能体按需生成
- **执行**：沙箱（本地 / Docker / K8s）、工具执行器、浏览器自动化
- **记忆与上下文**：跨会话记忆、资产、上下文按需加载
- **能力**：技能体系、MCP（stdio / SSE / HTTP）、知识库 RAG
- **治理**：任务中心、定时 / 值班、审批护栏、IM 网关

### 技术栈

Python 3.12 + uv · FastAPI / WebSocket · asyncio + networkx · SQLite（aiosqlite / sqlite-vec）· docker-py · Playwright · 官方 MCP SDK

## 状态

开发中（WIP）。

## 快速开始

```bash
# 安装依赖（Python 3.12+，uv 自动管理虚拟环境）
uv sync

# 配置（复制并填入 LLM_API_KEY，规划必需）
cp .env.example .env

# 启动引擎（本地 RPC，默认 127.0.0.1:8031）
uv run uvicorn backend.main:app --reload

# 运行测试
uv run pytest
```

**Plan → Execute → Verify 闭环**（默认端口 8031）：

```bash
curl -X POST localhost:8031/api/v1/tasks -H "Content-Type: application/json" -d '{"goal":"调研 DeepSeek 并输出周报"}'
# → {"task_id":"...","status":"PENDING"}

curl -X POST localhost:8031/api/v1/tasks/<task_id>/plan     # LLM 拆解为子任务 DAG → PLANNED
curl -X POST localhost:8031/api/v1/tasks/<task_id>/approve  # 授权 → 后台执行
curl localhost:8031/api/v1/tasks/<task_id>                  # 状态 + 子任务明细
```

> 浏览器自动化能力需额外执行 `uv run playwright install`（按需启用）。

## 目录结构

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

详细设计见 [ARCHITECTURE.md](ARCHITECTURE.md) · [API 与数据结构设计草稿](docs/api-design.md)。
