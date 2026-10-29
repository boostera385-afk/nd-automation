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
  const before = [rule("Fixture install"), rule("Fixture maintenance")];
  const after = [rule("Fixture install"), rule("Fixture repair"), rule("Fixture maintenance", { family: "Special fixtures" })];
  const differences = compareServiceRules(before, after);
  expect(differences).toHaveLength(3);
  const repair = differences.find((row) => row.keyword === "Fixture repair");
  expect(repair).toMatchObject({ kind: "added", fields: [], before: null });
  expect(repair?.after?.family).toBe("Fixtures");
  const maintenance = differences.find((row) => row.keyword === "Fixture maintenance");
  expect(maintenance).toMatchObject({ kind: "changed" });
  expect(maintenance?.fields).toEqual(["family"]);
  expect(maintenance?.before?.family).toBe("Fixtures");
  expect(maintenance?.after?.family).toBe("Special fixtures");
  expect(differences.find((row) => row.keyword === "Fixture install")?.kind).toBe("unchanged");
  const removedSet = compareServiceRules(before, [rule("Fixture repair")]);
  expect(removedSet.find((row) => row.keyword === "Fixture install")).toMatchObject({ kind: "removed", after: null });
  expect(removedSet.find((row) => row.keyword === "Fixture install")?.before?.searchTerm).toBe("fixture");
});

it("pairs rules under collector-key normalization while surfacing raw keyword-text changes", () => {
  const differences = compareServiceRules([rule("Fixture  install!")], [rule("fixture install")]);
  expect(differences).toHaveLength(1);
  expect(differences[0]).toMatchObject({ kind: "changed", fields: ["keyword"] });
  expect(differences[0]?.before?.keyword).toBe("Fixture  install!");
  expect(differences[0]?.after?.keyword).toBe("fixture install");
});

it("reports exact field changes including signal order without inferring equivalence", () => {
  const before = [rule("Fixture install", { topicSignals: ["a", "b"] })];
  const after = [rule("Fixture install", { topicSignals: ["b", "a"] })];
  const differences = compareServiceRules(before, after);
  expect(differences[0]?.kind).toBe("changed");
  expect(differences[0]?.fields).toEqual(["topicSignals"]);
});
