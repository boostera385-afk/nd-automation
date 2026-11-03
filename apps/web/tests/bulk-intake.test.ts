import { expect, it } from "vitest";
import { stagedIntakeSchema } from "@/lib/bulk-intake";
const id = "11111111-1111-4111-8111-111111111111";
const row = { row: 1, profile_id: id, kind: "cookie_write", replace: false, entries: 1, path: `C:/Private/${id}.private.bin` };
const input = { state: "staged_not_queued", expires_at: "2026-11-04T15:00:00Z", rows: [row] };
it("accepts only bounded redacted protected descriptors", () => {
  expect(stagedIntakeSchema.safeParse(input).success).toBe(true);
  for (const change of [{ ...row, cookies: "secret" }, { ...row, path: "C:/cookies.txt" }, { ...row, path: `\\\\server\\${id}.private.bin` }, { ...row, path: `C:/../${id}.private.bin` }, { ...row, profile_id: "profile name" }, { ...row, entries: 0 }, { ...row, kind: "proxy_write", replace: true }]) {
    expect(stagedIntakeSchema.safeParse({ ...input, rows: [change] }).success).toBe(false);
  }
});
it("refuses duplicate targets, overflow and raw credentials", () => {
  expect(stagedIntakeSchema.safeParse({ ...input, rows: [row, row] }).success).toBe(false);
  expect(stagedIntakeSchema.safeParse({ ...input, rows: Array(101).fill(row) }).success).toBe(false);
  expect(stagedIntakeSchema.safeParse({ ...input, proxy_password: "secret" }).success).toBe(false);
});
