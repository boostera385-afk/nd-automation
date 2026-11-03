import { heartbeatState } from "@/lib/workflow";

type Helper = { id: string; name: string; last_seen_at?: string | null };

// The name alone cannot tell two identically named computers apart. Show the
// heartbeat so a task is never queued to a helper that will not poll for it.
function describe(helper: Helper): string {
  if (helper.last_seen_at === undefined) return helper.name;
  if (helper.last_seen_at === null) return `${helper.name} (never connected)`;
  return `${helper.name} (${heartbeatState({ id: helper.id, name: helper.name, enabled: true, last_seen_at: helper.last_seen_at })})`;
}

export function LocalHelperField({ helpers }: { helpers: Helper[] }) {
  if (helpers.length === 1) return <><input type="hidden" name="worker" value={helpers[0].id} /><p className="small muted">Connected helper: {describe(helpers[0])}</p></>;
  return <label>Run using<select name="worker" required defaultValue=""><option value="" disabled>Choose the helper with these profiles</option>{helpers.map((helper) => <option key={helper.id} value={helper.id}>{describe(helper)} · {helper.id.slice(0, 8)}</option>)}</select><small>Use the helper your administrator prepared for this laptop. Names, saved profiles and heartbeats do not prove which computer you are using.</small></label>;
}
