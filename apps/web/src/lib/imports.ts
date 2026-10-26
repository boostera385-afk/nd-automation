import { parse } from "csv-parse/sync";
import { importedRow, type ImportedRow } from "./validation";

const allowed = new Set(["title", "url", "account_label", "published_at"]);

export function previewCsv(text: string): { rows: ImportedRow[]; errors: string[] } {
  if (Buffer.byteLength(text, "utf8") > 512 * 1024) return { rows: [], errors: ["CSV must be smaller than 512 KB."] };
  const errors: string[] = [];
  let records: Record<string, string>[];
  try {
    records = parse(text, {
      bom: true, skip_empty_lines: true, trim: true, max_record_size: 16000,
      columns: (headers: string[]) => {
        if (new Set(headers).size !== headers.length || headers.some((h) => !allowed.has(h))) throw new Error("Invalid headers");
        if (!["title", "url", "account_label"].every((h) => headers.includes(h))) throw new Error("Missing headers");
        return headers;
      },
    }) as Record<string, string>[];
  } catch {
    return { rows: [], errors: ["Use only these CSV headers: title,url,account_label,published_at. Credential/cookie/proxy columns are not accepted."] };
  }
  if (records.length === 0 || records.length > 100) return { rows: [], errors: ["Import between 1 and 100 records at a time."] };
  const rows: ImportedRow[] = [];
  const urls = new Set<string>();
  records.forEach((record, index) => {
    const result = importedRow.safeParse({ ...record, published_at: record.published_at || null });
    if (!result.success) { errors.push(`Row ${index + 2}: ${result.error.issues[0].message}`); return; }
    if (urls.has(result.data.url)) { errors.push(`Row ${index + 2}: duplicate post URL.`); return; }
    urls.add(result.data.url);
    rows.push(result.data);
  });
  return { rows, errors };
}
