"""调度器（接口桩）。

TODO：定时自动化（cron 跑固定 Prompt）+ 智能体员工（值班/审批/工作汇报）。
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class CronJob:
    job_id: str
    cron: str
    prompt: str
    enabled: bool = True


class Scheduler:
    def __init__(self) -> None:
        self._jobs: dict[str, CronJob] = {}

    def register(self, job: CronJob) -> None:
        self._jobs[job.job_id] = job

    def list_jobs(self) -> list[dict]:
        return [
            {"job_id": j.job_id, "cron": j.cron, "enabled": j.enabled}
            for j in self._jobs.values()
        ]
