export function LocalHelperField({ helpers }: { helpers: Array<{ id: string; name: string }> }) {
  if (helpers.length === 1) return <><input type="hidden" name="worker" value={helpers[0].id} /><p className="small muted">Connected helper: {helpers[0].name}</p></>;
  return <label>Run using<select name="worker" required defaultValue=""><option value="" disabled>Choose the helper with these profiles</option>{helpers.map((helper) => <option key={helper.id} value={helper.id}>{helper.name}</option>)}</select></label>;
}
