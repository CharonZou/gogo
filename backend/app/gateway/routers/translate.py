"""技能/连接器介绍翻译路由。

技能与连接器来自远程仓库（SkillHub、MCP Registry、Glama 等），描述可能为英文。
本路由复用主对话相同的模型调用栈（``gogo.models.create_chat_model``）将文本翻译成目标语言，
并带一层内存缓存，避免对同一文本重复消费模型额度。
"""

from __future__ import annotations

import logging
import threading
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["translate"])

# 单条文本最大长度（字符）；超过直接拒绝，防滥用模型额度。
MAX_TRANSLATE_TEXT_LEN = 4000
# 内存缓存上限（条数）；达到上限后清空，简单 LRU 足够（命中即移动）。
_CACHE_MAX = 512

_translate_cache: dict[tuple[str, str, str], str] = {}
_translate_cache_order: list[tuple[str, str, str]] = []
_translate_cache_lock = threading.Lock()

_SYSTEM_PROMPT_TMPL = (
    "你是专业翻译。请把用户给出的文本从{source}翻译成{target}。"
    "只输出译文本身，不要加任何解释、引号或前后缀；"
    "专有名词、产品名、命令、URL 按惯例保留或适当意译。"
)

_LANG_LABELS: dict[str, str] = {
    "auto": "自动检测",
    "zh": "简体中文",
    "zh-cn": "简体中文",
    "zh-hans": "简体中文",
    "zh-hant": "繁体中文",
    "en": "英文",
    "en-us": "英文",
    "en-gb": "英文",
    "ja": "日文",
    "ko": "韩文",
    "fr": "法文",
    "de": "德文",
    "es": "西班牙文",
    "ru": "俄文",
    "pt": "葡萄牙文",
}


def _lang_label(code: str) -> str:
    return _LANG_LABELS.get(str(code or "").strip().lower(), str(code or "auto"))


def _cache_get(key: tuple[str, str, str]) -> str | None:
    with _translate_cache_lock:
        if key not in _translate_cache:
            return None
        # LRU touch
        try:
            _translate_cache_order.remove(key)
            _translate_cache_order.append(key)
        except ValueError:
            pass
        return _translate_cache[key]


def _cache_put(key: tuple[str, str, str], value: str) -> None:
    with _translate_cache_lock:
        if key in _translate_cache:
            try:
                _translate_cache_order.remove(key)
            except ValueError:
                pass
        _translate_cache[key] = value
        _translate_cache_order.append(key)
        while len(_translate_cache) > _CACHE_MAX:
            oldest = _translate_cache_order.pop(0)
            _translate_cache.pop(oldest, None)


class TranslateRequest(BaseModel):
    """翻译请求：将一段介绍文本翻译成目标语言。"""

    text: str = Field(..., description="待翻译文本（技能/连接器介绍等），最长 4000 字符")
    source_lang: str = Field(
        default="auto",
        description="源语言代码（auto / zh / en 等），默认自动检测",
    )
    target_lang: str = Field(
        default="zh",
        description="目标语言代码（zh / en 等），默认简体中文",
    )
    model_name: str | None = Field(
        default=None,
        description="可选：指定使用的已配置模型名；省略使用默认模型",
    )


class TranslateResponse(BaseModel):
    translated_text: str = Field(..., description="翻译后的文本")
    source_lang: str = Field(default="auto", description="源语言代码")
    target_lang: str = Field(default="zh", description="目标语言代码")


@router.post(
    "/translate",
    response_model=TranslateResponse,
    summary="翻译文本（技能/连接器介绍）",
    description=(
        "使用已配置的对话模型把一段文本翻译成目标语言。"
        "技能与连接器介绍来自远程仓库，可能是英文；前端在展示时调用本接口翻译。"
    ),
)
async def translate_text(request: TranslateRequest) -> TranslateResponse:
    """翻译技能/连接器介绍文本（复用主对话模型栈 + 内存缓存）。"""
    text = str(request.text or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="text 不能为空")
    if len(text) > MAX_TRANSLATE_TEXT_LEN:
        raise HTTPException(
            status_code=422,
            detail=f"文本过长（{len(text)} 字符），单次最多翻译 {MAX_TRANSLATE_TEXT_LEN} 字符",
        )

    source = str(request.source_lang or "auto").strip().lower() or "auto"
    target = str(request.target_lang or "zh").strip().lower() or "zh"
    cache_key = (text, source, target)

    cached = _cache_get(cache_key)
    if cached is not None:
        return TranslateResponse(
            translated_text=cached,
            source_lang=source,
            target_lang=target,
        )

    from gogo.config import get_app_config
    from gogo.models import create_chat_model

    config = get_app_config()
    if not config.models:
        raise HTTPException(
            status_code=503,
            detail="未配置任何模型，请在设置 → 模型中添加模型后再翻译",
        )

    name = (request.model_name or "").strip() or None
    if name is not None and config.get_model_config(name) is None:
        raise HTTPException(
            status_code=404,
            detail=f"模型「{name}」不存在，请留空使用默认模型",
        )

    try:
        model = create_chat_model(name=name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    system_prompt = _SYSTEM_PROMPT_TMPL.format(
        source=_lang_label(source),
        target=_lang_label(target),
    )

    from langchain_core.messages import HumanMessage, SystemMessage

    try:
        resp = await model.ainvoke(
            [SystemMessage(content=system_prompt), HumanMessage(content=text)]
        )
    except Exception as e:
        logger.exception("translate invoke failed")
        raise HTTPException(status_code=502, detail=f"翻译失败: {e}") from e

    translated = _extract_text(getattr(resp, "content", resp))
    if not translated.strip():
        raise HTTPException(status_code=502, detail="翻译结果为空，请重试")

    _cache_put(cache_key, translated)
    return TranslateResponse(
        translated_text=translated,
        source_lang=source,
        target_lang=target,
    )


def _extract_text(content: Any) -> str:
    """从 langchain 响应 content（str 或 blocks）中提取纯文本。"""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") in {"text", "output_text"}:
                text = block.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "\n".join(parts) if parts else ""
    if content is None:
        return ""
    return str(content)
