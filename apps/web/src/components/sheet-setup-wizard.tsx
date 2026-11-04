"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { clearSheetConnection, saveSheetConnection, testSavedSheetConnection, type SheetConnectionTestState } from "@/app/actions/sheet-setup";
import { extractSpreadsheetId, generateSetupToken, sheetEnvironmentSnippet, sheetEnvironmentTemplate, validSetupToken } from "@/lib/sheet-setup";
import type { FormState } from "@/app/actions/auth";
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

// Two steps, once per workspace — like saving the worker ("check") credential:
// 1. prepare the small read-only connector in Google; 2. paste its URL and
// private token here and save. No hosting settings or restarts are needed.
export function SheetSetupWizard({ workspaceId, configured, connectorSource }: { workspaceId: string; configured: boolean; connectorSource: string }) {
  const [sheetInput, setSheetInput] = useState("");
  const [token, setToken] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [tokenError, setTokenError] = useState("");
  const [saveState, saveAction, saving] = useActionState<FormState, FormData>(saveSheetConnection, {});
  const [testState, testAction, testing] = useActionState<SheetConnectionTestState, FormData>(async () => testSavedSheetConnection(), {});
  const [clearState, clearAction, clearing] = useActionState<FormState, FormData>(clearSheetConnection, {});
  const sheetId = extractSpreadsheetId(sheetInput);
  const envSnippet = sheetEnvironmentSnippet(endpoint, token, workspaceId);
  return <div className="form-grid">
    <div className="notice"><strong>{configured ? "This workspace is connected" : "One connection for the whole workspace"}</strong>
      <p>Read-only Sheet preview: it never writes to the Sheet and does not activate posting, profile creation, live-post checking or Sheet writeback. New staff reuse the saved connection — they never redo setup.</p>
      {configured && <p>Use Test connection in step 2 first. Replace only values you are changing (for example after deploying a new Sheet). The saved token is never shown on this page.</p>}
    </div>

    <Panel title="Step 1 — Prepare the read-only connector in Google (about 5 minutes, once)">
      <label>Your Google Sheet URL<input value={sheetInput} onChange={(event) => setSheetInput(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…/edit" autoComplete="off" spellCheck={false} /></label>
      <p className="small muted">This reads the ID locally; it never opens or modifies your Sheet. Keep using your existing Fudge automation script — this connector is a separate, read-only project.</p>
      {sheetId ? <CopyBlock label="SHEET_ID value" value={sheetId} rows={2} /> : sheetInput && <p className="notice error" role="alert">Enter a Google Sheets URL or its spreadsheet ID, not a dashboard/workspace ID.</p>}
      <ol>
        <li>Open <a href="https://script.google.com/home/start" target="_blank" rel="noreferrer">Google Apps Script</a> → New project → replace the Code.gs contents with the connector code below → save (Ctrl+S). No libraries or menu actions are needed.</li>
        <li>Project Settings (bottom-left gear) → Script properties → add two rows: <strong>SHEET_ID</strong> (the value above) and <strong>SYNC_TOKEN</strong> (generate below, then paste the same value into step 2).</li>
        <li>Deploy → New deployment → gear selector → Web app. <strong>Execute as: Me. Who has access: Anyone.</strong> Keep the Sheet itself private. Copy the Web app URL ending in <strong>/exec</strong>.</li>
      </ol>
      <div className="header-actions"><button className="button secondary" type="button" disabled={Boolean(token)} onClick={() => {
        try { setToken(generateSetupToken()); setTokenError(""); } catch { setTokenError("Secure token generation is unavailable. Use a supported browser on HTTPS or localhost."); }
      }}>Generate private token</button><button className="button secondary" type="button" disabled={!token} onClick={() => { setToken(""); setTokenError(""); }}>Clear token from this page</button></div>
      {validSetupToken(token) ? <CopyBlock label="SYNC_TOKEN value" value={token} sensitive /> : null}
      {tokenError && <p className="notice error" role="alert">{tokenError}</p>}
      {validSetupToken(token) && <p className="small muted">Paste this same token into the Google Script property <strong>and</strong> step 2 below. Reloading clears it from this page; it is never sent to chat or screenshots.</p>}
      <details><summary>Connector code — ready to copy</summary><CopyBlock label="connector code" value={connectorSource} rows={12} /></details>
      <details><summary>If Google shows an unverified-app warning</summary><p>Only continue when the Google account is yours and the code is the connector above (Advanced → Go to your connector → review permissions → Allow). Stop for an unfamiliar developer or an organisational block and ask your administrator.</p></details>
    </Panel>

    <Panel title="Step 2 — Save the connection here (once, no hosting changes)">
      <p>Saved inside this workspace like the worker credential: the URL and token stay on the server, nothing is read or imported until you test, and staff reuse it from then on.</p>
      <form action={saveAction} className="form-grid">
        <input type="hidden" name="sheet_input" value={sheetInput} />
        <label>Connector Web app URL<input name="endpoint_url" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://script.google.com/macros/s/…/exec" autoComplete="off" spellCheck={false} /></label>
        <label>SYNC_TOKEN<input name="sync_token" type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="24+ character private token from step 1" autoComplete="off" spellCheck={false} /></label>
        <label className="check-label"><input type="checkbox" name="confirm_save" />I verified this Sheet in step 1 and save this connection for the whole workspace.</label>
        <button className="button" type="submit" disabled={saving || !sheetId} aria-busy={saving}>{saving ? "Saving…" : configured ? "Save (replace current)" : "Save connection"}</button>
      </form>
      {saveState.success && <p className="notice success" role="status">{saveState.success}</p>}
      {saveState.error && <p className="notice error" role="alert">{saveState.error}</p>}
      {!sheetId && <p className="small muted">Enter your Sheet URL in step 1 first — saving stays locked until its ID is recognised.</p>}
      <form action={testAction}><button className="button secondary" type="submit" disabled={testing} aria-busy={testing}>{testing ? "Testing saved connection…" : "Test saved connection"}</button></form>
      {testState.success && <p className="notice success" role="status">{testState.success}</p>}
      {testState.error && <p className="notice error" role="alert">{testState.error}</p>}
      {configured && <details className="workflow-details"><summary>Disconnect this workspace</summary>
        <form action={clearAction} className="form-grid">
          <label className="check-label"><input type="checkbox" name="confirm_clear" />Remove the saved connection. The Google connector, the Sheet and any hosted settings are untouched; staff lose Sheet sync until it is reconnected.</label>
          <button className="button secondary" type="submit" disabled={clearing} aria-busy={clearing}>{clearing ? "Removing…" : "Remove saved connection"}</button>
        </form>
        {clearState.success && <p className="notice success" role="status">{clearState.success}</p>}
        {clearState.error && <p className="notice error" role="alert">{clearState.error}</p>}
      </details>}
      <details className="workflow-details"><summary>Advanced: hosted environment settings instead</summary>
        <p>Your administrator can instead keep the three values below in the hosting project (Vercel → Environment Variables) and redeploy; those values then take precedence over the saved workspace row. The workspace save above needs none of this.</p>
        <CopyBlock label="workspace ID" value={workspaceId} rows={2} />
        {envSnippet ? <CopyBlock label="environment settings" value={envSnippet} sensitive rows={4} /> : <CopyBlock label="environment settings template" value={sheetEnvironmentTemplate(endpoint, token, workspaceId)} sensitive={validSetupToken(token)} rows={4} />}
      </details>
      <p><Link className="button secondary" href="/dashboard/master-sheet">Open Master Sheet preview</Link></p>
    </Panel>

    <Panel title="Troubleshooting">
      <dl className="definition-list"><dt>Not configured</dt><dd>Save in step 2 for this workspace, or add hosted environment settings and redeploy.</dd><dt>Unauthorized</dt><dd>The Script property token and the saved token must match exactly.</dd><dt>Unexpected HTML / 404</dt><dd>Check the /exec URL, Execute as Me, access policy and administrator restrictions.</dd><dt>Updated code not running</dt><dd>Save the separate connector; Deploy → Manage deployments → Edit → New version → Deploy.</dd><dt>Legacy Fudge script</dt><dd>Never replace it — the connector stays a separate read-only project.</dd></dl>
    </Panel>
  </div>;
}
