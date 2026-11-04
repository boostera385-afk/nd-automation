import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublicationTable } from "@/components/publication-table";
import type { Customer, Publication } from "@/lib/types";

const customer: Customer = {
  id: "c1",
  organization_id: "o1",
  name: "Fixture customer",
  time_zone: "America/Los_Angeles",
  service: null,
  created_at: "2026-10-01T00:00:00Z",
};

function post(overrides: Partial<Publication> = {}): Publication {
  return {
    id: "p1",
    organization_id: "o1",
    customer_id: "c1",
    title: "A stored post title long enough to be identified",
    url: "https://nextdoor.com/p/fixture",
    account_label: "Fixture account",
    published_at: null,
    source: "manual_entry",
    created_at: "2026-10-01T00:00:00Z",
    visibility: "live",
    last_observed_at: null,
    comments_total: 14,
    recorded_session_id: null,
    ...overrides,
  };
}

function render(commentCounts: Record<string, number>, overrides: Partial<Publication> = {}) {
  return renderToStaticMarkup(
    <PublicationTable publications={[post(overrides)]} customers={[customer]} zone="America/Los_Angeles" commentCounts={commentCounts} />,
  );
}

describe("publication comment column", () => {
  it("labels the platform count and reports stored comments when loaded", () => {
    const html = render({ p1: 14 });
    expect(html).toContain("Comments on page");
    expect(html).toContain("reported by Nextdoor");
    expect(html).toContain("14 saved");
    expect(html).not.toContain("none saved");
  });

  it("makes no saved claim when the caller did not load comments", () => {
    const html = render({});
    expect(html).toContain("reported by Nextdoor");
    expect(html).not.toContain("saved");
  });

  it("says none saved only when a zero count is known", () => {
    expect(render({ p1: 0 })).toContain("none saved");
  });

  it("shows stored comments when the page total was not read", () => {
    const html = render({ p1: 5 }, { comments_total: null });
    expect(html).toContain("5 saved");
    expect(html).not.toContain("Not recorded");
  });
});
