"use client";

import { useState } from "react";
import { bindWorkerProfile } from "@/app/actions/workers";
import type { InventoryProfile } from "@/lib/profiles";
import { ActionForm } from "./action-form";

export function ProfileAssignment({ profiles, workers, customers }: { profiles: InventoryProfile[]; workers: { id: string; name: string }[]; customers: { id: string; name: string }[] }) {
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  return <ActionForm action={bindWorkerProfile} label="Save mapping once">
    <label>Existing profile<select name="profile" required value={id} onChange={(event) => { setId(event.target.value); setLabel(profiles.find((item) => item.profile_id === event.target.value)?.name ?? ""); }}><option value="" disabled>Choose name / group</option>{profiles.map((profile) => <option key={profile.profile_id} value={profile.profile_id}>{profile.name} · {profile.group_name} · {profile.profile_id}</option>)}</select></label>
    <label>Customer<select name="customer" required defaultValue=""><option value="" disabled>Choose the authorized customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
    <label>Laptop<select name="worker" required defaultValue={workers.length === 1 ? workers[0].id : ""}><option value="" disabled>Choose the assigned laptop</option>{workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select></label>
    <label>Profile Name exactly as written in the master Sheet<input name="label" required maxLength={120} value={label} onChange={(event) => setLabel(event.target.value)} /><small>Used to match known post links automatically. Duplicate names must be resolved by exact UUID.</small></label>
    <label className="check"><input name="authorized" type="checkbox" required />This customer authorizes this exact profile and read-only post monitoring. Saving does not start a browser.</label>
  </ActionForm>;
}
