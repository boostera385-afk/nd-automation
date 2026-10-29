import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { fetchFudgeIntakeStatus, INTAKE_READ_TIMEOUT_MS } from "@/lib/fudge-intake-status";

const org = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const row = { id: "33333333-3333-4333-8333-333333333333", organization_id: org, record_id: "44444444-4444-4444-8444-444444444444", revision: 1, payload_sha256: "a".repeat(64), observed_at: "2026-10-28T12:00:00+00:00", received_at: "2026-10-29T12:00:00+00:00" };
function fixture(overrides: Record<number, Record<string, unknown>> = {}, throws = false, hangs = false) {
  const calls: Array<{ table: string; methods: Array<[string, unknown[]]> }> = [];
  const db = { from(table: string) {
    const index = calls.length;
    const call = { table, methods: [] as Array<[string, unknown[]]> }; calls.push(call);
    const result = { data: index === 2 ? [row] : null, count: index === 2 ? null : 1, error: null, ...overrides[index] };
    const query = {
      select(...args: unknown[]) { call.methods.push(["select", args]); return query; },
      eq(...args: unknown[]) { call.methods.push(["eq", args]); return query; },
      order(...args: unknown[]) { call.methods.push(["order", args]); return query; },
      limit(...args: unknown[]) { call.methods.push(["limit", args]); return query; },
      abortSignal(...args: unknown[]) { call.methods.push(["abortSignal", args]); return query; },
      then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
        if (hangs) return new Promise(() => {});
        return (throws ? Promise.reject(new Error("PRIVATE_SERVER_BODY")) : Promise.resolve(result)).then(resolve, reject);
      },
    };
    return query;
  } } as unknown as SupabaseClient;
  return { db, calls };
}

describe("Fudge intake metadata reads (fixtures, not hosted RLS acceptance)", () => {
  it("bounds hung reads and aborts all requests even when a transport ignores cancellation", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture({}, false, true);
      const work = fetchFudgeIntakeStatus(f.db, org);
      await vi.advanceTimersByTimeAsync(INTAKE_READ_TIMEOUT_MS);
      expect(await work).toMatchObject({ available: false, records: null, revisions: null });
      for (const call of f.calls) {
        const signal = call.methods.find(([method]) => method === "abortSignal")?.[1][0] as AbortSignal;
        expect(signal.aborted).toBe(true);
      }
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("clears the deadline after successful reads", async () => {
    vi.useFakeTimers();
    try {
      expect((await fetchFudgeIntakeStatus(fixture().db, org)).available).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("scopes all reads, uses exact HEAD counts and selects bounded metadata only", async () => {
    const f = fixture(); const result = await fetchFudgeIntakeStatus(f.db, org);
    expect(result).toMatchObject({ available: true, records: 1, revisions: 1, recent: [row], limited: false });
    expect(f.calls).toHaveLength(3);
    for (const call of f.calls) expect(call.methods).toContainEqual(["eq", ["organization_id", org]]);
    expect(f.calls[0].methods[0]).toEqual(["select", ["id", { count: "exact", head: true }]]);
    expect(f.calls[2].methods).toContainEqual(["limit", [51]]);
    expect(f.calls[2].methods.filter(([method]) => method === "order")).toEqual([
      ["order", ["received_at", { ascending: false }]], ["order", ["id", { ascending: false }]],
    ]);
    const selection = String(f.calls[2].methods[0][1][0]);
    expect(selection).not.toMatch(/\*|received_by|photo|author|payload,/);
  });
  it("distinguishes a successful empty read from failure", async () => {
    const f = fixture({ 0: { count: 0 }, 1: { count: 0 }, 2: { data: [] } });
    expect(await fetchFudgeIntakeStatus(f.db, org)).toMatchObject({ available: true, records: 0, revisions: 0, recent: [] });
  });
  it.each([0, 1, 2])("fails closed on query %s errors without returning private server bodies", async (index) => {
    const f = fixture({ [index]: { error: { message: "PRIVATE_SERVER_BODY" } } });
    const result = await fetchFudgeIntakeStatus(f.db, org);
    expect(result).toMatchObject({ available: false, records: null, revisions: null, recent: [] });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_SERVER_BODY");
  });
  it.each([null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("refuses invalid counts %s", async (count) => {
    expect((await fetchFudgeIntakeStatus(fixture({ 0: { count } }).db, org)).available).toBe(false);
  });
  it.each([
    [{ ...row, organization_id: other }], [{ ...row, revision: 0 }], [{ ...row, payload_sha256: "bad" }],
    [{ ...row, received_at: "not-a-date" }], [{ ...row, payload: { text: "PRIVATE_SOURCE" } }], [row, row], null,
  ])("rejects cross-business, malformed, duplicate or unexpected content rows", async (data) => {
    const result = await fetchFudgeIntakeStatus(fixture({ 2: { data } }).db, org);
    expect(result.available).toBe(false); expect(result.recent).toEqual([]);
  });
  it("shows at most 50 receipts and marks truncation honestly", async () => {
    const data = Array.from({ length: 51 }, (_, i) => ({ ...row, id: `33333333-3333-4333-8333-${String(i).padStart(12, "0")}` }));
    const result = await fetchFudgeIntakeStatus(fixture({ 2: { data } }).db, org);
    expect(result.available).toBe(true); expect(result.recent).toHaveLength(50); expect(result.limited).toBe(true);
  });
  it("rejects an invalid organization before any reads", async () => {
    const f = fixture(); expect((await fetchFudgeIntakeStatus(f.db, "invalid")).available).toBe(false);
    expect(f.calls).toHaveLength(0);
  });
  it("handles thrown transport failures without a false zero", async () => {
    const result = await fetchFudgeIntakeStatus(fixture({}, true).db, org);
    expect(result).toMatchObject({ available: false, records: null, revisions: null });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_SERVER_BODY");
  });
});
