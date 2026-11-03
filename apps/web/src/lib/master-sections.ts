import { z } from "zod";
import { validPostUrl } from "./sheet-status";

// Strict on purpose: the connector returns a fixed projection. An extra field
// (for example a phone or password column added by a misconfigured script) makes
// the whole response invalid instead of being silently accepted.
export const masterSectionRowSchema = z.strictObject({
  rowNumber: z.number().int().min(2).max(1_000_000),
  profileName: z.string().max(120),
  postLink: z.string().max(500),
  status: z.string().max(300),
  title: z.string().max(120),
  service: z.string().max(120),
  area: z.string().max(80),
  state: z.string().max(80),
});
export type MasterSectionRow = z.infer<typeof masterSectionRowSchema>;

export const masterSectionSchema = z.strictObject({
  planDate: z.iso.date().nullable(),
  bannerRow: z.number().int().min(1).max(1_000_000).nullable(),
  headerRow: z.number().int().min(1).max(1_000_000),
  fromRow: z.number().int().min(2).max(1_000_000),
  toRow: z.number().int().min(2).max(1_000_000),
  columns: z.record(z.string(), z.string().max(3)),
  rows: z.array(masterSectionRowSchema).max(2_400),
  rejectedLinks: z.number().int().min(0).max(2_400),
  truncated: z.boolean().optional(),
});
export type MasterSection = z.infer<typeof masterSectionSchema>;

export const MASTER_SECTION_WARNINGS = [
  "empty_sheet",
  "no_sections_detected",
  "profile_column_missing",
  "link_column_missing",
  "link_header_not_found",
  "section_without_banner",
] as const;

export const masterSectionsResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    action: z.literal("getMasterSections"),
    sheet: z.string().min(1).max(100),
    fetchedAt: z.string().max(40),
    linkHeader: z.string().max(60).nullable(),
    linkColumnSource: z.enum(["declared", "header"]).nullable(),
    columns: z.record(z.string(), z.string().max(3)),
    sections: z.array(masterSectionSchema).max(8),
    warnings: z.array(z.enum(MASTER_SECTION_WARNINGS)).max(8),
    truncated: z.boolean(),
    returnedRows: z.number().int().min(0).max(2_400),
  }),
  z.strictObject({ ok: z.literal(false), error: z.string().max(100) }),
]);
export type MasterSectionsResponse = z.infer<typeof masterSectionsResponseSchema>;
export type MasterSections = Extract<MasterSectionsResponse, { ok: true }>;

const WARNING_TEXT: Record<(typeof MASTER_SECTION_WARNINGS)[number], string> = {
  empty_sheet: "That tab has no data rows.",
  no_sections_detected: "No date banner and header row were found. The tab does not look like a dated posting plan.",
  profile_column_missing: "No Account Name or Profile Name column was recognised, so rows cannot be mapped to a profile.",
  link_column_missing: "No post-link column was recognised or declared, so saved links are not read.",
  link_header_not_found: "The declared post-link header is not present in this tab.",
  section_without_banner: "A section has no date banner above its header, so its planned date is unknown.",
};

export function describeMasterWarning(code: (typeof MASTER_SECTION_WARNINGS)[number]): string {
  return WARNING_TEXT[code];
}

// Structure only: tab names, sizes, the detected header row and recognised
// labels. The connector never returns a cell value it does not recognise, so
// reading a workbook's layout cannot pull a phone number or credential out of it.
export const masterLayoutTabSchema = z.strictObject({
  name: z.string().min(1).max(40),
  rows: z.number().int().min(0).max(1_000_000),
  columns: z.number().int().min(0).max(10_000),
  headerRow: z.number().int().min(0).max(1_000_000),
  planDate: z.iso.date().nullable(),
  labels: z.array(z.strictObject({ column: z.string().min(1).max(3), label: z.string().min(1).max(40) })).max(40),
  unrecognisedHeaders: z.number().int().min(0).max(1_000),
});
export type MasterLayoutTab = z.infer<typeof masterLayoutTabSchema>;

export const masterLayoutResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    action: z.literal("getMasterLayout"),
    fetchedAt: z.string().max(40),
    tabCount: z.number().int().min(0).max(10_000),
    truncated: z.boolean(),
    tabs: z.array(masterLayoutTabSchema).max(30),
  }),
  z.strictObject({ ok: z.literal(false), error: z.string().max(100) }),
]);
export type MasterLayoutResponse = z.infer<typeof masterLayoutResponseSchema>;
export type MasterLayout = Extract<MasterLayoutResponse, { ok: true }>;

// A workbook with one populated tab needs no choice from the operator. Several
// populated tabs do, because guessing which one holds the plan is not safe.
export function planTabCandidates(layout: MasterLayout): MasterLayoutTab[] {
  return layout.tabs.filter((tab) => tab.rows > 0);
}

export type MasterSectionSummary = {
  planDate: string | null;
  headerRow: number;
  fromRow: number;
  toRow: number;
  tasks: number;
  withLink: number;
  postedWithLink: number;
  postedWithoutLink: number;
  linkWithoutStatus: number;
  missingProfile: number;
  rejectedLinks: number;
  truncated: boolean;
  otherStatuses: { text: string; count: number }[];
};

export type MasterSectionsSummary = {
  sections: MasterSectionSummary[];
  totals: {
    sections: number;
    tasks: number;
    withLink: number;
    postedWithLink: number;
    postedWithoutLink: number;
    linkWithoutStatus: number;
    missingProfile: number;
    rejectedLinks: number;
    truncated: boolean;
  };
};

// Counts only. A "posted" status stays a claim from the Sheet; it is never
// upgraded to a verified observation here.
export function summarizeMasterSections(sections: MasterSection[]): MasterSectionsSummary {
  const summaries = sections.map((section) => {
    let withLink = 0;
    let postedWithLink = 0;
    let postedWithoutLink = 0;
    let linkWithoutStatus = 0;
    let missingProfile = 0;
    const statuses = new Map<string, number>();

    for (const row of section.rows) {
      const link = validPostUrl(row.postLink);
      const status = row.status.replace(/\s+/g, " ").trim();
      const posted = /^posted\b/i.test(status);
      if (link) withLink += 1;
      if (!row.profileName) missingProfile += 1;
      if (posted && link) postedWithLink += 1;
      else if (posted) postedWithoutLink += 1;
      else if (link && !status) linkWithoutStatus += 1;
      if (status && !posted) statuses.set(status, (statuses.get(status) ?? 0) + 1);
    }

    return {
      planDate: section.planDate,
      headerRow: section.headerRow,
      fromRow: section.fromRow,
      toRow: section.toRow,
      tasks: section.rows.length,
      withLink,
      postedWithLink,
      postedWithoutLink,
      linkWithoutStatus,
      missingProfile,
      rejectedLinks: section.rejectedLinks,
      truncated: section.truncated === true,
      otherStatuses: [...statuses.entries()]
        .map(([text, count]) => ({ text: text.slice(0, 60), count }))
        .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
        .slice(0, 6),
    } satisfies MasterSectionSummary;
  });

  const totals = summaries.reduce(
    (acc, section) => ({
      sections: acc.sections + 1,
      tasks: acc.tasks + section.tasks,
      withLink: acc.withLink + section.withLink,
      postedWithLink: acc.postedWithLink + section.postedWithLink,
      postedWithoutLink: acc.postedWithoutLink + section.postedWithoutLink,
      linkWithoutStatus: acc.linkWithoutStatus + section.linkWithoutStatus,
      missingProfile: acc.missingProfile + section.missingProfile,
      rejectedLinks: acc.rejectedLinks + section.rejectedLinks,
      truncated: acc.truncated || section.truncated,
    }),
    { sections: 0, tasks: 0, withLink: 0, postedWithLink: 0, postedWithoutLink: 0, linkWithoutStatus: 0, missingProfile: 0, rejectedLinks: 0, truncated: false },
  );

  return { sections: summaries, totals };
}
