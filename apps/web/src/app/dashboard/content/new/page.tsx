import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requireWorkspace } from "@/lib/data";
import { getContentTargets } from "@/lib/content-data";
import { isMissingSchemaError } from "@/lib/checks";
import { ContentComposer } from "@/components/content-composer";
import { EmptyState, PageHeader, Panel } from "@/components/ui";

export default async function NewContent() {
  const { db, organization } = await requireWorkspace(true);
  const schema = await db.from("reporting_content_drafts").select("id").eq("organization_id", organization.id).limit(1);
  if (schema.error && !isMissingSchemaError(schema.error)) throw new Error("Content setup could not be checked.");
  const { targets, available, limited } = await getContentTargets();
  return <><PageHeader eyebrow="PREPARE & REVIEW" title="Create content draft" description="Select an exact authorized profile, write content and review the intended audience. Saving never publishes." actions={<Link className="button secondary" href="/dashboard/content">All content</Link>} />
    {limited && <p className="notice">Assignment choices are limited to the first 500 records per source. Ask your administrator if an assignment is missing; never choose a substitute profile.</p>}
    <Panel title="Draft composer">{schema.error || !available ? <p className="notice">Content preparation needs an administrator database setup step.</p> : targets.length ? <ContentComposer id={randomUUID()} targets={targets} /> : <EmptyState title="Authorized profile needed">Add a customer and assign its exact profile to an enabled worker in <Link href="/dashboard/automation">Automation control</Link>. This does not require starting monitoring.</EmptyState>}</Panel>
  </>;
}
