import { describe, expect, it } from "vitest";
import { filterPublications, hasFilters, parseFilters } from "@/lib/filters";
import type { Customer, Publication } from "@/lib/types";

const customers: Customer[] = [
  { id: "c1", organization_id: "o", name: "Alpha Roofing", time_zone: "America/Los_Angeles", service: null, created_at: "2026-10-01T00:00:00Z" },
  { id: "c2", organization_id: "o", name: "Bright Plumbing", time_zone: "America/Los_Angeles", service: null, created_at: "2026-10-01T00:00:00Z" },
];

const post = (overrides: Partial<Publication>): Publication => ({
  id: "p", organization_id: "o", customer_id: "c1", title: "Spring offer", url: "https://nextdoor.com/p/abc", account_label: "Account A",
  published_at: null, source: "manual_entry", created_at: "2026-10-01T00:00:00Z", visibility: "not_checked", last_observed_at: null, comments_total: null, recorded_session_id: null,
  ...overrides,
});

const posts = [
  post({ id: "1", title: "Spring offer", visibility: "live" }),
  post({ id: "2", title: "Leak repair tips", customer_id: "c2", account_label: "Plumber Pat", visibility: "unknown" }),
  post({ id: "3", title: "Gutter cleaning", visibility: "unavailable" }),
];

describe("publication filters", () => {
  it("returns everything when no filter is set", () => {
    expect(filterPublications(posts, customers, parseFilters({}, customers))).toHaveLength(3);
    expect(hasFilters(parseFilters({}, customers))).toBe(false);
  });

  it("searches title, account, URL and customer name case-insensitively", () => {
    const find = (q: string) => filterPublications(posts, customers, parseFilters({ q }, customers)).map((item) => item.id);
    expect(find("LEAK")).toEqual(["2"]);
    expect(find("plumber pat")).toEqual(["2"]);
    expect(find("alpha roofing")).toEqual(["1", "3"]);
    expect(find("nextdoor.com/p/abc")).toEqual(["1", "2", "3"]);
  });

  it("filters by visibility and customer together", () => {
    const filters = parseFilters({ visibility: "live", customer: "c1" }, customers);
    expect(filterPublications(posts, customers, filters).map((item) => item.id)).toEqual(["1"]);
    expect(hasFilters(filters)).toBe(true);
  });

  it("ignores untrusted values instead of failing", () => {
    const filters = parseFilters({ visibility: "<script>", customer: "not-a-customer", q: ["  first  ", "second"] }, customers);
    expect(filters).toEqual({ q: "first", visibility: null, customer: "" });
  });

  it("limits the search term length", () => {
    expect(parseFilters({ q: "x".repeat(500) }, customers).q).toHaveLength(100);
  });
});
