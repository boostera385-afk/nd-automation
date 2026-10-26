import { getDashboardData, requireWorkspace } from "@/lib/data";
import { CustomerForm } from "@/components/reporting-forms";
import { EmptyState, PageHeader, Panel } from "@/components/ui";

export default async function Customers() {
  const { isStaff } = await requireWorkspace();
  const { customers, publications } = await getDashboardData();
  return <><PageHeader title="Customers" description="Clear ownership for every post record. Customer timezones are explicit, never inferred from a proxy or device location." /><div className={isStaff ? "two-column wide-left" : ""}><Panel title={`${customers.length} assigned customers`}>{customers.length ? <div className="customer-list">{customers.map((customer) => <article className="customer-row" key={customer.id}><span className="customer-avatar">{customer.name.slice(0, 1)}</span><div><h3>{customer.name}</h3><p>{customer.service || "No service description"}</p><small>{customer.time_zone}</small></div><strong>{publications.filter((post) => post.customer_id === customer.id).length}<small>post records</small></strong></article>)}</div> : <EmptyState title="No customers yet">Only customers your account is permitted to view appear here. No workbook data is imported automatically.</EmptyState>}</Panel>{isStaff && <Panel title="Add customer"><CustomerForm /></Panel>}</div></>;
}
