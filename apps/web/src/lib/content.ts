import { z } from "zod";

export const audiences = { anyone: "Anyone", nearby: "Nearby neighborhoods", neighborhood: "Your neighborhood" } as const;
const common = { title: z.string().trim().min(3).max(200), body: z.string().trim().min(1).max(5000), audience: z.enum(["anyone", "nearby", "neighborhood"]) };
export const contentSchema = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("post"), price_cents: z.null(), category: z.null() }).strict(),
  z.object({ ...common, kind: z.literal("listing"), price_cents: z.number().int().min(0).max(1000000000), category: z.string().trim().min(1).max(120) }).strict(),
]);
export type DraftContent = z.infer<typeof contentSchema>;
export type ContentDraft = { id: string; binding_id: string; content: DraftContent; status: "draft" | "approved" | "archived"; revision: number; updated_at: string; approved_at: string | null };
export type ContentTarget = { id: string; customer_id: string; worker_id: string; profile_id: string; account_label: string };

// Parse decimal money without rounding floating-point inputs or accepting exponent notation.
export function priceCents(value: string): number | null {
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return cents <= 1000000000 ? cents : null;
}

export function contentFromForm(form: FormData) {
  return contentSchema.safeParse({ kind: form.get("kind"), title: form.get("title"), body: form.get("body"), audience: form.get("audience"),
    price_cents: form.get("kind") === "listing" ? priceCents(String(form.get("price") ?? "")) : null,
    category: form.get("kind") === "listing" ? form.get("category") : null });
}
