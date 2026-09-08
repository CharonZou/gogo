# RocheFlow 路线图（P0–P3）

> 优先级路线，按依赖顺序推进；每个 P 出口标准达成后进入下一个。

## P0 — 收尾 · 真实闭环可用

| # | 内容 | 状态 |
|---|---|---|
| 0.1 | 编排闭环 Plan→Execute→Verify（编排 / 沙箱 / 工具 / 记忆） | ✅ 已上线（18 测试全绿） |
| 0.2 | 真实 LLM 端到端验证（配好 LLM_API_KEY 后跑通一条任务） | ⏳ 待验证 |
| 0.3 | 服务冒烟 + 仓库文档整理 | ✅ 已做 |

**出口标准**：真实 LLM 下 curl 闭环全绿 → 0.1 版可交付。

## P1 — 核心模块 MVP（说一句话能建东西）

| # | 内容 | 关键产出 |
|---|---|---|
| 1.1 | 任务中心扩展 | `tasks` 表加 kind/title/due_at/priority/assignee_id/done_at；PATCH /assign /complete API | ✅ 665fef2 |
| 1.2 | 智能体员工 | `agents` 表 + 雇佣 / 上下班 / chat API | ✅ 665fef2 |
| 1.3 | 小秘书意图路由 | `assistant/message`：LLM 分类意图 → 建任务 / 雇员工（先覆盖 2 种意图） | ✅ 9866dcc |
| 1.4 | 工作流模板 | `workflows` 表 + steps_json + /{id}/run 实例化（复用 planner 结构） | ✅ b007df7 |
| 1.5 | 编排内核切 LangGraph（v0.5.0） | StateGraph 执行图 + checkpointer 断点续跑；周边保留自研，门面不变 | ✅ 待推 |

**出口标准**：每个 API 有测试；对小秘书说「帮我记一条待办」能真的建出任务。

## P2 — 知识库与自动化

| # | 内容 | 关键产出 |
|---|---|---|
| 2.1 | 知识库 | kb_docs / kb_chunks + 导入 + LIKE 检索 → sqlite-vec 向量 | ✅ 4d9a0d7 |
| 2.2 | 自动化调度 | automations 表 + cron 落库 + 手动 trigger | ✅ 1708990 |
| 2.3 | 扩展应用 | apps 表 + MCP / 技能注册 + 工具白名单挂到员工 | ✅ 5c0e68d |

**出口标准**：员工回答前先检索知识库；cron 到点自动触发工作流。

## P3 — 产品化与值班生态

| # | 内容 | 关键产出 |
|---|---|---|
| 3.1 | 值班闭环 | 员工按 schedule 上班 → 自动接任务 → 工作汇报（kind=report）进任务中心 |
| 3.2 | 实时与页面 | WebSocket 流式输出（LangGraph astream）；任务中心管理 API；时间旅行 / interrupt（approve 门改图内 human-in-the-loop） |
| 3.3 | 前端（对标 EvoPanel） | 任务中心 / 工作流画布 / 员工管理 / 知识库 / 自动化 / 应用市场 |
| 3.4 | 多用户与权限 | 账号隔离、审批护栏 |

**出口标准**：在页面上完成「雇员工 → 派活 → 看结果」。

## 建议起点

P1 的 1.1 + 1.2（任务中心扩展 + 雇佣员工），随后 1.3 小秘书把它们串起来——先跑通「雇员工、记待办」，再上工作流与知识库。
