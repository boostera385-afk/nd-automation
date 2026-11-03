"use client";

import { useState } from "react";
import type { ProfileRow } from "@/lib/profiles";
import { setProfileArchived } from "@/app/actions/profiles";
import { ActionForm } from "./action-form";
import { profileListPage } from "@/lib/profile-list";

export function ProfileInventoryTable({ profiles, editable = false }: { profiles: (ProfileRow & { status?: string })[]; editable?: boolean }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const result = profileListPage(profiles, search, page);
  const { pages, page: current } = result;
  return <>
    <label>Search profiles<input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Name, group or UUID" /></label>
    <p className="small">{result.matches} of {profiles.length} loaded profiles match · page {current + 1} of {pages}.</p>
    <div className="table-wrap"><table><thead><tr><th>Profile</th><th>Group</th><th>Profile ID</th>{editable && <th>Inventory status</th>}</tr></thead><tbody>{result.rows.map((profile) => <tr key={profile.profile_id}><td>{profile.name}</td><td>{profile.group_name}</td><td><code>{profile.profile_id}</code></td>{editable && <td><ActionForm action={setProfileArchived} label={profile.status === "archived" ? "Reactivate inventory" : "Archive inventory"} secondary><input type="hidden" name="profile" value={profile.profile_id} /><input type="hidden" name="archived" value={profile.status === "archived" ? "false" : "true"} /><label className="check"><input type="checkbox" name="confirmed" required />Change this inventory claim only.</label></ActionForm></td>}</tr>)}</tbody></table></div>
    {!result.matches && <p>No matching loaded profiles. This search does not scan a laptop.</p>}
    <div className="action-row"><button type="button" className="button secondary" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous profiles</button><button type="button" className="button secondary" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>Next profiles</button></div>
  </>;
}
