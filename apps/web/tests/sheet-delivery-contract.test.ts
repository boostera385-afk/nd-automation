import { expect, it } from "vitest";
import { sheetDeliveryIntentSchema } from "@/lib/sheet-writeback-contract";

const id = "11111111-1111-4111-8111-111111111111";
const row = { "ND Row ID": id, Status: "Filled 😀" };
const intent = () => ({ action: "append", tab: "Auto Posting", rowRef: null, values: [{ ...row }] });

it("accepts stable, bounded append rows including literal formula-looking text", () => {
  expect(sheetDeliveryIntentSchema.safeParse(intent()).success).toBe(true);
  expect(sheetDeliveryIntentSchema.safeParse({ ...intent(), values: [{ ...row, "Post Text": "=literal text" }] }).success).toBe(true);
});
it("accepts one stable-ID update with an explicit expected revision", () => {
  expect(sheetDeliveryIntentSchema.safeParse({ action: "update_cells", tab: "Auto Posting", rowRef: `id:${id}`,
    values: [{ Status: null, __expected_revision: "1" }] }).success).toBe(true);
});
it.each(["legacy row", "duplicate id", "secret column", "missing id", "missing field", "surrogate", "tab"])("refuses %s for delivery", (kind) => {
  const value: Record<string, unknown> = intent();
  if (kind === "legacy row") { value.action = "update_cells"; value.rowRef = "A2"; value.values = [{ Status: "Filled", __expected_revision: "1" }]; }
  if (kind === "duplicate id") value.values = [row, row];
  if (kind === "secret column") value.values = [{ ...row, Password: "never-upload-this" }];
  if (kind === "missing id") value.values = [{ Status: "Filled" }];
  if (kind === "missing field") value.values = [{ "ND Row ID": id }];
  if (kind === "surrogate") value.values = [{ ...row, Status: "\ud800" }];
  if (kind === "tab") value.tab = "ND Acc Creation";
  expect(sheetDeliveryIntentSchema.safeParse(value).success).toBe(false);
});
