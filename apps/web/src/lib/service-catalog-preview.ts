import { z } from "zod";

export const CATALOG_MAX_BYTES = 1024 * 1024;
const cell = z.string().max(8000).refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value));
const fields = ["Service Keyword", "Status", "Reviews Collected", "Notes", "Search Term", "Business Name Keywords", "Review Keywords", "Required Review Keywords", "Google Filter Keywords", "Exclude Keywords", "Service Family", "Subcategory", "Topic Filter Required", "Collect Family Reviews", "Rewrite Service Phrase", "Equivalent Service Phrases"] as const;
const rowSchema = z.object(Object.fromEntries(fields.map((field) => [field, cell.optional()]))).extend({ _sheet_row: z.number().int().positive().optional() }).strict();
const envelope = z.object({
  services: z.array(rowSchema).min(1).max(500),
  structure_keywords_not_in_services: z.array(cell).max(1000).optional(),
});
export type CatalogRule = {
  row: number; keyword: string; searchTerm: string; family: string; subcategory: string;
  businessSignals: string[]; reviewSignals: string[]; requiredSignals: string[];
  topicSignals: string[]; excludeSignals: string[]; topicRequired: boolean | null;
  collectFamilyInventory: boolean | null; rewriteServicePhrase: string; equivalentServicePhrases: string[];
};
export type CatalogPreview = { valid: boolean; rules: CatalogRule[]; errors: string[]; warnings: string[]; unmatched: string[] };
const exact = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");
// Mirrors current Fudge lookup normalization; collisions must be resolved, not merged.
const collectorKey = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const signals = (text: string) => [...new Set(text.split(/[|;\n]+/).map((value) => value.trim()).filter(Boolean))];
function bool(text: string): boolean | null {
  if (/^(true|yes|1)$/i.test(text.trim())) return true;
  if (/^(false|no|0)$/i.test(text.trim())) return false;
  return null;
}

export function previewServiceCatalog(text: string): CatalogPreview {
  const failed = (message: string): CatalogPreview => ({ valid: false, rules: [], errors: [message], warnings: [], unmatched: [] });
  if (new TextEncoder().encode(text).byteLength > CATALOG_MAX_BYTES) return failed("Catalog exceeds the 1 MiB preview limit.");
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return failed("Choose a valid service-catalog JSON file. Workbook files cannot be uploaded here."); }
  const input = envelope.safeParse(parsed);
  if (!input.success) return failed("Expected 1–500 Services rows with supported column names and bounded text cells. No data was saved.");
  const errors: string[] = [], warnings: string[] = [];
  const lookup = new Map<string, number>();
  const rules = input.data.services.map((source, index): CatalogRule => {
    const read = (field: string): string => String(source[field] ?? "").trim();
    const row = typeof source._sheet_row === "number" ? source._sheet_row : index + 2;
    const keyword = read("Service Keyword"), key = collectorKey(keyword);
    const family = read("Service Family"), subcategory = read("Subcategory"), searchTerm = read("Search Term");
    if (!keyword || !key || keyword.length > 200) errors.push(`Row ${row}: a supported keyword of at most 200 characters is required.`);
    if (key && lookup.has(key)) errors.push(`Row ${row}: keyword collides with row ${lookup.get(key)} under current Fudge matching. Resolve explicitly.`);
    if (key) lookup.set(key, row);
    if (!family || !subcategory || !searchTerm) errors.push(`Row ${row}: search term, service family and subcategory are required; no fallback classification was invented.`);
    const topicRequired = bool(read("Topic Filter Required")), collectFamilyInventory = bool(read("Collect Family Reviews"));
    if (topicRequired === null || collectFamilyInventory === null) errors.push(`Row ${row}: both rule flags must explicitly be yes/no or true/false (1/0 also accepted).`);
    const topicSignals = signals(read("Google Filter Keywords"));
    if (topicRequired && !topicSignals.length) warnings.push(`Row ${row}: topic filtering is required but Google filter keywords are empty. Review matching behavior.`);
    if (!signals(read("Review Keywords")).length) warnings.push(`Row ${row}: no review keywords supplied. Verify intended business-only matching.`);
    if (read("Status")) warnings.push(`Row ${row}: historical Sheet status is informational, not permission to activate a backend rule.`);
    return { row, keyword, searchTerm, family, subcategory, businessSignals: signals(read("Business Name Keywords")), reviewSignals: signals(read("Review Keywords")), requiredSignals: signals(read("Required Review Keywords")), topicSignals, excludeSignals: signals(read("Exclude Keywords")), topicRequired, collectFamilyInventory, rewriteServicePhrase: read("Rewrite Service Phrase"), equivalentServicePhrases: signals(read("Equivalent Service Phrases")) };
  });
  const keys = new Set(rules.map((rule) => exact(rule.keyword)));
  const unmatched = [...new Set(input.data.structure_keywords_not_in_services ?? [])].filter((keyword) => !keys.has(exact(keyword)));
  if (unmatched.length) warnings.push("Listed request keywords lack exact rule matches. Family rules may cover them; do not infer synonyms or activate them automatically.");
  return { valid: errors.length === 0, rules, errors, warnings, unmatched };
}
