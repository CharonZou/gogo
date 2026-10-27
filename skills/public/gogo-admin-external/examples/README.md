# examples/ — 全量样例索引

路径相对本包根：`examples/<file>`。  
用法：`gogo <cmd> --file examples/<file>`（或先复制到 `outputs/`）。

## 输入样例（给 --file）

| 文件 | 命令 |
|------|------|
| [`model-create.json`](model-create.json) | `models create` |
| [`model-update.json`](model-update.json) | `models update <name>` |
| [`model-test.json`](model-test.json) | `models test` |
| [`model-invoke.json`](model-invoke.json) | `models invoke` |
| [`model-list-remote.json`](model-list-remote.json) | `models list-remote` |
| [`agent-create.json`](agent-create.json) | `agents create` |
| [`agent-update.json`](agent-update.json) | `agents update` |
| [`employees-hire.json`](employees-hire.json) | `employees hire` |
| [`employees-update.json`](employees-update.json) | `employees update` |
| [`item-create.json`](item-create.json) | `items create` |
| [`item-update.json`](item-update.json) | `items update` |
| [`workflow-run-params.json`](workflow-run-params.json) | `workflow run`（按 App schema 改字段） |
| [`automation-daily-cron.json`](automation-daily-cron.json) | `automation create` 周期 |
| [`automation-once.json`](automation-once.json) | `automation create` 一次性 |
| [`automation-update.json`](automation-update.json) | `automation update` |
| [`knowledge-remember.json`](knowledge-remember.json) | `knowledge remember` |
| [`experience-save.json`](experience-save.json) | `experience save` |
| [`experience-update.json`](experience-update.json) | `experience update` |
| [`mcp-set.json`](mcp-set.json) | `mcp set` |

## 输出形状样例（只读对照）

| 文件 | 对应命令 |
|------|----------|
| [`employees-list.sample.json`](employees-list.sample.json) | `employees list` |
| [`employees-worklog.sample.json`](employees-worklog.sample.json) | `employees worklog` |
| [`employees-trail.sample.json`](employees-trail.sample.json) | `employees trail` |

## 无 JSON、用 CLI 旗标

```bash
# 任务中心
gogo tasks create --name "修登录闪烁" --assignee code-reviewer --description "…"
gogo tasks progress Task_xxx --progress 80
gogo tasks state Task_xxx --status completed --summary "已验收：用例通过"

# 派活 / 审批
gogo employees dispatch code-reviewer --goal "核对 ESLint"
gogo employees wake code-reviewer --goal "协助验收" --from main
gogo items dispatch <item_id> --agent code-reviewer
gogo approvals list
gogo approvals approve Task_xxx
gogo approvals reject Task_xxx --reason "缺验收标准"

# MCP 单条添加（非 set）
gogo mcp add fs -- npx -y @modelcontextprotocol/server-filesystem D:/work
gogo mcp add remote --url https://example/mcp
```

概念路由：[`../references/00-concept-routing.md`](../references/00-concept-routing.md)  
全量命令：[`../references/03-cli-cheatsheet.md`](../references/03-cli-cheatsheet.md)  
剧本：[`../references/05-playbooks.md`](../references/05-playbooks.md)
