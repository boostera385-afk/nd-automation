import Link from "next/link";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireWorkspace } from "@/lib/data";
import { publishedServiceCatalogSchema, serviceRulesSchema, type ServiceRule } from "@/lib/service-catalog-contract";
import { ServiceCatalogReview } from "@/components/service-catalog-review";
import { PageHeader, Panel } from "@/components/ui";

export const dynamic = "force-dynamic";
type LoadedReview = { revision: number; rules: ServiceRule[]; active_revision_id: string | null; activation_version: number; activeRules: ServiceRule[] };
export default async function CatalogRevision({ params }: { params: Promise<{ id: string }> }) {
  const { db, organization, user, membership } = await requireWorkspace(true);
  const { id } = await params;
  const unavailable = <><PageHeader title="Configuration review unavailable" description="Verify your email, business access, revision ID and backend connection, then reload. No activation was requested." /><Link href="/dashboard/settings/services">Back to service configuration</Link></>;
  if (!user.email_confirmed_at || !z.uuid().safeParse(id).success) return unavailable;
  let loaded: LoadedReview | null = null;
  try {
    const signal = AbortSignal.timeout(15000);
    const [selected, head, published] = await Promise.all([
      db.from("reporting_service_catalog_revisions").select("id,revision,rules").eq("organization_id", organization.id).eq("id", id).abortSignal(signal).maybeSingle(),
      db.from("reporting_service_catalog_heads").select("active_revision_id,activation_version").eq("organization_id", organization.id).abortSignal(signal).maybeSingle(),
      db.rpc("reporting_get_service_catalog_v1", { org: organization.id }).abortSignal(signal),
    ]);
    if (!selected.error && !head.error && !published.error) {
      const revision = z.object({ id: z.uuid(), revision: z.number().int().positive(), rules: serviceRulesSchema }).strict().safeParse(selected.data);
      const current = z.object({ active_revision_id: z.uuid().nullable(), activation_version: z.number().int().min(0).max(2147483646) }).strict().safeParse(head.data);
      const active = publishedServiceCatalogSchema.nullable().safeParse(published.data);
      if (revision.success && revision.data.id === id && current.success && active.success) {
        const consistent = active.data
          ? active.data.organizationId === organization.id && active.data.generation === current.data.activation_version && active.data.revisionId === current.data.active_revision_id
          : current.data.active_revision_id === null && current.data.activation_version === 0;
        if (consistent) loaded = { revision: revision.data.revision, rules: revision.data.rules, active_revision_id: current.data.active_revision_id, activation_version: current.data.activation_version, activeRules: active.data?.rules ?? [] };
      }
    }
  } catch { /* Fail closed: any read/parse failure leaves the review unavailable. */ }
  if (!loaded) return unavailable;
  return <>
    <PageHeader title={`Review service revision ${loaded.revision}`} description="Exact immutable revision comparison. Opening this page does not activate or apply rules." />
    <Panel title="Review scope"><p>Revision ID: <code>{id}</code>. Published generation at this read: {loaded.activation_version}. Separate reads must agree; later changes invalidate activation through the expected-version check.</p><p>Activating an older revision is an explicit rollback with a newer generation, not deletion of history. Fudge download/application and source-upload release gates remain separate.</p></Panel>
    <Panel title="Exact rule changes"><ServiceCatalogReview key={`${id}:${loaded.activation_version}`} requestId={randomUUID()} selected={loaded.rules} active={loaded.activeRules} revisionId={id} generation={loaded.activation_version} canActivate={["owner", "admin"].includes(membership.role)} alreadyActive={loaded.active_revision_id === id} /></Panel>
    <Link href="/dashboard/settings/services">Back to service configuration</Link>
  </>;
}
