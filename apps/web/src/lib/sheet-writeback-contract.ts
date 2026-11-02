import { z } from "zod";

// Mirrors private_reporting.valid_writeback_intent in the sheet writeback
// outbox migration. The server re-validates everything; this contract bounds
// client input before a request is made. Nothing here dispatches a write: the
// delivery path is a separate, still-gated slice.
const noControl = (value: string) => !/[\u0000-\u001f\u007f]/.test(value);
const bounded = (max: number) => z.string().refine((value) => Array.from(value).length <= max && noControl(value));
const columnKey = bounded(100).refine((value) => value.trim().length > 0);
const cell = bounded(4000).nullable();
const row = z.record(columnKey, cell).refine((value) => Object.keys(value).length <= 100);

export const writebackIntentSchema = z.strictObject({
  action: z.enum(["append", "update_cells"]),
  tab: bounded(80).refine((value) => value.trim().length > 0),
  rowRef: z.union([bounded(300).refine((value) => value.trim().length > 0), z.null()]),
  values: z.array(row).min(1).max(50),
}).superRefine((intent, context) => {
  if (intent.action === "append" && intent.rowRef !== null) {
    context.addIssue({ code: "custom", message: "append intents must not pin a rowRef; the connector allocates it." });
  }
  if (intent.action === "update_cells" && intent.rowRef === null) {
    context.addIssue({ code: "custom", message: "update_cells intents require an explicit rowRef; no implicit target." });
  }
  if (new TextEncoder().encode(JSON.stringify(intent)).byteLength > 65536) {
    context.addIssue({ code: "custom", message: "Intent exceeds the 64 KiB transport bound." });
  }
});

export const writebackOutcomeSchema = z.enum(["delivered", "conflict", "failed", "retry"]);
export const writebackReceiptSchema = z.record(z.string().max(100), z.unknown()).refine(
  (receipt) => new TextEncoder().encode(JSON.stringify(receipt)).byteLength <= 8192 && Object.keys(receipt).length <= 20,
);
export type WritebackIntent = z.infer<typeof writebackIntentSchema>;
export type WritebackAckOutcome = z.infer<typeof writebackOutcomeSchema>;

/** Safe subset implemented by the separate v1 connector; legacy intents remain readable. */
export const sheetDeliveryIntentSchema = writebackIntentSchema.superRefine((intent, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  const columns = new Set(["Profile Name", "Post link", "Status", "Post Text", "Title"]);
  const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
  if (!["Auto Posting", "Auto Listing"].includes(intent.tab)) issue("The v1 deliverer supports Auto Posting and Auto Listing only.");
  if (intent.action === "update_cells" && (intent.values.length !== 1 || !intent.rowRef?.startsWith("id:") || !uuid(intent.rowRef.slice(3)))) {
    issue("Updates require one stable row reference id:UUID, never an A1 row number.");
  }
  const ids = new Set<string>();
  for (const value of intent.values) {
    const special = intent.action === "append" ? "ND Row ID" : "__expected_revision";
    if (!Object.keys(value).some((key) => columns.has(key)) || Object.keys(value).some((key) => key !== special && !columns.has(key))) {
      issue("Only approved non-secret columns plus row identity/revision may be queued for delivery.");
    }
    if (intent.action === "append") {
      if (!uuid(value[special]) || ids.has(value[special]!)) issue("Each appended row requires a unique ND Row ID UUID.");
      else ids.add(value[special]!);
    } else if (typeof value[special] !== "string" || !/^[1-9][0-9]{0,8}$/.test(value[special]!)) {
      issue("Updates require __expected_revision matching the current ND Revision cell.");
    }
    if (Object.values(value).some((cell) => typeof cell === "string" && /[\ud800-\udfff]/u.test(cell))) issue("Text must not contain unpaired Unicode surrogates.");
  }
});
