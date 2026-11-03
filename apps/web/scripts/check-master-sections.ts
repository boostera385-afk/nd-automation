import nextEnv from "@next/env";

// Live, read-only check for a dated-plan tab (date banner + repeated header rows).
// It prints counts only — no profile name, phone, content, link or token — and
// never writes a Sheet cell or queues automation.
//
// Usage from apps/web:
//   npm.cmd run check:master-sections -- "New Optimize Structure"
// Optional environment:
//   SHEET_MASTER_LINK_HEADER  exact header of the post-link column (e.g. Issues)
//   SHEET_PROBE_URL / SHEET_PROBE_TOKEN  probe another deployment without
//   changing the saved workspace connection.
nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });

const url = (process.env.SHEET_PROBE_URL ?? process.env.SHEET_SYNC_URL)?.trim();
const token = (process.env.SHEET_PROBE_TOKEN ?? process.env.SHEET_SYNC_TOKEN)?.trim();
const tab = (process.argv.slice(2).find((value) => !value.startsWith("-")) ?? process.env.SHEET_MASTER_TAB ?? "").trim();
const linkHeader = (process.env.SHEET_MASTER_LINK_HEADER ?? "").replace(/\s+/g, " ").trim();

type Row = { postLink?: unknown; status?: unknown; profileName?: unknown };
type Section = { planDate?: unknown; headerRow?: unknown; fromRow?: unknown; toRow?: unknown; rows?: unknown; rejectedLinks?: unknown; truncated?: unknown };
type Reply = { ok?: unknown; error?: unknown; tabs?: unknown; tabCount?: unknown; sections?: unknown; warnings?: unknown; columns?: unknown; linkColumnSource?: unknown; truncated?: unknown; returnedRows?: unknown; sheet?: unknown };

async function call(body: Record<string, unknown>): Promise<{ status: number | null; reply: Reply; failure: string | null }> {
  if (!url) return { status: null, reply: {}, failure: "missing_url" };
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25_000),
    });
    const reply = await response.json().catch(() => ({})) as Reply;
    return { status: response.status, reply, failure: null };
  } catch (error) {
    return { status: null, reply: {}, failure: (error as { name?: string })?.name === "TimeoutError" ? "timeout" : "network_error" };
  }
}

function exactNextdoorLink(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return null;
    if (!/(^|\.)nextdoor\.(com|co\.uk)$/i.test(parsed.hostname)) return null;
    return /^\/(p|for_sale_and_free)\/[A-Za-z0-9_-]+\/?$/.test(parsed.pathname) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

let report: Record<string, unknown>;

if (!tab) {
  // No tab chosen: list tabs so the operator can pick one.
  const layout = await call({ action: "getMasterLayout", token });
  const names = Array.isArray(layout.reply.tabs) ? (layout.reply.tabs as { name?: unknown }[]).map((entry) => (typeof entry.name === "string" ? entry.name : null)).filter(Boolean) : [];
  report = {
    mode: "live_read_only_master_sections_check",
    configuration: { endpointConfigured: Boolean(url), tokenConfigured: Boolean(token && token.length >= 24), tab: null, linkHeader: linkHeader || null },
    ready: false,
    missingTab: true,
    tabs: names,
    message: layout.reply.ok === true
      ? "Choose one of the tabs above and rerun with its exact name."
      : "The structure probe was refused. Redeploy the current connector first.",
    checks: [{ id: "tab_argument", status: "blocked", error: layout.reply.error ?? layout.failure ?? null }],
  };
} else {
  const result = await call({ action: "getMasterSections", sheet: tab, linkHeader, token });
  const reply = result.reply;
  const sections = Array.isArray(reply.sections) ? (reply.sections as Section[]) : [];
  const summaries = sections.map((section) => {
    const rows = Array.isArray(section.rows) ? (section.rows as Row[]) : [];
    let withLink = 0;
    let postedWithLink = 0;
    let postedWithoutLink = 0;
    let linkWithoutStatus = 0;
    let missingProfile = 0;
    for (const row of rows) {
      const link = exactNextdoorLink(row.postLink);
      const status = typeof row.status === "string" ? row.status.trim() : "";
      const posted = /^posted\b/i.test(status);
      if (link) withLink += 1;
      if (!(typeof row.profileName === "string" && row.profileName.trim())) missingProfile += 1;
      if (posted && link) postedWithLink += 1;
      else if (posted) postedWithoutLink += 1;
      else if (link && !status) linkWithoutStatus += 1;
    }
    return {
      planDate: typeof section.planDate === "string" ? section.planDate : null,
      headerRow: typeof section.headerRow === "number" ? section.headerRow : null,
      rows: typeof section.fromRow === "number" && typeof section.toRow === "number" ? `${section.fromRow}–${section.toRow}` : null,
      tasks: rows.length,
      withLink,
      postedWithLink,
      postedWithoutLink,
      linkWithoutStatus,
      missingProfile,
      rejectedLinks: typeof section.rejectedLinks === "number" ? section.rejectedLinks : null,
      truncated: section.truncated === true,
    };
  });

  report = {
    mode: "live_read_only_master_sections_check",
    configuration: { endpointConfigured: Boolean(url), tokenConfigured: Boolean(token && token.length >= 24), tab, linkHeader: linkHeader || null },
    ready: reply.ok === true,
    sheet: typeof reply.sheet === "string" ? reply.sheet : null,
    linkColumnSource: typeof reply.linkColumnSource === "string" ? reply.linkColumnSource : null,
    columns: reply.columns ?? {},
    warnings: Array.isArray(reply.warnings) ? reply.warnings : [],
    truncated: reply.truncated === true,
    returnedRows: typeof reply.returnedRows === "number" ? reply.returnedRows : null,
    sections: summaries,
    checks: [
      {
        id: "connector_reachable",
        status: result.failure ? "blocked" : "pass",
        httpStatus: result.status,
        error: result.failure,
      },
      {
        id: "section_action",
        status: result.failure ? "blocked" : reply.ok === true ? "pass" : "blocked",
        error: typeof reply.error === "string" ? reply.error : null,
        message: reply.ok === true ? "The connector returned a safe projection of the dated sections." : "The connector refused the section read.",
      },
    ],
    next: reply.ok === true
      ? [
          "A posted status stays a claim from the Sheet; it is not a verified observation.",
          "Counts only: no name, phone, content, link or token was printed.",
          "Nothing was imported, mapped, written or queued by this check.",
        ]
      : ["Redeploy the current connector, then rerun with the exact tab name.", "No Sheet cell was written by this check."],
  };
}

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ready === true ? 0 : 1;
