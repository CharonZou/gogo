# 智能体员工 — 安排岗位与观察（外部 Agent 版）

用 shell 跑 `gogo`；**不要**把员工拉进群聊互相对话。对用户用自然语言总结，勿整段贴 JSON。

**顺序：智能体 → 岗位。** `hire` 不创建 Agent，只把已有 `agent_code` 雇成值班岗位。

## 0. 建智能体 + 雇佣

```bash
gogo agents check code-reviewer
gogo agents create --file examples/agent-create.json
gogo employees hire --file examples/employees-hire.json
gogo employees update code-reviewer --file examples/employees-update.json
gogo employees pause|resume|archive code-reviewer
```

## 1. 今天谁在岗？

```bash
gogo employees list
gogo employees list --status active
gogo employees get code-reviewer
```

关注：`agent_code`、`role_name`、`busy`（需 Gateway）、`pending_approvals`、`gateway_reachable`。

## 2. 某人今天干了啥？

```bash
gogo employees worklog code-reviewer
gogo employees worklog code-reviewer --day 2026-09-05
```

| 字段 | 含义 |
|------|------|
| `rounds[]` / `round_count` | 值班巡检轮次；**为 0 ≠ 没干活** |
| `tasks[]` / `task_count` | 当日台账 Task（含 `items.dispatch`） |
| `hint` | 判空时优先读 hint |
| `rounds[].verdict` | `done` / `incomplete` / `in_progress` |

## 3. 某一轮调了哪些工具？

```bash
gogo employees trail code-reviewer --round-id <id>
```

## 4. 派活 / 唤醒

```bash
gogo employees dispatch code-reviewer --goal "核对 ESLint 是否仍为 0 error"
gogo employees wake code-reviewer --goal "协助验收" --from main
```

需要 Gateway。从个人事项派工：`items dispatch`（见 `05-playbooks.md`）。
