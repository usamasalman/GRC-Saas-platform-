-- Removes the invented usage rows. Run invented-usage-find.sql first.
--
-- Until QA-015 was fixed, opening the usage screens inserted invented rows for
-- every organisation that had none: quotas ("API calls 8,400 of 10,000"),
-- automation rules that had "run 142 times", and import jobs that never ran.
-- They then showed as that organisation's real usage.
--
-- A row is matched only on every value the old code wrote, so a quota someone
-- has since changed, or a rule someone has since edited, does not match and is
-- left alone.
--
-- On the server, from the directory holding docker-compose.yml:
--
--   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < invented-usage-remove.sql
--
-- One transaction: all of it or none of it. An invented rule's executions go
-- with it (they cascade), and they are as invented as the rule.
--
-- This is a direct database change, so it is not in the product's audit
-- trail. Record that it was run, when and by whom, in your change log.

\set ON_ERROR_STOP on
BEGIN;

WITH invented_quota(resource_type, used, limit_value) AS (VALUES
  ('Users', 34, 75),
  ('Storage', 42, 200),
  ('Documents', 187, 500),
  ('ApiCalls', 8400, 10000),
  ('Workflows', 12, 50),
  ('Integrations', 3, 10)
), invented_rule(name, description, trigger_type, trigger_config) AS (VALUES
  ('Daily Compliance Sync', 'Pull NCA ECC updates and sync control mappings to tenant standards library.', 'Scheduled', '0 2 * * *'),
  ('SLA Breach Escalation', 'Monitor open tickets approaching SLA breach and escalate to manager.', 'Event', 'ticket.sla_warning'),
  ('Weekly Risk Report', 'Generate consolidated risk report PDF and email to risk committee.', 'Scheduled', '0 8 * * 1'),
  ('User Deprovisioning', 'Auto-disable users 90 days after last login and revoke API keys.', 'Scheduled', '0 0 * * *'),
  ('Evidence Collection Reminder', 'Send reminder notifications for controls with evidence due within 7 days.', 'Scheduled', '0 9 * * *')
), invented_import(import_type, source, target_desc, total_records) AS (VALUES
  ('CsvUpload', 'users_export_2026.csv', 'User Directory', 245),
  ('ApiSync', 'SAP GRC API /risks', 'Risk Register', 128),
  ('TenantMigration', 'Legacy GRC v2.1 Export', 'Al-Rajhi Holding Group → New Tenant', 1420),
  ('CsvUpload', 'controls_iso27001_baseline.csv', 'Control Library', 114),
  ('ApiSync', 'Qualys VMDR API', 'ASM Asset Inventory', 342)
)
, gone_quotas AS (DELETE FROM "ResourceQuota" WHERE id IN (SELECT rq.id FROM "ResourceQuota" rq JOIN invented_quota v
  ON rq."resourceType" = v.resource_type AND rq.used = v.used AND rq."limitValue" = v.limit_value) RETURNING 1)
, gone_rules AS (DELETE FROM "AutomationRule" WHERE id IN (SELECT ar.id FROM "AutomationRule" ar JOIN invented_rule v
  ON ar.name = v.name AND ar.description = v.description AND ar."triggerType" = v.trigger_type AND ar."triggerConfig" = v.trigger_config) RETURNING 1)
, gone_imports AS (DELETE FROM "ImportJob" WHERE id IN (SELECT ij.id FROM "ImportJob" ij JOIN invented_import v
  ON ij."importType" = v.import_type AND ij.source = v.source AND ij."targetDesc" = v.target_desc AND ij."totalRecords" = v.total_records) RETURNING 1)
SELECT (SELECT count(*) FROM gone_quotas) AS quotas_removed,
       (SELECT count(*) FROM gone_rules) AS rules_removed,
       (SELECT count(*) FROM gone_imports) AS import_jobs_removed;

COMMIT;
