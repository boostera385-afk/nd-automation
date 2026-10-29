# Local SQL design drafts — not deployment migrations

`service_catalog_v1.sql` is a local tested design for immutable service rules,
version-checked staging/activation and a published snapshot RPC. It is **not
deployed**, not part of migration history, and not authorization to apply it.
See `docs/SERVICE-CONFIGURATION.md`; local PGlite tests do not prove hosted
concurrency/Auth/REST acceptance. Do not enable Fudge catalog downloads against
this draft until review, migration promotion and separate deployment acceptance.

The former `fudge_ingestion_v1.sql` draft was promoted to
`../migrations/20261028203213_fudge_ingestion_v1.sql` after explicit deployment
approval, then applied through MCP as hosted version `20261028203642`. Tests now
load the migration source; there is no second draft copy to deploy.

See `docs/FUDGE-INGESTION-V1.md` and `docs/DB-DEPLOYMENT-20261028.md` for the
contract, source/hosted timestamp mapping and remaining acceptance gates. Future
drafts are not deployment instructions. Historical applied source migrations must
remain unchanged; never reset the shared database or blindly push the directory.
