import type { SupabaseClient } from "@supabase/supabase-js";
import { PROFILE_SCAN_LIMIT, type InventoryProfile } from "./profiles";

/** Page beneath the Data API row ceiling; a large limit alone is not pagination. */
export async function loadProfileInventory(db: SupabaseClient, organizationId: string) {
  const rows: InventoryProfile[] = [];
  let total: number | null = null;
  while (rows.length <= PROFILE_SCAN_LIMIT) {
    const end = Math.min(rows.length + 499, PROFILE_SCAN_LIMIT);
    const result = await db.from("reporting_profile_inventory")
      .select("profile_id,name,group_name,status,updated_at", { count: "exact" })
      .eq("organization_id", organizationId).order("profile_id").range(rows.length, end);
    if (result.error) return { data: [] as InventoryProfile[], error: result.error, limited: false };
    if (result.count === null || (total !== null && result.count !== total)) throw new Error("Inventory changed or could not be loaded completely. Refresh before choosing a profile.");
    total = result.count;
    if (!result.data.length && rows.length < Math.min(total, PROFILE_SCAN_LIMIT + 1)) throw new Error("Profile inventory pagination was incomplete. Refresh before choosing a profile.");
    rows.push(...result.data as InventoryProfile[]);
    if (rows.length >= total || rows.length > PROFILE_SCAN_LIMIT) break;
  }
  if (new Set(rows.map((row) => row.profile_id)).size !== rows.length) throw new Error("Inventory changed during loading. Refresh before choosing a profile.");
  return { data: rows.slice(0, PROFILE_SCAN_LIMIT).sort((a, b) => a.name.localeCompare(b.name) || a.profile_id.localeCompare(b.profile_id)), error: null, limited: (total ?? 0) > PROFILE_SCAN_LIMIT };
}
