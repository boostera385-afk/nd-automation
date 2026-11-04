import { requireWorkspace } from "@/lib/data";
import { sheetConnectionConfigured } from "@/lib/sheet-sync";
import { SHEET_CONNECTOR_SOURCE } from "@/generated/sheet-connector";
import { SheetSetupWizard } from "@/components/sheet-setup-wizard";
import { PageHeader } from "@/components/ui";

export default async function SheetSetup() {
  const { organization } = await requireWorkspace(true);
  return <>
    <PageHeader eyebrow="INTERNAL WORKSPACE SETUP" title="Connect your Master Sheet" description="Two steps, once for the whole workspace — like saving the worker credential: prepare a small read-only connector in Google, then save its URL and private token here. No hosting settings or restarts needed." />
    <SheetSetupWizard workspaceId={organization.id} configured={await sheetConnectionConfigured(organization.id)} connectorSource={SHEET_CONNECTOR_SOURCE} />
  </>;
}
