import Link from "next/link";
import { requireWorkspace } from "@/lib/data";
import { ServiceCatalogPreview } from "@/components/service-catalog-preview";
import { PageHeader, Panel } from "@/components/ui";

export default async function Services() {
  const { user } = await requireWorkspace(true);
  if (!user.email_confirmed_at) return <p role="alert">Verify your email before previewing service configuration.</p>;
  return <>
    <PageHeader title="Service keyword import preview" description="Inspect the source catalog before implementing versioned backend storage. Current Fudge and Sheet settings stay unchanged." />
    <Panel title="Validate a private catalog"><ServiceCatalogPreview /></Panel>
    <Panel title="Not a release action"><p>No import, save, publication, automatic classification or Fudge configuration download is enabled here. Rule-version storage, authorization, conflict handling, matching fixtures and explicit activation are the next implementation gates. Blank exclusions stay blank; no keywords or synonyms are invented.</p><Link href="/dashboard/settings">Back to settings</Link></Panel>
  </>;
}
