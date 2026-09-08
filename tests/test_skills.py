"""技能注册（P2.3）测试：SKILL.md 扫描 / 手动注册 / 启停 / 注入白名单。"""

from __future__ import annotations

import pytest

from backend.skills.manager import SkillManager

SKILL_MD = """---
name: my-skill
description: 我的测试技能
---

# 用法

当用户提到 XXX 时使用本技能。
"""


async def test_scan_registers_from_dirs(tmp_path) -> None:
    public = tmp_path / "skills" / "public" / "alpha"
    public.mkdir(parents=True)
    (public / "SKILL.md").write_text(SKILL_MD, encoding="utf-8")
    custom = tmp_path / "skills" / "custom" / "beta"
    custom.mkdir(parents=True)
    (custom / "SKILL.md").write_text(SKILL_MD.replace("my-skill", "beta"), encoding="utf-8")

    mgr = SkillManager(db_path=str(tmp_path / "skills.db"))
    found = await mgr.scan(str(tmp_path / "skills" / "public"), str(tmp_path / "skills" / "custom"))
    assert {s["name"] for s in found} == {"my-skill", "beta"}
    by_name = {s["name"]: s for s in found}
    assert by_name["my-skill"]["source"] == "public"
    assert by_name["beta"]["source"] == "custom"
    assert "用法" in by_name["my-skill"]["instructions"]

    # 缺目录不报错
    assert await mgr.scan(str(tmp_path / "nope")) == []


async def test_scan_skips_invalid_skill_md(tmp_path) -> None:
    d = tmp_path / "skills" / "public" / "bad"
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text("没有 frontmatter", encoding="utf-8")
    mgr = SkillManager(db_path=str(tmp_path / "skills.db"))
    found = await mgr.scan(str(tmp_path / "skills" / "public"))
    assert found == []


async def test_upsert_enable_delete(tmp_path) -> None:
    mgr = SkillManager(db_path=str(tmp_path / "skills.db"))
    s = await mgr.upsert("deep-research", "深度调研", "联网检索多来源对比")
    assert s["enabled"] == 1

    s = await mgr.set_enabled("deep-research", False)
    assert s["enabled"] == 0

    # public 技能不可删
    await mgr.upsert("pdf", "PDF 生成", "x", source="public")
    with pytest.raises(ValueError, match="内置技能不可删除"):
        await mgr.delete("pdf")

    assert (await mgr.delete("deep-research"))["deleted"] == "deep-research"
    with pytest.raises(KeyError):
        await mgr.set_enabled("deep-research", True)


async def test_enabled_instructions_filters_whitelist(tmp_path) -> None:
    mgr = SkillManager(db_path=str(tmp_path / "skills.db"))
    await mgr.upsert("skill-a", "技能A", "说明A")
    await mgr.upsert("skill-b", "技能B", "说明B")
    await mgr.set_enabled("skill-b", False)

    # 空白名单 → 不注入
    assert await mgr.enabled_instructions([]) == []
    # 只注入已启用且在白名单里的
    notes = await mgr.enabled_instructions(["skill-a", "skill-b"])
    assert len(notes) == 1
    assert "技能A" in notes[0]
