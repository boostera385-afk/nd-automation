import nextEnv from "@next/env";

// Live, read-only workbook structure probe. It asks the deployed connector for
// tab names, sizes, the detected header row and recognised column labels. The
// connector returns no data cells, and this script prints no URL or token.
// Set SHEET_PROBE_URL / SHEET_PROBE_TOKEN to probe a different deployment
// without editing the saved workspace configuration.
nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });

const url = (process.env.SHEET_PROBE_URL ?? process.env.SHEET_SYNC_URL)?.trim();
const token = (process.env.SHEET_PROBE_TOKEN ?? process.env.SHEET_SYNC_TOKEN)?.trim();

type Label = { column?: unknown; label?: unknown };
type Tab = { name?: unknown; rows?: unknown; columns?: unknown; headerRow?: unknown; planDate?: unknown; labels?: unknown; unrecognisedHeaders?: unknown };
type Reply = { ok?: unknown; error?: unknown; tabCount?: unknown; truncated?: unknown; tabs?: unknown };

async function probe(): Promise<{ status: number | null; reply: Reply; failure: string | null }> {
  if (!url) return { status: null, reply: {}, failure: "missing_url" };
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "getMasterLayout", token }),
      signal: AbortSignal.timeout(25_000),
    });
    const reply = await response.json().catch(() => ({})) as Reply;
    return { status: response.status, reply, failure: null };
  } catch (error) {
    return { status: null, reply: {}, failure: (error as { name?: string })?.name === "TimeoutError" ? "timeout" : "network_error" };
  }
}

const result = await probe();
const reply = result.reply;
const tabs = Array.isArray(reply.tabs) ? (reply.tabs as Tab[]) : [];

const summary = tabs.map((tab) => ({
  name: typeof tab.name === "string" ? tab.name : null,
  rows: typeof tab.rows === "number" ? tab.rows : null,
  columns: typeof tab.columns === "number" ? tab.columns : null,
  headerRow: typeof tab.headerRow === "number" && tab.headerRow > 0 ? tab.headerRow : null,
  planDate: typeof tab.planDate === "string" ? tab.planDate : null,
  labels: Array.isArray(tab.labels)
    ? (tab.labels as Label[]).map((entry) => ({ column: String(entry.column ?? ""), label: String(entry.label ?? "") }))
    : [],
  unrecognisedHeaders: typeof tab.unrecognisedHeaders === "number" ? tab.unrecognisedHeaders : 0,
}));

const checks = [
  {
    id: "connector_reachable",
    status: result.failure ? "blocked" : "pass",
    httpStatus: result.status,
    error: result.failure,
    message: result.failure ? "The connector did not answer; check the deployment URL and network." : "The connector answered over HTTPS.",
  },
  {
    id: "layout_action",
    status: result.failure ? "blocked" : reply.ok === true ? "pass" : "blocked",
    error: typeof reply.error === "string" ? reply.error : null,
    message: reply.ok === true
      ? "The connector returned workbook structure only."
      : reply.error === "invalid_action"
        ? "This deployment still runs the older connector; redeploy the current script before probing."
        : "The connector rejected the structure probe; verify the token, SHEET_ID and deployment access.",
  },
];

const report = {
  mode: "live_read_only_master_layout_check",
  configuration: {
    endpointConfigured: Boolean(url),
    tokenConfigured: Boolean(token && token.length >= 24),
    override: Boolean(process.env.SHEET_PROBE_URL || process.env.SHEET_PROBE_TOKEN),
  },
  structureReady: reply.ok === true,
  checks,
  tabCount: typeof reply.tabCount === "number" ? reply.tabCount : null,
  truncated: reply.truncated === true,
  tabs: summary,
  next: reply.ok === true
    ? [
        "Confirm which tabs carry posting work and which column receives the Nextdoor post link.",
        "A date banner is a planned calendar date, not proof that a post was published.",
        "No cell content, credential column value, URL or token was printed by this check.",
      ]
    : [
        "Fix the checks above, then rerun `npm run check:master-layout`.",
        "No Sheet cell was read as data or written by this check.",
      ],
};
console.log(JSON.stringify(report, null, 2));
process.exitCode = reply.ok === true ? 0 : 1;
