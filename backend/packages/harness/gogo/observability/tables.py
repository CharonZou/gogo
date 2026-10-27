"""Canonical SQLite table names — prefix ``gogo_obs_`` only."""


class ObservabilityTable:
    THREADS = "gogo_obs_threads"
    RUNS = "gogo_obs_runs"
    MODEL_INVOCATIONS = "gogo_obs_model_invocations"
    TOOL_INVOCATIONS = "gogo_obs_tool_invocations"
    TRACE_EVENTS = "gogo_obs_trace_events"
    TASK_LIFECYCLE_EVENTS = "gogo_obs_task_lifecycle_events"
    IM_CHANNEL_ERRORS = "gogo_obs_im_channel_errors"
    GATEWAY_REQUESTS = "gogo_obs_gateway_requests"
