"""计划 DAG：networkx 有向无环图。

上游完成解锁下游，支持分支与汇合点。
TODO：无环校验、持久化、并行调度、可视化导出。
"""

from __future__ import annotations

from typing import Any

import networkx as nx


def build_empty_dag() -> nx.DiGraph:
    """创建空计划图。"""
    return nx.DiGraph()


def add_task(graph: nx.DiGraph, task_id: str, **attrs: Any) -> None:
    """新增计划节点（子任务）。"""
    graph.add_node(task_id, **attrs)


def add_dependency(graph: nx.DiGraph, upstream: str, downstream: str) -> None:
    """新增依赖边：上游完成才解锁下游。"""
    graph.add_edge(upstream, downstream)


def is_acyclic(graph: nx.DiGraph) -> bool:
    """校验计划图无环。"""
    return nx.is_directed_acyclic_graph(graph)


def to_dict(graph: nx.DiGraph) -> dict:
    """序列化计划图（供 API / 前端可视化）。"""
    return {
        "nodes": [{"id": n, **graph.nodes[n]} for n in graph.nodes],
        "edges": [{"from": u, "to": v} for u, v in graph.edges],
    }
