"""应用中心（P2.3）测试：创建 / 校验 / 三态 / 填参运行 / 运行历史。"""

from __future__ import annotations

import pytest

from backend.apps.manager import AppManager

STEPS = [
    {
        "id": "s1",
        "title": "生成报告",
        "description": "写 {topic} 报告",
        "depends_on": [],
        "tool": "write_file",
        "tool_args": {"path": "report.md", "content": "报告：{topic}"},
    },
    {
        "id": "s2",
        "title": "归档",
        "depends_on": ["s1"],
        "tool": "noop",
        "tool_args": {},
    },
]


@pytest.fixture
def tmp_manager(tmp_path) -> AppManager:
    return AppManager(db_path=str(tmp_path / "apps.db"))


async def test_create_validates_steps_and_params(tmp_manager: AppManager) -> None:
    app = await tmp_manager.create(
        "竞品调研",
        STEPS,
        description="调研报告",
        goal="调研 {topic} 竞品",
        params=[{"name": "topic", "label": "调研目标", "required": True}],
    )
    assert app["status"] == "draft"
    assert app["params"] == [{"name": "topic", "label": "调研目标", "required": True}]
    assert len(app["steps"]) == 2

    # 非法步骤（依赖不存在）
    with pytest.raises(ValueError):
        await tmp_manager.create("坏应用", [{"id": "a", "depends_on": ["ghost"]}])

    # 参数名重复
    with pytest.raises(ValueError, match="重复"):
        await tmp_manager.create(
            "重复参数", STEPS, params=[{"name": "x"}, {"name": "x"}]
        )


async def test_publish_and_run_renders_params(tmp_manager: AppManager) -> None:
    app = await tmp_manager.create(
        "周报",
        STEPS,
        goal="生成 {topic} 周报",
        params=[{"name": "topic", "required": True}],
    )
    # 未发布不能运行
    with pytest.raises(ValueError, match="未发布"):
        await tmp_manager.run(app["id"], {"topic": "P2.3"})

    await tmp_manager.update(app["id"], status="published")
    # 缺必填参数
    with pytest.raises(ValueError, match="缺少必填参数"):
        await tmp_manager.run(app["id"], {})
    # 未知参数
    with pytest.raises(ValueError, match="未知运行参数"):
        await tmp_manager.run(app["id"], {"topic": "x", "ghost": "y"})

    result = await tmp_manager.run(app["id"], {"topic": "P2.3"})
    task_id = result["task_id"]
    assert result["status"] == "PLANNED"

    from backend.core import db

    task = await db.get_task(str(tmp_manager.db_path), task_id)
    assert "运行参数：topic=P2.3" in task["goal"]
    assert "P2.3 周报" in task["goal"]

    subs = await db.list_subtasks(str(tmp_manager.db_path), task_id)
    assert len(subs) == 2
    s1 = next(s for s in subs if s["id"].endswith("-s1"))
    import json

    args = json.loads(s1["tool_args"])
    assert args["content"] == "报告：P2.3"  # {topic} 已渲染

    runs = await tmp_manager.runs(app["id"])
    assert len(runs) == 1
    assert runs[0]["params"] == {"topic": "P2.3"}
    assert runs[0]["task_id"] == task_id

    app_after = await tmp_manager.get(app["id"])
    assert app_after["run_count"] == 1


async def test_update_and_delete(tmp_manager: AppManager) -> None:
    app = await tmp_manager.create("A", STEPS, params=[])
    await tmp_manager.update(app["id"], name="B", status="archived")
    assert (await tmp_manager.get(app["id"]))["name"] == "B"

    with pytest.raises(KeyError):
        await tmp_manager.update("nope", name="x")

    await tmp_manager.delete(app["id"])
    with pytest.raises(KeyError):
        await tmp_manager.get(app["id"])
