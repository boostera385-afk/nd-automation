import { z } from "zod";
import { validateLocalPath } from "./automation-tasks";

const stagedRow = z.strictObject({
  row: z.number().int().min(1).max(100), profile_id: z.uuid(),
  kind: z.enum(["cookie_write", "proxy_write"]), replace: z.boolean(), entries: z.number().int().min(1).max(5000),
  path: z.string().min(3).max(400).refine((value) => !validateLocalPath(value) && !value.startsWith("\\\\") && !value.startsWith("//") && !/[\u0000-\u001f]/.test(value) && /[a-f0-9-]{36}\.private\.bin$/.test(value)),
});
export const stagedIntakeSchema = z.strictObject({ state: z.literal("staged_not_queued"), expires_at: z.iso.datetime({ offset: true }), rows: z.array(stagedRow).min(1).max(100) }).superRefine((value, context) => {
  const identities = value.rows.map((row) => `${row.profile_id}/${row.kind}`);
  if (new Set(identities).size !== identities.length || value.rows.some((row) => row.kind === "proxy_write" && row.replace)) context.addIssue({ code: "custom", message: "Duplicate targets or invalid replacement." });
});
