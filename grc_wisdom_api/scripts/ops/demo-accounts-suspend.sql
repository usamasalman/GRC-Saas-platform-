-- Suspends the demo seed's accounts. Deletes nothing.
--
-- Run demo-accounts-find.sql first and read its list.
--
-- Suspended, not deleted: 168 relations in the schema delete along with a
-- user, so deleting a demo account would take everything it owns with it.
-- 'Suspended' is refused at sign-in and on every request (authController,
-- authMiddleware), and clearing the refresh token ends any open session.
-- It can be undone per account in Users & Access.
--
-- On the server, from the directory holding docker-compose.yml:
--
--   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < demo-accounts-suspend.sql
--
-- Two guards: addresses in keep(email) below are never touched, and if the
-- result would leave no active account on the platform itself, the whole
-- change is rolled back and nothing happens.
--
-- This is a direct database change, so it is not in the product's audit
-- trail. Record that it was run, when and by whom, in your change log.

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE keep(email text PRIMARY KEY) ON COMMIT DROP;
-- An address from the demo list that you really sign in with goes here,
-- lower case, one line each. For example:
-- INSERT INTO keep VALUES ('someone@grcwisdom.com');

WITH demo(email) AS (VALUES
  ('alex.rivera@globalbank.com'),
  ('asm@grcwisdom.com'),
  ('asset.owner@omniops.me'),
  ('billing@grcwisdom.com'),
  ('business.madinah@hayathospitals.com'),
  ('company.admin@omniops.me'),
  ('compliance.madinah@hayathospitals.com'),
  ('compliance@retailco.com'),
  ('consultant@grcconsulting.com'),
  ('eleanor.vance@globalbank.com'),
  ('engagement.manager@grcconsulting.com'),
  ('experience.madinah@hayathospitals.com'),
  ('finance.madinah@hayathospitals.com'),
  ('finance.manager@omniops.me'),
  ('finance@globalbank.com'),
  ('finance@grcconsulting.com'),
  ('finance@retailco.com'),
  ('franchisee.admin@retailco.com'),
  ('franchisor.admin@retailco.com'),
  ('grc.manager@omniops.me'),
  ('group.admin@alnoor.com'),
  ('group.compliance@alnoor.com'),
  ('group.finance@alnoor.com'),
  ('group.hr@alnoor.com'),
  ('group.risk@alnoor.com'),
  ('hr.madinah@hayathospitals.com'),
  ('hr.manager@omniops.me'),
  ('hr@globalbank.com'),
  ('hr@grcconsulting.com'),
  ('hr@grcwisdom.com'),
  ('hr@retailco.com'),
  ('internal.audit@omniops.me'),
  ('marcus.thorne@auditco.com'),
  ('marketplace@grcwisdom.com'),
  ('network.admin@givc.com.sa'),
  ('network.support@retailco.com'),
  ('owner@grcwisdom.com'),
  ('partner.owner@grcconsulting.com'),
  ('post.sales@grcconsulting.com'),
  ('postsales@alnoor.com'),
  ('postsales@globalbank.com'),
  ('postsales@grcwisdom.com'),
  ('postsales@omniops.me'),
  ('postsales@retailco.com'),
  ('presales@alnoor.com'),
  ('presales@globalbank.com'),
  ('presales@grcconsulting.com'),
  ('presales@grcwisdom.com'),
  ('presales@omniops.me'),
  ('presales@retailco.com'),
  ('risk.madinah@hayathospitals.com'),
  ('risk.manager@omniops.me'),
  ('risk@globalbank.com'),
  ('risk@grcconsulting.com'),
  ('risk@grcwisdom.com'),
  ('risk@retailco.com'),
  ('sarah.jenkins@globalbank.com'),
  ('security.manager@omniops.me'),
  ('security@grcwisdom.com'),
  ('servicedesk@grcwisdom.com'),
  ('success@grcwisdom.com'),
  ('support.coordinator@omniops.me'),
  ('support.madinah@hayathospitals.com'),
  ('support@alnoor.com'),
  ('support@globalbank.com'),
  ('top.management@omniops.me')
)
UPDATE "User" u
SET status = 'Suspended', "refreshTokenHash" = NULL, "refreshTokenExpiresAt" = NULL
WHERE lower(u.email) IN (SELECT email FROM demo)
  AND lower(u.email) NOT IN (SELECT email FROM keep)
  AND u.status = 'Active'
RETURNING u.email, u.role, u.status;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "User" u JOIN "Tenant" t ON t.id = u."tenantId"
    WHERE t.type IN ('SAAS', 'SAAS_UNIT') AND u.status = 'Active'
  ) THEN
    RAISE EXCEPTION 'This would leave no active platform account, so nothing was changed. Put the address you sign in with into keep and run it again.';
  END IF;
END $$;

COMMIT;
