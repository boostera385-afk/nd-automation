"""Bounded sequential dispatch policy; never approves, requeues or retries a submit."""

import time


def run_due_jobs(bridge, journal, prepare, execute_job, recover, max_jobs=1, watch_minutes=0,
                 monotonic=time.monotonic, sleep=time.sleep, claim_method="reporting_claim_publish"):
    if type(max_jobs) is not int or not 1 <= max_jobs <= 20 or type(watch_minutes) is not int or not 0 <= watch_minutes <= 480:
        raise ValueError("Publishing must be bounded to 1–20 jobs and at most eight hours")
    if claim_method not in {"reporting_claim_publish", "reporting_claim_publish_v2"}:
        raise ValueError("Unsupported publishing claimant")
    deadline = monotonic() + watch_minutes * 60 if watch_minutes else None
    completed = 0
    while completed < max_jobs:
        if deadline is not None and monotonic() >= deadline:
            return {"state": "watch_window_ended", "completed": completed}
        prepare()  # Unresolved monitoring/publishing checkpoints block every claim.
        if deadline is not None and monotonic() >= deadline:
            return {"state": "watch_window_ended", "completed": completed}
        job = bridge.rpc(claim_method)
        if job is None:
            if deadline is None:
                return {"state": "idle", "completed": completed}
            pause = min(30, max(0, deadline - monotonic()))
            if pause:
                sleep(pause)
            continue
        execute_job(job)  # Exactly one invocation. An exception stops the entire run.
        saved = journal.read()
        if not saved or saved["state"] != "result_ready" or saved["job"]["job_id"] != job["job_id"]:
            raise ValueError("Publishing did not produce one durable result for the exact claimed job")
        outcome = saved["result"]["outcome"]
        recover()  # Receipt replay/cleanup must settle before another job is claimed.
        completed += 1
        if outcome != "submitted":
            return {"state": "stopped_on_non_submission", "completed": completed, "outcome": outcome}
    return {"state": "job_limit_reached", "completed": completed}
