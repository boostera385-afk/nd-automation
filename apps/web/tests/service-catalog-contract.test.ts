import { expect, it } from "vitest";
import { serviceRulesSchema, publishedServiceCatalogSchema, rulesFromCatalogPreview } from "@/lib/service-catalog-contract";
import { previewServiceCatalog } from "@/lib/service-catalog-preview";
const rule = { keyword: "Fixture service", searchTerm: "fixture", family: "Fixtures", subcategory: "Fixture", businessSignals: [], reviewSignals: [], requiredSignals: [], topicSignals: [], excludeSignals: [], topicRequired: false, collectFamilyInventory: true, rewriteServicePhrase: "", equivalentServicePhrases: [] };
const snapshot = { version: 1, organizationId: "11111111-1111-4111-8111-111111111111", generation: 1, revisionId: "22222222-2222-4222-8222-222222222222", revision: 1, rules: [rule] };
it("accepts exact published snapshots and refuses injected metadata or null booleans", () => {
  expect(publishedServiceCatalogSchema.safeParse(snapshot).success).toBe(true);
  expect(publishedServiceCatalogSchema.safeParse({ ...snapshot, token: "fixture" }).success).toBe(false);
  expect(serviceRulesSchema.safeParse([{ ...rule, topicRequired: null }]).success).toBe(false);
});
it("bounds rule content and rejects collector-key collisions", () => {
  for (const rules of [[], [rule, { ...rule, keyword: "Fixture-service," }], [{ ...rule, reviewSignals: ["\u0000"] }], [{ ...rule, businessSignals: Array(101).fill("fixture") }], [{ ...rule, family: "x".repeat(501) }]]) expect(serviceRulesSchema.safeParse(rules).success).toBe(false);
});
it("refuses publishing invalid previews and removes source-row bookkeeping", () => {
  const preview = previewServiceCatalog(JSON.stringify({ services: [{ "Service Keyword": "Fixture", "Search Term": "fixture", "Service Family": "Fixtures", Subcategory: "Fixture", "Topic Filter Required": "no", "Collect Family Reviews": "yes", _sheet_row: 7 }] }));
  const rules = rulesFromCatalogPreview(preview);
  expect(rules).toHaveLength(1); expect(rules?.[0]).not.toHaveProperty("row");
  expect(rulesFromCatalogPreview({ ...preview, valid: false })).toBeNull();
});
