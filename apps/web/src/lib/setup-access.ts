/** Configuration is separate from daily execution. Never trust a submitted role. */
export function canManageSetup(role: string | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function assertSetupAdmin(membership: { role: string } | null | undefined): void {
  if (!canManageSetup(membership?.role)) throw new Error("Only a workspace owner or admin can change setup. Ask your administrator.");
}
