"""P1.4 工作流模板：CRUD 校验 + 实例化闭环。"""

import json
import time

from fastapi.testclient import TestClient

from backend.main import app


def _client():
    return TestClient(app)


def _valid_steps():
    return [
        {"id": "a", "title": "采集", "description": "抓取数据", "depends_on": []},
        {"id": "b", "title": "清洗", "description": "处理脏数据", "depends_on": ["a"]},
        {"id": "c", "title": "出报告", "description": "汇总成报告", "depends_on": ["b"]},
    ]


def test_create_workflow() -> None:
    with _client() as client:
        resp = client.post(
            "/api/v1/workflows",
            json={"name": "数据分析", "description": "三步流水线", "steps": _valid_steps()},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "数据分析"
        assert data["status"] == "draft"
        assert data["run_count"] == 0
        assert len(data["steps"]) == 3
        assert data["steps"][2]["depends_on"] == ["b"]


def test_create_workflow_rejects_duplicate_id() -> None:
    with _client() as client:
        steps = _valid_steps()
        steps.append({"id": "a", "title": "重复", "depends_on": []})
        resp = client.post(
            "/api/v1/workflows", json={"name": "坏模板", "steps": steps}
        )
        assert resp.status_code == 400
        assert "重复" in resp.json()["detail"]


def test_create_workflow_rejects_missing_dependency() -> None:
    with _client() as client:
        steps = [{"id": "x", "title": "X", "depends_on": ["ghost"]}]
        resp = client.post(
            "/api/v1/workflows", json={"name": "坏模板", "steps": steps}
        )
        assert resp.status_code == 400
        assert "依赖不存在" in resp.json()["detail"]


def test_create_workflow_rejects_cycle() -> None:
    with _client() as client:
        steps = [
            {"id": "a", "title": "A", "depends_on": ["b"]},
            {"id": "b", "title": "B", "depends_on": ["a"]},
        ]
        resp = client.post(
            "/api/v1/workflows", json={"name": "坏模板", "steps": steps}
        )
        assert resp.status_code == 400
        assert "环" in resp.json()["detail"]


def test_create_workflow_rejects_empty_name() -> None:
    with _client() as client:
        resp = client.post(
            "/api/v1/workflows", json={"name": "", "steps": _valid_steps()}
        )
        assert resp.status_code == 422


def test_list_and_get_workflow() -> None:
    with _client() as client:
        created = client.post(
            "/api/v1/workflows", json={"name": "列表测试", "steps": _valid_steps()}
        ).json()
        lst = client.get("/api/v1/workflows").json()
        assert any(w["id"] == created["id"] for w in lst)

        got = client.get(f"/api/v1/workflows/{created['id']}").json()
        assert got["name"] == "列表测试"

        missing = client.get("/api/v1/workflows/nope")
        assert missing.status_code == 404


def test_update_workflow() -> None:
    with _client() as client:
        created = client.post(
            "/api/v1/workflows", json={"name": "改前", "steps": _valid_steps()}
        ).json()
        resp = client.patch(
            f"/api/v1/workflows/{created['id']}",
            json={"name": "改后", "status": "active"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "改后"
        assert data["status"] == "active"

        # 换 steps 后重新校验
        resp = client.patch(
            f"/api/v1/workflows/{created['id']}",
            json={"steps": [{"id": "only", "title": "单步", "depends_on": []}]},
        )
        assert resp.status_code == 200
        assert len(resp.json()["steps"]) == 1


def test_update_workflow_rejects_invalid_status() -> None:
    with _client() as client:
        created = client.post(
            "/api/v1/workflows", json={"name": "状态测试", "steps": _valid_steps()}
        ).json()
        resp = client.patch(
            f"/api/v1/workflows/{created['id']}", json={"status": "bogus"}
        )
        assert resp.status_code == 422


def test_delete_workflow() -> None:
    with _client() as client:
        created = client.post(
            "/api/v1/workflows", json={"name": "删除测试", "steps": _valid_steps()}
        ).json()
        resp = client.delete(f"/api/v1/workflows/{created['id']}")
        assert resp.status_code == 200
        assert resp.json()["deleted"] == created["id"]

        assert client.get(f"/api/v1/workflows/{created['id']}").status_code == 404


def test_run_workflow_instantiates_task() -> None:
    """run：建 task + steps 落库为 subtasks（PLANNED），run_count +1。"""
    with _client() as client:
        wf = client.post(
            "/api/v1/workflows", json={"name": "实例化", "steps": _valid_steps()}
        ).json()

        run = client.post(f"/api/v1/workflows/{wf['id']}/run")
        assert run.status_code == 200
        payload = run.json()
        assert payload["status"] == "PLANNED"
        task_id = payload["task_id"]

        task = client.get(f"/api/v1/tasks/{task_id}").json()
        assert task["source"] == "workflow"
        assert task["title"] == "实例化"
        assert task["status"] == "PLANNED"
        subs = task["subtasks"]
        assert len(subs) == 3
        # 依赖关系保留（映射到实例化后的 subtask id）：第三步骤依赖第二步骤
        assert json.loads(subs[0]["depends_on"]) == []
        assert json.loads(subs[2]["depends_on"]) == [subs[1]["id"]]

        after = client.get(f"/api/v1/workflows/{wf['id']}").json()
        assert after["run_count"] == 1


def test_run_workflow_then_execute_closed_loop() -> None:
    """完整闭环：run → approve → 后台执行（noop 直通）→ DONE。"""
    with _client() as client:
        wf = client.post(
            "/api/v1/workflows", json={"name": "闭环", "steps": _valid_steps()}
        ).json()
        task_id = client.post(f"/api/v1/workflows/{wf['id']}/run").json()["task_id"]

        resp = client.post(f"/api/v1/tasks/{task_id}/approve")
        assert resp.status_code == 200
        assert resp.json()["status"] == "APPROVED"

        # approve 走后台执行，轮询等待 DONE
        task: dict | None = None
        deadline = time.time() + 5
        while time.time() < deadline:
            task = client.get(f"/api/v1/tasks/{task_id}").json()
            if task["status"] == "DONE":
                break
            time.sleep(0.05)
        assert task is not None and task["status"] == "DONE"
        assert all(s["status"] == "DONE" for s in task["subtasks"])


def test_run_missing_workflow() -> None:
    with _client() as client:
        resp = client.post("/api/v1/workflows/nope/run")
        assert resp.status_code == 404
