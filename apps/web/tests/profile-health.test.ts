import { describe, expect, it } from "vitest";
import { HEARTBEAT_LIVE_MS, HEARTBEAT_STALE_MS, healthLabels, healthSummary, profileHealth, relativeAge, workerLevel } from "@/lib/profile-health";
import type { LocalWorker, MonitoringJob, ProfileBinding } from "@/lib/workflow";

const now = Date.parse("2026-10-31T12:00:00.000Z");
const worker = (overrides: Partial<LocalWorker> = {}): LocalWorker => ({ id: "w1", name: "Kashif PC", enabled: true, last_seen_at: new Date(now - 60_000).toISOString(), ...overrides });
const binding = (overrides: Partial<ProfileBinding> = {}): ProfileBinding => ({ id: "b1", worker_id: "w1", customer_id: "c1", profile_id: "p1", account_label: "Thomas Gutierrez", monitoring_session_id: "s1", ...overrides });
const job = (overrides: Partial<MonitoringJob> = {}): MonitoringJob => ({ id: "j1", publication_id: "pub1", worker_id: "w1", status: "leased", outcome: null, created_at: new Date(now - 60_000).toISOString(), lease_expires_at: new Date(now + 5 * 60_000).toISOString(), ...overrides });
const health = (input: { worker?: LocalWorker; binding?: ProfileBinding; jobs?: MonitoringJob[]; sessionId?: string | null } = {}) => profileHealth({ binding: input.binding ?? binding(), worker: input.worker ?? worker(), jobs: input.jobs ?? [], sessionId: input.sessionId === undefined ? "s1" : input.sessionId, now });

describe("worker heartbeat level", () => {
  it("treats a report inside the live window as live", () => {
    expect(workerLevel(worker(), now)).toBe("live");
    expect(workerLevel(worker({ last_seen_at: new Date(now - HEARTBEAT_LIVE_MS).toISOString() }), now)).toBe("live");
  });

  it("separates a stale heartbeat from an offline one", () => {
    expect(workerLevel(worker({ last_seen_at: new Date(now - HEARTBEAT_LIVE_MS - 1).toISOString() }), now)).toBe("stale");
    expect(workerLevel(worker({ last_seen_at: new Date(now - HEARTBEAT_STALE_MS).toISOString() }), now)).toBe("stale");
    expect(workerLevel(worker({ last_seen_at: new Date(now - HEARTBEAT_STALE_MS - 1).toISOString() }), now)).toBe("offline");
  });

  it("reports a disabled laptop as disabled even with a fresh heartbeat", () => {
    expect(workerLevel(worker({ enabled: false }), now)).toBe("disabled");
  });

  it("never invents a heartbeat", () => {
    expect(workerLevel(worker({ last_seen_at: null }), now)).toBe("offline");
    expect(workerLevel(undefined, now)).toBe("offline");
    expect(workerLevel(worker({ last_seen_at: "not-a-date" }), now)).toBe("offline");
  });

  it("treats a future timestamp as live rather than negative age", () => {
    expect(workerLevel(worker({ last_seen_at: new Date(now + 60_000).toISOString() }), now)).toBe("live");
  });
});

describe("relative age wording", () => {
  it("describes each magnitude honestly", () => {
    expect(relativeAge(null, now)).toBe("never reported");
    expect(relativeAge(new Date(now - 20_000).toISOString(), now)).toBe("under a minute ago");
    expect(relativeAge(new Date(now - 4 * 60_000).toISOString(), now)).toBe("4 min ago");
    expect(relativeAge(new Date(now - (2 * 60 + 15) * 60_000).toISOString(), now)).toBe("2 h 15 min ago");
    expect(relativeAge(new Date(now - 50 * 60 * 60_000).toISOString(), now)).toBe("2 d 2 h ago");
    expect(relativeAge(new Date(now + 60_000).toISOString(), now)).toBe("just now");
    expect(relativeAge("not-a-date", now)).toBe("time unknown");
  });
});

describe("profile health", () => {
  it("shows the laptop name and heartbeat for a healthy profile", () => {
    const item = health();
    expect(item.level).toBe("live");
    expect(item.tone).toBe("positive");
    expect(item.workerName).toBe("Kashif PC");
    expect(item.heartbeat).toBe("1 min ago");
    expect(item.monitored).toBe(true);
  });

  it("does not call an unassigned laptop a named worker", () => {
    const item = profileHealth({ binding: binding(), worker: undefined, jobs: [], sessionId: "s1", now });
    expect(item.workerName).toBe("Unassigned laptop");
    expect(item.level).toBe("offline");
    expect(item.monitored).toBe(false);
  });

  it("requires the binding to belong to the active session", () => {
    expect(health({ sessionId: null }).monitored).toBe(false);
    expect(health({ sessionId: "other" }).monitored).toBe(false);
    expect(health({ binding: binding({ monitoring_session_id: null }) }).monitored).toBe(false);
    expect(health({ worker: worker({ enabled: false }) }).monitored).toBe(false);
  });

  it("counts leases for the laptop and flags only expired ones", () => {
    const jobs = [
      job(),
      job({ id: "j2", lease_expires_at: new Date(now - 60_000).toISOString() }),
      job({ id: "j3", status: "pending" }),
      job({ id: "j4", worker_id: "other" }),
    ];
    const item = health({ jobs });
    expect(item.workerLeases).toBe(2);
    expect(item.expiredLeases).toBe(1);
  });

  it("does not treat a lease with no deadline as expired", () => {
    const item = health({ jobs: [job({ lease_expires_at: null })] });
    expect(item.workerLeases).toBe(1);
    expect(item.expiredLeases).toBe(0);
  });
});

describe("health summary", () => {
  it("counts each level, monitored profiles and expired leases", () => {
    const items = [
      health(),
      health({ worker: worker({ last_seen_at: new Date(now - 10 * 60_000).toISOString() }) }),
      health({ worker: worker({ last_seen_at: new Date(now - 3 * 60 * 60_000).toISOString() }) }),
      health({ worker: worker({ enabled: false }) }),
      health({ jobs: [job({ lease_expires_at: new Date(now - 1_000).toISOString() })], worker: worker({ last_seen_at: new Date(now - 3 * 60 * 60_000).toISOString() }) }),
    ];
    const totals = healthSummary(items);
    expect(totals).toMatchObject({ total: 5, live: 1, stale: 1, offline: 2, disabled: 1, monitored: 4, expiredLeases: 1 });
  });

  it("describes an empty workspace without dividing by anything", () => {
    expect(healthSummary([])).toEqual({ total: 0, live: 0, stale: 0, offline: 0, disabled: 0, monitored: 0, expiredLeases: 0 });
  });
});

describe("labels", () => {
  it("states a status for every level", () => {
    expect(Object.values(healthLabels).every((label) => label.length > 0)).toBe(true);
  });
});
