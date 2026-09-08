"""技能注册（P2.3）：扫描 SKILL.md 目录注册技能，供员工按白名单注入。

技能 = 文件夹 + SKILL.md（frontmatter 提供 name/description，正文为 instructions）。
skills 表为注册权威源；员工在 skill_whitelist 勾选，对话时注入说明。
"""

from __future__ import annotations

import re
import uuid
from pathlib import Path

from backend.core import db

_initialized_paths: set[str] = set()


class SkillManager:
    def __init__(self, db_path: str | None = None) -> None:
        self.db_path = db_path or db.get_db_path()

    async def _ensure_db(self) -> None:
        if self.db_path in _initialized_paths:
            return
        await db.init_db(self.db_path)
        _initialized_paths.add(self.db_path)

    async def scan(self, *dirs: str) -> list[dict]:
        """扫描目录下所有 SKILL.md（目录不存在则跳过），upsert 注册。"""
        await self._ensure_db()
        found: list[dict] = []
        for raw_dir in dirs:
            root = Path(raw_dir)
            if not root.is_dir():
                continue
            for skill_md in sorted(root.rglob("SKILL.md")):
                try:
                    parsed = _parse_skill_md(skill_md)
                except ValueError as exc:
                    # 目录存在但 SKILL.md 不合法：跳过并说明
                    print(f"技能解析失败 {skill_md}: {exc}")
                    continue
                source = "public" if root.name == "public" else "custom"
                await db.upsert_skill(
                    self.db_path,
                    uuid.uuid4().hex[:12],
                    parsed["name"],
                    parsed["description"],
                    parsed["instructions"],
                    source=source,
                )
                found.append(await db.get_skill(self.db_path, parsed["name"]))
        return found

    async def upsert(
        self,
        name: str,
        description: str = "",
        instructions: str = "",
        *,
        source: str = "custom",
        enabled: bool = True,
    ) -> dict:
        if not name or not name.strip():
            raise ValueError("技能名称不能为空")
        await self._ensure_db()
        await db.upsert_skill(
            self.db_path,
            uuid.uuid4().hex[:12],
            name.strip(),
            description,
            instructions,
            source=source,
            enabled=enabled,
        )
        return await db.get_skill(self.db_path, name.strip())

    async def list(self) -> list[dict]:
        await self._ensure_db()
        return await db.list_skills(self.db_path)

    async def set_enabled(self, name: str, enabled: bool) -> dict:
        await self._ensure_db()
        if await db.get_skill(self.db_path, name) is None:
            raise KeyError(f"技能不存在：{name}")
        await db.set_skill_enabled(self.db_path, name, enabled)
        return await db.get_skill(self.db_path, name)

    async def delete(self, name: str) -> dict:
        await self._ensure_db()
        skill = await db.get_skill(self.db_path, name)
        if skill is None:
            raise KeyError(f"技能不存在：{name}")
        if skill["source"] == "public":
            raise ValueError(f"内置技能不可删除：{name}")
        await db.delete_skill(self.db_path, name)
        return {"deleted": name}

    async def enabled_instructions(self, whitelist: list[str] | None) -> list[str]:
        """取员工可用的技能说明（全局启用 + 员工勾选）。空白名单 = 不注入。"""
        if not whitelist:
            return []
        await self._ensure_db()
        skills = await db.list_skills(self.db_path)
        enabled = {s["name"] for s in skills if s["enabled"]}
        out = []
        for name in whitelist:
            if name not in enabled:
                continue
            skill = next(s for s in skills if s["name"] == name)
            out.append(f"技能「{name}」：{skill['description']}\n{skill['instructions']}")
        return out


def _parse_skill_md(path: Path) -> dict:
    """解析 SKILL.md：frontmatter（--- 包裹的 YAML 子集）+ 正文。

    只提取 name / description 两个必填字段；正文作为 instructions。
    完整 YAML 解析不引入依赖，按行 key: value 提取。
    """
    text = path.read_text(encoding="utf-8", errors="replace")
    match = re.match(r"^\s*---\s*\n(.*?)\n---\s*\n?(.*)$", text, re.DOTALL)
    if not match:
        raise ValueError(f"缺少 frontmatter：{path}")
    front, body = match.group(1), match.group(2)
    meta: dict[str, str] = {}
    for line in front.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        meta[key.strip().lower()] = value.strip().strip("\"'")
    name = meta.get("name", "")
    description = meta.get("description", "")
    if not name:
        raise ValueError(f"frontmatter 缺少 name：{path}")
    return {
        "name": name,
        "description": description,
        "instructions": body.strip(),
    }
