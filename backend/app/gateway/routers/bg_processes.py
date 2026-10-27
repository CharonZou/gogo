"""终端后台进程查看面板接口（Gateway 双模式路由）。

后台进程注册表在 LangGraph 服务进程里（工具 process_tool 维护）：
  - 外部 LangGraph 模式：转发到 LangGraph 侧同名 HTTP 接口
    （gogo/langgraph_http.py，经 langgraph.json http.app 挂载，无额外前缀）；
  - in-process 模式：图与 Gateway 同进程，直接调用 process_tool 助手。

  GET  /api/bg-processes                     列出全部后台进程会话
  POST /api/bg-processes/{session_id}/stop   停止指定会话（不存在透传 404）
"""
from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/bg-processes", tags=["bg-processes"])

_FORWARD_TIMEOUT = httpx.Timeout(5.0)


def _external_mode() -> bool:
    from gogo.langgraph_deployment import is_external_langgraph_mode

    return is_external_langgraph_mode()


async def _forward(method: str, path: str) -> JSONResponse:
    from gogo.langgraph_run_config import resolve_langgraph_base_url

    url = f"{resolve_langgraph_base_url()}{path}"
    try:
        async with httpx.AsyncClient(timeout=_FORWARD_TIMEOUT) as client:
            resp = await client.request(method, url)
    except httpx.RequestError as exc:
        logger.warning("bg-processes 转发失败 (%s %s): %s", method, url, exc)
        raise HTTPException(status_code=503, detail="LangGraph 服务不可用，无法操作后台进程") from exc
    try:
        payload = resp.json()
    except ValueError:
        payload = {"detail": resp.text}
    return JSONResponse(status_code=resp.status_code, content=payload)


@router.get("", response_model=None)
async def list_bg_processes() -> dict | JSONResponse:
    if _external_mode():
        return await _forward("GET", "/api/bg-processes")
    from gogo.tools.builtins.process_tool import list_all_process_sessions

    return {"processes": list_all_process_sessions()}


@router.post("/{session_id}/stop", response_model=None)
async def stop_bg_process(session_id: str) -> dict | JSONResponse:
    if _external_mode():
        return await _forward("POST", f"/api/bg-processes/{session_id}/stop")
    from gogo.tools.builtins.process_tool import kill_process_by_id

    result = kill_process_by_id(session_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"未找到后台进程会话: {session_id}")
    return result
