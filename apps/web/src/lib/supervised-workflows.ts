import { z } from "zod";

export const workflowOperations = {
  account_register: "Registration — genuine-data first step",
  account_login: "Sign in using private local credentials",
  account_inspect: "Verify signed-in account identity",
  profile_browse: "Open account for bounded read-only review",
  post_edit: "Edit one exact post/listing using an approved text revision",
  post_delete: "Delete one exact owned post/listing",
  account_block: "Block one explicitly selected account",
} as const;
const id = z.uuid().refine((value) => value === value.toLowerCase());
const account = z.string().regex(/^https:\/\/nextdoor\.com\/profile\/[A-Za-z0-9_-]+\/?$/);
const post = z.string().regex(/^https:\/\/nextdoor\.com\/(p|for_sale_and_free)\/[A-Za-z0-9_-]+$/);
export const workflowManifest = z.strictObject({
  version: z.literal(1), operation: z.enum(Object.keys(workflowOperations) as Array<keyof typeof workflowOperations>),
  binding_id: id, profile_id: id, customer_id: id, account_label: z.string().trim().min(1).max(120),
  account_url: account.nullable(), target_url: z.string().max(2048).nullable(), expected_body_sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  draft_id: id.nullable(), draft_revision: z.number().int().min(1).max(999999999).nullable(), consent: z.literal(true),
}).superRefine((value, context) => {
  const issue = () => context.addIssue({ code: "custom", message: "Review the exact operation's target, identity and approved revision." });
  if ((value.operation === "account_register") !== (value.account_url === null)) issue();
  if (value.operation === "post_edit" || value.operation === "post_delete") {
    if (!post.safeParse(value.target_url).success || !value.expected_body_sha256) issue();
  } else if (value.operation === "account_block") {
    if (!account.safeParse(value.target_url).success || value.target_url?.replace(/\/$/, "") === value.account_url?.replace(/\/$/, "") || value.expected_body_sha256 !== null) issue();
  } else if (value.target_url !== null || value.expected_body_sha256 !== null) issue();
  if (value.operation === "post_edit") {
    if (!value.draft_id || !value.draft_revision) issue();
  } else if (value.draft_id !== null || value.draft_revision !== null) issue();
});
export type WorkflowManifest = z.infer<typeof workflowManifest>;
export const workflowResult = z.strictObject({ operation: workflowManifest.shape.operation,
  outcome: z.enum(["verified", "handoff_required", "needs_reconciliation", "validation_error", "profile_error"]),
  action_attempted: z.boolean(), cleanup_confirmed: z.boolean(), adapter_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  observed_at: z.iso.datetime({ offset: true }),
});
