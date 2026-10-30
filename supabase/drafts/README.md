# Local SQL design drafts — not deployment migrations

The former `check_cohort_v1.sql` draft was promoted after explicit deployment
approval to `../migrations/20261030164030_check_cohort_v1.sql` and applied through
MCP as hosted version `20261030164030` (source filename matches hosted). Tests now
load the migration source; there is no second draft copy to deploy. See
`docs/DB-DEPLOYMENT-20261030-COHORT.md`.

The former `service_catalog_v1.sql` draft was promoted after authorization to
`../migrations/20261029165237_service_catalog_v1.sql`, applied as hosted
`20261029165416`. Follow-up FK indexes are source `20261029165727`, hosted
`20261029165815`. No second draft copy exists. See
`docs/DB-DEPLOYMENT-20261029-CATALOG.md`. Do not reapply these versions or enable
Fudge catalog downloads merely because database SQL smoke passed.

The former `fudge_ingestion_v1.sql` draft was promoted to
`../migrations/20261028203213_fudge_ingestion_v1.sql` after explicit deployment
approval, then applied through MCP as hosted version `20261028203642`. Tests now
load the migration source; there is no second draft copy to deploy.

See `docs/FUDGE-INGESTION-V1.md` and `docs/DB-DEPLOYMENT-20261028.md` for the
contract, source/hosted timestamp mapping and remaining acceptance gates. Future
drafts are not deployment instructions. Historical applied source migrations must
remain unchanged; never reset the shared database or blindly push the directory.
