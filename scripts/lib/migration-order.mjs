/**
 * scripts/lib/migration-order.mjs
 *
 * The ordered core migration list for the Supabase setup wizard.
 * Extracted from scripts/setup.mjs so tests/coreMigrations.test.mjs can
 * verify ordering contracts (file existence, no duplicates, dependency
 * rules such as "objects.sql before any migration altering public.objects").
 *
 * Contracts enforced by tests/coreMigrations.test.mjs:
 *  - Every listed file exists in migrations/ (storage.sql is generated at
 *    runtime from storage.default.sql — the template must exist instead).
 *  - No duplicates.
 *  - preamble.sql runs first (provides set_current_timestamp_updated_at()
 *    and gen_random_uuid helpers used by nearly every migration).
 *  - Any migration referencing `public.<table>` must have that table created
 *    by itself or by an earlier migration in the order.
 *  - storage.sql is only appended when STORAGE_PROVIDER === 'supabase'.
 */

export const MIGRATION_ORDER_CORE = [
  'preamble.sql',
  'user_profile.sql',
  'roles.sql',
  'employers.sql',
  'user_roles.sql',
  'mentor_groups.sql',
  'companies.sql',
  'staff_registry.sql',
  'products.sql',
  'page_schemas.sql',
  'page_schema_templates.sql',
  'managed_secrets.sql',
  'system_config.sql',
  'forms.sql',
  'forms_answers.sql',
  'forms_notifications.sql',
  'forms_notification_recipient_rls_fix.sql',
  '202609050001_forms_confirmation_and_sender_override.sql',
  '202609050002_remove_custom_from_email.sql',
  '202609050003_form_notification_message.sql',
  '202609060001_form_notification_subject.sql',
  'mail_delivery.sql',
  'forms_published_default.sql',
  'plugins.sql',
  'plugins_config_schema.sql',
  // plugins_webapps.sql adds plugins.kind/external_url/icon_url — must run
  // BEFORE 202605240006_webapps_multi_tenant.sql, which filters on `kind`.
  'plugins_webapps.sql',
  'mentorbooking_products.sql',
  'llm_specs.sql',
  '202608030002_frontend_prompt_specs.sql',
  '202608030003_global_llm_specs.sql',
  '202608030004_global_llm_specs_super_admin_policy.sql',
  'page_schema_specs.sql',
  'llm_specs_default_specy_schema_docs.sql',
  'pages.sql',
  'mentorbooking_events.sql',
  'mentorbooking_events_archive.sql',
  'mentorbooking_notifications.sql',
  'agent_logs.sql',
  'agent_logs_hardening.sql',
  '202605240001_multi_tenant_foundation.sql',
  // objects.sql creates public.objects — must run BEFORE the multi-tenant
  // backfill/RLS migrations (202605240002–005), which alter that table.
  'objects.sql',
  '202605240002_multi_tenant_backfill_and_ownership.sql',
  '202605240003_multi_tenant_rls_hardening.sql',
  '202605240004_tenant_assignment_rls_fix.sql',
  '202609070001_mail_queue_retry.sql',
  '202609070002_mail_queue_tenant_scoping.sql',
  '202605240005_console_visibility_hardening.sql',
  '202605240006_webapps_multi_tenant.sql',
  '202605250001_tenant_storage_management.sql',
  '202608300001_tenant_storage_allocation_types.sql',
  '202609030001_tenant_storage_shared_apps_scope.sql',
  '202605310001_markdown_objects.sql',
  '202605310002_markdown_object_share_scope.sql',
  '202606050001_poll_extensions.sql',
  '202606050002_poll_participant_config.sql',
  '202606200001_page_schema_visibility_fix.sql',
  '202608020001_schema_frontend_targets.sql',
  '202608020002_schema_frontend_target_rpc.sql',
  '202608020003_schema_frontend_target_precedence.sql',
  '202608020004_schema_content_scope.sql',
  '202608030001_page_publication_timestamp.sql',
  '202608050001_tenant_organization_alias.sql',
  'Auth/Access_hook.sql',
  'Auth/Access_hook_oauth_claims.sql',
  // plugin_claims registry must exist before the hook extension reads it.
  '202609090001_plugin_claims_registry.sql',
  'Auth/Access_hook_plugin_claims.sql',
  // Support-role visibility on core tables + is_support() — moved 1:1 from
  // PluraDash 009 (core/plugin boundary); must run before plugin migrations
  // that reference public.is_support().
  '202609090002_support_role_core_rls.sql',
  // Deployment-state registry (DEPLOYMENT-STATE-TRACKING) — typed replacement
  // for the core_update namespace; backfills from system_config/plugins/
  // plugin_claims, so it must run after all three.
  '202609100001_deployment_state.sql',
  // plugin_claims → plugins(id) FK (cascade) — must run after both tables.
  '202609100002_plugin_claims_ownership.sql',
];

/**
 * Full migration order for a given storage provider.
 * storage.sql is generated from storage.default.sql (bucket name substituted)
 * and is only needed for Supabase Storage — Cloudflare R2 manages its own
 * permissions outside of Supabase.
 *
 * @param {string} storageProvider 'supabase' | 'r2'
 * @returns {string[]}
 */
export function getMigrationOrder(storageProvider) {
  return [
    ...MIGRATION_ORDER_CORE,
    ...(String(storageProvider).toLowerCase() === 'supabase' ? ['storage.sql'] : []),
  ];
}
