/** UI availability only. Database RPCs independently enforce authorization. */
export function hasActiveSession(session: { status: string; started_at: string } | null, now: number): boolean {
  if (!session || session.status !== "active") return false;
  const age = now - Date.parse(session.started_at);
  return Number.isFinite(age) && age >= 0 && age < 10 * 3600_000;
}
