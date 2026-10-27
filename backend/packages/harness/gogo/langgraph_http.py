"""终端后台进程查看面板的 LangGraph 侧 HTTP 接口。

后台进程注册表由 process_tool 维护在 LangGraph 服务进程（langgraph dev）里，
Gateway（FastAPI，另一进程）无法直接读取。本模块通过 langgraph.json 的
``"http": {"app": ...}`` 自定义应用机制（langgraph_api.load_custom_app）挂载到
LangGraph 服务上，供 Gateway 跨进程转发：

  GET  /api/bg-processes                     列出全部后台进程会话快照
  POST /api/bg-processes/{session_id}/stop   停止指定会话，不存在返回 404

注意：process_tool 一律函数内延迟导入——langgraph_api 在启动早期加载自定义
app，模块导入期拉起 langchain 会拖慢甚至破坏启动，延迟导入更稳。
"""
from __future__ import annotations

from fastapi import FastAPI, HTTPException

app = FastAPI(title="GoGo background-process panel API")


@app.get("/api/bg-processes")
async def list_bg_processes() -> dict:
    from gogo.tools.builtins.process_tool import list_all_process_sessions

    return {"processes": list_all_process_sessions()}


@app.post("/api/bg-processes/{session_id}/stop")
async def stop_bg_process(session_id: str) -> dict:
    from gogo.tools.builtins.process_tool import kill_process_by_id

    result = kill_process_by_id(session_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"未找到后台进程会话: {session_id}")
    return result
