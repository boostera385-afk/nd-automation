import nextEnv from "@next/env";
import { backendReadiness } from "../src/lib/backend-readiness.ts";
import { publicConfig } from "../src/lib/env.ts";

// Offline, read-only, secret-safe. Suppress environment-loader diagnostic output.
nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const report = backendReadiness({
  expectedProjectRef: "xtefjnfdjnxwrpkoydaj",
  configuredProjectRef: process.env.SUPABASE_EXPECTED_PROJECT_REF,
  publicConfig: publicConfig(),
  appUrl: process.env.APP_URL,
  sheetUrl: process.env.SHEET_SYNC_URL,
  sheetToken: process.env.SHEET_SYNC_TOKEN,
  sheetOrganizationId: process.env.SHEET_SYNC_ORGANIZATION_ID,
});
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.localConfigurationReady ? 0 : 1;
