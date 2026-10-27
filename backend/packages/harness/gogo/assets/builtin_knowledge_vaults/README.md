# Bundled Obsidian vaults shipped with the product.

| Asset dir | Product name | Repo SSOT |
|-----------|--------------|-----------|
| `user-guide/` | GoGo 用户指南 | GoGo `docs/user` |
| `ops-knowledge/` | 运营知识库 | ContentOS `docs/智能内容运营平台/知识库` |

Mapped at package/build time when the sibling ContentOS tree is present. Editable checkouts prefer the live ContentOS path via `contentos_ops_knowledge_src()` (`GoGo_OPS_KNOWLEDGE_ROOT` override).
