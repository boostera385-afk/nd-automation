"use client";

import { useMemo, useState } from "react";
import { bindWorkerProfile } from "@/app/actions/workers";
import type { InventoryProfile } from "@/lib/profiles";
import { ActionForm } from "./action-form";
import { LocalHelperField } from "./local-helper-field";

export function ProfileAssignment({ profiles, workers, customers }: { profiles: InventoryProfile[]; workers: { id: string; name: string }[]; customers: { id: string; name: string }[] }) {
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return profiles;
    return profiles.filter((profile) => `${profile.name} ${profile.group_name} ${profile.profile_id}`.toLowerCase().includes(text));
  }, [profiles, query]);
  // A long inventory is unusable without search; keep the current choice visible even when it stops matching.
  const chosen = profiles.filter((profile) => profile.profile_id === id);
  const visible = chosen.length && !matches.some((profile) => profile.profile_id === id) ? [...chosen, ...matches] : matches;
  return <ActionForm action={bindWorkerProfile} label="Save mapping once">
    <label>Find profile<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Type a profile name, group or UUID" /><small>{profiles.length ? `${visible.length} of ${profiles.length} profiles shown.` : "No profiles in inventory yet — detect profiles first."}</small></label>
    <label>Existing profile<select name="profile" required value={id} onChange={(event) => { setId(event.target.value); setLabel(profiles.find((item) => item.profile_id === event.target.value)?.name ?? ""); }}><option value="" disabled>Choose name / group</option>{visible.map((profile) => <option key={profile.profile_id} value={profile.profile_id}>{profile.name} · {profile.group_name} · {profile.profile_id}</option>)}</select></label>
    <label>Customer<select name="customer" required defaultValue=""><option value="" disabled>Choose the authorized customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
    <LocalHelperField helpers={workers} />
    <label>Profile Name exactly as written in the master Sheet<input name="label" required maxLength={120} value={label} onChange={(event) => setLabel(event.target.value)} /><small>Used to match known post links automatically. Duplicate names must be resolved by exact UUID.</small></label>
    <label className="check"><input name="authorized" type="checkbox" required />This customer authorizes this exact profile and read-only post monitoring. Saving does not start a browser.</label>
  </ActionForm>;
}
