import type { ServiceRule } from "./service-catalog-contract";

export type RuleDifference = { keyword: string; kind: "added" | "removed" | "changed" | "unchanged"; fields: string[]; before: ServiceRule | null; after: ServiceRule | null };
const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function compareServiceRules(before: ServiceRule[], after: ServiceRule[]): RuleDifference[] {
  const old = new Map(before.map((rule) => [key(rule.keyword), rule]));
  const next = new Map(after.map((rule) => [key(rule.keyword), rule]));
  return [...new Set([...next.keys(), ...old.keys()])].map((id) => {
    const previous = old.get(id) ?? null, selected = next.get(id) ?? null;
    const fields = previous && selected ? Object.keys(selected).filter((field) => JSON.stringify(previous[field as keyof ServiceRule]) !== JSON.stringify(selected[field as keyof ServiceRule])) : [];
    return { keyword: (selected ?? previous)!.keyword, kind: !previous ? "added" : !selected ? "removed" : fields.length ? "changed" : "unchanged", fields, before: previous, after: selected };
  });
}
