-- Follow-up index for the writeback outbox (advisor finding, same pattern as the
-- service catalog FK-index follow-up): the outbox FK on created_by has no
-- covering index, which makes user deletion/update scans suboptimal. Additive
-- only; no permissions or function changes.
create index reporting_writeback_creator_fk on public.reporting_sheet_writeback_outbox(created_by);
