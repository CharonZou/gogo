# RocheFlow

> 用AI帮你干活的工作平台

智能体引擎（Agent Engine），独立产品。对标 DeerFlow 2.0 与 EvoFlow：编排 / 沙箱 / 记忆 / 技能 / MCP / 调度。无头（headless）运行时，可被 Roche 或其他客户端通过本地 RPC 集成。

## 规划能力

- **编排**：Plan → Execute → Verify、计划 DAG、子智能体按需生成
- **执行**：沙箱（本地 / Docker / K8s）、工具执行器、浏览器自动化
- **记忆与上下文**：跨会话记忆、资产、上下文按需加载
- **能力**：技能体系、MCP（stdio / SSE / HTTP）、知识库 RAG
- **治理**：任务中心、定时 / 值班、审批护栏、IM 网关

## 技术栈

Python 3.12 + uv · FastAPI / WebSocket · asyncio + networkx · SQLite（aiosqlite / sqlite-vec）· docker-py · Playwright · 官方 MCP SDK

## 状态

开发中（WIP）。
