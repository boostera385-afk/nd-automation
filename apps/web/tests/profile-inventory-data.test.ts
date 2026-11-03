import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { loadProfileInventory } from "@/lib/profile-inventory-data";

const row = (i: number) => ({ profile_id: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`, name: `Profile ${i}`, group_name: "Fixture", status: "active", updated_at: "2026-11-04T00:00:00Z" });
function client(rows: ReturnType<typeof row>[], maximum = 500) {
  const ranges: number[][] = [];
  const eq = vi.fn();
  const chain = { select: () => chain, eq: (key: string, value: string) => { eq(key, value); return chain; }, order: () => chain,
    range: vi.fn(async (start: number, end: number) => { ranges.push([start, end]); return { data: rows.slice(start, Math.min(end + 1, start + maximum)), error: null, count: rows.length }; }) };
  return { db: { from: vi.fn(() => chain) } as unknown as SupabaseClient, chain, ranges, eq };
}
it("loads all 3,135 rows under the Data API ceiling with a stable org filter", async () => {
  const fixture = client(Array.from({ length: 3135 }, (_, i) => row(i)));
  const result = await loadProfileInventory(fixture.db, "workspace");
  expect(result.data).toHaveLength(3135); expect(result.limited).toBe(false);
  expect(fixture.ranges).toHaveLength(7);
  expect(fixture.eq.mock.calls.every(([key, value]) => key === "organization_id" && value === "workspace")).toBe(true);
});
it("continues correctly even if the server returns less than a requested page", async () => {
  const fixture = client(Array.from({ length: 613 }, (_, i) => row(i)), 100);
  expect((await loadProfileInventory(fixture.db, "workspace")).data).toHaveLength(613);
});
it("honestly flags inventory beyond the 5,000-record supported window", async () => {
  const fixture = client(Array.from({ length: 5100 }, (_, i) => row(i)));
  const result = await loadProfileInventory(fixture.db, "workspace");
  expect(result.data).toHaveLength(5000); expect(result.limited).toBe(true);
});
it("fails closed on an empty intermediate page, changing counts or duplicates", async () => {
  const fixture = client(Array.from({ length: 600 }, (_, i) => row(i)));
  fixture.chain.range.mockResolvedValueOnce({ data: [], count: 600, error: null });
  await expect(loadProfileInventory(fixture.db, "workspace")).rejects.toThrow("incomplete");
  const changing = client(Array.from({ length: 600 }, (_, i) => row(i)));
  changing.chain.range.mockResolvedValueOnce({ data: Array.from({ length: 500 }, (_, i) => row(i)), count: 600, error: null });
  changing.chain.range.mockResolvedValueOnce({ data: [row(500)], count: 601, error: null });
  await expect(loadProfileInventory(changing.db, "workspace")).rejects.toThrow("changed");
  await expect(loadProfileInventory(client([row(1), row(1)]).db, "workspace")).rejects.toThrow("changed");
});
