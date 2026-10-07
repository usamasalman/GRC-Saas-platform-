-- Consulting engagement, sprint 6: scope, enforcement and the migration of
-- engagements that named a firm the old way.
--
-- EngagementScopeVersion is what an engagement shares with its delivery firm,
-- versioned and approved like risk appetite. EngagementAccessReview is the
-- organisation's confirmation of who from outside can see what.
-- EnforcementConfirmation is the organisation's administrator confirming it is
-- ready for its consulting rules to be enforced. Projects gain the
-- per-engagement document setting (view only or download) and when they were
-- migrated; relationships and members record that they came from a migration;
-- a flag override can take effect on a later date; a shadow refusal records
-- how it was explained.
--
-- Additive only: three new tables and nullable columns.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "documentAccess" TEXT,
ADD COLUMN     "documentAccessSetAt" TIMESTAMP(3),
ADD COLUMN     "documentAccessSetById" TEXT,
ADD COLUMN     "migratedAt" TIMESTAMP(3),
ADD COLUMN     "migratedById" TEXT;

-- AlterTable
ALTER TABLE "EngagementShadowRefusal" ADD COLUMN     "disposition" TEXT,
ADD COLUMN     "dispositionAt" TIMESTAMP(3),
ADD COLUMN     "dispositionById" TEXT,
ADD COLUMN     "dispositionNote" TEXT;

-- AlterTable
ALTER TABLE "ProviderRelationship" ADD COLUMN     "migratedAt" TIMESTAMP(3),
ADD COLUMN     "migratedById" TEXT;

-- AlterTable
ALTER TABLE "ProjectMember" ADD COLUMN     "origin" TEXT;

-- AlterTable
ALTER TABLE "FeatureFlagOverride" ADD COLUMN     "effectiveFrom" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EngagementScopeVersion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "entityIds" TEXT NOT NULL DEFAULT '[]',
    "frameworkIds" TEXT NOT NULL DEFAULT '[]',
    "services" TEXT NOT NULL DEFAULT '[]',
    "classificationCeiling" TEXT NOT NULL DEFAULT 'Internal',
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "note" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'Drafted',
    "draftedById" TEXT NOT NULL,
    "draftedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "EngagementScopeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementAccessReview" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "note" TEXT,
    "reviewedById" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngagementAccessReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnforcementConfirmation" (
    "id" TEXT NOT NULL,
    "clientTenantId" TEXT NOT NULL,
    "confirmedById" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "EnforcementConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EngagementScopeVersion_projectId_status_idx" ON "EngagementScopeVersion"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementScopeVersion_projectId_version_key" ON "EngagementScopeVersion"("projectId", "version");

-- CreateIndex
CREATE INDEX "EngagementAccessReview_projectId_reviewedAt_idx" ON "EngagementAccessReview"("projectId", "reviewedAt");

-- CreateIndex
CREATE INDEX "EnforcementConfirmation_clientTenantId_confirmedAt_idx" ON "EnforcementConfirmation"("clientTenantId", "confirmedAt");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_documentAccessSetById_fkey" FOREIGN KEY ("documentAccessSetById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_migratedById_fkey" FOREIGN KEY ("migratedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementShadowRefusal" ADD CONSTRAINT "EngagementShadowRefusal_dispositionById_fkey" FOREIGN KEY ("dispositionById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderRelationship" ADD CONSTRAINT "ProviderRelationship_migratedById_fkey" FOREIGN KEY ("migratedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementScopeVersion" ADD CONSTRAINT "EngagementScopeVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementScopeVersion" ADD CONSTRAINT "EngagementScopeVersion_draftedById_fkey" FOREIGN KEY ("draftedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementScopeVersion" ADD CONSTRAINT "EngagementScopeVersion_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementAccessReview" ADD CONSTRAINT "EngagementAccessReview_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementAccessReview" ADD CONSTRAINT "EngagementAccessReview_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnforcementConfirmation" ADD CONSTRAINT "EnforcementConfirmation_clientTenantId_fkey" FOREIGN KEY ("clientTenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnforcementConfirmation" ADD CONSTRAINT "EnforcementConfirmation_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

