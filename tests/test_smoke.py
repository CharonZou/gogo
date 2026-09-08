"""冒烟测试：RPC 面 + 编排状态机 + 计划 DAG。"""

from fastapi.testclient import TestClient

from backend.main import app
from backend.orchestration.dag import add_dependency, add_task, build_empty_dag, is_acyclic
from backend.orchestration.state_machine import StateMachine, TaskState


def _client():
    # 用 context manager 触发 lifespan（初始化测试库）
    return TestClient(app)


def test_health() -> None:
    with _client() as client:
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"


def test_create_task() -> None:
    with _client() as client:
        resp = client.post("/api/v1/tasks", json={"goal": "调研并生成报告"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "PENDING"
        assert data["task_id"]


def test_example_workflow_dag() -> None:
    with _client() as client:
        resp = client.get("/api/v1/workflows/example")
        assert resp.status_code == 200
        data = resp.json()
        assert {"id": "plan"} in data["nodes"]
        assert {"id": "execute"} in data["nodes"]
        assert {"from": "plan", "to": "execute"} in data["edges"]


def test_state_machine_full_lifecycle() -> None:
    machine = StateMachine()
    machine.transition(TaskState.PLANNED)
    machine.transition(TaskState.APPROVED)
    machine.transition(TaskState.RUNNING)
    machine.transition(TaskState.VERIFYING)
    machine.transition(TaskState.DONE)
    assert machine.state == TaskState.DONE


def test_state_machine_rejects_illegal_transition() -> None:
    machine = StateMachine()
    try:
        machine.transition(TaskState.DONE)  # PENDING -> DONE 非法
    except ValueError:
        return
    raise AssertionError("非法迁移未被拒绝")


def test_dag_acyclic_and_serialize() -> None:
    graph = build_empty_dag()
    add_task(graph, "a")
    add_task(graph, "b")
    add_task(graph, "c")
    add_dependency(graph, "a", "b")
    add_dependency(graph, "a", "c")
    assert is_acyclic(graph)
