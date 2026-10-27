import { parse } from "csv-parse/sync";
import { z } from "zod";

export const profileRowSchema = z.object({
  profile_id: z.uuid(),
  name: z.string().trim().min(1).max(200),
  group_name: z.string().trim().min(1).max(200),
}).strict();
export type ProfileRow = z.infer<typeof profileRowSchema>;
export type InventoryProfile = ProfileRow & { status: "active" | "archived"; updated_at: string };

// CSV headers come from the legacy sheet-style export; values map to the strict row schema.
const headerAliases: Record<string, keyof ProfileRow> = { profile_id: "profile_id", id: "profile_id", name: "name", "profile name": "name", profile_name: "name", group: "group_name", group_name: "group_name", "group name": "group_name" };

export function previewProfileCsv(text: string): { rows: ProfileRow[]; errors: string[] } {
  if (Buffer.byteLength(text, "utf8") > 1024 * 1024) return { rows: [], errors: ["Import file must be smaller than 1 MB."] };
  let records: Record<string, string>[];
  try {
    records = parse(text, {
      bom: true, skip_empty_lines: true, trim: true, max_record_size: 2000,
      columns: (headers: string[]) => {
        const mapped = headers.map((h) => headerAliases[h.trim().toLowerCase()]);
        if (mapped.some((h) => !h) || new Set(mapped).size !== mapped.length) throw new Error("Invalid headers");
        if (!mapped.includes("profile_id") || !mapped.includes("name")) throw new Error("Missing headers");
        return mapped as string[];
      },
    }) as Record<string, string>[];
  } catch {
    return { rows: [], errors: ["Use CSV headers profile_id,name,group (a Profile Name column is accepted). UUIDs and names only — never cookies, proxies or passwords."] };
  }
  if (records.length === 0 || records.length > 5000) return { rows: [], errors: ["Import between 1 and 5,000 profiles at a time."] };
  const rows: ProfileRow[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  records.forEach((record, index) => {
    const result = profileRowSchema.safeParse({ ...record, group_name: record.group_name || "Unassigned" });
    if (!result.success) { errors.push(`Row ${index + 2}: ${result.error.issues[0].message}`); return; }
    const key = result.data.profile_id.toLowerCase();
    if (seen.has(key)) { errors.push(`Row ${index + 2}: duplicate profile ID.`); return; }
    seen.add(key);
    rows.push(result.data);
  });
  return { rows, errors };
}
