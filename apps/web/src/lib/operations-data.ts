import "server-only";
import { cache } from "react";
import { requireWorkspace } from "./data";
import { isMissingSchemaError } from "./checks";
import type { LocalWorker, MonitoringJob, ProfileBinding } from "./workflow";

export const getOperationsData = cache(async () => {
  const { db, organization } = await requireWorkspace(true);
  const [workers, bindings, jobs] = await Promise.all([
    db.from("reporting_workers").select("id,name,enabled,last_seen_at").eq("organization_id", organization.id).order("name").limit(1001),
    db.from("reporting_worker_profiles").select("id,worker_id,customer_id,profile_id,account_label,monitoring_session_id").eq("organization_id", organization.id).order("account_label").limit(1001),
    db.from("reporting_check_jobs").select("id,publication_id,worker_id,status,outcome,created_at,lease_expires_at").eq("organization_id", organization.id).order("created_at", { ascending: false }).limit(101),
  ]);
  const errors = [workers.error, bindings.error, jobs.error].filter(Boolean);
  if (errors.some((error) => !isMissingSchemaError(error))) throw new Error("Local automation status could not be loaded. No jobs were changed.");
  return { loadedAt: Date.now(), bindingsLimited: (bindings.data?.length ?? 0) > 1000, available: errors.length === 0, workers: (workers.data ?? []).slice(0, 1000) as LocalWorker[], bindings: (bindings.data ?? []).slice(0, 1000) as ProfileBinding[], jobs: (jobs.data ?? []).slice(0, 100) as MonitoringJob[], limited: (workers.data?.length ?? 0) > 1000 || (bindings.data?.length ?? 0) > 1000 || (jobs.data?.length ?? 0) > 100 };
});
