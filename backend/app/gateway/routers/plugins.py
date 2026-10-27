"""DSH 插件（bundle）列表接口。

数据源：gogo 项目内插件目录（gogo-app/plugins/dsh/，由 dsh 插件复制而来）。
- 启用清单：profiles/web/package.json 的 ``dsh.profile.bundles``（bundle 组合列表）
- 来源信息：dependencies 的 spec（npm / file: / link: / github:）
- 元信息：优先项目内 node_modules/@deepseek-ai/<name>/package.json（291 个内置包）；
  已装插件实体（dsh-better-sidebar 等）回退本机 ~/.dsh/profiles/web/node_modules

只读接口；不修改任何配置。
"""

import json
import logging
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["plugins"])

# gogo 项目内插件目录（dsh 插件复制而来）
GOGO_PLUGINS_DIR = Path(r"D:\MyProject\GoGo\gogo-app\plugins\dsh")
PROFILES_DIR = GOGO_PLUGINS_DIR / "profiles"
# 本机 dsh 真实实体（已装插件的 node_modules；gogo 项目内仅清单）
FALLBACK_PROFILE = Path.home() / ".dsh" / "profiles" / "web"


class PluginInfo(BaseModel):
    """DSH 插件（bundle）信息。"""

    name: str = Field(..., description="插件包名（bundle 名）")
    description: str = Field("", description="插件描述（来自包元信息）")
    version: str = Field("", description="插件版本")
    author: str = Field("", description="作者")
    license: str = Field("", description="许可证")
    homepage: str = Field("", description="项目主页")
    source: str = Field("npm", description="来源类型：npm / file / link / github / workspace / unknown")
    source_detail: str = Field("", description="来源原始 spec")
    enabled: bool = Field(True, description="是否在 profile 的 bundles 启用清单中")
    profile: str = Field("web", description="所属 dsh profile 名")
    path: str = Field("", description="本地安装路径")


class PluginsListResponse(BaseModel):
    """插件列表响应。"""

    plugins: list[PluginInfo]
    profiles: list[str] = Field(default_factory=list, description="扫描到的 profile 名")


def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 - 元信息缺失不阻塞列表
        if path.exists():
            logger.debug("plugins: cannot parse %s: %s", path, exc)
        return {}


def _author_name(author) -> str:
    if isinstance(author, dict):
        return str(author.get("name") or "")
    return str(author or "")


def _license_name(license_) -> str:
    if isinstance(license_, dict):
        return str(license_.get("type") or "")
    return str(license_ or "")


def _plugin_source(spec: str) -> tuple[str, str]:
    """根据依赖 spec 判断来源类型。"""
    s = str(spec or "").strip()
    if not s:
        return "unknown", ""
    for prefix in ("file:", "link:", "github:", "workspace:", "npm:"):
        if s.startswith(prefix):
            return prefix[:-1], s
    return "npm", s


def _plugin_meta_name(dep_name: str) -> str:
    """@deepseek-ai/dsh-base -> dsh-base（项目内 node_modules/@deepseek-ai/<pkg> 布局）。"""
    if dep_name.startswith("@"):
        _, _, short = dep_name.partition("/")
        return short
    return dep_name


def _resolve_meta(profile_dir: Path, dep_name: str, spec: str) -> dict:
    """优先项目内 @deepseek-ai 内置包元信息；已装插件回退本机实体。"""
    short = _plugin_meta_name(dep_name)
    meta = _read_json(GOGO_PLUGINS_DIR / "node_modules" / "@deepseek-ai" / short / "package.json")
    if not meta:
        meta = _read_json(FALLBACK_PROFILE / "node_modules" / dep_name / "package.json")
    if not meta and spec.startswith("link:"):
        meta = _read_json(Path(spec[5:]) / "package.json")
    if not meta and spec.startswith("file:"):
        # file: 指向 tgz/目录；尝试目录
        target = spec[5:]
        meta = _read_json(Path(target) / "package.json")
    return meta


@router.get("/plugins", response_model=PluginsListResponse)
async def list_plugins() -> PluginsListResponse:
    plugins: list[PluginInfo] = []
    profiles: list[str] = []
    seen: set[str] = set()

    # 1) dsh 内置插件全列表：扫描项目内 node_modules/@deepseek-ai/*（291 个包）
    builtin_dir = GOGO_PLUGINS_DIR / "node_modules" / "@deepseek-ai"
    if builtin_dir.is_dir():
        for pkg_dir in sorted(builtin_dir.iterdir()):
            if not pkg_dir.is_dir():
                continue
            meta = _read_json(pkg_dir / "package.json")
            if not meta:
                continue
            name = f"@deepseek-ai/{pkg_dir.name}"
            seen.add(name)
            plugins.append(
                PluginInfo(
                    name=name,
                    description=str(meta.get("description") or ""),
                    version=str(meta.get("version") or ""),
                    author=_author_name(meta.get("author")),
                    license=_license_name(meta.get("license")),
                    homepage=str(meta.get("homepage") or ""),
                    source="builtin",
                    source_detail="dsh 应用内置插件（gogo 项目内 plugins/dsh/node_modules/@deepseek-ai）",
                    enabled=True,
                    profile="dsh-builtin",
                    path=str(pkg_dir),
                )
            )

    # 2) profile 已安装/引用的插件（跳过已列出的内置 @deepseek-ai/*）
    if PROFILES_DIR.is_dir():
        for profile_dir in sorted(PROFILES_DIR.iterdir()):
            if not profile_dir.is_dir():
                continue
            pkg_path = profile_dir / "package.json"
            if not pkg_path.exists():
                continue
            pkg = _read_json(pkg_path)
            profile_name = str(pkg.get("name") or profile_dir.name)
            profiles.append(profile_name)

            deps: dict = pkg.get("dependencies", {}) or {}
            bundles: list = (pkg.get("dsh", {}).get("profile", {}).get("bundles", []) or [])
            bundle_names = [str(b) for b in bundles]
            # 排序：启用清单在前（保持 bundle 声明顺序），再补 dependencies 中未声明的
            order: list[str] = []
            for n in bundle_names + [k for k in deps if k not in bundle_names]:
                if n not in seen and n not in order:
                    order.append(n)

            for dep_name in order:
                spec = str(deps.get(dep_name, "") or "")
                if not spec:
                    # 不在 dependencies 的 bundle：dsh 应用内置核心（理论上已被内置列表覆盖）
                    source, source_detail = "builtin", ""
                else:
                    source, source_detail = _plugin_source(spec)
                meta = _resolve_meta(profile_dir, dep_name, spec)
                plugins.append(
                    PluginInfo(
                        name=dep_name,
                        description=str(meta.get("description") or ""),
                        version=str(meta.get("version") or ""),
                        author=_author_name(meta.get("author")),
                        license=_license_name(meta.get("license")),
                        homepage=str(meta.get("homepage") or ""),
                        source=source,
                        source_detail=source_detail,
                        enabled=dep_name in bundle_names,
                        profile=profile_name,
                        path=str(GOGO_PLUGINS_DIR / "node_modules" / "@deepseek-ai" / _plugin_meta_name(dep_name)),
                    )
                )
    return PluginsListResponse(plugins=plugins, profiles=profiles)
