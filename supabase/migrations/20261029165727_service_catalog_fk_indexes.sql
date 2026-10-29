-- Additive follow-up from hosted post-deployment advisor inspection.
create index reporting_catalog_activation_revision_fk
  on public.reporting_service_catalog_activations(organization_id,revision_id);
create index reporting_catalog_head_revision_fk
  on public.reporting_service_catalog_heads(organization_id,active_revision_id);
