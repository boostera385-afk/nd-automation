import "server-only";
import { requireWorkspace } from "./data";
import { isMissingSchemaError } from "./checks";
import type { ContentTarget } from "./content";

export async function getContentTargets() {
  const { db, organization } = await requireWorkspace(true);
  const [bindings, customers, workers] = await Promise.all([
    db.from("reporting_worker_profiles").select("id,customer_id,worker_id,profile_id,account_label").eq("organization_id", organization.id).order("account_label").limit(501),
    db.from("reporting_customers").select("id,name").eq("organization_id", organization.id).order("name").limit(501),
    db.from("reporting_workers").select("id,name,enabled").eq("organization_id", organization.id).order("name").limit(501),
  ]);
  const errors = [bindings.error, customers.error, workers.error].filter(Boolean);
  if (errors.some((error) => !isMissingSchemaError(error))) throw new Error("Content assignments could not be loaded.");
  const targets = ((bindings.data ?? []).slice(0, 500) as ContentTarget[]).flatMap((binding) => {
    const customer = customers.data?.slice(0, 500).find((row) => row.id === binding.customer_id);
    const worker = workers.data?.slice(0, 500).find((row) => row.id === binding.worker_id && row.enabled);
    return customer && worker ? [{ ...binding, label: `${customer.name} · ${binding.account_label} · ${worker.name} · ${binding.profile_id}` }] : [];
  });
  return { targets, available: errors.length === 0, limited: [bindings.data, customers.data, workers.data].some((rows) => (rows?.length ?? 0) > 500) };
}
