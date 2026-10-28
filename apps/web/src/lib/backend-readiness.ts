/** Local configuration checks only: never infer hosted schema/Auth readiness. */
export type ReadinessCheck = {
  id: string;
  status: "pass" | "blocked" | "unverified";
  message: string;
};

type ReadinessInput = {
  expectedProjectRef: string;
  configuredProjectRef?: string;
  publicConfig: { url: string; key: string } | null;
  appUrl?: string;
  sheetUrl?: string;
  sheetToken?: string;
  sheetOrganizationId?: string;
};

// Return fixed messages only. Neither valid nor malformed settings may be echoed.
export function backendReadiness(input: ReadinessInput): {
  localConfigurationReady: boolean;
  hostedReadiness: "unverified";
  checks: ReadinessCheck[];
} {
  const checks: ReadinessCheck[] = [];
  const add = (id: string, passed: boolean, success: string, failure: string) => {
    checks.push({ id, status: passed ? "pass" : "blocked", message: passed ? success : failure });
  };
  const targetValid = /^[a-z0-9]{20}$/.test(input.expectedProjectRef);
  const pinned = targetValid && input.configuredProjectRef?.trim() === input.expectedProjectRef;
  add("project_pin", pinned, "Deployment pin matches the requested target.", "Set the deployment pin to the verified requested project before connecting.");

  let matchingOrigin = false;
  try {
    const url = new URL(input.publicConfig?.url ?? "");
    matchingOrigin = targetValid && url.origin === `https://${input.expectedProjectRef}.supabase.co`
      && !url.username && !url.password && !url.search && !url.hash && ["", "/"].includes(url.pathname);
  } catch { /* Invalid settings are reported without their values. */ }
  add("client_configuration", pinned && matchingOrigin && input.publicConfig !== null,
    "Validated client configuration points to the requested target; key ownership is not verified.",
    "Configure a validated target URL and publishable key together. Do not use a management token or privileged key.");

  let appOriginValid = false;
  try {
    const url = new URL(input.appUrl ?? "");
    appOriginValid = !url.username && !url.password && !url.search && !url.hash && ["", "/"].includes(url.pathname)
      && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)));
  } catch { /* No exception text or input values in reports. */ }
  add("app_origin", appOriginValid, "Canonical app origin is configured; hosted Auth redirects still need inspection.",
    "Set an explicit canonical APP_URL using HTTPS, except for local development.");

  let sheetEndpointValid = false;
  try {
    const url = new URL(input.sheetUrl ?? "");
    sheetEndpointValid = url.protocol === "https:" && url.hostname === "script.google.com" && !url.port
      && !url.username && !url.password && !url.search && !url.hash
      && /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) && !url.pathname.includes("YOUR_");
  } catch { /* Never print the private connector URL. */ }
  add("sheet_endpoint", sheetEndpointValid, "Separate Sheet connector endpoint is configured; deployment is unverified.",
    "Configure the separate dashboard connector, not the legacy credential-bearing endpoint.");
  add("sheet_token", (input.sheetToken?.trim().length ?? 0) >= 24,
    "Sheet token meets the local length requirement; connector agreement is unverified.",
    "Configure a private random Sheet token of at least 24 characters on both sides.");
  add("sheet_workspace", /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.sheetOrganizationId ?? ""),
    "Sheet workspace ID has a valid UUID shape; membership and target ownership are unverified.",
    "Configure the actual target workspace UUID after verifying authorized membership.");

  for (const [id, message] of [
    ["hosted_database", "Inspect target identity, migration history, grants, RLS and advisors through authorized read-only access."],
    ["hosted_auth", "Verify a real login, workspace/customer isolation and configured Auth redirect/email delivery."],
    ["recovery", "Verify backup/restore and retention decisions before production enablement."],
    ["worker", "Pairing, exact profile ownership, adapter validation and supervised live acceptance remain separate gates."],
  ]) checks.push({ id, status: "unverified", message });

  return { localConfigurationReady: !checks.some((check) => check.status === "blocked"), hostedReadiness: "unverified", checks };
}
