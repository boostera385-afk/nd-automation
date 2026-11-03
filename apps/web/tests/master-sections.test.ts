import { describe, expect, it } from "vitest";
import {
  MASTER_SECTION_WARNINGS,
  describeMasterWarning,
  masterSectionsResponseSchema,
  summarizeMasterSections,
  type MasterSection,
} from "@/lib/master-sections";

function row(overrides: Partial<MasterSection["rows"][number]> = {}) {
  return {
    rowNumber: 3,
    profileName: "Profile One",
    postLink: "",
    status: "",
    title: "Short title",
    service: "Garage Door Repair",
    area: "Chicago",
    state: "Illinois",
    ...overrides,
  };
}

function section(overrides: Partial<MasterSection> = {}): MasterSection {
  return {
    planDate: "2026-11-04",
    bannerRow: 1,
    headerRow: 2,
    fromRow: 3,
    toRow: 6,
    columns: { profile: "M", link: "K", status: "L", title: "F", service: "A", area: "I", state: "J" },
    rows: [
      row({ rowNumber: 3, postLink: "https://nextdoor.com/p/AbC123", status: "Posted" }),
      row({ rowNumber: 4, status: "posted" }),
      row({ rowNumber: 5, postLink: "https://nextdoor.com/p/XyZ789", status: "" }),
      row({ rowNumber: 6, profileName: "", status: "Issue: proxy dead" }),
    ],
    rejectedLinks: 1,
    ...overrides,
  };
}

const response = {
  ok: true,
  action: "getMasterSections",
  sheet: "New Optimize Structure",
  fetchedAt: "2026-11-04T12:00:00.000Z",
  linkHeader: "Issues",
  linkColumnSource: "declared",
  columns: { profile: "M", link: "K", status: "L", title: "F", service: "A", area: "I", state: "J" },
  sections: [section()],
  warnings: [],
  truncated: false,
  returnedRows: 4,
} as const;

describe("master section response schema", () => {
  it("accepts the connector's strict safe projection", () => {
    const parsed = masterSectionsResponseSchema.safeParse(response);
    expect(parsed.success).toBe(true);
  });

  it("rejects an unexpected field such as a phone or password column", () => {
    const parsed = masterSectionsResponseSchema.safeParse({ ...response, sections: [{ ...section(), rows: [{ ...row(), phone: "555-0100" }] }] });
    expect(parsed.success).toBe(false);
  });

  it("requires a real ISO plan date or null, never a free-text banner", () => {
    expect(masterSectionsResponseSchema.safeParse({ ...response, sections: [{ ...section(), planDate: "11/4/2026" }] }).success).toBe(false);
    expect(masterSectionsResponseSchema.safeParse({ ...response, sections: [{ ...section(), planDate: null }] }).success).toBe(true);
  });

  it("refuses an invented link-column source or unknown warning", () => {
    expect(masterSectionsResponseSchema.safeParse({ ...response, linkColumnSource: "guessed" }).success).toBe(false);
    expect(masterSectionsResponseSchema.safeParse({ ...response, warnings: ["looks_fine"] }).success).toBe(false);
  });

  it("explains every warning code", () => {
    for (const code of MASTER_SECTION_WARNINGS) expect(describeMasterWarning(code).length).toBeGreaterThan(10);
  });
});

describe("master section summary", () => {
  it("separates a posted claim with a link from one without, and counts unusable links", () => {
    const { sections, totals } = summarizeMasterSections([section()]);
    expect(sections[0]).toMatchObject({
      tasks: 4,
      withLink: 2,
      postedWithLink: 1,
      postedWithoutLink: 1,
      linkWithoutStatus: 1,
      missingProfile: 1,
      rejectedLinks: 1,
      truncated: false,
    });
    expect(sections[0].otherStatuses).toEqual([{ text: "Issue: proxy dead", count: 1 }]);
    expect(totals).toMatchObject({ sections: 1, tasks: 4, withLink: 2, postedWithLink: 1, postedWithoutLink: 1, linkWithoutStatus: 1, missingProfile: 1, rejectedLinks: 1 });
  });

  it("does not count a non-Nextdoor URL as a saved post link", () => {
    const { totals } = summarizeMasterSections([section({ rows: [row({ postLink: "https://example.com/p/abc", status: "Posted" })] })]);
    expect(totals.withLink).toBe(0);
    expect(totals.postedWithoutLink).toBe(1);
  });

  it("totals every section and carries truncation honestly", () => {
    const second = section({ planDate: "2026-11-03", truncated: true, rejectedLinks: 0, rows: [row({ rowNumber: 128, status: "Posted", postLink: "https://nextdoor.com/p/Qq11" })] });
    const { sections, totals } = summarizeMasterSections([section(), second]);
    expect(sections.map((entry) => entry.planDate)).toEqual(["2026-11-04", "2026-11-03"]);
    expect(totals.sections).toBe(2);
    expect(totals.tasks).toBe(5);
    expect(totals.truncated).toBe(true);
    expect(totals.rejectedLinks).toBe(1);
  });

  it("treats a missing status as waiting, not as posted", () => {
    const { totals } = summarizeMasterSections([section({ rows: [row({ postLink: "https://nextdoor.com/p/AbC123", status: "" })] })]);
    expect(totals.postedWithLink).toBe(0);
    expect(totals.linkWithoutStatus).toBe(1);
  });
});
