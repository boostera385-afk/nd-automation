import { requireWorkspace } from "@/lib/data";
import { PageHeader, Panel } from "@/components/ui";

export default async function Settings() {
  const { organization, membership } = await requireWorkspace();
  return <><PageHeader title="Workspace settings" description="Your business context, reporting timezone and account access." /><div className="two-column"><Panel title="Workspace details"><dl className="definition-list"><dt>Name</dt><dd>{organization.name}</dd><dt>Business timezone</dt><dd>{organization.time_zone}</dd><dt>Your role</dt><dd>{membership.role}</dd><dt>Working model</dt><dd>Daily reporting sessions, with separate local and business clocks.</dd></dl></Panel><Panel title="Your data, in context"><p className="muted">Access is limited to your assigned workspace and customers. A saved observation shows what was reviewed at its recorded time, not a guarantee of current visibility.</p><p className="muted">Contact your workspace administrator for access changes. Customer timezone details are shown on each customer record; they never change just because a device is in another location.</p></Panel></div></>;
}
