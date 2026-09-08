"""pytest 全局配置：测试环境变量（须在导入 backend 前生效）。"""

import os

os.environ.setdefault("SQLITE_PATH", "data/test_rocheflow.db")
os.environ.setdefault("SANDBOX_ROOT", "data/test_sandbox")
os.environ.setdefault("LLM_API_KEY", "")
