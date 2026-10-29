import { z } from "zod";
import type { CatalogPreview } from "./service-catalog-preview";

const text = (max: number) => z.string().refine((value) => Array.from(value).length <= max && !/[\u0000-\u001f\u007f]/.test(value));
const required = (max: number) => text(max).refine((value) => value.trim().length > 0);
const terms = z.array(required(300)).max(100);
export const serviceRuleSchema = z.strictObject({
  keyword: required(200), searchTerm: required(500), family: required(500), subcategory: required(500),
  businessSignals: terms, reviewSignals: terms, requiredSignals: terms, topicSignals: terms,
  excludeSignals: terms, topicRequired: z.boolean(), collectFamilyInventory: z.boolean(),
  rewriteServicePhrase: text(500), equivalentServicePhrases: terms,
});
export const serviceRulesSchema = z.array(serviceRuleSchema).min(1).max(500).superRefine((rules, context) => {
  const keys = rules.map((rule) => rule.keyword.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  if (keys.some((key) => !key) || new Set(keys).size !== keys.length) context.addIssue({ code: "custom", message: "Resolve collector-key collisions before saving." });
  // Leave headroom for JSONB serialization whitespace within the server's 512 KiB bound.
  if (new TextEncoder().encode(JSON.stringify(rules)).byteLength > 262144) context.addIssue({ code: "custom", message: "Catalog exceeds the 256 KiB client transport budget." });
});
export const publishedServiceCatalogSchema = z.strictObject({
  version: z.literal(1), organizationId: z.uuid(), generation: z.number().int().positive().max(2147483647),
  revisionId: z.uuid(), revision: z.number().int().positive().max(2147483647), rules: serviceRulesSchema,
});
export type ServiceRule = z.infer<typeof serviceRuleSchema>;
export type PublishedServiceCatalog = z.infer<typeof publishedServiceCatalogSchema>;

export function rulesFromCatalogPreview(preview: CatalogPreview): ServiceRule[] | null {
  if (!preview.valid) return null;
  const rules = preview.rules.map((rule) => ({ keyword: rule.keyword, searchTerm: rule.searchTerm, family: rule.family,
    subcategory: rule.subcategory, businessSignals: rule.businessSignals, reviewSignals: rule.reviewSignals,
    requiredSignals: rule.requiredSignals, topicSignals: rule.topicSignals, excludeSignals: rule.excludeSignals,
    topicRequired: rule.topicRequired, collectFamilyInventory: rule.collectFamilyInventory,
    rewriteServicePhrase: rule.rewriteServicePhrase, equivalentServicePhrases: rule.equivalentServicePhrases }));
  const parsed = serviceRulesSchema.safeParse(rules);
  return parsed.success ? parsed.data : null;
}
