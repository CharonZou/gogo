"""技能管理（接口桩）。

技能 = 目录 + SKILL.md（工作流 / 最佳实践 / 参考资源），按需渐进加载，收敛上下文。
"""

from __future__ import annotations

from pathlib import Path


class SkillManager:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or Path("skills")

    def discover(self) -> list[Path]:
        """扫描技能目录，返回所有 SKILL.md。"""
        if not self.root.exists():
            return []
        return sorted(self.root.glob("*/SKILL.md"))

    def load(self, name: str) -> str | None:
        """按技能名加载 SKILL.md 内容（渐进加载入口）。"""
        skill_file = self.root / name / "SKILL.md"
        if not skill_file.exists():
            return None
        return skill_file.read_text(encoding="utf-8")
