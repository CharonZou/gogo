"""P2.1 知识库测试：导入 / 分块 / 检索 / API / 员工问答注入（fake LLM，不烧余额）。"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.agents.manager import AgentManager
from backend.kb.embedder import HashingEmbedder
from backend.kb.manager import KBManager
from backend.main import app

SAMPLE = """RocheFlow 是超级 Agent 编排框架，采用 Supervisor 总控模式。
用户可以雇佣智能体员工，把任务派给员工执行。

## 退款政策
用户下单后 7 天内可无理由退款。退款原路退回，一般 1-3 个工作日到账。

## 会员权益
连续包月会员每月赠送 30 个积分，可用于兑换礼品。
"""


@pytest.fixture
def kb(tmp_path) -> KBManager:
    return KBManager(db_path=str(tmp_path / "kb.db"), embedder=HashingEmbedder())


# ---------- 导入 ----------

async def test_import_text_chunks_and_persists(kb: KBManager) -> None:
    doc = await kb.import_text("产品手册", SAMPLE)
    assert doc["title"] == "产品手册"
    assert doc["status"] == "imported"
    assert doc["chunk_count"] >= 1
    chunks = await kb.chunks(doc["id"])
    assert len(chunks) == doc["chunk_count"]
    assert chunks[0]["position"] == 0
    assert "RocheFlow" in chunks[0]["content"]


async def test_long_text_splits_into_chunks(kb: KBManager) -> None:
    long_content = "\n\n".join(f"第{i}节：" + "内容" * 120 for i in range(8))
    doc = await kb.import_text("长文", long_content)
    assert doc["chunk_count"] >= 2
    chunks = await kb.chunks(doc["id"])
    # 分块有序
    assert [c["position"] for c in chunks] == list(range(len(chunks)))
    assert all(c["content"] for c in chunks)


async def test_import_short_text_single_chunk(kb: KBManager) -> None:
    doc = await kb.import_text("短文档", "一句话。")
    assert doc["chunk_count"] == 1


async def test_import_rejects_empty(kb: KBManager) -> None:
    with pytest.raises(ValueError, match="标题"):
        await kb.import_text("  ", "内容")
    with pytest.raises(ValueError, match="内容"):
        await kb.import_text("标题", "   ")


async def test_import_file_md(kb: KBManager, tmp_path) -> None:
    f = tmp_path / "note.md"
    f.write_text("# 笔记\n内容一。\n内容二。", encoding="utf-8")
    doc = await kb.import_file(f)
    assert doc["title"] == "note"
    assert doc["source"] == "upload"
    assert doc["chunk_count"] >= 1


async def test_import_file_rejects_unsupported(kb: KBManager, tmp_path) -> None:
    f = tmp_path / "doc.pdf"
    f.write_bytes(b"%PDF-1.4 fake")
    with pytest.raises(ValueError, match="不支持"):
        await kb.import_file(f)


async def test_import_file_missing(kb: KBManager) -> None:
    with pytest.raises(FileNotFoundError):
        await kb.import_file("/nonexistent/note.md")


# ---------- CRUD ----------

async def test_list_get_delete(kb: KBManager) -> None:
    doc = await kb.import_text("手册", SAMPLE)
    docs = await kb.list()
    assert any(d["id"] == doc["id"] for d in docs)

    got = await kb.get(doc["id"])
    assert got["title"] == "手册"

    with pytest.raises(KeyError):
        await kb.get("nope")

    assert (await kb.delete(doc["id"]))["deleted"] == doc["id"]
    with pytest.raises(KeyError):
        await kb.delete(doc["id"])


# ---------- 检索 ----------

async def test_search_keyword(kb: KBManager) -> None:
    await kb.import_text("手册", SAMPLE)
    hits = await kb.search("退款", k=3, mode="keyword")
    assert hits
    assert any("退款" in h["content"] for h in hits)


async def test_search_vector_top1_same_text(kb: KBManager) -> None:
    await kb.import_text("手册A", SAMPLE)
    await kb.import_text("手册B", "完全不同的内容：今天天气不错，适合出门散步买菜做饭。")
    hits = await kb.search("会员权益 积分 兑换", k=2, mode="vector")
    assert hits
    assert hits[0]["doc_title"] == "手册A"
    assert hits[0]["score"] > hits[1]["score"]


async def test_search_vector_short_query(kb: KBManager) -> None:
    """短查询（如 2 字词）也能得到非零向量命中（回归：零向量 bug）。"""
    await kb.import_text("手册A", SAMPLE)
    hits = await kb.search("退款", k=1, mode="vector")
    assert hits
    assert hits[0]["score"] > 0.0
    assert "退款" in hits[0]["content"]


async def test_search_hybrid(kb: KBManager) -> None:
    await kb.import_text("手册", SAMPLE)
    hits = await kb.search("退款怎么处理", k=3, mode="hybrid")
    assert hits
    assert any("退款" in h["content"] for h in hits)


async def test_search_rejects_bad_mode(kb: KBManager) -> None:
    with pytest.raises(ValueError, match="模式"):
        await kb.search("x", mode="bogus")


async def test_search_empty_query(kb: KBManager) -> None:
    assert await kb.search("  ") == []


# ---------- API 层 ----------

def test_api_import_search_delete() -> None:
    with TestClient(app) as client:
        resp = client.post(
            "/api/v1/kb/import",
            json={"title": "制度手册", "content": SAMPLE},
        )
        assert resp.status_code == 200
        doc = resp.json()
        assert doc["chunk_count"] >= 1

        hits = client.post(
            "/api/v1/kb/search", json={"query": "退款", "k": 3, "mode": "keyword"}
        ).json()
        assert hits and any("退款" in h["content"] for h in hits)

        docs = client.get("/api/v1/kb/docs").json()
        assert any(d["id"] == doc["id"] for d in docs)

        detail = client.get(f"/api/v1/kb/docs/{doc['id']}").json()
        assert len(detail["chunks"]) == doc["chunk_count"]

        assert client.delete(f"/api/v1/kb/docs/{doc['id']}").json()["deleted"] == doc["id"]
        assert client.get(f"/api/v1/kb/docs/{doc['id']}").status_code == 404


def test_api_import_requires_title_or_path() -> None:
    with TestClient(app) as client:
        assert client.post("/api/v1/kb/import", json={"content": "x"}).status_code == 400
        assert client.post("/api/v1/kb/import", json={"title": "x"}).status_code == 400


# ---------- 员工问答注入 ----------

async def test_agent_chat_injects_kb_hits(tmp_path) -> None:
    class FakeLLM:
        def __init__(self) -> None:
            self.last_messages: list[dict] | None = None

        async def chat_text(self, messages: list[dict], **kwargs) -> str:
            self.last_messages = messages
            return "已根据资料回答。"

    kb = KBManager(db_path=str(tmp_path / "kb.db"), embedder=HashingEmbedder())
    await kb.import_text("退款制度", SAMPLE)
    llm = FakeLLM()
    mgr = AgentManager(db_path=str(tmp_path / "a.db"), llm=llm, kb_manager=kb)
    agent = await mgr.hire("小周", role="客服")
    out = await mgr.chat(agent["id"], "退款政策是什么？")
    assert out["reply"] == "已根据资料回答。"
    system = llm.last_messages[0]["content"]
    assert "以下是从知识库检索到的相关资料" in system
    assert "退款制度" in system
    assert "7 天内可无理由退款" in system


async def test_agent_chat_without_kb_skips_injection(tmp_path) -> None:
    class FakeLLM:
        def __init__(self) -> None:
            self.last_messages: list[dict] | None = None

        async def chat_text(self, messages: list[dict], **kwargs) -> str:
            self.last_messages = messages
            return "ok"

    llm = FakeLLM()
    mgr = AgentManager(db_path=str(tmp_path / "a.db"), llm=llm)  # 未注入 kb
    agent = await mgr.hire("小周")
    await mgr.chat(agent["id"], "你好")
    assert "以下是从知识库检索到的相关资料" not in llm.last_messages[0]["content"]
