import Link from "next/link";
import { z } from "zod";
import { requireWorkspace } from "@/lib/data";
import { workflowManifest, workflowOperations, workflowResult } from "@/lib/supervised-workflows";
import { SupervisedWorkflowForm } from "@/components/supervised-workflow-form";
import { ActionForm } from "@/components/action-form";
import { PageHeader, Panel } from "@/components/ui";
import { cancelBrowserTask, reconcileExpiredBrowserTask } from "@/app/actions/automation-tasks";

const bindingShape = z.object({ id: z.uuid(), profile_id: z.uuid(), customer_id: z.uuid(), account_label: z.string() });
const taskShape = z.object({ id: z.uuid(), status: z.enum(["pending", "leased", "succeeded", "failed", "cancelled"]),
  payload: z.object({ manifest: workflowManifest }), result: workflowResult.nullable(), error: z.string().nullable(), lease_expires_at: z.string().nullable() });

export default async function Workflows() {
  const { db, organization } = await requireWorkspace(true);
  const header = <PageHeader title="Supervised account & content workflows" description="One exact locally reviewed operation. Human identity challenges stop automation; results and uncertain actions remain visible." />;
  const protocol = await db.rpc("reporting_supervised_workflow_version").abortSignal(AbortSignal.timeout(15000));
  if (protocol.error || protocol.data !== 1) return <>{header}<Panel title="Reviewed migration required"><p>The workflow protocol is unavailable. No account or content operation can be queued here yet.</p></Panel></>;
  const [bindings, tasks] = await Promise.all([
    db.from("reporting_worker_profiles").select("id,profile_id,customer_id,account_label").eq("organization_id", organization.id).order("id").limit(101),
    db.from("reporting_automation_tasks").select("id,status,payload,result,error,lease_expires_at").eq("organization_id", organization.id).eq("kind", "supervised_workflow").order("created_at", { ascending: false }).order("id").limit(101),
  ]);
  const parsedBindings = z.array(bindingShape).max(101).safeParse(bindings.data);
  const parsedTasks = z.array(taskShape).max(101).safeParse(tasks.data);
  if (bindings.error || tasks.error || !parsedBindings.success || !parsedTasks.success) return <>{header}<p role="alert">Workflow state could not be verified. Refresh before authorizing another action.</p></>;
  return <>{header}<Panel title="Authorize a reviewed operation"><SupervisedWorkflowForm bindings={parsedBindings.data.slice(0, 100)} /></Panel>
    <Panel title="Latest 100 workflow requests" hint="Receipt recorded is not the same as action verified">
      {parsedTasks.data.slice(0, 100).map((task) => <article className="notice subtle" key={task.id}>
        <h3>{workflowOperations[task.payload.manifest.operation]}</h3><p>Request <code>{task.id}</code> · {task.status === "succeeded" ? "Result recorded" : task.status}</p>
        <p>{task.payload.manifest.account_label} · profile <code>{task.payload.manifest.profile_id}</code> · target <code>{task.payload.manifest.target_url ?? "Account access only"}</code></p>
        {task.result && <p>Outcome: <strong>{task.result.outcome}</strong> · action attempted: {task.result.action_attempted ? "yes" : "no"} · owned-profile cleanup confirmed: {task.result.cleanup_confirmed ? "yes" : "no"}. {task.result.outcome === "handoff_required" && "Complete identity/location/OTP/consent steps personally; do not rerun registration."}</p>}
        {task.error && <p>{task.error}</p>}
        {task.status === "pending" && <ActionForm action={cancelBrowserTask} label="Cancel pending task" secondary><input type="hidden" name="task" value={task.id} /></ActionForm>}
        {task.status === "leased" && <ActionForm action={reconcileExpiredBrowserTask} label="Reconcile expired task" secondary><input type="hidden" name="task" value={task.id} /><label><input type="checkbox" name="reconciled" required /> I stopped the runner and inspected the exact account/profile/action. Reconciliation never proves it did not run.</label></ActionForm>}
      </article>)}
      {(parsedBindings.data.length > 100 || parsedTasks.data.length > 100) && <p>Partial view: earlier requests or assignments are omitted.</p>}
      <p>Verified account access or a maintenance action does not update post visibility, yesterday’s check coverage, or Sheet status. Those require separately sourced observations.</p>
    </Panel><Link href="/dashboard/run/cohorts">Check yesterday’s exact post cohort</Link></>;
}
