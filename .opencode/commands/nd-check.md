---
description: Validate the reporting app and update delivery status
---
Run typecheck, lint, unit/database tests, and production build in apps/web. Independent checks may run in parallel, but do not race type generation and build. Investigate failures, make focused fixes, and update docs/IMPLEMENTATION-STATUS.md with actual results and remaining blockers. Do not run legacy test*.py scripts or access customer accounts. Do not commit or push.
