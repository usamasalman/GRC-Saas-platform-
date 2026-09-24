-- Counts the invented usage rows in this database. READ ONLY.
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
--   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < invented-usage-find.sql

\set ON_ERROR_STOP on
BEGIN READ ONLY;

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
SELECT 'quotas' AS kind, count(*) AS invented_rows, count(DISTINCT rq."tenantId") AS organisations
  FROM "ResourceQuota" rq WHERE rq.id IN (SELECT rq.id FROM "ResourceQuota" rq JOIN invented_quota v
  ON rq."resourceType" = v.resource_type AND rq.used = v.used AND rq."limitValue" = v.limit_value)
UNION ALL
SELECT 'automation rules', count(*), count(DISTINCT ar."tenantId")
  FROM "AutomationRule" ar WHERE ar.id IN (SELECT ar.id FROM "AutomationRule" ar JOIN invented_rule v
  ON ar.name = v.name AND ar.description = v.description AND ar."triggerType" = v.trigger_type AND ar."triggerConfig" = v.trigger_config)
UNION ALL
SELECT 'rule executions (go with their rule)', count(*), NULL
  FROM "AutomationExecution" ae WHERE ae."ruleId" IN (SELECT ar.id FROM "AutomationRule" ar JOIN invented_rule v
  ON ar.name = v.name AND ar.description = v.description AND ar."triggerType" = v.trigger_type AND ar."triggerConfig" = v.trigger_config)
UNION ALL
SELECT 'import jobs', count(*), count(DISTINCT ij."tenantId")
  FROM "ImportJob" ij WHERE ij.id IN (SELECT ij.id FROM "ImportJob" ij JOIN invented_import v
  ON ij."importType" = v.import_type AND ij.source = v.source AND ij."targetDesc" = v.target_desc AND ij."totalRecords" = v.total_records);

ROLLBACK;
