import type { LocalWorker, MonitoringJob, ProfileBinding } from "./workflow";

// The registered agent reports a heartbeat when it polls. These thresholds describe
// that report only: nothing here probes Incogniton, opens a browser or starts a
// job. A profile can look healthy while its desktop app is still unusable.
export const HEARTBEAT_LIVE_MS = 5 * 60_000;
export const HEARTBEAT_STALE_MS = 30 * 60_000;

export type HealthLevel = "live" | "stale" | "offline" | "disabled";
export type HealthTone = "positive" | "attention" | "negative" | "neutral";

export const healthLabels: Record<HealthLevel, string> = {
  live: "Agent live",
  stale: "Heartbeat stale",
  offline: "Agent offline",
  disabled: "Agent disabled",
};

export const healthTones: Record<HealthLevel, HealthTone> = {
  live: "positive",
  stale: "attention",
  offline: "negative",
  disabled: "neutral",
};

export function workerLevel(worker: Pick<LocalWorker, "enabled" | "last_seen_at"> | undefined, now: number): HealthLevel {
  if (!worker) return "offline";
  if (!worker.enabled) return "disabled";
  if (!worker.last_seen_at) return "offline";
  const age = now - Date.parse(worker.last_seen_at);
  if (!Number.isFinite(age)) return "offline";
  if (age <= HEARTBEAT_LIVE_MS) return "live";
  if (age <= HEARTBEAT_STALE_MS) return "stale";
  return "offline";
}

export function relativeAge(lastSeenAt: string | null, now: number): string {
  if (!lastSeenAt) return "never reported";
  const age = now - Date.parse(lastSeenAt);
  if (!Number.isFinite(age)) return "time unknown";
  if (age < 0) return "just now";
  const minutes = Math.floor(age / 60_000);
  if (minutes < 1) return "under a minute ago";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ${hours % 24} h ago`;
}

export type ProfileHealth = {
  level: HealthLevel;
  tone: HealthTone;
  workerName: string;
  heartbeat: string;
  monitored: boolean;
  workerLeases: number;
  expiredLeases: number;
};

// Leases belong to a device, not to a single profile: reporting_check_jobs
// records the worker, never the Incogniton profile. Label them as device-wide.
export function profileHealth(input: {
  binding: ProfileBinding;
  worker: LocalWorker | undefined;
  jobs: MonitoringJob[];
  sessionId: string | null;
  now: number;
}): ProfileHealth {
  const { binding, worker, jobs, sessionId, now } = input;
  const level = workerLevel(worker, now);
  const leases = jobs.filter((job) => job.status === "leased" && job.worker_id === binding.worker_id);
  const expiredLeases = leases.filter((job) => job.lease_expires_at && Date.parse(job.lease_expires_at) < now).length;
  return {
    level,
    tone: healthTones[level],
    workerName: worker?.name ?? "Unassigned device",
    heartbeat: relativeAge(worker?.last_seen_at ?? null, now),
    // A profile counts as monitored only inside the active session it was
    // bound to, on an enabled device. No session means nothing is dispatched.
    monitored: Boolean(sessionId) && binding.monitoring_session_id === sessionId && Boolean(worker?.enabled),
    workerLeases: leases.length,
    expiredLeases,
  };
}

export type HealthSummary = {
  total: number;
  live: number;
  stale: number;
  offline: number;
  disabled: number;
  monitored: number;
  expiredLeases: number;
};

export function healthSummary(items: ProfileHealth[]): HealthSummary {
  const count = (level: HealthLevel) => items.filter((item) => item.level === level).length;
  return {
    total: items.length,
    live: count("live"),
    stale: count("stale"),
    offline: count("offline"),
    disabled: count("disabled"),
    monitored: items.filter((item) => item.monitored).length,
    expiredLeases: items.reduce((total, item) => total + item.expiredLeases, 0),
  };
}
