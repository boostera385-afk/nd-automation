"use client";

import { useState } from "react";
import { saveContentDraft } from "@/app/actions/content";
import { audiences, type ContentDraft, type ContentTarget } from "@/lib/content";
import { ActionForm } from "./action-form";

export function ContentComposer({ id, draft, targets }: { id: string; draft?: ContentDraft; targets: (ContentTarget & { label: string })[] }) {
  const [kind, setKind] = useState(draft?.content.kind ?? "post");
  const [title, setTitle] = useState(draft?.content.title ?? "");
  const [body, setBody] = useState(draft?.content.body ?? "");
  const [audience, setAudience] = useState(draft?.content.audience ?? "neighborhood");
  const [binding, setBinding] = useState(draft?.binding_id ?? "");
  const target = targets.find((item) => item.id === binding);
  return <div className="composer-layout">
    <ActionForm action={saveContentDraft} label="Save draft — does not publish">
      <input type="hidden" name="draft" value={id} /><input type="hidden" name="expected_revision" value={draft?.revision ?? 0} />
      <label>Authorized customer / profile<select name="binding" required value={binding} onChange={(e) => setBinding(e.target.value)}><option value="" disabled>Choose an exact assignment</option>{targets.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>Content type<select name="kind" value={kind} onChange={(e) => setKind(e.target.value as "post" | "listing")}><option value="post">Standard text post</option><option value="listing">Listing</option></select></label>
      <label>{kind === "listing" ? "Listing title" : "Internal title (not post text)"}<input name="title" required minLength={3} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>{kind === "listing" ? "Description" : "Post text"}<textarea name="body" required maxLength={5000} rows={9} value={body} onChange={(e) => setBody(e.target.value)} /><small>{body.length} / 5,000 characters</small></label>
      <label>Intended audience<select name="audience" value={audience} onChange={(e) => setAudience(e.target.value as keyof typeof audiences)}>{Object.entries(audiences).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {kind === "listing" && <><label>Price (USD; 0 for free)<input name="price" required inputMode="decimal" placeholder="0.00" defaultValue={draft?.content.kind === "listing" ? (draft.content.price_cents / 100).toFixed(2) : ""} /></label><label>Requested category<input name="category" required maxLength={120} defaultValue={draft?.content.category ?? ""} /><small>Draft preference only; supported platform categories must be validated before submission.</small></label></>}
      <p className="muted small">Text-only preparation. Attachments, scheduling and browser submission are not enabled. Never paste passwords, cookies or proxies into content.</p>
    </ActionForm>
    <aside className="notice subtle composer-preview" aria-label="Content preview"><p className="eyebrow">UNPUBLISHED PREVIEW</p><h3>{title || "Untitled draft"}</h3><p>{target?.label || "Choose a customer and profile"}</p>{target && <p className="small">Exact UUID: <code>{target.profile_id}</code></p>}<p><strong>{audiences[audience]}</strong> · {kind === "listing" ? "Listing" : "Standard post"}</p><div className="content-body">{body || "Your content preview will appear here."}</div><p className="small muted">Not a platform preview or visibility claim. The actual audience must be verified in the browser before any future submission.</p></aside>
  </div>;
}
