"use client";

import { useActionState, useState } from "react";
import { enqueueSupervisedWorkflow } from "@/app/actions/supervised-workflows";
import { workflowOperations, type WorkflowManifest } from "@/lib/supervised-workflows";
import { WorkspaceField } from "./workspace-context";

export function SupervisedWorkflowForm({ bindings }: { bindings: Array<{ id: string; profile_id: string; customer_id: string; account_label: string }> }) {
  const [state, action, pending] = useActionState(enqueueSupervisedWorkflow, {});
  const [request] = useState(() => crypto.randomUUID());
  const [operation, setOperation] = useState<WorkflowManifest["operation"]>("account_inspect");
  const [bindingId, setBinding] = useState("");
  const [account, setAccount] = useState("");
  const [target, setTarget] = useState("");
  const [hash, setHash] = useState("");
  const [draft, setDraft] = useState("");
  const [revision, setRevision] = useState(1);
  const binding = bindings.find((item) => item.id === bindingId);
  const isPost = operation === "post_edit" || operation === "post_delete";
  const destructive = operation === "post_delete" || operation === "account_block";
  const manifest = { version: 1, operation, binding_id: bindingId, profile_id: binding?.profile_id ?? "", customer_id: binding?.customer_id ?? "",
    account_label: binding?.account_label ?? "", account_url: operation === "account_register" ? null : account,
    target_url: isPost || operation === "account_block" ? target : null, expected_body_sha256: isPost ? hash : null,
    draft_id: operation === "post_edit" ? draft : null, draft_revision: operation === "post_edit" ? revision : null, consent: true };
  if (state.success) return <p role="status">{state.success}</p>;
  return <form action={action} className="form-grid"><WorkspaceField />
    <fieldset disabled={pending}><legend>One exact operation</legend>
      <label>Operation<select value={operation} onChange={(event) => setOperation(event.target.value as WorkflowManifest["operation"])}>{Object.entries(workflowOperations).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Authorized assignment<select required value={bindingId} onChange={(event) => setBinding(event.target.value)}><option value="">Select exact customer/profile</option>{bindings.map((item) => <option key={item.id} value={item.id}>{item.account_label} · customer {item.customer_id} · profile {item.profile_id}</option>)}</select></label>
      {operation !== "account_register" && <label>Exact signed-in account profile URL<input type="url" required value={account} onChange={(event) => setAccount(event.target.value)} /></label>}
      {(isPost || operation === "account_block") && <label>Exact target URL<input type="url" required value={target} onChange={(event) => setTarget(event.target.value)} /></label>}
      {isPost && <label>Reviewed existing body SHA-256<input required pattern="[a-f0-9]{64}" value={hash} onChange={(event) => setHash(event.target.value)} /><small>Use the normalized visible body fingerprint reviewed on the authorized device. A changed source stops the task.</small></label>}
      {operation === "post_edit" && <><label>Approved text draft UUID<input required value={draft} onChange={(event) => setDraft(event.target.value)} /></label><label>Exact approved revision<input type="number" min={1} required value={revision} onChange={(event) => setRevision(Number(event.target.value))} /></label></>}
      <p>No email, password, OTP, birth date, residence, browser state or local selector is sent in this form. Registration fills only genuine operator-supplied local fields and attempts one first-step submission. Human verification and consent remain human steps. Text edits can retain existing attachments only with a separately reviewed local retain-all adapter. Adding, removing or reordering attachments is not supported. Live platform compatibility is not yet verified.</p>
      <details><summary>Review non-secret manifest for the local plan</summary><pre>{JSON.stringify(manifest, null, 2)}</pre></details>
      <p>Request ID: <code>{request}</code></p>
      <input type="hidden" name="requestId" value={request} /><input type="hidden" name="manifest" value={JSON.stringify(manifest)} />
      <label><input type="checkbox" name="confirmed" required /> I reviewed this exact customer, profile, operation, target and revision, hold permission, and will use the same privately reviewed local plan.</label>
      {destructive && <label><input type="checkbox" name="destructive" required /> I explicitly authorize this one deletion or block after checking the exact target. This is not bulk moderation.</label>}
    </fieldset>
    {state.error && <p role="alert">{state.error}</p>}<button type="submit" disabled={pending || !binding}>{pending ? "Recording…" : "Authorize one supervised task"}</button>
  </form>;
}
