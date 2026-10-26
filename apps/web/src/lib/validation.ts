import { z } from "zod";
import { validTimeZone } from "./time";

export const uuid = z.uuid();
export const timeZoneSchema = z.string().refine(validTimeZone, "Choose a valid IANA timezone.");
export const visibilitySchema = z.enum(["not_checked", "live", "unavailable", "confirmed_removed", "deleted_by_owner", "unknown"]);
export type Visibility = z.infer<typeof visibilitySchema>;

export const postUrlSchema = z.url().refine((value) => {
  // Refinements still run after z.url() fails, so unparseable text must return false, not throw.
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  return url.protocol === "https:" && !url.username && !url.password && !url.port &&
    (url.hostname === "nextdoor.com" || url.hostname.endsWith(".nextdoor.com") || url.hostname === "nextdoor.co.uk" || url.hostname.endsWith(".nextdoor.co.uk")) &&
    /^\/(p|for_sale_and_free)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
}, "Use an exact HTTPS Nextdoor share URL (/p/ID or /for_sale_and_free/ID), without credentials.").transform((value) => {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
});

export const publicationInput = z.object({
  customer_id: uuid,
  title: z.string().trim().min(3).max(200),
  url: postUrlSchema,
  account_label: z.string().trim().min(1).max(120),
  published_at: z.iso.datetime({ offset: true }).nullable(),
});

export const importedRow = publicationInput.omit({ customer_id: true });
export type ImportedRow = z.infer<typeof importedRow>;
export const importRowsSchema = z.array(importedRow).min(1).max(100);

export const credentialsSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(12, "Use at least 12 characters.").max(128),
});

export function safeCsvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  const safe = /^[\s]*[=+\-@]|^[\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function safeAuthNext(value: string | null): string {
  return value === "/reset-password" ? "/reset-password" : "/dashboard";
}
