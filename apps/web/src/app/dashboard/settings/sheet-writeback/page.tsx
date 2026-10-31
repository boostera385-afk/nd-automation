import Link from "next/link";
import { z } from "zod";
import { requireWorkspace } from "@/lib/data";
import { PageHeader, Panel } from "@/components/ui";
import { SheetWritebackQueue } from "@/components/sheet-writeback-queue";

const itemShape = z.object({
  id: z.uuid(),
  seq: z.number().int().positive(),
  status: z.enum(["pending", "leased", "delivered", "conflict", "failed", "cancelled"]),
  attempts: z.number().int().min(0).max(10),
  intent: z.object({
    action: z.enum(["append", "update_cells"]),
    tab: z.string().min(1).max(80),
    rowRef: z.string().min(1).max(300).nullable(),
    values: z.array(z.record(z.string(), z.union([z.string(), z.null()]))).min(1).max(50),
  }),
  lease_expires_at: z.iso.datetime({ offset: true }).nullable(),
  last_error: z.string().max(500).nullable(),
  created_at: z.iso.datetime({ offset: true }),
  delivered_at: z.iso.datetime({ offset: true }).nullable(),
}).strict();

export default async function SheetWriteback() {
  const { db, organization, user } = await requireWorkspace(true);
  if (!user.email_confirmed_at) return <>
    <PageHeader title="Sheet writeback queue" description="Explicit, ordered and replay-safe Sheet write intents. Delivery to any real Sheet stays inactive." />
    <p role="alert">Verify your email before viewing or queueing Sheet writeback intents.</p>
    <Link className="text-link" href="/dashboard/settings">Back to settings</Link>
  </>;
  let items: z.infer<typeof itemShape>[] = [];
  let total = 0;
  try {
    const signal = AbortSignal.timeout(15000);
    const [queue, counted] = await Promise.all([
      db.from("reporting_sheet_writeback_outbox").select("id,seq,status,attempts,intent,lease_expires_at,last_error,created_at,delivered_at").eq("organization_id", organization.id).order("seq", { ascending: false }).limit(25).abortSignal(signal),
      db.from("reporting_sheet_writeback_outbox").select("id", { count: "exact", head: true }).eq("organization_id", organization.id).abortSignal(signal),
    ]);
    const parsed = z.array(itemShape).max(25).safeParse(queue.data);
    if (queue.error || counted.error || !parsed.success || typeof counted.count !== "number") throw new Error("Writeback queue read could not be verified.");
    items = parsed.data;
    total = counted.count;
  } catch {
    return <>
      <PageHeader title="Sheet writeback queue" description="Explicit, ordered and replay-safe Sheet write intents. Delivery to any real Sheet stays inactive." />
      <p role="alert">The writeback queue could not be verified. Nothing was queued, cancelled or changed; reload to retry the read.</p>
      <Link className="text-link" href="/dashboard/settings">Back to settings</Link>
    </>;
  }
  return <>
    <PageHeader title="Sheet writeback queue" description="Explicit, ordered and replay-safe Sheet write intents. Delivery to any real Sheet stays inactive." />
    <Panel title="Delivery is not active"><p>Intents queue durably in the shared backend only. No connector, worker or Edge Function writes any Sheet through this queue yet; your existing Sheets, Fudge writeback and release gates are unchanged. Activating delivery requires separate live acceptance and the configuration-ownership decision.</p></Panel>
    <Panel title="Queue intents and review exact status"><p>Each intent is bounded, confirmed and replay-safe: the same request or stable key never produces a second copy, and changed values under the same key are refused. Timeouts stay unconfirmed — reconcile the queue below rather than re-queueing with new IDs.</p><SheetWritebackQueue items={items} total={total} /></Panel>
    <Link className="text-link" href="/dashboard/settings">Back to settings</Link>
  </>;
}
