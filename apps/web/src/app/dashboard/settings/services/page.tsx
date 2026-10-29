import Link from "next/link";
import { requireWorkspace } from "@/lib/data";
import { ServiceCatalogPreview } from "@/components/service-catalog-preview";
import { PageHeader, Panel } from "@/components/ui";
import { z } from "zod";

export default async function Services() {
  const { db, organization, user } = await requireWorkspace(true);
  if (!user.email_confirmed_at) return <p role="alert">Verify your email before previewing service configuration.</p>;
  let expectedRevision: number | undefined;
  let recent: Array<{ id: string; revision: number; created_at: string }> = [];
  try {
    const signal = AbortSignal.timeout(15000);
    const [head, history] = await Promise.all([
      db.from("reporting_service_catalog_heads").select("latest_revision").eq("organization_id", organization.id).abortSignal(signal).maybeSingle(),
      db.from("reporting_service_catalog_revisions").select("id,revision,created_at").eq("organization_id", organization.id).order("revision", { ascending: false }).limit(20).abortSignal(signal),
    ]);
    const parsedHead = z.object({ latest_revision: z.number().int().nonnegative().max(2147483646) }).nullable().safeParse(head.data);
    const parsedHistory = z.array(z.object({ id: z.uuid(), revision: z.number().int().positive(), created_at: z.iso.datetime({ offset: true }) }).strict()).max(20).safeParse(history.data);
    if (!head.error && !history.error && parsedHead.success && parsedHistory.success) {
      expectedRevision = parsedHead.data?.latest_revision ?? 0;
      recent = parsedHistory.data;
    }
  } catch { /* Fail closed: local preview stays usable, staging is unavailable. */ }
  return <>
    <PageHeader title="Service keyword import preview" description="Inspect and explicitly stage an inactive catalog revision. Current Fudge and Sheet settings stay unchanged." />
    <Panel title="Backend staging status">{expectedRevision === undefined ? <p role="alert">Backend revision status could not be verified. Local preview is available; saving is disabled until access/schema/connectivity is verified.</p> : <><p>Latest saved revision at this read: {expectedRevision}. Save uses an expected-version check; no rules are activated.</p><ul>{recent.map((row) => <li key={row.id}><Link href={`/dashboard/settings/services/${row.id}`}>Review revision {row.revision}</Link> · <code>{row.id}</code> · {new Date(row.created_at).toISOString()} (UTC)</li>)}</ul><p className="small muted">Latest 20 revision receipts only; not the complete history. After a lost response or reload, reconcile these IDs before another save.</p></>}</Panel>
    <Panel title="Validate a private catalog"><ServiceCatalogPreview expectedRevision={expectedRevision} /></Panel>
    <Panel title="Separate review and release"><p>Saving stages an inactive immutable revision only. Open a saved revision to compare exact rules; owner/admin activation requires separate confirmation. Automatic classification and Fudge rule application remain off. Blank exclusions stay blank; no keywords or synonyms are invented.</p><Link href="/dashboard/settings">Back to settings</Link></Panel>
  </>;
}
