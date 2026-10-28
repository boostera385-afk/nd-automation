# P2 Fudge ingestion v1 — backend contract

Updated: 2026-10-28. **Schema deployed; uploader release remains OFF.** Fudge has optional
Auth/workspace setup and a durable MV3 uploader in source; upload release is OFF.
See the Fudge repository's `docs/BACKEND-UPLOADER.md` for session, queue, retry and
cancellation behavior. Hosted migration `20261028203642` and transactional smoke
tests passed; see `DB-DEPLOYMENT-20261028.md`. No real source upload, historical
migration or live intake pilot ran. This is not a completed P2 rollout.

## Files and deployment boundary

- `supabase/migrations/20261028203213_fudge_ingestion_v1.sql`: promoted source,
  loaded explicitly by PGlite tests and applied through MCP.
- `apps/web/src/lib/fudge-ingestion.ts`: strict DTOs, collector projection, client
  budgets and receipt validation for the future uploader/API boundary.
- `apps/web/tests/fudge-ingestion.test.ts`: fixture database and validation tests.

Supabase CLI 2.122.0 was invoked through pinned npx to generate the migration
filename after explicit deployment approval. MCP assigned hosted version
`20261028203642`; preserve that source/hosted mapping and all six prior migrations.
Do not blindly push the directory or deploy the unrelated publishing protocol as
an intake dependency. Local Docker-stack/restore acceptance remains unverified.

## Ownership and access

Use the single selected shared backend `xtefjnfdjnxwrpkoydaj`. Raw source records
belong to the explicitly selected organization, not one uploader. Verified-email
owner/admin/operator members may ingest. Established staff membership controls
reads; customer members and other workspaces cannot read the raw library.
Workspace membership is checked in the database, not trusted from client input.

The public RPC is SECURITY INVOKER; the privilege-requiring implementation is in
the private schema, uses an empty fixed search path, checks Auth/verified email/
staff authorization, and has no anon execution grant. Both new public tables have
RLS plus authenticated SELECT only. Clients cannot directly insert/update/delete.
No service-role key, worker credential or metadata-based role claim is used.

Customer assignment, cleanup, approval and publishing remain separate later
operations. Intake grants none of them. Background upload does not require an
active browser-worker work session; authenticated upload consent is separate from
browser dispatch authorization. This ownership choice remains subject to review
before deployment; it is not an account/membership change.

## Versioned request

The client validates this envelope:

```json
{
  "version": 1,
  "organization_id": "11111111-1111-4111-8111-111111111111",
  "reviews": [
    {
      "source": "google",
      "source_review_id": "fixture-stable-google-review-id",
      "observed_at": "2026-10-27T10:00:00Z",
      "payload": {
        "text": "Unmodified original fixture review text.",
        "rating": 5,
        "author": "Fixture reviewer",
        "business_name": "Fixture business",
        "place_id": "fixture-place",
        "source_url": "https://www.google.com/maps?fixture=1",
        "photo_urls": ["https://images.example/fixture.jpg"],
        "display_date": "A week ago"
      }
    }
  ]
}
```

The future authenticated PostgREST call is
`reporting_ingest_fudge_reviews_v1`, with parameters
`{ "org": organization_id, "reviews": reviews }`. The function name encodes the
contract version. Send the publishable key in `apikey` and the user's access JWT
as bearer authorization; a publishable key alone cannot ingest. This RPC is not
currently deployed, so do not enable an uploader against it yet.

The current `content.js` fields map as follows:

| Collector field | v1 field |
| --- | --- |
| `googleReviewId` | `source_review_id`; no local fingerprint fallback |
| `collectedAt` | `observed_at`; observation time, never publication time |
| `text`, `rating`, `author` | Same payload fields, original values |
| `placeName`, `placeId` | `business_name`, `place_id` |
| `sourceUrl`, `photos`, `date` | `source_url`, `photo_urls`, `display_date` |

`projectFudgeCollectorReview` makes a new allowlisted projection without mutating
local data. It deliberately excludes rewrite output, classification, upload/Drive
state, API keys and cookie/password/proxy fields. This projection is not a full
serialization of the original extension object; the local library remains intact.
Unavailable optional descriptive strings become empty strings, not invented
authors/businesses. Missing stable Google review IDs return null: keep those
records local/blocked until a separately reviewed identity policy exists.

## Limits and validation

- 1–100 distinct source identities per batch; duplicate identities within a batch
  are rejected. This is an ingestion limit, not the 100-publication check policy.
- Client serialized envelope budget: 256 KiB UTF-8; per-payload client budget:
  120,000 UTF-8 bytes. SQL ceilings: 512 KiB for serialized JSONB batch and 128 KiB
  for one serialized JSONB payload. Conservative client budgets leave room for
  serialization differences. Enforce HTTP limits before JSON parsing in a future
  API gateway; SQL limits are not request/account rate limits.
- Original text: nonblank, maximum 30,000 Unicode code points; no text rewrite or
  truncation. Ratings: integer 1–5. Up to 30 photo URLs. Descriptive field and URL
  lengths are explicitly bounded in client/SQL validation. Unsupported/oversized
  records require a visible repair path, never silent dropping.
- Source/photo URLs are HTTPS provenance strings without URL user credentials;
  nothing fetches or follows them in this slice. Storing a URL is not proof of
  access, media rights or safe future fetching. Any media fetch adapter needs its
  own approved-origin, redirect, byte/type and SSRF controls.
- Observation timestamps require seconds and a timezone (prefer the collector's
  UTC ISO string), parse as timestamps and cannot exceed server time by five
  minutes. Original relative display dates remain strings; never invent an
  absolute platform publication date from them.
- Unknown fields, credential-shaped fields, wrong types and malformed source
  identities are rejected. Allowlisting cannot detect a secret embedded inside
  otherwise valid review text; opt-in/retention/privacy review is still required.

## Immutable originals and safe retry semantics

`reporting_fudge_records` holds an organization/source/Google-review identity.
`reporting_fudge_revisions` holds immutable client-visible payload versions with
server IDs, revision numbers, first observation/receipt time and actor attribution.
The RPC only inserts; no later review overwrites the first source text.

Content SHA-256 is computed by the restricted implementation. JSONB canonical key
order and numeric-rating normalization make key-order changes or rating 5 versus
5.0 reuse the same content revision. Stored payload remains unchanged. Observation
time is outside the content fingerprint: a later identical recapture returns the
original revision and its first observation, not a fabricated new version.
Last-seen tracking and per-upload-event audit are not implemented by this slice.

A fuller/changed payload appends a revision; replaying an older payload returns
its old revision ID. Do not interpret replay as making that version latest or
approved. Customer review selects versions explicitly in a later phase. A matching
checksum with unequal JSONB content fails closed rather than acknowledging the
wrong payload. Direct privileged administrative changes remain outside the
append-only client contract and require separate operational controls.

Initial ingestion is conservatively serialized per workspace using a transaction
advisory lock. Unique constraints provide durable identity/revision integrity.
Collision on the advisory hash may reduce throughput but never shares tenants.
Workspace throughput and multi-connection contention must be measured before
claiming production concurrency; single-runtime PGlite tests do not prove that.

## Receipts and acknowledgment

The RPC returns one receipt per input in order:
`source`, `source_review_id`, `record_id`, `revision_id`, `revision`,
`inserted_record`, `inserted_revision`.

The whole batch commits or fails. `validateFudgeReceipts` rejects partial,
reordered, wrong-identity, duplicate-ID, malformed or internally inconsistent
receipts. The release-gated uploader acknowledges only after a validated durable response;
lost responses replay the same identities/content safely. An old receipt's IDs
remain stable even after a fuller revision exists. A replay does not authorize
clearing a newer local upload intent; queue generations must be matched separately.

## Required next work before real intake

1. Review this ownership/field/identity contract and retention/deletion requirements.
   Source Sheet cleanup rules remain unconfirmed; raw upload need not guess them.
2. Migration creation/application and initial hosted advisors/smoke checks are
   complete. Still test real concurrent connections and recovery; PGlite and a
   rollback-only hosted transaction do not establish contention/restore readiness.
3. Preserve the verified grants/RLS and source/hosted mapping. Complete REST/Auth
   acceptance and backup/restore evidence; do not reset or replay migrations.
4. Review/live-validate the implemented opt-in sign-in/workspace selection, token refresh and
   durable per-review upload intents. Restrict extension host permissions to the
   reviewed target; do not package privileged secrets.
5. Keep uploads independent of existing Sheets acknowledgment. Persist local
   source+intent before scheduling network; use MV3 alarms/startup recovery,
   serialized storage mutations, generation-aware receipts, bounded backoff,
   permanent-error repair and explicit disconnect/workspace-switch behavior.
6. Test offline/restart/logout/refresh/workspace-change/lost-response/revision-race
   scenarios. Existing library migration is a separate explicit opt-in. Do not
   silently upload all historical records or delete originals after receipt.
7. Add staff intake status/reconciliation UI, then a separately approved small
   pilot. Only then mark P2 complete. Publishing, live checks and Sheet writeback
   keep their later phase gates.

Hosted smoke uses a pre-existing verified staff subject with disposable fixture
content and rolls back all fixture writes. No backup creation, real source-data
upload, Sheet update or customer operation occurred.
