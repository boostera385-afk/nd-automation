# Branded sign-up and security emails

Six professional HTML emails (light and dark mode, Outlook/Gmail-safe tables, a plain-link fallback and no remote images). They link to the app's one-click `/auth/confirm` page, which fixes two real problems of the default Supabase link:

- **Opens on any device.** The default link only works in the browser that requested it; opening the email on a phone gave "invalid link".
- **Survives email scanners.** Some mail systems pre-open links and use up the one-time token. The confirm page needs one click from the person first.

| File | Supabase template | Subject (see `subjects.json`) |
|---|---|---|
| `confirm-signup.html` | Confirm sign up | Verify your Fudge + ND account |
| `reset-password.html` | Reset password | Reset your Fudge + ND password |
| `magic-link.html` | Magic link | Your ND Automations sign-in link |
| `invite-user.html` | Invite user | You’re invited to ND Automations |
| `change-email.html` | Change email address | Confirm your new email address |
| `reauthentication.html` | Reauthentication | Your ND Automations security code |

Edit the wording in `apps/web/scripts/build-email-templates.mjs`, then regenerate with `node scripts/build-email-templates.mjs` (run from `apps/web`). Do not hand-edit the HTML.

## Apply them (Supabase dashboard → Authentication)

1. **URL Configuration**
   - *Site URL*: your app address, e.g. `http://127.0.0.1:3100` for local use or your `https://` domain in production. The templates build their links from it (`{{ .SiteURL }}`).
   - Set dashboard `APP_URL` to the same canonical origin. Add only the exact needed
     redirect URLs: `<your address>/auth/callback` and
     `<your address>/auth/callback?next=/reset-password`. Keep local development
     entries separate; do not use a production wildcard or a Chrome-extension URL.
2. **Emails → Templates**: open each template, paste the matching HTML file, and set the subject from the table.
3. **Sign In / Providers → Email**: keep **Confirm email** turned on.
4. **Emails → SMTP Settings (recommended before real customers)**: Supabase's built-in sender is only for testing, is heavily rate-limited and often lands in spam. Connect a transactional provider (Resend, Postmark, Amazon SES, ...) and use a sender such as `no-reply@yourdomain.com` after setting up SPF, DKIM and DMARC for your domain.
5. **Rate limits**: leave Supabase's defaults on. The app already shows a clear "wait a few minutes" message when they are hit.
6. Optional on paid plans: turn on leaked-password protection.

## Shared-project deployment status — 2026-10-29

These files are prepared locally, **not applied to hosted Auth settings**. The
connected database MCP cannot change Auth email templates, SMTP or Site URL; these
are Auth service settings, not SQL migrations. Use the authenticated Supabase
dashboard for project `xtefjnfdjnxwrpkoydaj`. Do not store SMTP passwords or management
tokens in SQL, the extension, public docs or the repository. Keep confirmation
enabled. A real public HTTPS dashboard origin and verified sending domain must be
chosen before production setup; do not invent these or use localhost for customers.

Both Fudge signup (which uses the project Site URL) and dashboard signup must be
tested after applying the template. The `/auth/confirm` page requires a deliberate
button click before consuming the token hash. Check delivery, valid/expired/used
links, resend and password reset with authorized test addresses. Confirm that
verification grants no other team's membership and starts no browser or upload job.
Do not send verification emails to unrelated addresses as a test. Updating files
or passing tests does not prove delivery or SPF/DKIM/DMARC configuration.

## Check it worked

1. Sign up with a new address → the email arrives with the "Confirm my email" button.
2. Open the link on a different device or browser → a page with one button; press it → you land in the dashboard.
3. Sign up again with the same address → you see the same neutral message and no second account is created.
4. Sign in with an unverified address → you are offered "Send a new verification email".

## Why sign-up never says "already registered"

Supabase deliberately answers "success" for an address that already has an account, so strangers cannot test which emails are registered. The app keeps that protection: the message tells everyone to check their inbox and, if nothing arrives, to sign in or reset their password. If you would rather show an explicit "already registered" message, that is a business choice that trades privacy for convenience; ask and it can be added.
