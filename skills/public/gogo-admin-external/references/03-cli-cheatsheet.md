# gogo CLI 全量速查

全局：`gogo [--config path] <组> <子命令> …`  
默认 pretty JSON；脚本加 `--compact`。写 JSON：**`--file <路径>` 或 `--stdin`**（禁止把 JSON 字符串塞进 `--file`）。  
**参数以 `gogo <组> <子命令> -h` 为准。** 选组先读 [`00-concept-routing.md`](00-concept-routing.md)。

顶层组（20）：`models` `skills` `agents` `employees` `org` `approvals` `mcp` `memory` `assets` `experience` `knowledge` `automation` `profile` `sessions` `tasks` `workflow` `items` `workspace` `eval` `logs`

---

## 1. models — 模型

```bash
gogo models list
gogo models get <name>
gogo models primary get
gogo models primary set <name>
gogo models create --file examples/model-create.json
gogo models update <name> --file examples/model-update.json
gogo models delete <name>
gogo models test --file examples/model-test.json
gogo models invoke --file examples/model-invoke.json
gogo models list-remote --file examples/model-list-remote.json
```

`create` 必填：`name` `model` `base_url`；常用：`api_key` `vendor` `display_name` `supports_vision` `max_tokens` `context_length`。

---

## 2. skills — 技能包

```bash
gogo skills list [--enabled-only]
gogo skills get <name>
gogo skills enable <name>
gogo skills disable <name>
gogo skills install <path.zip>          # 推荐 .zip
gogo skills install-market <slug>       # SkillHub
gogo skills delete <name>               # 仅 custom
```

---

## 3. agents — 智能体角色（≠ employees）

```bash
gogo agents list [--tag 标签]
gogo agents get <code>                  # 主控常用 main
gogo agents check <code>
gogo agents create --file examples/agent-create.json
gogo agents update <code> --file examples/agent-update.json
gogo agents delete <code> [--keep-employee]
```

**无** `agents seed`。字段：`agent_code` `agent_name` `description` `soul` `system_prompt` `tools` `skills` `mcp_servers` `agent_type` `tags`。

---

## 4. employees — 智能体员工 / 值班岗位

先有 `agents`，再 `hire`。观察：[`employees-observe.md`](employees-observe.md)。

```bash
gogo employees list [--status active|paused|archived|draft] [--include-archived]
gogo employees get <agent_code> [--recent N]
gogo employees hire --file examples/employees-hire.json
gogo employees update <agent_code> --file examples/employees-update.json
gogo employees pause|resume|stop|archive <agent_code>
# stop=停在途；pause=停巡检；archive=离岗名册
gogo employees worklog <agent_code> [--day YYYY-MM-DD] [--limit N]
gogo employees trail <agent_code> [--round-id id] [--max-steps N]
gogo employees dispatch <agent_code> --goal "…" [--description …] [--priority normal|high|low] [--task-id …] [--round-id …] [--force-new]
gogo employees wake <code_or_role_name> [--goal …] [--from <code>] [--task-id …]
gogo employees migrate [--agent-code …] [--dry-run]
```

`dispatch` / `wake` **需 Gateway**。

---

## 5. items — 个人事项 / 备忘（≠ tasks）

```bash
gogo items list [-q …] [--status todo|in_progress|waiting|done|parked] [--priority …] [--tag …] [--exclude-done] [--page N]
gogo items get <item_id>
gogo items create --file examples/item-create.json
gogo items update <item_id> --file examples/item-update.json
gogo items delete <item_id>
gogo items dispatch <item_id> --agent <agent_code> [--goal …] [--no-wake] [--force] [--interrupt]
```

`create` 必填 `title`。

---

## 6. tasks — 协作任务台账（任务中心）

```bash
gogo tasks list [--status …] [--assignee code|--role 岗位名] [--source chat|workflow|role] [--main-task-id …] [--subtasks-only] [--limit N] [--offset N]
gogo tasks get <task_id> [--subtask-id …]
gogo tasks create --name "…" [--description …] [--assignee code] [--role 岗位名] [--main-task-id …] [--status pending] [--source …] [--raised-by user|code] [--source-ref …] [--risk-level low|medium|high|critical] [--action-type …] [--round-id …]
gogo tasks progress <task_id> --progress 0..100 [--status …] [--subtask-id …]
gogo tasks state <task_id> --status completed|failed|cancelled|… [--summary "必填于 completed"] [--outputs '[{…}]'] [--handlers '[{…}]'] [--subtask-id …]
gogo tasks delete <task_id> --yes
gogo tasks cleanup-noise [--apply] [--limit N]
gogo tasks reclaim-zombies [--apply] [--executing-stale-days 3] [--awaiting-stale-days 3] [--limit N]
```

结案：`state --status completed --summary "…"`。轨迹：platform `tasks.execution_trail`。

---

## 7. approvals — 审批

```bash
gogo approvals list [--status pending|approved|rejected|timeout|all] [--limit N]
gogo approvals request <task_id> [--note …] [--risk-level …]
gogo approvals approve <id> [--comment …] [--by cli]
gogo approvals reject <id> --reason "必须" [--comment …] [--by cli]
```

`approve` 执行需 Gateway。

---

## 8. workflow — Apps 运行

```bash
gogo workflow list [--status …] [--search …]
gogo workflow get <App_id>
gogo workflow run <App_id> [--file examples/workflow-run-params.json]
gogo workflow status <run_id>
gogo workflow stop <run_id> [--pause] [--reason …]
```

**无** create/publish/resume CLI → [`04-http-platform.md`](04-http-platform.md) `workflow.*` 或 `/api/apps`。

---

## 9. automation — 定时

```bash
gogo automation list
gogo automation get <id>
gogo automation history <id> [--limit N]
gogo automation create --file examples/automation-daily-cron.json
gogo automation create --file examples/automation-once.json
gogo automation update <id> --file examples/automation-update.json
gogo automation pause|resume|delete <id>
```

必填：`name` + `prompt`；周期用 `cron_expr`/`schedule`；once 要 `schedule_type=once` + `scheduled_at`。

---

## 10. org — 组织 / 资源包

```bash
gogo org preflight <path> [--zip] [--workspace …] [--id-prefix …]
gogo org install <path> [--zip] [--workspace …] [--id-prefix …] [--conflict fail|skip|replace]
gogo org list [--status active|uninstalled|all]
gogo org get <org_instance_id>
gogo org uninstall <id> [--keep-primitives] [--delete-workspace]
gogo org export --employees a,b --apps App_x -o ./out [--zip] [--id …] [--name …] [--version …]
gogo org market catalog
gogo org market install packs/foo [--repo owner/repo@branch]
```

---

## 11. assets — Entity Asset Hub

```bash
gogo assets init
gogo assets migrate [--dry-run] [--only …]
gogo assets export [-o path.gogo-pack]
gogo assets import <pack.gogo-pack>
```

---

## 12. mcp — MCP 服务器

```bash
gogo mcp list
gogo mcp get <name>
gogo mcp show
gogo mcp add <name> --url https://…/mcp
gogo mcp add <name> -- npx -y @modelcontextprotocol/server-filesystem /path
gogo mcp remove <name>
gogo mcp test [name]
gogo mcp login|logout <name>
gogo mcp set --file examples/mcp-set.json
```

---

## 13. memory — Agent 长期记忆

```bash
gogo memory show [--agent main]
gogo memory status
gogo memory reload
gogo memory clear [--agent …]
gogo memory agents
gogo memory facts delete <fact_id> [--agent …]
```

---

## 14. knowledge — 平台自有知识库（Obsidian Vault 遗留）

```bash
gogo knowledge create --name "库名" [--description …] [--embedding-model-ref …]
gogo knowledge create --name "库名" --legacy-vault [--path …] [--access-mode read_write|read_only] [--disabled]
gogo knowledge vaults
gogo knowledge enable|disable <vaultId>   # 仅遗留 Vault
gogo knowledge list [--vault kb_…] [--prefix guides/] [--limit N]
gogo knowledge get <path|docId> [--vault kb_…]
gogo knowledge remember --file examples/knowledge-remember.json [--vault kb_…]
gogo knowledge recall "关键词" [--vault kb_…] [--mode hybrid|semantic|keyword|title] [--limit N]
gogo knowledge delete <path> [--vault kb_…]
```

---

## 15. experience — 经验库

```bash
gogo experience list [--query …] [--category …] [--limit N]
gogo experience get <id>
gogo experience save --file examples/experience-save.json
gogo experience update <id> --file examples/experience-update.json
gogo experience mark-used <id>
gogo experience delete <id>
```

---

## 16. 用户画像 — 资产中心

SoT：`~/.gogo/assets/user/profile/basic-info.md` · `preferences.md` · `persona.md`

- 面板：`#/assets` → 画像
- 对话：`assets(action=profile, path=preferences, content=喜欢简洁回复)`
- 管理 API：`assets.get_profile` / `assets.update_profile`

```bash
gogo assets init
gogo assets export --type user --id user -o ./user-hub.gogo-pack
```

---

## 17. sessions — 历史会话检索

```bash
gogo sessions search --query "…" [-q …] [--titles] [--limit 5] [--max-age-days 90]
```

`--max-age-days 0` ≈ 不限时间。

---

## 18. workspace memory — 工作区记忆

```bash
gogo workspace memory show <workspace_root>
gogo workspace memory status <path>
gogo workspace memory clear <path>
gogo workspace memory bootstrap <path> [--model NAME] [--force]
gogo workspace memory prune <path> [--dry-run]
gogo workspace memory seed <path> [--force]
```

---

## 19. eval — 评测中心

```bash
gogo eval run --mode smoke|scenario|full [--name …] [--days 7] [--async]
gogo eval cases [--category scenario|business|security|performance]
gogo eval runs
gogo eval show <run_id>
```

HTTP：`POST /api/eval/run`。

---

## 20. logs — 诊断日志

```bash
gogo logs sources [--hours 72]
gogo logs scan [--hours 24] [-s gateway] [-s frontend] [--limit N]
gogo logs timeline [--hours 24] [-s gateway] [--format markdown|json]
```

等价 platform：`diagnostics.sources|scan|timeline`；综合诊断仅 platform：`diagnostics.run`。

---

## Gateway 依赖

| 需要 Gateway | 通常不需要 |
|--------------|------------|
| `employees dispatch/wake`、`approvals approve` 执行、`workflow run`、多数 automation 触发 | agents/items/skills/org CRUD、hire/update、list/get、experience、knowledge 本地读写 |

示例文件索引：[`../examples/README.md`](../examples/README.md)。
