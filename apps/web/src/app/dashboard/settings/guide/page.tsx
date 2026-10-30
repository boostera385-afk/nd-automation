import Link from "next/link";
import type { ReactNode } from "react";
import { CircleAlert, Info, Laptop, ShieldCheck, TriangleAlert } from "lucide-react";
import { requireWorkspace } from "@/lib/data";
import { PageHeader } from "@/components/ui";

type Tone = "blue" | "violet" | "green" | "amber" | "red";

function GuideSection({ tone, step, label, title, hint, children }: { tone: Tone; step: string; label: string; title: string; hint?: string; children: ReactNode }) {
  return <section className={`guide-section guide-tone-${tone}`}>
    <header className="guide-section-head">
      <span className="guide-step-num" aria-hidden>{step}</span>
      <div><p className="eyebrow">{label}</p><h2>{title}</h2>{hint && <p className="muted small">{hint}</p>}</div>
    </header>
    {children}
  </section>;
}

function Step({ title, children }: { title: string; children?: ReactNode }) {
  return <li><div><strong>{title}</strong>{children && <p>{children}</p>}</div></li>;
}

function Callout({ tone, icon, title, children }: { tone: Tone; icon: "info" | "warn" | "danger" | "safe"; title: string; children: ReactNode }) {
  const Icon = icon === "danger" || icon === "warn" ? TriangleAlert : icon === "safe" ? ShieldCheck : Info;
  return <div className={`guide-callout guide-tone-${tone}`}><Icon size={17} aria-hidden /><div><strong>{title}</strong><p>{children}</p></div></div>;
}

export default async function SetupGuide() {
  await requireWorkspace();
  return <>
    <PageHeader eyebrow="START HERE · SETUP + DAILY USE" title="First-time setup & how-to guide" description="Follow the colored phases once, then use the daily rhythm. This guide keeps dashboard features, Fudge behaviour and desktop-only work clearly separate. Opening this page starts no browser, upload, post or Sheet write." />

    <section className="guide-banner guide-tone-blue">
      <div>
        <h2>Two apps, three jobs, one honest workflow</h2>
        <p><strong>Fudge</strong> collects reviews. <strong>Your Sheet</strong> stays the working list. <strong>ND dashboard</strong> saves profile mappings, syncs known post links and records read-only monitoring results. Posting, listing and account creation still belong to the desktop app.</p>
      </div>
      <Link className="button" href="/dashboard/settings/sheet-setup">Sheet setup wizard</Link>
    </section>

    <div className="guide-phases">
      <article className="guide-phase guide-tone-blue"><span aria-hidden>1</span><strong>One-time setup</strong><small>Account, customers, worker, profile mappings, Master Sheet.</small></article>
      <article className="guide-phase guide-tone-violet"><span aria-hidden>2</span><strong>Fudge intake</strong><small>Collect reviews, save the source Sheet, clean rows.</small></article>
      <article className="guide-phase guide-tone-green"><span aria-hidden>3</span><strong>ND automations</strong><small>Sync the master Sheet, confirm a batch, review Results.</small></article>
      <article className="guide-phase guide-tone-amber"><span aria-hidden>4</span><strong>Daily + fixes</strong><small>Six-step work session and the troubleshooting cards.</small></article>
    </div>

    <GuideSection tone="blue" step="1" label="PHASE 1 · DO THIS ONCE" title="First-time setup" hint="About 30 minutes. Do not repeat it every day, and never paste credentials into chat or a Sheet.">
      <ol className="guide-steps">
        <Step title="Verify one account for both apps">Use the same email and password in Fudge and this dashboard — there is no second signup. Open the verification email before staff pages will work. An unverified account sees only limited screens.</Step>
        <Step title="Confirm the business timezone">Open <Link href="/dashboard/customers">Customers</Link> and check the customer record. The default business timezone is <code>America/Los_Angeles</code>. Timestamps are stored in UTC and shown in the business timezone; do not change the timezone just to make an unknown date look known.</Step>
        <Step title="Create only real customer records">Add the customers you are authorized to report on. Never create a placeholder, competitor or test customer to explore a page.</Step>
        <Step title="Pair your laptop / worker once">Open <Link href="/dashboard/automation">Pair laptop / worker</Link> and register the worker. Save its private credential locally on the paired laptop as the worker asks. A credential is revocable; if it is exposed, revoke it and pair again. There is no service-role key in the web app or worker.</Step>
        <Step title="Map the exact profile, not a guessed name">Open <Link href="/dashboard/profiles">Profiles</Link> or <Link href="/dashboard/automation">Automation control</Link>. Choose the existing Incogniton profile by exact UUID, its customer, its worker and the account label used on post records. Duplicate names are never resolved by guessing. A saved mapping is reused by Sheet sync and monitoring.</Step>
        <Step title="Connect the Master Sheet if you use Sheet sync">Open <Link href="/dashboard/master-sheet">Master Sheet</Link> → Connect Master Sheet — step-by-step. The server needs <code>SHEET_SYNC_URL</code>, <code>SHEET_SYNC_TOKEN</code> and <code>SHEET_SYNC_ORGANIZATION_ID</code> (the workspace ID is shown in the wizard). Deploy the separate read-only connector; never replace the Fudge or desktop Apps Script with it. Test the saved connection — a saved setting alone does not prove the Sheet is reachable.</Step>
        <Step title="Check the Home setup cards">Open <Link href="/dashboard">Home</Link> and confirm Master Sheet, local laptop and profile mappings show as configured or seen. A worker heartbeat means the worker checked in; it is not proof that Incogniton or the browser profile is ready.</Step>
      </ol>
      <Callout tone="amber" icon="warn" title="Skipping a step is safe — the dashboard will not improvise">Without a worker or a saved profile mapping, no monitoring batch is planned. The dashboard never guesses a profile, customer or publication link.</Callout>
    </GuideSection>

    <GuideSection tone="violet" step="2" label="PHASE 2 · FUDGE INTAKE" title="How to use Fudge" hint="Fudge is a separate Chrome extension. The dashboard only exposes read-only backend receipts.">
      <ol className="guide-steps">
        <Step title="Start from the correct signed-in profile">Open Chrome with the intended Incogniton profile and confirm you are on the right Nextdoor account. Use one profile at a time; do not run Fudge and another automation against the same profile.</Step>
        <Step title="Run Fudge’s own capture on the page you are viewing">Follow the Fudge extension’s current setup for the review list you have open. Do not run a second collection on the same profile, and do not treat a dashboard page as a collection button.</Step>
        <Step title="Resolve local pending or blocked items inside Fudge">The dashboard cannot see a device-local queue. If Fudge reports pending or blocked work, finish or clear it in Fudge. A backend receipt is not proof that every local record was delivered.</Step>
        <Step title="Save to the Fudge source Sheet">Fudge writes its source Sheet. Keep that Sheet as your working copy; it is not the Master Sheet the dashboard previews.</Step>
        <Step title="Clean up before the master Sheet">Remove duplicates, correct business names and fix dates you can actually verify. Leave an unknown date unknown instead of inventing one. Keep the column layout your Master Sheet expects.</Step>
        <Step title="Copy the cleaned rows into the ND master Sheet">Use the same tabs and columns the dashboard reads. Do not rename or delete the existing Sheet, and do not replace the desktop or Fudge Apps Script with the read-only dashboard connector.</Step>
      </ol>
      <Callout tone="red" icon="danger" title="Upload release is off in this Fudge build">The <Link href="/dashboard/fudge">Fudge intake receipts</Link> page is read-only. It shows received-record and revision counts; it cannot upload, approve, publish or write to a Sheet. An empty backend count does not mean the local Fudge library is empty. Intake upload, live acceptance and an approved pilot remain separate gates.</Callout>
    </GuideSection>

    <GuideSection tone="green" step="3" label="PHASE 3 · ND DASHBOARD AUTOMATIONS" title="From Master Sheet to Results" hint="Monitoring is read-only. The dashboard alone never launches a local browser.">
      <ol className="guide-steps">
        <Step title="Start a work session">Use the top bar or <Link href="/dashboard">Home</Link>. A work session is an 8–10 hour human work record, not 24/7 operation. Enablement is tied to the current session; a new session requires a new authorization.</Step>
        <Step title="Sync the Master Sheet">Open <Link href="/dashboard/master-sheet">Master Sheet</Link>, choose Auto Posting or Auto Listing, then use <strong>Sync known profiles now</strong>. The sync is explicit and idempotent and uses saved mappings only. A Sheet “Posted” or “Alive” label is a claim, not an automatically verified observation.</Step>
        <Step title="Confirm a monitoring batch once">Open <Link href="/dashboard/run">Run automation</Link>, select the saved profiles and confirm the batch. Alternatively use <Link href="/dashboard/automation">Automation control</Link> to enable each assigned profile. Comment collection is partial by design and only happens when the operator has authorized it for the session.</Step>
        <Step title="Let the paired worker plan due checks">The worker plans read-only checks for older or unknown-date posts that have not been checked in 24 hours. The laptop and Incogniton must stay available. The dashboard dispatches work; it does not open a profile itself.</Step>
        <Step title="Review Results, Posts and Comments">Open <Link href="/dashboard/results">Results</Link> for saved links, visibility, comments and problems. Visibility describes the saved observation time, not guaranteed current status. Use <Link href="/dashboard/posts">Posts</Link> and <Link href="/dashboard/comments">Comments</Link> for the detailed ledger.</Step>
        <Step title="Read comments honestly">A stored sample can be incomplete. When the page does not expose a comment total or an expansion path, the run is marked incomplete instead of claiming completeness. Authors and bodies are saved only when read from the page; when only a relative label exists, the platform creation time stays “unknown” and is never invented.</Step>
        <Step title="Pause or end the session when you stop">Pause/End work stops new claims; an in-flight read may finish. Pending jobs are not retried automatically after an expired lease — reconcile only after stopping the old agent.</Step>
      </ol>
      <Callout tone="blue" icon="info" title="What the buttons do not do">Sync, monitoring and Results never publish, upload, create profiles, change cookies or proxies, or write back to the Sheet. Those actions remain gated or belong to the desktop app.</Callout>
    </GuideSection>

    <GuideSection tone="amber" step="4" label="PHASE 4 · EVERY WORKING DAY" title="Daily rhythm and troubleshooting" hint="If something looks wrong, stop and read the matching card before retrying.">
      <ol className="guide-steps">
        <Step title="Check Home, then start the session">Look at the three setup cards and the work-session control before opening any profile.</Step>
        <Step title="Finish the Fudge → source Sheet → cleanup → master Sheet loop">Do the Sheet work while Fudge’s local state is fresh. Keep unknown dates unknown.</Step>
        <Step title="Sync known links in Master Sheet">One explicit sync after the cleaned rows are in place. Do not retype posts into the dashboard.</Step>
        <Step title="Confirm the monitoring batch for this session">Select only the profiles you intend to check and confirm once.</Step>
        <Step title="Review Results before you finish">Handle exceptions — login problems, proxies, partial comments, account review — as human follow-ups.</Step>
        <Step title="End the session cleanly">Pause/End work, close the profile and leave no second agent running on it.</Step>
      </ol>
      <div className="guide-cards">
        <article className="guide-card guide-tone-amber"><h3>Login required</h3><p>The profile is signed out or challenged. Sign in by hand in that exact profile, finish any verification, then run again.</p><p>Never automate a login challenge or retry it in a loop.</p></article>
        <article className="guide-card guide-tone-amber"><h3>Verification / checkpoint</h3><p>Human handoff. Stop the run, complete the check yourself in the browser, and record the real outcome.</p></article>
        <article className="guide-card guide-tone-amber"><h3>Proxy issue</h3><p>Stop the run. Check the proxy in the desktop app or Incogniton profile. Never paste proxy passwords into a dashboard form or a Sheet.</p></article>
        <article className="guide-card guide-tone-amber"><h3>Profile busy</h3><p>Another agent or tab is using the profile. Close it and wait. Run one profile at a time; reconcile an expired lease only after the old agent is stopped.</p></article>
        <article className="guide-card guide-tone-red"><h3>Account disabled / needs review</h3><p>Nextdoor redirected to its Account Disabled page. Everything stops for a person to review the account.</p><p>Never use another profile or technique to evade a suspension.</p></article>
        <article className="guide-card guide-tone-amber"><h3>Waiting for worker / offline</h3><p>Start the local worker on the paired laptop and confirm the heartbeat. A heartbeat still is not proof that Incogniton or the browser profile is ready.</p></article>
        <article className="guide-card guide-tone-amber"><h3>Sheet not configured</h3><p>The server is missing its <code>SHEET_SYNC_*</code> settings (for example on a deployment). Use the CSV import/export fallback; no live Sheet write happens.</p></article>
        <article className="guide-card guide-tone-amber"><h3>Counts look partial</h3><p>Lists are intentionally limited (for example the latest 100 jobs or 50 revision receipts). Partial data is labelled; never present it as an all-time total.</p></article>
      </div>
    </GuideSection>

    <section className="guide-section guide-tone-red">
      <header className="guide-section-head">
        <span className="guide-step-num" aria-hidden><Laptop size={17} /></span>
        <div><p className="eyebrow">STILL DESKTOP OR GATED</p><h2>What this dashboard does not do yet</h2><p className="muted small">No pretend buttons. Use the preserved desktop app for these jobs and avoid overlapping work on the same profile.</p></div>
      </header>
      <div className="guide-cards">
        <article className="guide-card guide-tone-blue"><h3>Desktop app</h3><p>Auto Posting, Auto Listing, Incogniton profile creation, cookie and proxy handling, and media work.</p></article>
        <article className="guide-card guide-tone-red"><h3>Not implemented or validated</h3><p>Dashboard publishing and listings, scheduling, account creation, automatic Sheet writeback, Fudge intake upload and unattended ingestion.</p></article>
        <article className="guide-card guide-tone-amber"><h3>Labelled honestly</h3><p>Run automation marks these tasks <strong>Desktop only</strong>. There is no Start button that pretends otherwise.</p></article>
      </div>
      <div className="guide-callout guide-tone-red"><TriangleAlert size={17} aria-hidden /><div><strong>Irreversible actions stay off</strong><p>Uploads, publishing, client-facing posts and real Sheet writes require a separate, explicit authorization. Do not enable them to “test” the guide.</p></div></div>
    </section>

    <section className="guide-section guide-tone-green">
      <header className="guide-section-head">
        <span className="guide-step-num" aria-hidden><ShieldCheck size={17} /></span>
        <div><p className="eyebrow">SAFETY RULES</p><h2>Keep credentials and claims clean</h2><p className="muted small">These rules apply to every role, including staff.</p></div>
      </header>
      <ul className="guide-rules">
        <li><ShieldCheck size={15} aria-hidden />Never share, screenshot or commit tokens, cookies, proxies, <code>.env</code> files, customer exports or signed-in sessions.</li>
        <li><CircleAlert size={15} aria-hidden />There is no service-role key in the web app or worker. Worker requests use narrow, revocable credentials.</li>
        <li><TriangleAlert size={15} aria-hidden />Never guess a profile UUID, customer assignment, post date or observation. Unknown stays unknown.</li>
        <li><Laptop size={15} aria-hidden />No 24/7 execution. Work sessions are 8–10 hours and must be ended cleanly.</li>
      </ul>
    </section>

    <section className="guide-section guide-tone-blue">
      <header className="guide-section-head">
        <span className="guide-step-num" aria-hidden>→</span>
        <div><p className="eyebrow">NEXT PAGE</p><h2>Open the exact screen you need</h2><p className="muted small">Every step above links to a real dashboard page. Nothing opens automatically.</p></div>
      </header>
      <div className="workflow-links">
        <Link href="/dashboard/settings"><strong>Settings / More</strong><small>All one-time connections and advanced tools.</small></Link>
        <Link href="/dashboard/master-sheet"><strong>Master Sheet</strong><small>Read tabs and sync known post links.</small></Link>
        <Link href="/dashboard/run"><strong>Run automation</strong><small>Confirm a read-only monitoring batch.</small></Link>
        <Link href="/dashboard/results"><strong>Results</strong><small>Links, visibility, comments and problems.</small></Link>
        <Link href="/dashboard/profiles"><strong>Profiles</strong><small>Saved exact-UUID customer mappings.</small></Link>
        <Link href="/dashboard/automation"><strong>Automation control</strong><small>Worker health, authorization and lease recovery.</small></Link>
        <Link href="/dashboard/fudge"><strong>Fudge intake receipts</strong><small>Read-only backend counts and revisions.</small></Link>
        <Link href="/dashboard/settings/sheet-setup"><strong>Connect Master Sheet</strong><small>Numbered wizard with copy buttons and testing.</small></Link>
      </div>
    </section>
  </>;
}
