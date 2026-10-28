import { requireWorkspace } from "@/lib/data";
import { sheetSyncConfigured } from "@/lib/sheet-sync";
import { SHEET_CONNECTOR_SOURCE } from "@/generated/sheet-connector";
import { SheetSetupWizard } from "@/components/sheet-setup-wizard";
import { PageHeader } from "@/components/ui";

export default async function SheetSetup() {
  const { organization } = await requireWorkspace(true);
  return <>
    <PageHeader eyebrow="INTERNAL WORKSPACE SETUP" title="Connect your Master Sheet" description="Follow the numbered steps, copy the code and settings, then test the saved connection. Set up once for your organization—not once per staff member." />
    <SheetSetupWizard workspaceId={organization.id} configured={sheetSyncConfigured(organization.id)} connectorSource={SHEET_CONNECTOR_SOURCE} />
  </>;
}
