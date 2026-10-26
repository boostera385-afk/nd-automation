import Link from "next/link";
import { getDashboardData, requireWorkspace } from "@/lib/data";
import { PublicationForm, CsvImport } from "@/components/reporting-forms";
import { PageHeader, Panel, EmptyState } from "@/components/ui";

export default async function NewPost() {
  await requireWorkspace(true);
  const { customers } = await getDashboardData();
  return <><PageHeader title="Record an existing post" description="Add an authorized link to the reporting ledger. This form cannot publish, schedule or modify a Nextdoor post." />{customers.length ? <div className="two-column"><Panel title="One post link"><PublicationForm customers={customers} /></Panel><Panel title="Reviewed CSV import"><CsvImport customers={customers} /></Panel></div> : <Panel title="Customer required"><EmptyState title="Add your first customer">Associate every post with a customer before recording it. <Link href="/dashboard/customers">Open customers</Link>.</EmptyState></Panel>}</>;
}
