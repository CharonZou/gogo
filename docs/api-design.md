# RocheFlow API 与数据结构设计（草稿）

> 产品模块 ↔ 引擎 API ↔ 存储 的映射设计。
> 统一入口：**小秘书小R**（或超级助手）——自然语言 → 意图路由 → 调对应模块 API → 创建完成。

```
小秘书小R / 超级助手（自然语言入口）
   └─ 意图路由（LLM 分类 + 参数抽取）
        ├─ 记待办      → 任务中心
        ├─ 派任务      → 任务中心 + 智能体员工
        ├─ 搭工作流    → 工作流
        ├─ 雇员工      → 智能体员工
        ├─ 存资料      → 知识库
        └─ 设自动化    → 自动化
```

---

## 0. 统一入口（小秘书小R）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/assistant/message` | 自然语言指令 → 解析意图 → 创建对应模块内容 → 返回回执（含页面位置） |

- 意图类型：`create_todo` / `assign_task` / `hire_agent` / `build_workflow` / `ingest_knowledge` / `create_automation` / `run_task`
- 示例：「帮我记一条待办」→ 创建 task（kind=todo）；「雇佣一个智能体员工，负责周报」→ 创建 agent
- 设计：意图解析用 LLM（复用 `llm/` 网关），产出结构化参数后走各模块 API；参数不全时反问澄清

---

## 1. 任务中心 / 我的事项

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/tasks` | 创建待办 / 任务 |
| GET | `/api/v1/tasks` | 列表（过滤：status / assignee / due） |
| GET | `/api/v1/tasks/{id}` | 详情 + 子任务明细（已有） |
| PATCH | `/api/v1/tasks/{id}` | 修改标题 / 截止 / 优先级 |
| POST | `/api/v1/tasks/{id}/plan` | LLM 规划子任务 DAG（已有） |
| POST | `/api/v1/tasks/{id}/approve` | 授权执行（已有） |
| POST | `/api/v1/tasks/{id}/assign` | 派给智能体员工 |
| POST | `/api/v1/tasks/{id}/complete` | 标记完成 |

**表 `tasks`**（在现有基础上扩展）：

| 列 | 说明 |
|---|---|
| id / goal / source / status / plan_json / created_at / updated_at | 现有字段 |
| kind | `todo`（我的事项）/ `task`（多步任务）/ `report`（员工汇报） |
| title | 待办标题（todo 场景用） |
| due_at | 截止时间 |
| priority | `low` / `medium` / `high` |
| assignee_id | 派给的智能体员工 id |
| done_at | 完成时间 |

---

## 2. 工作流

概念：**工作流 = 可复用的 DAG 模板**（步骤 + 依赖 + 工具）；运行一次 = 实例化成一个任务。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/workflows` | 创建工作流模板 |
| GET | `/api/v1/workflows` | 模板列表 |
| GET | `/api/v1/workflows/{id}` | 模板详情（步骤 DAG 可视化数据） |
| PATCH | `/api/v1/workflows/{id}` | 编辑步骤 |
| POST | `/api/v1/workflows/{id}/run` | 实例化 → 生成 task 并直接 PLANNED |

**表 `workflows`**：

| 列 | 说明 |
|---|---|
| id / name / description | 基本信息 |
| steps_json | 步骤 DAG（复用 planner 的 tasks 结构：title/description/depends_on/tool） |
| version | 模板版本 |
| created_at / updated_at | 时间 |

运行实例：复用 `tasks`（task 增加 `workflow_id` 来源标记），`plan_json` 由模板步骤填充，不走 LLM 重规划。

---

## 3. 智能体 / 智能体员工

概念：配置化的 AI 同事——SOUL 人设 / 模型 / 工具白名单 / 上班时间；负责回答、执行、日常值班。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/agents` | 雇佣（创建智能体员工） |
| GET | `/api/v1/agents` | 员工列表 |
| GET | `/api/v1/agents/{id}` | 员工详情 |
| PATCH | `/api/v1/agents/{id}` | 修改配置（人设 / 模型 / 工具） |
| POST | `/api/v1/agents/{id}/activate` | 上班（on_duty） |
| POST | `/api/v1/agents/{id}/deactivate` | 下班（off_duty） |
| POST | `/api/v1/agents/{id}/chat` | 直接对话（员工回答） |

**表 `agents`**：

| 列 | 说明 |
|---|---|
| id / name / role | 姓名 / 岗位（如：周报专员） |
| soul | SOUL 人设（prompt 种子） |
| model | 使用的模型 |
| tool_whitelist | 工具白名单（JSON 数组，对应扩展应用/内置工具） |
| schedule_json | 上班时间（值班调度配置） |
| status | `on_duty` / `off_duty` |
| created_at / updated_at | 时间 |

---

## 4. 知识库

概念：存资料、文档 → 切块 → 向量化 → RAG 检索，让 AI 按你的材料回答。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/knowledge/docs` | 上传 / 导入文档（路径或 URL） |
| GET | `/api/v1/knowledge/docs` | 文档列表 |
| GET | `/api/v1/knowledge/docs/{id}` | 详情（分块 / 索引状态） |
| DELETE | `/api/v1/knowledge/docs/{id}` | 删除文档及分块 |
| POST | `/api/v1/knowledge/search` | 检索（query, top_k）→ 命中分块 + 来源 |

**表 `kb_docs`** / **表 `kb_chunks`**：

| kb_docs | 说明 | kb_chunks | 说明 |
|---|---|---|---|
| id / name | 文档标识 | id / doc_id | 分块归属 |
| source | 路径 / URL | position | 块序号 |
| status | `parsing` / `ready` / `failed` | content | 块内容 |
| chunk_count | 分块数 | embedding | 向量（sqlite-vec，Phase 3） |

过渡方案：Phase 3 前检索用 SQLite LIKE 全文匹配；向量能力（sqlite-vec）接入后替换为语义检索。

---

## 5. 自动化

概念：触发器（定时 / 条件）→ 动作（跑任务 / 员工值班 / 跑工作流），到点自动触发。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/automations` | 创建自动化 |
| GET | `/api/v1/automations` | 列表（含下次触发时间） |
| PATCH | `/api/v1/automations/{id}` | 启停 / 改配置 |
| POST | `/api/v1/automations/{id}/trigger` | 手动触发（测试用） |

**表 `automations`**：

| 列 | 说明 |
|---|---|
| id / name | 基本信息 |
| trigger_type | `cron`（定时）/ `event`（条件触发） |
| trigger_config | JSON：cron 表达式 或 事件条件 |
| action_type | `task`（创建任务）/ `workflow`（跑工作流）/ `agent`（员工值班） |
| action_config | JSON：动作参数 |
| enabled | 是否启用 |
| last_run_at / next_run_at | 运行时间 |

---

## 6. 扩展应用

概念：接入外部工具，扩展平台能力（MCP server / 技能包 / 内置工具），白名单加载。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/apps` | 注册扩展（kind：`mcp` / `skill` / `tool`） |
| GET | `/api/v1/apps` | 应用列表 |
| GET | `/api/v1/apps/{id}/tools` | 该应用提供的工具 |
| PATCH | `/api/v1/apps/{id}` | 启用 / 停用 |
| DELETE | `/api/v1/apps/{id}` | 卸载 |

**表 `apps`**：

| 列 | 说明 |
|---|---|
| id / name / kind | 标识 / 名称 / 类型（mcp、skill、tool） |
| config_json | 连接配置（MCP transport / endpoint / 技能目录根） |
| enabled | 是否启用 |
| tools_json | 工具清单缓存（供 Agent 白名单勾选） |
| created_at | 时间 |

---

## 跨模块联动（典型场景）

1. **雇佣员工 + 值班自动化**：`agents.create`（on_duty）→ 自动化 cron 到点唤醒 → 员工跑任务 → 工作汇报写入任务中心（kind=report）
2. **工作流 + 自动化**：周五 17:00 自动化触发 `workflows.run`（周报生成模板）→ 实例化任务执行 → 结果进任务中心
3. **知识库 + 员工对话**：员工 `chat` 时先 `knowledge.search` 注入材料 → 按你的资料回答
4. **扩展应用 + 员工**：注册 MCP 应用 → 在员工工具白名单勾选 → 执行时可用

## 实现顺序建议

- **Phase 2.5（下一步）**：任务中心扩展（PATCH / assign / complete）+ `agents` 表与雇佣 API
- **Phase 3**：工作流模板（复用 planner 结构）+ 知识库（先 LIKE 检索，后向量）
- **Phase 4**：自动化调度（cron 落库）+ 扩展应用 / MCP 注册 + 小秘书意图路由
