import { expect, it } from "vitest";
import { compareServiceRules } from "@/lib/service-catalog-diff";
import type { ServiceRule } from "@/lib/service-catalog-contract";

const rule = (keyword: string, overrides: Partial<ServiceRule> = {}): ServiceRule => ({
  keyword, searchTerm: "fixture", family: "Fixtures", subcategory: "Fixture",
  businessSignals: [], reviewSignals: [], requiredSignals: [], topicSignals: [],
  excludeSignals: [], topicRequired: false, collectFamilyInventory: true,
  rewriteServicePhrase: "", equivalentServicePhrases: [], ...overrides,
});

it("classifies added, removed, changed and unchanged rules explicitly", () => {
  const before = [rule("Haircut"), rule("Bridal makeup")];
  const after = [rule("Haircut"), rule("Manicure"), rule("Bridal makeup", { family: "Bridal" })];
  const differences = compareServiceRules(before, after);
  expect(differences).toHaveLength(3);
  const manicure = differences.find((row) => row.keyword === "Manicure");
  expect(manicure).toMatchObject({ kind: "added", fields: [], before: null });
  expect(manicure?.after?.family).toBe("Fixtures");
  const bridal = differences.find((row) => row.keyword === "Bridal makeup");
  expect(bridal).toMatchObject({ kind: "changed" });
  expect(bridal?.fields).toEqual(["family"]);
  expect(bridal?.before?.family).toBe("Fixtures");
  expect(bridal?.after?.family).toBe("Bridal");
  expect(differences.find((row) => row.keyword === "Haircut")?.kind).toBe("unchanged");
  const removedSet = compareServiceRules(before, [rule("Manicure")]);
  expect(removedSet.find((row) => row.keyword === "Haircut")).toMatchObject({ kind: "removed", after: null });
  expect(removedSet.find((row) => row.keyword === "Haircut")?.before?.searchTerm).toBe("fixture");
});

it("pairs rules under collector-key normalization while surfacing raw keyword-text changes", () => {
  const differences = compareServiceRules([rule("Hair  cut!")], [rule("hair cut")]);
  expect(differences).toHaveLength(1);
  expect(differences[0]).toMatchObject({ kind: "changed", fields: ["keyword"] });
  expect(differences[0]?.before?.keyword).toBe("Hair  cut!");
  expect(differences[0]?.after?.keyword).toBe("hair cut");
});

it("reports exact field changes including signal order without inferring equivalence", () => {
  const before = [rule("Facial", { topicSignals: ["a", "b"] })];
  const after = [rule("Facial", { topicSignals: ["b", "a"] })];
  const differences = compareServiceRules(before, after);
  expect(differences[0]?.kind).toBe("changed");
  expect(differences[0]?.fields).toEqual(["topicSignals"]);
});
