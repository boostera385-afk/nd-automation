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
