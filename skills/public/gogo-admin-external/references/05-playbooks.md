# 编排剧本（全覆盖）

概念：[`00-concept-routing.md`](00-concept-routing.md)。示例相对包根 `examples/`。

## 0. 冒烟

```bash
GOGO models list
GOGO agents list
GOGO employees list
GOGO items list --exclude-done
GOGO tasks list --limit 20
GOGO workflow list
```

## 1. 个人待办（items）

```bash
GOGO items create --file examples/item-create.json
GOGO items list --exclude-done
GOGO items update <item_id> --file examples/item-update.json
GOGO items get <item_id>
```

## 2. 待办 → 派给岗位员工

```bash
GOGO items create --file examples/item-create.json
GOGO items dispatch <item_id> --agent code-reviewer --goal "写本周选题简报"
GOGO employees worklog code-reviewer
GOGO tasks list --assignee code-reviewer
```

## 3. 建角色 → 雇岗 → 派活 / 唤醒

```bash
GOGO agents check code-reviewer
GOGO agents create --file examples/agent-create.json
GOGO employees hire --file examples/employees-hire.json
GOGO employees update code-reviewer --file examples/employees-update.json
GOGO employees dispatch code-reviewer --goal "核对 ESLint 是否仍为 0 error"
GOGO employees wake code-reviewer --goal "协助验收" --from main
GOGO employees list --status active
GOGO employees worklog code-reviewer
GOGO employees trail code-reviewer --round-id <id>
```

字段含义：[`employees-observe.md`](employees-observe.md)；输出形状见 `examples/employees-*.sample.json`。

## 4. 任务中心结案 / 进度

```bash
GOGO tasks create --name "修登录闪烁" --assignee code-reviewer --description "复现并修"
GOGO tasks progress <task_id> --progress 50
GOGO tasks state <task_id> --status completed --summary "已修；手动复现通过"
GOGO tasks list --status completed --limit 10
```

## 5. 审批

```bash
GOGO approvals list
GOGO approvals request <task_id> --note "请批方案"
GOGO approvals approve <task_id>
# 或
GOGO approvals reject <task_id> --reason "需补充验收标准"
```

## 6. 工作流 Apps

```bash
GOGO workflow list
GOGO workflow get App_xxx
GOGO workflow run App_xxx --file examples/workflow-run-params.json
GOGO workflow status <runId>
GOGO workflow stop <runId> --reason "取消"
```

创建/发布（HTTP）：

```bash
curl -s -X POST "$GOGO_GATEWAY_URL/api/platform" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"workflow.create","args":{"name":"日报","goal":"汇总昨日进展"},"confirm":true}'
```

全量 action：[`04-http-platform.md`](04-http-platform.md)。

## 7. 定时自动化

```bash
GOGO automation create --file examples/automation-daily-cron.json
GOGO automation create --file examples/automation-once.json
GOGO automation update <id> --file examples/automation-update.json
GOGO automation list
GOGO automation pause <id>
GOGO automation resume <id>
GOGO automation history <id>
```

## 8. 模型 / 技能 / MCP / 画像

```bash
GOGO models create --file examples/model-create.json
GOGO models primary set my-glm
GOGO models test --file examples/model-test.json
GOGO models invoke --file examples/model-invoke.json
GOGO skills list --enabled-only
GOGO skills install ./some-skill.zip
GOGO mcp set --file examples/mcp-set.json
GOGO mcp add fs -- npx -y @modelcontextprotocol/server-filesystem D:/work
GOGO mcp test fs
# 用户画像改走资产中心：#/assets → 画像，或 assets.update_profile
```

## 9. 知识 / 经验 / 记忆 / 会话

```bash
GOGO knowledge create --name "英语单词库"   # 平台自有库；遗留 Vault 加 --legacy-vault
GOGO knowledge remember --file examples/knowledge-remember.json
GOGO knowledge recall "MCP 配置"
GOGO experience save --file examples/experience-save.json
GOGO experience list --query "PATH"
GOGO memory show --agent main
GOGO sessions search -q "docker 端口" --titles
GOGO workspace memory bootstrap D:/path/to/project
```

## 10. 组织包 / 资产

```bash
GOGO org preflight ./packs/content-ops
GOGO org install ./packs/content-ops --workspace D:/ws/content-ops
GOGO org list
GOGO org export --employees code-reviewer -o ./my-pack --zip
GOGO assets init
GOGO assets export -o ./hub.GOGO-pack
```

## 11. 评测 / 排障

```bash
GOGO eval run --mode smoke
GOGO eval cases --category scenario
GOGO logs sources --hours 72
GOGO logs scan --hours 24 -s gateway
GOGO logs timeline --hours 24 --format markdown
```

综合诊断（仅 platform）：`{"action":"diagnostics.run","confirm":false}`
