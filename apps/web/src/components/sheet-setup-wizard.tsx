"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { testSavedSheetConnection, type SheetConnectionTestState } from "@/app/actions/sheet-setup";
import { extractSpreadsheetId, generateSetupToken, sheetEnvironmentSnippet, validSetupToken } from "@/lib/sheet-setup";
import { Panel } from "./ui";

function CopyBlock({ label, value, sensitive = false, rows = 3 }: { label: string; value: string; sensitive?: boolean; rows?: number }) {
  const [message, setMessage] = useState("");
  const [visible, setVisible] = useState(!sensitive);
  return <div className="form-grid">
    {visible && <label>{label}<textarea readOnly value={value} rows={rows} spellCheck={false} autoComplete="off" /></label>}
    <div className="header-actions">
      <button className="button secondary" type="button" onClick={async () => {
        try { await navigator.clipboard.writeText(value); setMessage(sensitive ? "Copied. Paste privately, then clear your clipboard." : "Copied."); }
        catch { setVisible(true); setMessage("Clipboard unavailable. Select the text above and copy manually."); }
      }}>Copy {label}</button>
      {sensitive && <button className="button secondary" type="button" onClick={() => setVisible(!visible)}>{visible ? "Hide" : "Show"} {label}</button>}
    </div>
    <span className="small" role="status">{message}</span>
  </div>;
}

export function SheetSetupWizard({ workspaceId, configured, connectorSource }: { workspaceId: string; configured: boolean; connectorSource: string }) {
  const [sheetInput, setSheetInput] = useState("");
  const [token, setToken] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [tokenError, setTokenError] = useState("");
  const [state, testAction, testing] = useActionState<SheetConnectionTestState, FormData>(async () => testSavedSheetConnection(), {});
  const sheetId = extractSpreadsheetId(sheetInput);
  const envSnippet = sheetEnvironmentSnippet(endpoint, token, workspaceId);
  return <div className="form-grid">
    <div className="notice"><strong>{configured ? "A server connection is already configured" : "First-time organization connection"}</strong>
      <p>This is read-only Sheet preview setup. It does not activate posting, profile creation, live-post checking or Sheet writeback. New staff can reuse the existing organization connection.</p>
      {configured && <p>Use step 6 to test the existing connection first. Its saved token is never sent to this page. Do not generate a replacement token unless you intend to update both Script properties and the server.</p>}
    </div>
    <Panel title="1. Choose your development Sheet">
      <label>Google Sheet URL or spreadsheet ID<input value={sheetInput} onChange={(event) => setSheetInput(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…/edit" autoComplete="off" spellCheck={false} /></label>
      <p className="small muted">Use the development copy, not production. This extracts an ID locally; it does not open or modify your Sheet. A Sheet ID is different from the workspace ID below.</p>
      {sheetId ? <CopyBlock label="SHEET_ID value" value={sheetId} rows={2} /> : sheetInput && <p className="notice error" role="alert">Enter a Google Sheets URL or its spreadsheet ID, not a dashboard/workspace ID.</p>}
    </Panel>
    <Panel title="2. Create the separate Apps Script project">
      <ol><li>Open <a href="https://script.google.com/home/start" target="_blank" rel="noreferrer">Google Apps Script</a> and choose New project.</li><li>Name it ND Dev Dashboard Connector — Read Only.</li><li>Copy the complete code below, replace the starter myFunction code in Code.gs, and save with Ctrl+S.</li></ol>
      <p>Do not replace the existing desktop or Fudge script. No extra libraries or Sheet menu actions are needed.</p>
      <details><summary>Connector code — ready to copy</summary><CopyBlock label="connector code" value={connectorSource} rows={12} /></details>
    </Panel>
    <Panel title="3. Add Script properties">
      <p>In your new Apps Script project, click the bottom-left gear (Project Settings). Scroll to Script properties → Add script property. Add two separate rows:</p>
      <dl className="definition-list"><dt>SHEET_ID</dt><dd>The spreadsheet ID from step 1, not this dashboard’s workspace ID.</dd><dt>SYNC_TOKEN</dt><dd>The private token you generate or enter below.</dd></dl>
      {configured && <label className="check-label"><input type="checkbox" checked={replaceConfirmed} onChange={(event) => setReplaceConfirmed(event.target.checked)} />I intend to replace the existing connection and will update both sides.</label>}
      <div className="header-actions"><button className="button secondary" type="button" disabled={Boolean(token) || (configured && !replaceConfirmed)} onClick={() => {
        try { setToken(generateSetupToken()); setTokenError(""); } catch { setTokenError("Secure token generation is unavailable. Use a supported browser on HTTPS or localhost."); }
      }}>Generate private token</button><button className="button secondary" type="button" disabled={!token} onClick={() => { setToken(""); setTokenError(""); }}>Clear token from this page</button></div>
      <label>SYNC_TOKEN (or paste your existing Script property value)<input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" spellCheck={false} /></label>
      {validSetupToken(token) ? <CopyBlock label="SYNC_TOKEN value" value={token} sensitive /> : token && <p className="notice error" role="alert">Use 24–256 letters, numbers, underscores or hyphens, or generate a token above. No spaces or line breaks.</p>}
      {tokenError && <p className="notice error" role="alert">{tokenError}</p>}
      <p className="small muted">Save both properties in Google. Token input stays only in this page’s memory until you copy it; reloading clears it. It is not saved to the browser or submitted by the test button. Do not send it through chat or screenshots.</p>
    </Panel>
    <Panel title="4. Deploy and authorize in Google">
      <ol><li>Deploy → New deployment → gear/type selector → Web app.</li><li>Execute as: Me. Who has access: Anyone. Keep the Sheet itself private.</li><li>Deploy, select your authorized Google account, and review the requested permissions.</li><li>If Google shows an unverified-app warning, first confirm the developer account is yours and the code is your reviewed connector. Only then use Advanced → Go to your connector → review permissions → Allow. Stop for an unfamiliar developer or organizational access block and contact your administrator.</li><li>Copy the Web app URL ending in /exec, not the Deployment ID or editor URL.</li></ol>
      <label>New connector Web app URL<input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://script.google.com/macros/s/…/exec" autoComplete="off" spellCheck={false} /></label>
      <p className="small muted">Opening the URL in a browser may show post_only; this is normal GET rejection. Never add a token to the URL.</p>
    </Panel>
    <Panel title="5. Copy the dashboard settings">
      <CopyBlock label="workspace ID" value={workspaceId} rows={2} />
      <p>For a local install, open <code>apps/web/.env.local</code>. Replace the three existing SHEET_SYNC entries with the block below; do not duplicate them. Leave Supabase settings unchanged.</p>
      {envSnippet ? <CopyBlock label="environment settings" value={envSnippet} sensitive rows={4} /> : <p className="notice">Enter a valid token and /exec URL above to generate the complete settings block. Your current workspace ID is inserted automatically.</p>}
      <p>An administrator must save these settings and restart this project’s local server. On Vercel, add them in project Environment Variables for the intended environment and redeploy. This page does not write server files or change Vercel settings.</p>
    </Panel>
    <Panel title="6. Test the saved connection and open your Sheet">
      <p>This button tests only the server’s saved configuration for your workspace—not unsaved values entered above. It reads safe Auto Posting metadata and never imports rows or starts jobs.</p>
      <form action={testAction}><button className="button" type="submit" disabled={testing} aria-busy={testing}>{testing ? "Testing saved connection…" : "Test saved connection"}</button></form>
      {state.success && <p className="notice success" role="status">{state.success}</p>}
      {state.error && <p className="notice error" role="alert">{state.error}</p>}
      <p><Link className="button secondary" href="/dashboard/master-sheet">Open Master Sheet preview</Link></p>
      <p className="small muted">The legacy Bulk proxy import tab with a Cookies column appears under Bulk cookies import. A separate missing proxy tab is optional. Refresh view is not a live-post check. Exact customer/profile mapping is required before importing links.</p>
    </Panel>
    <Panel title="Troubleshooting and updates">
      <dl className="definition-list"><dt>Not configured</dt><dd>Save all three server settings for this workspace and restart/redeploy.</dd><dt>Unauthorized</dt><dd>Ensure the Script property token and server token match exactly.</dd><dt>Unexpected HTML / 404</dt><dd>Check /exec URL, Execute as Me, access policy and administrator restrictions.</dd><dt>Updated code not running</dt><dd>Save the separate connector; Deploy → Manage deployments → Edit → New version → Deploy.</dd><dt>Need to disconnect?</dt><dd>Remove this integration’s server settings or archive only its separate Google deployment. Do not delete Sheet data or replace legacy scripts.</dd></dl>
    </Panel>
  </div>;
}
