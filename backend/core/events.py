"""内存事件总线：任务执行流式事件（WebSocket 订阅）。

Hub 用 per-task asyncio.Queue 广播：run_graph 每轮节点输出 publish 到该任务队列，
WebSocket 路由订阅对应 task_id 消费推送；无人订阅时事件直接丢弃（零开销）。
"""

from __future__ import annotations

import asyncio


class EventHub:
    def __init__(self) -> None:
        self._queues: dict[str, set[asyncio.Queue]] = {}
        self._lock = asyncio.Lock()

    async def subscribe(self, topic: str) -> asyncio.Queue:
        """订阅 topic（task_id），返回专属队列；调用方负责 unsubscribe。"""
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        async with self._lock:
            self._queues.setdefault(topic, set()).add(q)
        return q

    async def unsubscribe(self, topic: str, q: asyncio.Queue) -> None:
        async with self._lock:
            subs = self._queues.get(topic)
            if subs is None:
                return
            subs.discard(q)
            if not subs:
                self._queues.pop(topic, None)

    async def publish(self, topic: str, event: dict) -> None:
        """广播事件：慢消费者丢弃（非阻塞），避免拖慢执行引擎。"""
        async with self._lock:
            subs = list(self._queues.get(topic, ()))
        for q in subs:
            if q.full():
                try:
                    q.get_nowait()  # 丢最旧，保最新
                except asyncio.QueueEmpty:
                    pass
            q.put_nowait(event)

    def stream_callback(self, topic: str):
        """适配 graph.StreamCallback：把节点输出 publish 到 topic。"""

        async def _cb(event: dict) -> None:
            await self.publish(topic, event)

        return _cb


hub = EventHub()
