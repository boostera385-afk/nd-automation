import nextEnv from "@next/env";

// Live, read-only connector check. It sends only the configured token and a
// read action; it never writes a Sheet cell and never prints the URL or token.
nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });

type ConnectorReply = { ok?: unknown; sheet?: unknown; rows?: unknown; truncated?: unknown; error?: unknown };

const tabs = ["Auto Posting", "Auto Listing"] as const;
const url = process.env.SHEET_SYNC_URL?.trim();
const token = process.env.SHEET_SYNC_TOKEN?.trim();
const organizationId = process.env.SHEET_SYNC_ORGANIZATION_ID?.trim();

async function post(body: Record<string, unknown>): Promise<{ status: number | null; reply: ConnectorReply; failure: string | null }> {
  if (!url) return { status: null, reply: {}, failure: "missing_url" };
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const reply = await response.json().catch(() => ({})) as ConnectorReply;
    return { status: response.status, reply, failure: null };
  } catch (error) {
    return { status: null, reply: {}, failure: (error as { name?: string })?.name === "TimeoutError" ? "timeout" : "network_error" };
  }
}

const configuration = {
  endpointConfigured: Boolean(url),
  tokenConfigured: Boolean(token && token.length >= 24),
  workspaceConfigured: Boolean(organizationId),
};

const checks = [] as Array<Record<string, unknown>>;
if (url && token) {
  for (const sheet of tabs) {
    const result = await post({ action: "getPostRecords", token, sheet });
    const reply = result.reply;
    checks.push({
      id: `read:${sheet}`,
      status: result.failure ? "blocked" : reply.ok === true ? "pass" : "blocked",
      httpStatus: result.status,
      error: result.failure ?? (typeof reply.error === "string" ? reply.error : null),
      sheet: typeof reply.sheet === "string" ? reply.sheet : null,
      rowCount: Array.isArray(reply.rows) ? reply.rows.length : null,
      truncated: reply.truncated === true,
      message: result.failure ? "The connector did not answer; check the deployment URL and network."
        : reply.ok === true ? "Connector answered a bounded read. Row content is intentionally not printed."
          : "Connector rejected the read; verify SYNC_TOKEN and the script deployment.",
    });
  }
  const unauthorized = await post({ action: "getPostRecords", token: "invalid-token-value-000000000000", sheet: tabs[0] });
  checks.push({
    id: "token_enforcement",
    status: unauthorized.failure ? "blocked" : unauthorized.reply.ok === false && unauthorized.reply.error === "unauthorized" ? "pass" : "failed",
    message: unauthorized.failure ? "Could not verify token enforcement; the connector did not answer."
      : unauthorized.reply.error === "unauthorized" ? "A wrong token is refused." : "A wrong token was not refused as expected.",
  });
} else {
  checks.push({ id: "connector", status: "blocked", message: "Set SHEET_SYNC_URL and SHEET_SYNC_TOKEN in the ignored .env.local first." });
}

const connectorReady = checks.every((check) => check.status === "pass");
const report = {
  mode: "live_read_only_sheet_check",
  configuration,
  connectorReady,
  checks,
  next: connectorReady
    ? ["Sheet read is live. Worker pairing, an active session and profile mappings are still required before browser checks."]
    : ["Fix the connector checks above, then rerun `npm run check:sheet`.", "No Sheet cell was written by this check."],
};
console.log(JSON.stringify(report, null, 2));
process.exitCode = connectorReady ? 0 : 1;
